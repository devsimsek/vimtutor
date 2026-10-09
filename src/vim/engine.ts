// The vim engine: a pure key-to-state machine.
// applyKey(state, key) -> new state. The UI renders from state.
// Windows: layout tree with one cursor per window; s.cursor mirrors the
// active window and is saved back on focus moves.

import type {
  Cursor,
  EngineState,
  FloatState,
  LayoutNode,
  OpPending,
  PromptAction,
  Range,
} from "./types";
import {
  activeBuffer,
  clampCursor,
  deleteLines,
  deleteRange,
  indentLines,
  joinLines,
  putText,
  snapshotForUndo,
  toggleComment,
  yankRange,
} from "./ops";
import {
  charClass,
  firstNonBlank,
  indentOf,
  matchBracketBuf,
  nextWordStart,
  prevWordStart,
  wordEnd,
  isWordChar,
} from "./text";
import { cwordAt, nextMatch } from "./search";
import { parseSubstitute, runCommand, runSubstitute } from "./commands";
import { applyGoTag, removeGoTags } from "./gopher";
import { closeBuffer, cycleBuffer, ensureBuffer } from "./buffers";
import { parentOf, toggleTree, treeKey } from "./tree";
import { closeTelescope, openTelescope, telescopeKey } from "./telescope";

// ------------------------------------------------------------------ clone

export function cloneState(s: EngineState): EngineState {
  return {
    ...s,
    buffers: s.buffers.map((b) => ({
      ...b,
      lines: [...b.lines],
      undoStack: b.undoStack.map((l) => [...l]),
      redoStack: b.redoStack.map((l) => [...l]),
    })),
    cursor: { ...s.cursor },
    visualAnchor: s.visualAnchor ? { ...s.visualAnchor } : null,
    lastVisual: s.lastVisual
      ? { ...s.lastVisual, anchor: { ...s.lastVisual.anchor }, cursor: { ...s.lastVisual.cursor } }
      : null,
    wins: s.wins.map((w) => ({ ...w, cursor: { ...w.cursor } })),
    layout: cloneLayout(s.layout),
    pendingOp: s.pendingOp ? { ...s.pendingOp } : null,
    pendingSurround: s.pendingSurround
      ? ({
          ...s.pendingSurround,
          ...(s.pendingSurround.stage === "pair" ? { range: { ...s.pendingSurround.range } } : {}),
        } as EngineState["pendingSurround"])
      : null,
    pendingFind: s.pendingFind ? { ...s.pendingFind } : null,
    searchState: s.searchState ? { ...s.searchState } : null,
    pendingOpForObj: s.pendingOpForObj ? { ...s.pendingOpForObj } : null,
    blockInsert: s.blockInsert ? { ...s.blockInsert, rows: [...s.blockInsert.rows] } : null,
    visualLines: s.visualLines ? { ...s.visualLines } : null,
    tree: { ...s.tree, files: s.tree.files.map((f) => ({ ...f })), cut: s.tree.cut ? { ...s.tree.cut } : null },
    telescope: s.telescope ? { ...s.telescope } : null,
    diagnostics: Object.fromEntries(
      Object.entries(s.diagnostics).map(([k, v]) => [k, v.map((d) => ({ ...d }))])
    ),
    gitHunks: Object.fromEntries(
      Object.entries(s.gitHunks).map(([k, v]) => [k, v.map((d) => ({ ...d }))])
    ),
    float: s.float ? { ...s.float, text: s.float.text ? [...s.float.text] : undefined, items: s.float.items?.map((i) => ({ ...i })) } : null,
    tabs: s.tabs.map((t) => ({ ...t, bufIds: [...t.bufIds] })),
    promptAction: { ...s.promptAction } as PromptAction,
    lastChange: s.lastChange ? [...s.lastChange] : null,
    recordingChange: s.recordingChange ? [...s.recordingChange] : null,
  };
}

function cloneLayout(n: LayoutNode): LayoutNode {
  if (n.type === "leaf") return { type: "leaf", win: n.win };
  return {
    type: n.type,
    children: n.children.map(cloneLayout),
    weights: n.weights ? [...n.weights] : undefined,
  };
}

// ------------------------------------------------------------------ init

export function initEngine(): EngineState {
  return {
    buffers: [
      {
        id: "0",
        name: "[No Name]",
        filetype: "txt",
        lines: [""],
        undoStack: [],
        redoStack: [],
      },
    ],
    activeBuf: 0,
    cursor: { row: 0, col: 0 },
    desiredCol: null,
    mode: "normal",
    visualAnchor: null,
    lastVisual: null,
    wins: [{ id: 0, bufIdx: 0, cursor: { row: 0, col: 0 }, desiredCol: null }],
    activeWin: 0,
    layout: { type: "leaf", win: 0 },
    pendingOp: null,
    pendingFind: null,
    pendingG: false,
    pendingD: false,
    bracketDir: 1,
    pendingLeader: false,
    leaderSeq: "",
    pendingReplace: false,
    pendingTextObj: false,
    pendingObjAround: false,
    pendingOpForObj: null,
    pendingSurround: null,
    count: "",
    register: "",
    linewise: false,
    blockAnchorCol: 0,
    lastFind: null,
    searchState: null,
    hlSearch: false,
    cmdKind: ":",
    cmd: "",
    promptAction: { kind: "none" },
    message: "",
    lastChange: null,
    recordingChange: null,
    blockInsert: null,
    visualLines: null,
    tree: {
      open: false,
      focused: false,
      files: [],
      selected: null,
      cut: null,
      message: "",
    },
    telescope: null,
    diagnostics: {},
    gitHunks: {},
    float: null,
    troubleOpen: false,
    troubleSelected: 0,
    tabs: [{ name: "main", bufIds: [0] }],
    activeTab: 0,
    focus: "editor",
  };
}

// ------------------------------------------------------------------ windows

let nextWinId = 1000;

function newWin(s: EngineState, bufIdx: number): number {
  const id = nextWinId++;
  s.wins.push({ id, bufIdx, cursor: { ...s.cursor }, desiredCol: null });
  return id;
}

function replaceLeaf(n: LayoutNode, winId: number, replacement: LayoutNode): boolean {
  if (n.type === "leaf") return false;
  for (let i = 0; i < n.children.length; i++) {
    const c = n.children[i];
    if (c.type === "leaf" && c.win === winId) {
      n.children[i] = replacement;
      return true;
    }
    if (replaceLeaf(c, winId, replacement)) return true;
  }
  return false;
}

function removeLeaf(n: LayoutNode, winId: number): LayoutNode | null {
  if (n.type === "leaf") return null;
  const newChildren: LayoutNode[] = [];
  for (const c of n.children) {
    if (c.type === "leaf" && c.win === winId) continue;
    newChildren.push(c);
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  return { type: n.type, children: newChildren, weights: n.weights ? [...n.weights] : undefined };
}

/** C-w s: horizontal split (below). C-w v: vertical split (right). */
function splitWindow(s: EngineState, dir: "col" | "row") {
  const curWinId = s.activeWin;
  const newId = newWin(s, s.activeBuf);
  const leaf: LayoutNode = { type: "leaf", win: newId };
  if (s.layout.type === "leaf" && s.layout.win === curWinId) {
    s.layout = { type: dir, children: [{ type: "leaf", win: curWinId }, leaf] };
  } else {
    replaceLeaf(s.layout, curWinId, { type: dir, children: [{ type: "leaf", win: curWinId }, leaf] });
  }
  s.message =
    dir === "col"
      ? "split below (<leader>w- / C-w s)"
      : "split right (<leader>w| / C-w v)";
}

function closeWindow(s: EngineState) {
  if (s.wins.length <= 1) {
    s.message = "E444: last window, not closing (your tab is the :q)";
    return;
  }
  const closing = s.activeWin;
  s.wins = s.wins.filter((w) => w.id !== closing);
  const next = s.wins[0];
  const stripped = removeLeaf(s.layout, closing);
  s.layout = stripped ?? { type: "leaf", win: next.id };
  s.activeWin = next.id;
  s.activeBuf = next.bufIdx;
  s.cursor = { ...next.cursor };
  s.desiredCol = next.desiredCol;
  s.message = "window closed";
}

export interface Rect {
  top: number;
  height: number;
  left: number;
  width: number;
}

const VIRTUAL_ROWS = 30;
const VIRTUAL_COLS = 100;

/** Compute each leaf's rect from the layout with weights. */
export function winRects(layout: LayoutNode): Map<number, Rect> {
  const out = new Map<number, Rect>();
  const walk = (node: LayoutNode, rect: Rect) => {
    if (node.type === "leaf") {
      out.set(node.win, rect);
      return;
    }
    const n = node.children.length;
    const weights = node.weights && node.weights.length === n ? node.weights : node.children.map(() => 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let offset = node.type === "row" ? rect.left : rect.top;
    for (let i = 0; i < n; i++) {
      const frac = weights[i] / total;
      if (node.type === "row") {
        const w = Math.max(4, Math.round(rect.width * frac));
        walk(node.children[i], {
          top: rect.top,
          height: rect.height,
          left: offset,
          width: Math.min(w, rect.left + rect.width - offset),
        });
        offset += w;
      } else {
        const h = Math.max(2, Math.round(rect.height * frac));
        walk(node.children[i], {
          top: offset,
          height: Math.min(h, rect.top + rect.height - offset),
          left: rect.left,
          width: rect.width,
        });
        offset += h;
      }
    }
  };
  walk(layout, { top: 0, height: VIRTUAL_ROWS, left: 0, width: VIRTUAL_COLS });
  return out;
}

/** C-h/j/k/l: focus the neighbouring window in that direction. */
function focusDirection(s: EngineState, dir: "h" | "j" | "k" | "l") {
  saveActiveWin(s);
  const rects = winRects(s.layout);
  const me = rects.get(s.activeWin);
  if (!me) return;
  const cx = me.left + me.width / 2;
  const cy = me.top + me.height / 2;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const [id, r] of rects) {
    if (id === s.activeWin) continue;
    const ox = r.left + r.width / 2;
    const oy = r.top + r.height / 2;
    if (dir === "l" && r.left < me.left + me.width) continue;
    if (dir === "h" && r.left + r.width > me.left + 1) continue;
    if (dir === "j" && r.top < me.top + me.height) continue;
    if (dir === "k" && r.top + r.height > me.top + 1) continue;
    // vertical overlap for h/l, horizontal for j/k
    const overlapV = Math.min(me.top + me.height, r.top + r.height) - Math.max(me.top, r.top);
    const overlapH = Math.min(me.left + me.width, r.left + r.width) - Math.max(me.left, r.left);
    if ((dir === "h" || dir === "l") && overlapV <= 0) continue;
    if ((dir === "j" || dir === "k") && overlapH <= 0) continue;
    const d = Math.abs(ox - cx) + Math.abs(oy - cy);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  if (best === null) {
    s.message = `no window ${dir === "h" ? "left" : dir === "l" ? "right" : dir === "j" ? "below" : "above"}`;
    return;
  }
  setActiveWin(s, best);
}

function saveActiveWin(s: EngineState) {
  const w = s.wins.find((x) => x.id === s.activeWin);
  if (!w) return;
  w.cursor = { ...s.cursor };
  w.desiredCol = s.desiredCol;
  w.bufIdx = s.activeBuf;
}

function setActiveWin(s: EngineState, id: number) {
  saveActiveWin(s);
  s.activeWin = id;
  const w = s.wins.find((x) => x.id === id);
  if (!w) return;
  s.activeBuf = w.bufIdx;
  s.cursor = { ...w.cursor };
  s.desiredCol = w.desiredCol;
  // visual mode is per-window; exiting on focus move keeps things sane
  if (s.mode.startsWith("v")) {
    s.mode = "normal";
    s.visualAnchor = null;
  }
}

function equalizeWindows(s: EngineState) {
  clearWeights(s.layout);
  s.message = "windows equalized (<leader>we)";
}

function clearWeights(n: LayoutNode) {
  if (n.type === "leaf") return;
  n.weights = undefined;
  n.children.forEach(clearWeights);
}

function adjustSize(s: EngineState, delta: 1 | -1) {
  // find parent of active leaf that is a row (vertical splits share width)
  const found = findParentOf(s.layout, s.activeWin, "row");
  if (!found) {
    s.message = "not in a vertical split (<leader>w| first)";
    return;
  }
  const idx = found.children.findIndex((c) => c.type === "leaf" && c.win === s.activeWin);
  const weights = found.weights && found.weights.length === found.children.length ? [...found.weights] : found.children.map(() => 1);
  weights[idx] = Math.max(0.5, weights[idx] + delta * 0.25);
  found.weights = weights;
  s.message = delta === 1 ? "wider (<leader>w.)" : "narrower (<leader>w,)";
}

function findParentOf(n: LayoutNode, winId: number, type: "row" | "col"): { type: "row" | "col"; children: LayoutNode[]; weights?: number[] } | null {
  if (n.type === "leaf") return null;
  for (const c of n.children) {
    if (c.type === "leaf" && c.win === winId && n.type === type) return n;
    const r = findParentOf(c, winId, type);
    if (r) return r;
  }
  return null;
}

// ------------------------------------------------------------------ leader

const LEADER_KEYS = [
  "e", "E", "ff", "fg", "fb", "st", "w-", "w|", "we", "w,", "w.", "bd", "tn", "tl", "th", "tc",
  "nh", "sr", "ga", "gA", "gx", "gs", "gr", "gd", "gp", "gb", "xx", "xw",
  "rn", "ca", "d", "pd", "q", "Q",
];

const LEADER_HELP: [string, string][] = [
  ["e / E", "toggle / reveal file tree"],
  ["ff / fg / fb", "find files / grep / buffers"],
  ["st", "search TODOs"],
  ["sr", "search & replace (:%s/ )"],
  ["ga / gA / gx", "go: add json tags / add named / remove"],
  ["gs / gr / gd / gp / gb", "git: stage / reset / diff / preview / blame"],
  ["xx / xw", "trouble: diagnostics"],
  ["ca / rn", "code actions / lsp rename"],
  ["d / pd", "diagnostic float / peek definition"],
  ["w- / w| / we", "splits: below / right / equalize"],
  ["w, / w.", "shrink / grow split"],
  ["bd", "delete buffer"],
  ["tn / tl / th / tc", "tabs"],
  ["nh / q / Q", "nohlsearch / quit window / quit all"],
];

function showWhichKey(s: EngineState) {
  s.float = {
    kind: "whichkey",
    text: LEADER_HELP.map(([k, d]) => `<leader>${k.padEnd(16)} ${d}`),
  };
}

function leaderAction(s: EngineState, seq: string) {
  const buf = activeBuffer(s);
  switch (seq) {
    case "e":
      toggleTree(s);
      return;
    case "E": {
      toggleTree(s);
      const name = buf.name;
      if (s.tree.files.find((f) => f.path === name)) {
        s.tree.selected = name;
        s.tree.message = `revealed ${name}`;
      }
      return;
    }
    case "ff":
      openTelescope(s, "files");
      return;
    case "fg":
      openTelescope(s, "grep");
      return;
    case "fb":
      openTelescope(s, "buffers");
      return;
    case "st":
      openTelescope(s, "todos");
      return;
    case "sr":
      s.mode = "cmd";
      s.cmdKind = ":";
      s.cmd = "%s/";
      return;
    case "nh":
      s.hlSearch = false;
      s.message = "search highlight cleared";
      return;
    case "bd":
      closeBuffer(s, s.activeBuf);
      return;
    case "tn": {
      const id = s.buffers.indexOf(buf);
      s.tabs.push({ name: `tab ${s.tabs.length + 1}`, bufIds: [id] });
      s.activeTab = s.tabs.length - 1;
      s.message = `tab ${s.activeTab + 1} created`;
      return;
    }
    case "tl": {
      s.activeTab = (s.activeTab + 1) % s.tabs.length;
      s.activeBuf = s.tabs[s.activeTab].bufIds[0];
      s.message = `tab ${s.activeTab + 1}`;
      return;
    }
    case "th": {
      s.activeTab = (s.activeTab - 1 + s.tabs.length) % s.tabs.length;
      s.activeBuf = s.tabs[s.activeTab].bufIds[0];
      s.message = `tab ${s.activeTab + 1}`;
      return;
    }
    case "tc": {
      if (s.tabs.length <= 1) {
        s.message = "E444: last tab";
        return;
      }
      s.tabs.splice(s.activeTab, 1);
      s.activeTab = Math.max(0, s.activeTab - 1);
      s.activeBuf = s.tabs[s.activeTab].bufIds[0];
      return;
    }
    case "q":
      if (s.wins.length > 1) {
        closeWindow(s);
      } else {
        s.message = "this is a web mock, the tab is your :q";
      }
      return;
    case "Q":
      s.message = "force quit? close the browser tab, allahsiz";
      return;
    case "ga":
      applyGoTag(s, "json");
      return;
    case "gA":
      s.mode = "prompt";
      s.cmdKind = "prompt";
      s.promptAction = { kind: "gopher-tag" };
      s.cmd = "json";
      return;
    case "gx":
      removeGoTags(s, undefined);
      return;
    case "gs":
      gitStageHunk(s);
      return;
    case "gr":
      gitResetHunk(s);
      return;
    case "gd":
      gitPreviewHunk(s);
      return;
    case "gp":
      gitPreviewHunk(s);
      return;
    case "gb": {
      const r = s.cursor.row;
      s.float = {
        kind: "diagnostic",
        text: [
          `${buf.name}:${r + 1}`,
          "author: you (devsimsek)",
          "date: today, obviously",
          "summary: " + (buf.lines[r] ?? "").trim().slice(0, 40),
        ],
      };
      return;
    }
    case "xx":
    case "xw":
      s.troubleOpen = true;
      s.troubleSelected = 0;
      s.focus = "trouble";
      return;
    case "rn": {
      const { word } = cwordAt(buf.lines, s.cursor);
      s.mode = "prompt";
      s.cmdKind = "prompt";
      s.promptAction = { kind: "lsp-rename", symbol: word };
      s.cmd = word;
      return;
    }
    case "ca":
      openCodeActions(s);
      return;
    case "d": {
      const under = diagnosticUnder(s);
      if (!under) {
        s.message = "no diagnostic on this line";
        return;
      }
      s.float = {
        kind: "diagnostic",
        text: [`${under.severity}: ${under.msg}`, `at ${buf.name}:${under.row + 1}:${under.col + 1}`],
      };
      return;
    }
    case "pd":
      lspHover(s);
      return;
    case "w-":
      splitWindow(s, "col");
      return;
    case "w|":
      splitWindow(s, "row");
      return;
    case "we":
      equalizeWindows(s);
      return;
    case "w,":
      adjustSize(s, -1);
      return;
    case "w.":
      adjustSize(s, 1);
      return;
    default:
      return;
  }
}

// ------------------------------------------------------------------ motions

interface MotionResult {
  cursor: Cursor | null;
  linewise?: [number, number];
  exclusiveEnd?: boolean;
  inclusiveEnd?: boolean;
}

/** Resolve a motion key to a cursor target. count already applied. */
function motion(s: EngineState, key: string, count: number): MotionResult {
  const lines = activeBuffer(s).lines;
  const cur = s.cursor;
  const lineAt = (r: number) => lines[r] ?? "";
  const clampRow = (r: number) => Math.max(0, Math.min(r, lines.length - 1));

  switch (key) {
    case "h":
    case "Left": {
      let col = cur.col;
      for (let i = 0; i < count; i++) col = Math.max(0, col - 1);
      return { cursor: { row: cur.row, col } };
    }
    case "l":
    case "Right": {
      const max = Math.max(0, lineAt(cur.row).length - 1);
      let col = cur.col;
      for (let i = 0; i < count; i++) col = Math.min(max, col + 1);
      return { cursor: { row: cur.row, col } };
    }
    case "j":
    case "Down": {
      const target = clampRow(cur.row + count);
      const col = s.desiredCol ?? cur.col;
      return {
        cursor: { row: target, col },
        linewise: [Math.min(cur.row, target), Math.max(cur.row, target)],
      };
    }
    case "k":
    case "Up": {
      const target = clampRow(cur.row - count);
      const col = s.desiredCol ?? cur.col;
      return {
        cursor: { row: target, col },
        linewise: [Math.min(target, cur.row), Math.max(target, cur.row)],
      };
    }
    case "w": {
      let pos: Cursor = { ...cur };
      for (let i = 0; i < count; i++) {
        const n = nextWordStart(lines, pos.row, pos.col);
        if (!n) break;
        pos = n;
      }
      return { cursor: pos, exclusiveEnd: true };
    }
    case "b": {
      let pos: Cursor = { ...cur };
      for (let i = 0; i < count; i++) {
        const n = prevWordStart(lines, pos.row, pos.col);
        if (!n) break;
        pos = n;
      }
      return { cursor: pos };
    }
    case "e": {
      let pos: Cursor = { ...cur };
      for (let i = 0; i < count; i++) {
        const n = wordEnd(lines, pos.row, pos.col);
        if (!n) break;
        pos = n;
      }
      return { cursor: pos, inclusiveEnd: true };
    }
    case "W": {
      let pos: Cursor = { ...cur };
      for (let i = 0; i < count; i++) {
        const n = bigWordStart(lines, pos.row, pos.col, 1);
        if (!n) break;
        pos = n;
      }
      return { cursor: pos, exclusiveEnd: true };
    }
    case "B": {
      let pos: Cursor = { ...cur };
      for (let i = 0; i < count; i++) {
        const n = bigWordStart(lines, pos.row, pos.col, -1);
        if (!n) break;
        pos = n;
      }
      return { cursor: pos };
    }
    case "E": {
      let pos: Cursor = { ...cur };
      for (let i = 0; i < count; i++) {
        const n = bigWordEnd(lines, pos.row, pos.col);
        if (!n) break;
        pos = n;
      }
      return { cursor: pos, inclusiveEnd: true };
    }
    case "0":
      return { cursor: { row: cur.row, col: 0 } };
    case "^":
      return { cursor: { row: cur.row, col: firstNonBlank(lineAt(cur.row)) } };
    case "$":
      return {
        cursor: { row: cur.row, col: Math.max(0, lineAt(cur.row).length - 1) },
        inclusiveEnd: true,
      };
    case "G": {
      const target = count > 1 ? clampRow(count - 1) : lines.length - 1;
      return {
        cursor: { row: target, col: firstNonBlank(lineAt(target)) },
        linewise: [Math.min(cur.row, target), Math.max(cur.row, target)],
      };
    }
    case "{": {
      let r = cur.row;
      for (let i = 0; i < count; i++) {
        r--;
        while (r > 0 && lineAt(r).trim() !== "") r--;
      }
      r = clampRow(r);
      return { cursor: { row: r, col: 0 }, linewise: [Math.min(cur.row, r), Math.max(cur.row, r)] };
    }
    case "}": {
      let r = cur.row;
      for (let i = 0; i < count; i++) {
        r++;
        while (r < lines.length - 1 && lineAt(r).trim() !== "") r++;
      }
      r = clampRow(r);
      return { cursor: { row: r, col: 0 }, linewise: [Math.min(cur.row, r), Math.max(cur.row, r)] };
    }
    case "%": {
      const target = matchBracketBuf(lines, cur.row, cur.col);
      if (!target) return { cursor: null };
      return { cursor: target, inclusiveEnd: true };
    }
    case "f":
    case "F":
    case "t":
    case "T": {
      s.pendingFind = { type: key, char: "" };
      return { cursor: null };
    }
    case ";": {
      if (!s.lastFind) return { cursor: null };
      return findRepeat(lines, cur, s.lastFind.type, s.lastFind.char, count);
    }
    case ",": {
      if (!s.lastFind) return { cursor: null };
      const flip: Record<string, "f" | "t" | "F" | "T"> = { f: "F", t: "T", F: "f", T: "t" };
      return findRepeat(lines, cur, flip[s.lastFind.type], s.lastFind.char, count);
    }
    case "CR": {
      const target = clampRow(cur.row + 1);
      return {
        cursor: { row: target, col: firstNonBlank(lineAt(target)) },
        linewise: [cur.row, target],
      };
    }
    case "n": {
      if (!s.searchState) return { cursor: null };
      const m = nextMatch(lines, cur, s.searchState.term, 1, true);
      if (!m) return { cursor: null };
      return { cursor: { row: m.row, col: m.col } };
    }
    case "N": {
      if (!s.searchState) return { cursor: null };
      const m = nextMatch(lines, cur, s.searchState.term, -1, true);
      if (!m) return { cursor: null };
      return { cursor: { row: m.row, col: m.col } };
    }
    case "*": {
      const { word } = cwordAt(lines, cur);
      if (!word) return { cursor: null };
      s.searchState = { term: word, dir: 1 };
      s.hlSearch = true;
      const m = nextMatch(lines, cur, word, 1, false);
      if (m) return { cursor: { row: m.row, col: m.col } };
      return { cursor: null };
    }
    case "#": {
      const { word } = cwordAt(lines, cur);
      if (!word) return { cursor: null };
      s.searchState = { term: word, dir: -1 };
      s.hlSearch = true;
      const m = nextMatch(lines, cur, word, -1, false);
      if (m) return { cursor: { row: m.row, col: m.col } };
      return { cursor: null };
    }
    default:
      return { cursor: null };
  }
}

function findMotion(
  lines: string[],
  cur: Cursor,
  type: "f" | "t" | "F" | "T",
  char: string,
  count: number
): Cursor | null {
  let { row, col } = cur;
  for (let i = 0; i < count; i++) {
    const line = lines[row] ?? "";
    if (type === "f" || type === "t") {
      let idx = -1;
      for (let c = col + 1; c < line.length; c++) {
        if (line[c] === char) {
          idx = c;
          break;
        }
      }
      if (idx === -1) return i > 0 ? { row, col } : null;
      if (type === "t") {
        while (idx > col + 1 && line[idx - 1] === char) {
          const nx = line.indexOf(char, idx + 1);
          if (nx === -1) return null;
          idx = nx;
        }
        idx = idx - 1;
      }
      col = idx;
    } else {
      let idx = -1;
      for (let c = col - 1; c >= 0; c--) {
        if (line[c] === char) {
          idx = c;
          break;
        }
      }
      if (idx === -1) return i > 0 ? { row, col } : null;
      if (type === "T") {
        while (idx < col - 1 && line[idx + 1] === char) {
          const nx = line.lastIndexOf(char, idx - 1);
          if (nx === -1) return null;
          idx = nx;
        }
        idx = idx + 1;
      }
      col = idx;
    }
  }
  return { row, col };
}

function findRepeat(
  lines: string[],
  cur: Cursor,
  type: "f" | "t" | "F" | "T",
  char: string,
  count: number
): MotionResult {
  const target = findMotion(lines, cur, type, char, count);
  return { cursor: target, inclusiveEnd: type === "f" || type === "t" };
}

function bigWordStart(lines: string[], row: number, col: number, dir: 1 | -1): Cursor | null {
  let r = row;
  let c = col;
  for (let guard = 0; guard < 10000; guard++) {
    const line = lines[r] ?? "";
    if (dir === 1) {
      if (c >= line.length) {
        if (r + 1 >= lines.length) return null;
        r++;
        c = 0;
        continue;
      }
      if (line[c] === " ") {
        c++;
        continue;
      }
      while (c < line.length && line[c] !== " ") c++;
      return { row: r, col: c };
    }
    if (c <= 0) {
      if (r === 0) return null;
      r--;
      c = Math.max(0, (lines[r] ?? "").length - 1);
      continue;
    }
    while (c > 0 && line[c - 1] === " ") c--;
    if (c <= 0) {
      if (r === 0) return null;
      r--;
      c = Math.max(0, (lines[r] ?? "").length - 1);
      continue;
    }
    while (c > 0 && line[c - 1] !== " ") c--;
    return { row: r, col: c };
  }
  return null;
}

function bigWordEnd(lines: string[], row: number, col: number): Cursor | null {
  let r = row;
  let c = col + 1;
  for (let guard = 0; guard < 10000; guard++) {
    const line = lines[r] ?? "";
    if (c >= line.length) {
      if (r + 1 >= lines.length) return null;
      r++;
      c = 0;
      continue;
    }
    if (line[c] === " ") {
      c++;
      continue;
    }
    while (c + 1 < line.length && line[c + 1] !== " ") c++;
    if (r !== row || c > col) return { row: r, col: c };
    c++;
  }
  return null;
}

// ------------------------------------------------------------------ text objects

export function textObjectRange(s: EngineState, around: boolean, obj: string): { range: Range; linewise: boolean } | null {
  const lines = activeBuffer(s).lines;
  const { row, col } = s.cursor;
  const line = lines[row] ?? "";

  if (obj === "w" || obj === "W") {
    let start = col;
    let end = col;
    if (obj === "W") {
      while (start > 0 && line[start - 1] !== " ") start--;
      while (end < line.length - 1 && line[end + 1] !== " ") end++;
    } else {
      const cls = charClass(line[col] ?? " ");
      if (cls === 0) {
        while (start > 0 && charClass(line[start - 1]) === 0) start--;
        while (end < line.length - 1 && charClass(line[end + 1]) === 0) end++;
      } else {
        while (start > 0 && charClass(line[start - 1]) === cls) start--;
        while (end < line.length - 1 && charClass(line[end + 1]) === cls) end++;
      }
    }
    if (around) {
      let e = end;
      while (e < line.length - 1 && line[e + 1] === " ") e++;
      if (e === end && start > 0) {
        let st = start;
        while (st > 0 && line[st - 1] === " ") st--;
        start = st;
      } else {
        end = e;
      }
    }
    return { range: { fromRow: row, fromCol: start, toRow: row, toCol: end + 1 }, linewise: false };
  }

  const quoteIdx = "\"'`".indexOf(obj);
  if (quoteIdx >= 0) {
    const q = obj;
    const positions: number[] = [];
    for (let c = 0; c < line.length; c++) {
      if (line[c] === q && (c === 0 || line[c - 1] !== "\\")) positions.push(c);
    }
    let openIdx = -1;
    for (const p of positions) {
      if (p < col) openIdx = p;
    }
    const closeIdx = positions.find((p) => p > col) ?? -1;
    if (openIdx === -1 || closeIdx === -1) return null;
    const fromCol = around ? openIdx : openIdx + 1;
    const toCol = around ? closeIdx + 1 : closeIdx;
    return { range: { fromRow: row, fromCol, toRow: row, toCol }, linewise: false };
  }

  const pairs: Record<string, [string, string]> = {
    "(": ["(", ")"],
    ")": ["(", ")"],
    b: ["(", ")"],
    B: ["{", "}"],
    "{": ["{", "}"],
    "}": ["{", "}"],
    "[": ["[", "]"],
    "]": ["[", "]"],
    "<": ["<", ">"],
    ">": ["<", ">"],
  };
  const pair = pairs[obj];
  if (pair) {
    const [open, close] = pair;
    let openPos: Cursor | null = null;
    let depth = 0;
    for (let r = row; r >= 0; r--) {
      const l = lines[r] ?? "";
      const startC = r === row ? col : l.length - 1;
      for (let c = startC; c >= 0; c--) {
        if (l[c] === close) depth++;
        else if (l[c] === open) {
          if (depth === 0) {
            openPos = { row: r, col: c };
            break;
          }
          depth--;
        }
      }
      if (openPos) break;
    }
    if (!openPos) return null;
    let closePos: Cursor | null = null;
    depth = 0;
    for (let r = openPos.row; r < lines.length; r++) {
      const l = lines[r] ?? "";
      const startC = r === openPos.row ? openPos.col + 1 : 0;
      for (let c = startC; c < l.length; c++) {
        if (l[c] === open) depth++;
        else if (l[c] === close) {
          if (depth === 0) {
            closePos = { row: r, col: c };
            break;
          }
          depth--;
        }
      }
      if (closePos) break;
    }
    if (!closePos) return null;
    if (around) {
      return {
        range: { fromRow: openPos.row, fromCol: openPos.col, toRow: closePos.row, toCol: closePos.col + 1 },
        linewise: false,
      };
    }
    return {
      range: { fromRow: openPos.row, fromCol: openPos.col + 1, toRow: closePos.row, toCol: closePos.col },
      linewise: false,
    };
  }

  return null;
}

// ------------------------------------------------------------------ surround (mini.surround flow)

function pairFor(ch: string): [string, string] {
  switch (ch) {
    case "(":
    case ")":
    case "b":
      return ["(", ")"];
    case "[":
    case "]":
      return ["[", "]"];
    case "{":
    case "}":
    case "B":
      return ["{", "}"];
    case "<":
    case ">":
      return ["<", ">"];
    case "'":
      return ["'", "'"];
    case "`":
      return ["`", "`"];
    default:
      return [ch, ch]; // ", etc
  }
}

function handleSurround(s: EngineState, key: string) {
  const ps = s.pendingSurround!;
  const buf = activeBuffer(s);
  if (key === "Esc") {
    s.pendingSurround = null;
    return;
  }
  if (ps.stage === "s") {
    if (key === "a") {
      s.pendingSurround = { stage: "action", action: "add" };
      s.message = "surround add: motion or text object, then the pair char";
      return;
    }
    if (key === "d") {
      s.pendingSurround = { stage: "action", action: "del" };
      s.message = "surround delete: which pair?";
      return;
    }
    if (key === "r") {
      s.pendingSurround = { stage: "action", action: "replace" };
      s.message = "surround replace: old pair";
      return;
    }
    // not a surround action: plain s (delete char, insert), key types on
    s.pendingSurround = null;
    snapshotForUndo(s);
    const removed = deleteRange(s, {
      fromRow: s.cursor.row,
      fromCol: s.cursor.col,
      toRow: s.cursor.row,
      toCol: s.cursor.col + 1,
    });
    s.register = removed.text;
    s.mode = "insert";
    s.recordingChange = ["s"];
    insertKey(s, key);
    return;
  }
  if (ps.stage === "action") {
    if (ps.action === "add") {
      if (key === "i" || key === "a") {
        s.pendingSurround = { stage: "obj", action: "add", objAround: key === "a" };
        return;
      }
      if (key === "w" || key === "W") {
        const to = textObjectRange(s, false, key);
        if (!to) {
          s.pendingSurround = null;
          s.message = "no text object here";
          return;
        }
        s.pendingSurround = { stage: "pair", action: "add", range: to.range };
        s.message = "surround with:";
        return;
      }
      s.pendingSurround = null;
      s.message = "surround cancelled";
      return;
    }
    if (ps.action === "del") {
      const to = textObjectRange(s, true, key);
      if (!to) {
        s.pendingSurround = null;
        s.message = "no surrounding pair found";
        return;
      }
      snapshotForUndo(s);
      // strip only the pair chars, keep the content: sd" on "hello" -> hello
      const r = to.range;
      if (r.fromRow === r.toRow) {
        const l = buf.lines[r.fromRow] ?? "";
        buf.lines[r.fromRow] =
          l.slice(0, r.fromCol) + l.slice(r.fromCol + 1, r.toCol - 1) + l.slice(r.toCol);
        s.cursor = { row: r.fromRow, col: r.fromCol };
        clampCursor(s);
      }
      s.pendingSurround = null;
      return;
    }
    // replace
    if (!ps.replaceOld) {
      s.pendingSurround = { ...ps, replaceOld: key };
      s.message = "replace with:";
      return;
    }
    const to = textObjectRange(s, true, ps.replaceOld);
    if (!to) {
      s.pendingSurround = null;
      s.message = "no surrounding pair found";
      return;
    }
    const [openN, closeN] = pairFor(key);
    const r = to.range;
    snapshotForUndo(s);
    if (r.fromRow === r.toRow) {
      const l = buf.lines[r.fromRow] ?? "";
      buf.lines[r.fromRow] =
        l.slice(0, r.fromCol) + openN + l.slice(r.fromCol + 1, r.toCol - 1) + closeN + l.slice(r.toCol);
    }
    s.pendingSurround = null;
    return;
  }
  if (ps.stage === "obj") {
    const to = textObjectRange(s, ps.objAround, key);
    if (!to) {
      s.pendingSurround = null;
      s.message = "no text object here";
      return;
    }
    s.pendingSurround = { stage: "pair", action: "add", range: to.range };
    s.message = "surround with:";
    return;
  }
  // stage "pair": add the pair around the stored range
  const [openN, closeN] = pairFor(key);
  const r = ps.range;
  snapshotForUndo(s);
  if (r.fromRow === r.toRow) {
    const l = buf.lines[r.fromRow] ?? "";
    buf.lines[r.fromRow] =
      l.slice(0, r.fromCol) + openN + l.slice(r.fromCol, r.toCol) + closeN + l.slice(r.toCol);
    clampCursor(s);
  }
  s.pendingSurround = null;
}

function moveLines(s: EngineState, dir: 1 | -1) {
  const buf = activeBuffer(s);
  const row = s.cursor.row;
  const target = row + dir;
  if (target < 0 || target >= buf.lines.length) {
    s.message = "E16: invalid range";
    return;
  }
  snapshotForUndo(s);
  const l = buf.lines[row];
  buf.lines.splice(row, 1);
  buf.lines.splice(target, 0, l);
  s.cursor.row = target;
  s.desiredCol = null;
}

// ------------------------------------------------------------------ operator application

function applyOperator(s: EngineState, op: OpPending, range: Range | null, linewise: boolean) {
  const buf = activeBuffer(s);
  switch (op.op) {
    case "d": {
      snapshotForUndo(s);
      if (range === null) {
        const removed = deleteLines(s, s.cursor.row, s.cursor.row + op.count - 1);
        s.register = removed.join("\n");
        s.linewise = true;
      } else if (linewise) {
        const removed = deleteLines(s, range.fromRow, range.toRow);
        s.register = removed.join("\n");
        s.linewise = true;
      } else {
        const res = deleteRange(s, range);
        s.register = res.text;
        s.linewise = false;
      }
      clampCursor(s);
      break;
    }
    case "c": {
      snapshotForUndo(s);
      if (range === null || linewise) {
        const from = range ? range.fromRow : s.cursor.row;
        const to = range ? range.toRow : s.cursor.row + op.count - 1;
        const removed = deleteLines(s, from, to);
        s.register = removed.join("\n");
        s.linewise = true;
        buf.lines.splice(from, 0, "");
        s.cursor = { row: from, col: 0 };
      } else {
        const res = deleteRange(s, range);
        s.register = res.text;
        s.linewise = false;
      }
      s.mode = "insert";
      s.recordingChange = [];
      break;
    }
    case "y": {
      if (range === null) {
        const removed = buf.lines.slice(s.cursor.row, s.cursor.row + op.count);
        s.register = removed.join("\n");
        s.linewise = true;
      } else if (linewise) {
        const lines = buf.lines.slice(range.fromRow, range.toRow + 1);
        s.register = lines.join("\n");
        s.linewise = true;
        s.cursor = { row: range.fromRow, col: 0 };
      } else {
        const res = yankRange(s, range);
        s.register = res.text;
        s.linewise = false;
        s.cursor = {
          row: range.fromRow,
          col: Math.min(range.fromCol, Math.max(0, (buf.lines[range.fromRow] ?? "").length - 1)),
        };
      }
      s.message = `${s.linewise ? s.register.split("\n").length : 1} line(s) yanked`;
      break;
    }
    case ">":
    case "<": {
      const from = range ? range.fromRow : s.cursor.row;
      const to = range ? range.toRow : s.cursor.row + op.count - 1;
      snapshotForUndo(s);
      indentLines(s, from, Math.min(to, buf.lines.length - 1), op.op === ">" ? 1 : -1);
      s.cursor = { row: from, col: firstNonBlank(buf.lines[from] ?? "") };
      break;
    }
    case "gc": {
      const from = range ? range.fromRow : s.cursor.row;
      const to = range ? range.toRow : s.cursor.row + op.count - 1;
      snapshotForUndo(s);
      toggleComment(s, from, Math.min(to, buf.lines.length - 1));
      s.cursor = {
        row: from,
        col: Math.min(s.cursor.col, Math.max(0, (buf.lines[from] ?? "").length - 1)),
      };
      break;
    }
  }
  clampCursor(s);
}

// ------------------------------------------------------------------ insert mode

function insertKey(s: EngineState, key: string) {
  const buf = activeBuffer(s);
  if (s.recordingChange) s.recordingChange.push(key);

  if (key === "Esc") {
    s.mode = "normal";
    s.cursor.col = Math.max(0, s.cursor.col - 1);
    clampCursor(s);
    if (s.recordingChange) {
      s.lastChange = [...s.recordingChange, "Esc"];
      s.recordingChange = null;
    }
    return;
  }
  if (key === "C-z") {
    doUndo(s);
    return;
  }
  if (key === "C-r") {
    doRedo(s);
    return;
  }
  if (key === "C-s") {
    s.message = `"${buf.name}" written`;
    return;
  }
  if (s.mode === "replace") {
    if (key.length === 1) {
      const l = buf.lines[s.cursor.row] ?? "";
      if (s.cursor.col < l.length) {
        buf.lines[s.cursor.row] = l.slice(0, s.cursor.col) + key + l.slice(s.cursor.col + 1);
      } else {
        buf.lines[s.cursor.row] = l + key;
      }
      s.cursor.col++;
      return;
    }
    if (key === "BS") {
      s.cursor.col = Math.max(0, s.cursor.col - 1);
      const l = buf.lines[s.cursor.row] ?? "";
      if (s.cursor.col < l.length) {
        buf.lines[s.cursor.row] = l.slice(0, s.cursor.col) + l.slice(s.cursor.col + 1);
      }
      return;
    }
    return;
  }

  const lineAt = (r: number) => buf.lines[r] ?? "";
  switch (key) {
    case "BS": {
      const { row, col } = s.cursor;
      if (col > 0) {
        const l = lineAt(row);
        buf.lines[row] = l.slice(0, col - 1) + l.slice(col);
        s.cursor.col = col - 1;
      } else if (row > 0) {
        const prevLen = lineAt(row - 1).length;
        buf.lines[row - 1] = lineAt(row - 1) + lineAt(row);
        buf.lines.splice(row, 1);
        s.cursor = { row: row - 1, col: prevLen };
      }
      return;
    }
    case "CR": {
      const { row } = s.cursor;
      const l = lineAt(row);
      const indent = l.slice(0, indentOf(l));
      let extra = "";
      const trimmed = l.trimEnd();
      if (/[{([]$/.test(trimmed) || (buf.filetype === "lua" && /(then|do|function.*)$/.test(trimmed))) {
        extra = "  ";
      }
      buf.lines.splice(row + 1, 0, indent + extra);
      s.cursor = { row: row + 1, col: (indent + extra).length };
      return;
    }
    case "Tab": {
      const l = lineAt(s.cursor.row);
      buf.lines[s.cursor.row] = l.slice(0, s.cursor.col) + "  " + l.slice(s.cursor.col);
      s.cursor.col += 2;
      return;
    }
    case "Up": {
      s.cursor.row = Math.max(0, s.cursor.row - 1);
      s.cursor.col = Math.min(s.cursor.col, Math.max(0, lineAt(s.cursor.row).length));
      return;
    }
    case "Down": {
      s.cursor.row = Math.min(buf.lines.length - 1, s.cursor.row + 1);
      s.cursor.col = Math.min(s.cursor.col, Math.max(0, lineAt(s.cursor.row).length));
      return;
    }
    case "Left": {
      s.cursor.col = Math.max(0, s.cursor.col - 1);
      return;
    }
    case "Right": {
      s.cursor.col = Math.min(lineAt(s.cursor.row).length, s.cursor.col + 1);
      return;
    }
    default: {
      if (key.length === 1) {
        const l = lineAt(s.cursor.row);
        buf.lines[s.cursor.row] = l.slice(0, s.cursor.col) + key + l.slice(s.cursor.col);
        s.cursor.col++;
      }
      return;
    }
  }
}

// ------------------------------------------------------------------ visual mode

function selectionRange(s: EngineState): {
  range: Range;
  linewise: boolean;
  block: { top: number; bottom: number; left: number; right: number } | null;
} {
  const anchor = s.visualAnchor ?? s.cursor;
  const cur = s.cursor;
  const top = Math.min(anchor.row, cur.row);
  const bottom = Math.max(anchor.row, cur.row);
  if (s.mode === "vline") {
    return {
      range: { fromRow: top, fromCol: 0, toRow: bottom, toCol: Number.MAX_SAFE_INTEGER },
      linewise: true,
      block: null,
    };
  }
  if (s.mode === "vblock") {
    const left = Math.min(anchor.col, cur.col);
    const right = Math.max(anchor.col, cur.col);
    return {
      range: { fromRow: top, fromCol: left, toRow: bottom, toCol: right + 1 },
      linewise: false,
      block: { top, bottom, left, right },
    };
  }
  const fromCol = anchor.row <= cur.row ? anchor.col : cur.col;
  const toCol = anchor.row <= cur.row ? cur.col : anchor.col;
  return {
    range: { fromRow: top, fromCol, toRow: bottom, toCol: toCol + 1 },
    linewise: false,
    block: null,
  };
}

function deleteBlock(
  s: EngineState,
  block: { top: number; bottom: number; left: number; right: number }
): string {
  const buf = activeBuffer(s);
  const removed: string[] = [];
  for (let r = block.top; r <= block.bottom; r++) {
    const line = buf.lines[r] ?? "";
    removed.push(line.slice(block.left, block.right + 1));
    buf.lines[r] = line.slice(0, block.left) + line.slice(block.right + 1);
  }
  s.cursor = { row: block.top, col: block.left };
  return removed.join("\n");
}

function visualKey(s: EngineState, key: string) {
  const buf = activeBuffer(s);

  // pending g prefix in visual: gc comments the selection
  if (s.pendingG) {
    s.pendingG = false;
    if (key === "c") {
      const sel = selectionRange(s);
      snapshotForUndo(s);
      toggleComment(s, sel.range.fromRow, sel.range.toRow);
      s.visualAnchor = { row: sel.range.fromRow, col: 0 };
      s.cursor = { row: sel.range.fromRow, col: 0 };
      return;
    }
    return;
  }

  if (s.blockInsert) {
    if (key === "Esc") {
      const bi = s.blockInsert;
      for (const r of bi.rows) {
        const l = buf.lines[r] ?? "";
        const at = bi.append ? Math.min(l.length, bi.col) : bi.col;
        buf.lines[r] = l.slice(0, at) + bi.text + l.slice(at);
      }
      s.blockInsert = null;
      s.mode = "normal";
      s.visualAnchor = null;
      clampCursor(s);
      if (s.recordingChange) {
        s.lastChange = [...s.recordingChange, "Esc"];
        s.recordingChange = null;
      }
      return;
    }
    if (key === "BS") {
      s.blockInsert.text = s.blockInsert.text.slice(0, -1);
      return;
    }
    if (key === "CR") {
      s.blockInsert.text += "\n";
      return;
    }
    if (key.length === 1) {
      s.blockInsert.text += key;
      return;
    }
    return;
  }

  if (/^[1-9]$/.test(key) || (key === "0" && s.count !== "")) {
    s.count += key;
    return;
  }
  const count = s.count === "" ? 1 : parseInt(s.count, 10);
  s.count = "";

  switch (key) {
    case "Esc": {
      s.visualAnchor = null;
      s.mode = "normal";
      clampCursor(s);
      return;
    }
    case "v": {
      s.mode = s.mode === "visual" ? "normal" : "visual";
      if (s.mode === "normal") s.visualAnchor = null;
      return;
    }
    case "V": {
      s.mode = s.mode === "vline" ? "normal" : "vline";
      if (s.mode === "normal") s.visualAnchor = null;
      return;
    }
    case "C-v": {
      s.mode = s.mode === "vblock" ? "normal" : "vblock";
      if (s.mode === "normal") s.visualAnchor = null;
      return;
    }
    case "o": {
      const a = s.visualAnchor;
      s.visualAnchor = { ...s.cursor };
      if (a) s.cursor = a;
      return;
    }
    case "d":
    case "x": {
      const sel = selectionRange(s);
      snapshotForUndo(s);
      if (sel.block) {
        s.register = deleteBlock(s, sel.block);
        s.linewise = false;
      } else if (sel.linewise) {
        const removed = deleteLines(s, sel.range.fromRow, sel.range.toRow);
        s.register = removed.join("\n");
        s.linewise = true;
      } else {
        const res = deleteRange(s, sel.range);
        s.register = res.text;
        s.linewise = false;
      }
      exitVisual(s);
      clampCursor(s);
      return;
    }
    case "y": {
      const sel = selectionRange(s);
      if (sel.block) {
        const parts: string[] = [];
        for (let r = sel.block.top; r <= sel.block.bottom; r++) {
          const l = buf.lines[r] ?? "";
          parts.push(l.slice(sel.block.left, sel.block.right + 1));
        }
        s.register = parts.join("\n");
        s.linewise = false;
      } else if (sel.linewise) {
        s.register = buf.lines.slice(sel.range.fromRow, sel.range.toRow + 1).join("\n");
        s.linewise = true;
      } else {
        const res = yankRange(s, sel.range);
        s.register = res.text;
        s.linewise = false;
      }
      s.message = `${sel.linewise ? sel.range.toRow - sel.range.fromRow + 1 : 1} line(s) yanked`;
      s.visualAnchor = null;
      s.mode = "normal";
      s.cursor = {
        row: Math.min(sel.range.fromRow, buf.lines.length - 1),
        col: sel.linewise ? 0 : sel.range.fromCol,
      };
      clampCursor(s);
      return;
    }
    case "c":
    case "s": {
      const sel = selectionRange(s);
      snapshotForUndo(s);
      if (sel.block) {
        deleteBlock(s, sel.block);
        const rows: number[] = [];
        for (let r = sel.block.top; r <= sel.block.bottom; r++) rows.push(r);
        s.blockInsert = { col: sel.block.left, rows, text: "", append: false };
      } else if (sel.linewise) {
        const removed = deleteLines(s, sel.range.fromRow, sel.range.toRow);
        s.register = removed.join("\n");
        buf.lines.splice(sel.range.fromRow, 0, "");
        s.cursor = { row: sel.range.fromRow, col: 0 };
      } else {
        deleteRange(s, sel.range);
      }
      s.visualAnchor = null;
      s.mode = "insert";
      s.recordingChange = [];
      return;
    }
    case ">":
    case "<": {
      const sel = selectionRange(s);
      snapshotForUndo(s);
      indentLines(s, sel.range.fromRow, sel.range.toRow, key === ">" ? 1 : -1);
      // this config reselects (<gv / >gv): keep the same lines selected
      const from = sel.range.fromRow;
      const to = sel.range.toRow;
      s.cursor = { row: to, col: firstNonBlank(buf.lines[to] ?? "") };
      s.visualAnchor = { row: from, col: 0 };
      s.lastVisual = { mode: s.mode as "visual" | "vline" | "vblock", anchor: { ...s.visualAnchor }, cursor: { ...s.cursor } };
      return;
    }
    case "u":
    case "U":
    case "~": {
      const sel = selectionRange(s);
      snapshotForUndo(s);
      lowerUpper(s, sel, key === "u" ? false : key === "U" ? true : null);
      exitVisual(s);
      return;
    }
    case "J": {
      const sel = selectionRange(s);
      snapshotForUndo(s);
      let n = 0;
      for (let r = sel.range.toRow - 1; r >= sel.range.fromRow; r--) {
        joinLines(s, r);
        n++;
      }
      s.cursor = {
        row: sel.range.fromRow,
        col: Math.max(0, (buf.lines[sel.range.fromRow] ?? "").length - 1),
      };
      s.visualAnchor = null;
      s.mode = "normal";
      s.message = `${n + 1} lines joined`;
      return;
    }
    case "p":
    case "P": {
      const sel = selectionRange(s);
      snapshotForUndo(s);
      if (s.linewise) {
        const regLines = s.register.split("\n");
        buf.lines.splice(sel.range.fromRow, sel.range.toRow - sel.range.fromRow + 1, ...regLines);
        s.cursor = { row: sel.range.fromRow, col: 0 };
      } else {
        deleteRange(s, sel.range);
        const at = s.cursor.col;
        const l = buf.lines[s.cursor.row] ?? "";
        buf.lines[s.cursor.row] = l.slice(0, at) + s.register + l.slice(at);
        s.cursor.col = at + s.register.length - 1;
      }
      exitVisual(s);
      clampCursor(s);
      return;
    }
    case "gc": {
      const sel = selectionRange(s);
      snapshotForUndo(s);
      toggleComment(s, sel.range.fromRow, sel.range.toRow);
      s.visualAnchor = { row: sel.range.fromRow, col: 0 };
      s.cursor = { row: sel.range.toRow, col: 0 };
      s.lastVisual = { mode: s.mode as "visual" | "vline" | "vblock", anchor: { ...s.visualAnchor }, cursor: { ...s.cursor } };
      return;
    }
    case "I": {
      if (s.mode !== "vblock") {
        const sel = selectionRange(s);
        s.visualAnchor = null;
        s.mode = "insert";
        s.cursor = { row: sel.range.fromRow, col: sel.range.fromCol };
        return;
      }
      const sel = selectionRange(s);
      const rows: number[] = [];
      for (let r = sel.block!.top; r <= sel.block!.bottom; r++) rows.push(r);
      s.blockInsert = { col: sel.block!.left, rows, text: "", append: false };
      return;
    }
    case "A": {
      if (s.mode !== "vblock") {
        const sel = selectionRange(s);
        const endRow = sel.range.toRow;
        const l = buf.lines[endRow] ?? "";
        s.visualAnchor = null;
        s.mode = "insert";
        s.cursor = { row: endRow, col: l.length };
        return;
      }
      const sel = selectionRange(s);
      const rows: number[] = [];
      for (let r = sel.block!.top; r <= sel.block!.bottom; r++) rows.push(r);
      s.blockInsert = { col: sel.block!.right + 1, rows, text: "", append: true };
      return;
    }
    case "g": {
      s.pendingG = true;
      return;
    }
    case "A-j":
    case "A-k": {
      const sel = selectionRange(s);
      const from = sel.range.fromRow;
      const to = sel.range.toRow;
      const target = key === "A-j" ? to + 1 : from - 1;
      if (target < 0 || target >= buf.lines.length) {
        s.message = "E16: invalid range";
        return;
      }
      snapshotForUndo(s);
      const chunk = buf.lines.splice(from, to - from + 1);
      const at = key === "A-j" ? from + 1 : from - 1;
      buf.lines.splice(at, 0, ...chunk);
      // selection rides with the lines
      const shift = key === "A-j" ? (from <= s.visualAnchor!.row && s.visualAnchor!.row <= to ? 1 : 0) : from <= s.visualAnchor!.row && s.visualAnchor!.row <= to ? -1 : 0;
      s.visualAnchor = { row: s.visualAnchor!.row + shift, col: s.visualAnchor!.col };
      const curShift = from <= s.cursor.row && s.cursor.row <= to ? (key === "A-j" ? 1 : -1) : 0;
      s.cursor.row += curShift;
      return;
    }
    case ":": {
      // visual : enters cmdline with the '<,'> range
      const sel = selectionRange(s);
      s.visualLines = { fromRow: sel.range.fromRow, toRow: sel.range.toRow };
      s.visualAnchor = null;
      s.mode = "cmd";
      s.cmdKind = ":";
      s.cmd = "'<,'>";
      return;
    }
    case "sr": {
      const sel = selectionRange(s);
      s.visualLines = { fromRow: sel.range.fromRow, toRow: sel.range.toRow };
      s.visualAnchor = null;
      s.mode = "cmd";
      s.cmdKind = ":";
      s.cmd = `'<,'>s/`;
      return;
    }
    case "G": {
      const t = count > 1 ? Math.min(count - 1, buf.lines.length - 1) : buf.lines.length - 1;
      s.cursor = { row: t, col: firstNonBlank(buf.lines[t] ?? "") };
      return;
    }
    default: {
      const res = motion(s, key, count);
      if (res.cursor) {
        s.cursor = res.cursor;
      }
      return;
    }
  }
}

function lowerUpper(
  s: EngineState,
  sel: { range: Range; block: { top: number; bottom: number; left: number; right: number } | null },
  upper: boolean | null
) {
  const buf = activeBuffer(s);
  if (sel.block) {
    for (let r = sel.block.top; r <= sel.block.bottom; r++) {
      const l = buf.lines[r] ?? "";
      const mid = l.slice(sel.block.left, sel.block.right + 1);
      buf.lines[r] =
        l.slice(0, sel.block.left) + flipCase(mid, upper) + l.slice(sel.block.right + 1);
    }
    return;
  }
  for (let r = sel.range.fromRow; r <= sel.range.toRow; r++) {
    const l = buf.lines[r] ?? "";
    if (r === sel.range.fromRow && r === sel.range.toRow) {
      const mid = l.slice(sel.range.fromCol, sel.range.toCol);
      buf.lines[r] = l.slice(0, sel.range.fromCol) + flipCase(mid, upper) + l.slice(sel.range.toCol);
    } else if (r === sel.range.fromRow) {
      const mid = l.slice(sel.range.fromCol);
      buf.lines[r] = l.slice(0, sel.range.fromCol) + flipCase(mid, upper);
    } else if (r === sel.range.toRow) {
      const mid = l.slice(0, sel.range.toCol);
      buf.lines[r] = flipCase(mid, upper) + l.slice(sel.range.toCol);
    } else {
      buf.lines[r] = flipCase(l, upper);
    }
  }
}

function flipCase(str: string, upper: boolean | null): string {
  if (upper !== null) return upper ? str.toUpperCase() : str.toLowerCase();
  return [...str].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("");
}

function exitVisual(s: EngineState) {
  s.visualAnchor = null;
  s.mode = "normal";
}

// ------------------------------------------------------------------ undo / redo

function doUndo(s: EngineState) {
  const buf = activeBuffer(s);
  const prev = buf.undoStack.pop();
  if (!prev) {
    s.message = "Already at oldest change";
    return;
  }
  buf.redoStack.push([...buf.lines]);
  buf.lines = prev;
  clampCursor(s);
  s.message = `1 change; ${buf.undoStack.length} undo steps left`;
}

function doRedo(s: EngineState) {
  const buf = activeBuffer(s);
  const next = buf.redoStack.pop();
  if (!next) {
    s.message = "Already at newest change";
    return;
  }
  buf.undoStack.push([...buf.lines]);
  buf.lines = next;
  clampCursor(s);
  s.message = "1 change redone";
}

// ------------------------------------------------------------------ lsp

function lspJumpDefinition(s: EngineState) {
  const buf = activeBuffer(s);
  const { word } = cwordAt(buf.lines, s.cursor);
  if (!word) {
    s.message = "gd: nothing under cursor";
    return;
  }
  const patterns = [
    new RegExp(`\\bfunc\\s+(?:\\([^)]*\\)\\s*)?${word}\\s*\\(`),
    new RegExp(`\\btype\\s+${word}\\b`),
    new RegExp(`\\b(?:const|var|let|local)\\s+${word}\\b`),
    new RegExp(`\\b${word}\\s*=`),
    new RegExp(`\\bclass\\s+${word}\\b`),
  ];
  for (let r = 0; r < buf.lines.length; r++) {
    for (const p of patterns) {
      const l = buf.lines[r] ?? "";
      const m = l.match(p);
      if (m && m.index !== undefined && !(r === s.cursor.row && Math.abs(m.index - s.cursor.col) < 2)) {
        s.cursor = { row: r, col: l.indexOf(word) };
        s.message = `gd: ${word} -> ${buf.name}:${r + 1}`;
        return;
      }
    }
  }
  s.message = `gd: no definition for ${word} in this buffer`;
}

function lspHover(s: EngineState) {
  const buf = activeBuffer(s);
  const { word } = cwordAt(buf.lines, s.cursor);
  const defRow = buf.lines.findIndex((l) =>
    new RegExp(`\\b(func|type|class|local|const|var)\\b.*\\b${word}\\b`).test(l)
  );
  const sig = defRow >= 0 ? buf.lines[defRow] : word;
  s.float = {
    kind: "hover",
    text: [
      `${word}`,
      "----------------------------------------",
      sig.trim(),
      defRow >= 0 ? `defined at ${buf.name}:${defRow + 1}` : "(no definition found)",
    ],
  };
}

function lspRenameAll(s: EngineState, symbol: string, replacement: string): number {
  const buf = activeBuffer(s);
  snapshotForUndo(s);
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  let count = 0;
  buf.lines = buf.lines.map((l) => {
    count += (l.match(re) ?? []).length;
    return l.replace(re, replacement);
  });
  return count;
}

// ------------------------------------------------------------------ diagnostics & code actions

function diagnosticNav(s: EngineState, dir: 1 | -1) {
  const buf = activeBuffer(s);
  const diags = (s.diagnostics[buf.id] ?? []).slice().sort((a, b) => a.row - b.row);
  const filtered =
    dir === 1
      ? diags.filter((d) => d.row > s.cursor.row)
      : diags.filter((d) => d.row < s.cursor.row).reverse();
  const target = filtered[0];
  if (!target) {
    s.message = dir === 1 ? "]d: no more diagnostics" : "[d: no previous diagnostics";
    return;
  }
  s.cursor = { row: target.row, col: target.col };
  s.message = `${target.severity}: ${target.msg}`;
}

function diagnosticUnder(s: EngineState) {
  const buf = activeBuffer(s);
  const diags = s.diagnostics[buf.id] ?? [];
  return diags.find((d) => d.row === s.cursor.row) ?? null;
}

function openCodeActions(s: EngineState) {
  const under = diagnosticUnder(s);
  const items: NonNullable<FloatState["items"]> = [];
  if (under && under.fixKind && under.fixLabel) {
    items.push({ label: `quickfix: ${under.fixLabel}`, kind: under.fixKind, symbol: under.symbol });
  }
  items.push({ label: "organize imports", kind: "imports" });
  items.push({ label: "extract function (mock)", kind: "mock" });
  s.float = {
    kind: "actions",
    title: under ? `actions for line ${s.cursor.row + 1} (${under.severity}: ${under.msg})` : "actions",
    items,
  };
}

function applyCodeAction(s: EngineState, item: NonNullable<FloatState["items"]>[number]) {
  const buf = activeBuffer(s);
  switch (item.kind) {
    case "unused": {
      // rename symbol on this line to _symbol
      const re = new RegExp(`\\b${item.symbol ?? ""}\\b`, "g");
      const l = buf.lines[s.cursor.row] ?? "";
      if (re.test(l)) {
        snapshotForUndo(s);
        buf.lines[s.cursor.row] = l.replace(re, `_${item.symbol}`);
        s.message = `quickfix: ${item.symbol} -> _${item.symbol}`;
        // also clear the diagnostic on this line
        clearDiagnosticOnRow(s, s.cursor.row);
      } else {
        s.message = "quickfix: nothing to rename";
      }
      break;
    }
    case "import": {
      const l = buf.lines[s.cursor.row] ?? "";
      const needed = item.symbol ?? "";
      if (needed) {
        snapshotForUndo(s);
        buf.lines.unshift(`import "${needed}"`);
        s.message = `quickfix: added import "${needed}"`;
        clearDiagnosticOnRow(s, s.cursor.row + 1);
        void l;
      }
      break;
    }
    case "typo": {
      const l = buf.lines[s.cursor.row] ?? "";
      if (item.symbol) {
        snapshotForUndo(s);
        buf.lines[s.cursor.row] = l.split(item.symbol).join(fixTypo(item.symbol));
        s.message = `quickfix: ${item.symbol} -> ${fixTypo(item.symbol)}`;
        clearDiagnosticOnRow(s, s.cursor.row);
      }
      break;
    }
    case "nilcheck": {
      const l = buf.lines[s.cursor.row] ?? "";
      snapshotForUndo(s);
      buf.lines[s.cursor.row] = l.replace(/\b(\w+)\./, "$1 != nil && $1.");
      s.message = "quickfix: added nil check";
      clearDiagnosticOnRow(s, s.cursor.row);
      break;
    }
    case "imports": {
      const seen = new Set<string>();
      const out: string[] = [];
      let removed = 0;
      for (const l of buf.lines) {
        const m = l.match(/^import\s+"?([^"]*)"?/);
        if (m) {
          if (seen.has(l.trim())) {
            removed++;
            continue;
          }
          seen.add(l.trim());
        }
        out.push(l);
      }
      if (removed > 0) {
        snapshotForUndo(s);
        buf.lines = out;
      }
      s.message = removed > 0 ? `removed ${removed} duplicate import(s)` : "imports already tidy";
      break;
    }
    case "mock":
      s.message = "extract function: this is a mock, you get the idea";
      break;
  }
  s.float = null;
}

function fixTypo(word: string): string {
  const fixes: Record<string, string> = {
    responce: "response",
    seperate: "separate",
    recieve: "receive",
    adress: "address",
  };
  return fixes[word.toLowerCase()] ?? word;
}

function clearDiagnosticOnRow(s: EngineState, row: number) {
  const buf = activeBuffer(s);
  const diags = s.diagnostics[buf.id] ?? [];
  s.diagnostics[buf.id] = diags.filter((d) => d.row !== row);
}

// ------------------------------------------------------------------ gitsigns

function hunkIdxNear(s: EngineState): number {
  const buf = activeBuffer(s);
  const hunks = s.gitHunks[buf.id] ?? [];
  const exact = hunks.findIndex((h) => h.row === s.cursor.row);
  if (exact >= 0) return exact;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < hunks.length; i++) {
    const d = Math.abs(hunks[i].row - s.cursor.row);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function gitHunkNav(s: EngineState, dir: 1 | -1) {
  const buf = activeBuffer(s);
  const hunks = (s.gitHunks[buf.id] ?? []).slice().sort((a, b) => a.row - b.row);
  const list =
    dir === 1
      ? hunks.filter((h) => h.row > s.cursor.row)
      : hunks.filter((h) => h.row < s.cursor.row).reverse();
  const target = list[0];
  if (!target) {
    s.message = dir === 1 ? "]c: no more hunks" : "[c: no previous hunks";
    return;
  }
  s.cursor = { row: target.row, col: 0 };
  s.message = `hunk ${hunks.indexOf(target) + 1}/${hunks.length} (${target.type})`;
}

function gitResetHunk(s: EngineState) {
  const buf = activeBuffer(s);
  const hunks = s.gitHunks[buf.id] ?? [];
  const hunk = hunks[hunkIdxNear(s)];
  if (!hunk) {
    s.message = "gitsigns: no hunk under cursor";
    return;
  }
  snapshotForUndo(s);
  if (hunk.type === "add" && hunk.row < buf.lines.length) {
    buf.lines.splice(hunk.row, 1);
  } else if (hunk.type === "change" && hunk.original) {
    buf.lines[hunk.row] = hunk.original[0] ?? "";
  } else if (hunk.type === "delete" && hunk.original) {
    buf.lines.splice(hunk.row, 0, ...hunk.original);
  }
  hunks.splice(hunks.indexOf(hunk), 1);
  s.message = "gitsigns: hunk reset";
  clampCursor(s);
}

function gitStageHunk(s: EngineState) {
  const hunks = s.gitHunks[activeBuffer(s).id] ?? [];
  if (!hunks[hunkIdxNear(s)]) {
    s.message = "gitsigns: no hunk under cursor";
    return;
  }
  s.message = "gitsigns: hunk staged";
}

function gitPreviewHunk(s: EngineState) {
  const buf = activeBuffer(s);
  const hunks = s.gitHunks[buf.id] ?? [];
  const hunk = hunks[hunkIdxNear(s)];
  if (!hunk) {
    s.message = "gitsigns: no hunk under cursor";
    return;
  }
  const current = buf.lines[hunk.row] ?? "";
  s.float = {
    kind: "diagnostic",
    text: [
      `hunk @ ${buf.name}:${hunk.row + 1} (${hunk.type})`,
      "- " + (hunk.original?.[0] ?? "(none)"),
      "+ " + current,
    ],
  };
}

// ------------------------------------------------------------------ trouble

function troubleKey(s: EngineState, key: string): boolean {
  const entries: { bufId: string; name: string; row: number; msg: string; severity: string }[] = [];
  for (const buf of s.buffers) {
    for (const d of s.diagnostics[buf.id] ?? []) {
      entries.push({ bufId: buf.id, name: buf.name, row: d.row, msg: d.msg, severity: d.severity });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.row - b.row);
  if (entries.length === 0) {
    s.troubleOpen = false;
    s.focus = "editor";
    return true;
  }
  switch (key) {
    case "j":
    case "Down":
      s.troubleSelected = Math.min(entries.length - 1, s.troubleSelected + 1);
      return true;
    case "k":
    case "Up":
      s.troubleSelected = Math.max(0, s.troubleSelected - 1);
      return true;
    case "CR": {
      const pick = entries[Math.min(s.troubleSelected, entries.length - 1)];
      const bufIdx = s.buffers.findIndex((b) => b.id === pick.bufId);
      if (bufIdx >= 0) {
        s.activeBuf = bufIdx;
        s.cursor = { row: pick.row, col: 0 };
      }
      s.troubleOpen = false;
      s.focus = "editor";
      return true;
    }
    case "q":
    case "Esc":
      s.troubleOpen = false;
      s.focus = "editor";
      return true;
    default:
      return false;
  }
}

// ------------------------------------------------------------------ prompt mode

function promptKey(s: EngineState, key: string) {
  if (key === "Esc") {
    s.mode = "normal";
    s.cmdKind = ":";
    s.promptAction = { kind: "none" };
    s.cmd = "";
    return;
  }
  if (key === "BS") {
    s.cmd = s.cmd.slice(0, -1);
    return;
  }
  if (key === "CR") {
    const action = s.promptAction;
    const answer = s.cmd;
    s.mode = "normal";
    s.cmdKind = ":";
    s.promptAction = { kind: "none" };
    s.cmd = "";
    runPromptAction(s, action, answer);
    return;
  }
  if (key.length === 1) {
    s.cmd += key;
  }
}

function runPromptAction(s: EngineState, action: PromptAction, answer: string) {
  switch (action.kind) {
    case "gopher-tag": {
      const name = answer.trim() || "json";
      applyGoTag(s, name);
      return;
    }
    case "tree-create": {
      const path = answer.replace(/\/+$/, "");
      if (!path) return;
      if (!s.tree.files.find((f) => f.path === path)) {
        s.tree.files.push({
          path,
          type: answer.endsWith("/") ? "dir" : "file",
        });
        s.tree.selected = path;
        s.tree.message = `created ${path}`;
      }
      return;
    }
    case "tree-rename": {
      const newPath = answer.trim();
      const node = s.tree.files.find((f) => f.path === action.path);
      if (!node || !newPath) return;
      const dir = parentOf(action.path);
      const dest = dir ? `${dir}/${newPath}` : newPath;
      node.path = dest;
      s.tree.selected = dest;
      s.tree.message = `renamed -> ${dest}`;
      return;
    }
    case "tree-delete": {
      if (answer.trim().toLowerCase() === "y") {
        s.tree.files = s.tree.files.filter((f) => f.path !== action.path);
        s.tree.selected = s.tree.files[0]?.path ?? null;
        s.tree.message = `deleted ${action.path}`;
      } else {
        s.tree.message = "delete cancelled";
      }
      return;
    }
    case "lsp-rename": {
      const to = answer.trim();
      if (!to || !action.symbol) return;
      const n = lspRenameAll(s, action.symbol, to);
      s.message = n > 0 ? `renamed ${n} occurrence(s): ${action.symbol} -> ${to}` : `no occurrences of ${action.symbol}`;
      return;
    }
    default:
      return;
  }
}

// ------------------------------------------------------------------ cmdline & search modes

function cmdlineKey(s: EngineState, key: string) {
  if (key === "Esc") {
    s.mode = "normal";
    s.cmd = "";
    s.cmdKind = ":";
    return;
  }
  if (key === "BS") {
    s.cmd = s.cmd.slice(0, -1);
    if (s.cmd === "") {
      s.mode = "normal";
      s.cmdKind = ":";
    }
    return;
  }
  if (key === "CR") {
    const cmd = s.cmd;
    s.mode = "normal";
    s.cmd = "";
    runExCommand(s, cmd);
    clampCursor(s);
    return;
  }
  if (key.length === 1) {
    s.cmd += key;
  }
}

/** ':' handler with visual range support ('<,'>s/...) and window-aware :q. */
function runExCommand(s: EngineState, cmd: string) {
  const trimmed = cmd.trim();
  if (trimmed === "q" || trimmed === "q!") {
    if (s.wins.length > 1) {
      closeWindow(s);
      return;
    }
    s.message = "this is a web mock, the tab is your :q";
    return;
  }
  const visualSub = cmd.match(/^'<,'>(s\/.*)$/);
  if (visualSub) {
    const range = s.visualLines ?? { fromRow: s.cursor.row, toRow: s.cursor.row };
    s.visualLines = null;
    const spec = parseSubstitute(visualSub[1]);
    if (spec) {
      const buf = activeBuffer(s);
      const originalCursor = s.cursor.row;
      s.cursor.row = range.fromRow;
      let count = 0;
      for (let r = range.fromRow; r <= Math.min(range.toRow, buf.lines.length - 1); r++) {
        s.cursor.row = r;
        // run per-line by temporarily setting rangeAll false
        spec.rangeAll = false;
        count += runSubstitute(s, spec);
      }
      s.cursor.row = originalCursor;
      s.message = `${count} substitution${count === 1 ? "" : "s"} in selection`;
      return;
    }
    return;
  }
  runCommand(s, cmd);
}

function searchKey(s: EngineState, key: string) {
  const dir = s.cmdKind === "?" ? -1 : 1;
  if (key === "Esc") {
    s.mode = "normal";
    s.cmd = "";
    s.cmdKind = ":";
    return;
  }
  if (key === "BS") {
    s.cmd = s.cmd.slice(0, -1);
    if (s.cmd === "") {
      s.mode = "normal";
      s.cmdKind = ":";
    }
    return;
  }
  if (key === "CR") {
    const term = s.cmd;
    s.mode = "normal";
    s.cmd = "";
    s.cmdKind = ":";
    if (term) {
      s.searchState = { term, dir };
      s.hlSearch = true;
      const lines = activeBuffer(s).lines;
      const m = nextMatch(lines, s.cursor, term, dir, true);
      if (m) {
        s.cursor = { row: m.row, col: m.col };
        s.message = `/${term} [${countMatches(lines, term)} matches]`;
      } else {
        s.message = `E486: Pattern not found: ${term}`;
      }
    }
    return;
  }
  if (key.length === 1) {
    s.cmd += key;
  }
}

function countMatches(lines: string[], term: string): number {
  let n = 0;
  try {
    const re = new RegExp(term, /[A-Z]/.test(term) ? "g" : "gi");
    for (const l of lines) {
      n += (l.match(re) ?? []).length;
    }
  } catch {
    return 0;
  }
  return n;
}

// ------------------------------------------------------------------ normal mode

function normalKey(s: EngineState, key: string) {
  const buf = activeBuffer(s);
  if (s.recordingChange) s.recordingChange.push(key);

  // float interactions come first: action lists need their numbers
  if (s.float && s.float.kind === "actions") {
    if (/^[1-9]$/.test(key)) {
      const item = s.float.items?.[parseInt(key, 10) - 1];
      if (item) applyCodeAction(s, item);
      return;
    }
    if (key === "Esc" || key === "q") {
      s.float = null;
      return;
    }
    s.float = null; // dismiss and keep processing
  } else if (s.float && s.float.kind !== "whichkey") {
    s.float = null; // informational floats dismiss on any key
  }

  // pending surround mini-flow (mini.surround: sa / sd / sr)
  if (s.pendingSurround) {
    handleSurround(s, key);
    return;
  }

  // counts
  if (/^[1-9]$/.test(key) || (key === "0" && s.count !== "")) {
    s.count += key;
    return;
  }
  const count = s.count === "" ? 1 : parseInt(s.count, 10);
  s.count = "";

  // pending replace char (r)
  if (s.pendingReplace) {
    s.pendingReplace = false;
    if (key === "Esc") return;
    if (key.length === 1) {
      snapshotForUndo(s);
      const l = buf.lines[s.cursor.row] ?? "";
      if (l[s.cursor.col] !== undefined) {
        buf.lines[s.cursor.row] = l.slice(0, s.cursor.col) + key + l.slice(s.cursor.col + 1);
        s.lastChange = ["r", key];
      }
    }
    return;
  }

  // pending find char
  if (s.pendingFind) {
    if (key.length === 1 && s.pendingFind.char === "") {
      s.pendingFind.char = key;
      const type = s.pendingFind.type;
      s.lastFind = { type, char: key };
      s.pendingFind = null;
      const target = findMotion(buf.lines, s.cursor, type, key, count);
      if (target) s.cursor = target;
      return;
    }
    s.pendingFind = null;
    return;
  }

  // pending g prefix
  if (s.pendingG) {
    s.pendingG = false;
    if (key === "g") {
      const target = count > 1 ? Math.min(count - 1, buf.lines.length - 1) : 0;
      s.cursor = { row: target, col: firstNonBlank(buf.lines[target] ?? "") };
      s.desiredCol = null;
      return;
    }
    if (key === "c" || key === "u" || key === "U") {
      s.pendingOp = { op: key === "c" ? "gc" : key === "u" ? "gu" : "gU", count };
      return;
    }
    if (key === "d") {
      lspJumpDefinition(s);
      return;
    }
    if (key === "v") {
      const lv = s.lastVisual;
      if (lv) {
        s.mode = lv.mode;
        s.visualAnchor = { ...lv.anchor };
        s.cursor = { ...lv.cursor };
      }
      return;
    }
    return;
  }

  // pending bracket nav
  if (s.pendingD) {
    s.pendingD = false;
    if (key === "b") {
      cycleBuffer(s, s.bracketDir);
      return;
    }
    if (key === "c") {
      gitHunkNav(s, s.bracketDir);
      return;
    }
    if (key === "d") {
      diagnosticNav(s, s.bracketDir);
      return;
    }
    return;
  }

  // pending operator
  if (s.pendingOp) {
    const op = s.pendingOp;
    s.pendingOp = null;

    if (key === op.op || (op.op === "gc" && key === "c")) {
      applyOperator(s, op, null, true);
      return;
    }

    if (key === "i" || key === "a") {
      s.pendingTextObj = true;
      s.pendingObjAround = key === "a";
      s.pendingOpForObj = op;
      return;
    }

    // cw behaves like ce (vim special case)
    const motionKey = op.op === "c" && key === "w" ? "e" : key;
    const res = motion(s, motionKey, count);
    if (!res.cursor) {
      if (s.pendingFind) s.pendingOp = op;
      return;
    }
    const target = res.cursor;
    const linewise = !!res.linewise;
    let range: Range | null = null;
    if (!linewise) {
      const forward =
        target.row > s.cursor.row ||
        (target.row === s.cursor.row && (res.inclusiveEnd ? target.col >= s.cursor.col : target.col > s.cursor.col));
      const from = forward ? s.cursor : target;
      const to = forward ? target : s.cursor;
      const toCol = res.inclusiveEnd ? to.col + 1 : to.col;
      range = { fromRow: from.row, fromCol: from.col, toRow: to.row, toCol };
    } else {
      range = { fromRow: res.linewise![0], fromCol: 0, toRow: res.linewise![1], toCol: Number.MAX_SAFE_INTEGER };
    }
    applyOperator(s, op, range, linewise);
    return;
  }

  // pending text object
  if (s.pendingTextObj) {
    s.pendingTextObj = false;
    const op = s.pendingOpForObj;
    s.pendingOpForObj = null;
    if (!op) return;
    const to = textObjectRange(s, s.pendingObjAround, key);
    if (!to) {
      s.message = "no text object here";
      return;
    }
    applyOperator(s, op, to.range, to.linewise);
    return;
  }

  // pending leader
  if (s.pendingLeader) {
    s.leaderSeq += key;
    const exact = LEADER_KEYS.find((k) => k === s.leaderSeq);
    const partial = LEADER_KEYS.filter((k) => k.startsWith(s.leaderSeq) && k !== s.leaderSeq);
    if (exact) {
      s.pendingLeader = false;
      s.leaderSeq = "";
      s.float = null;
      leaderAction(s, exact);
      return;
    }
    if (partial.length > 0) {
      showWhichKey(s);
      return;
    }
    s.pendingLeader = false;
    s.leaderSeq = "";
    s.float = null;
    return;
  }

  switch (key) {
    case "Esc": {
      s.pendingOp = null;
      return;
    }
    case "i":
      s.mode = "insert";
      s.recordingChange = ["i"];
      return;
    case "a": {
      const l = buf.lines[s.cursor.row] ?? "";
      s.cursor.col = Math.min(l.length, s.cursor.col + 1);
      s.mode = "insert";
      s.recordingChange = ["a"];
      return;
    }
    case "A": {
      const l = buf.lines[s.cursor.row] ?? "";
      s.cursor.col = l.length;
      s.mode = "insert";
      s.recordingChange = ["A"];
      return;
    }
    case "I": {
      const l = buf.lines[s.cursor.row] ?? "";
      s.cursor.col = firstNonBlank(l);
      s.mode = "insert";
      s.recordingChange = ["I"];
      return;
    }
    case "o": {
      snapshotForUndo(s);
      const l = buf.lines[s.cursor.row] ?? "";
      const indent = l.slice(0, indentOf(l));
      buf.lines.splice(s.cursor.row + 1, 0, indent);
      s.cursor = { row: s.cursor.row + 1, col: indent.length };
      s.mode = "insert";
      s.recordingChange = ["o"];
      return;
    }
    case "O": {
      snapshotForUndo(s);
      const l = buf.lines[s.cursor.row] ?? "";
      const indent = l.slice(0, indentOf(l));
      buf.lines.splice(s.cursor.row, 0, indent);
      s.cursor = { row: s.cursor.row, col: indent.length };
      s.mode = "insert";
      s.recordingChange = ["O"];
      return;
    }
    case "x": {
      const l = buf.lines[s.cursor.row] ?? "";
      if (l.length === 0) return;
      snapshotForUndo(s);
      const removed = deleteRange(s, {
        fromRow: s.cursor.row,
        fromCol: s.cursor.col,
        toRow: s.cursor.row,
        toCol: s.cursor.col + 1,
      });
      s.register = removed.text;
      s.linewise = false;
      s.lastChange = ["x"];
      clampCursor(s);
      return;
    }
    case "X": {
      if (s.cursor.col === 0) return;
      snapshotForUndo(s);
      const removed = deleteRange(s, {
        fromRow: s.cursor.row,
        fromCol: s.cursor.col - 1,
        toRow: s.cursor.row,
        toCol: s.cursor.col,
      });
      s.register = removed.text;
      s.cursor.col = s.cursor.col - 1;
      s.lastChange = ["X"];
      return;
    }
    case "r":
      s.pendingReplace = true;
      return;
    case "D": {
      snapshotForUndo(s);
      const res = deleteRange(s, {
        fromRow: s.cursor.row,
        fromCol: s.cursor.col,
        toRow: s.cursor.row,
        toCol: Number.MAX_SAFE_INTEGER,
      });
      s.register = res.text;
      s.linewise = false;
      s.lastChange = ["D"];
      clampCursor(s);
      return;
    }
    case "C": {
      snapshotForUndo(s);
      const res = deleteRange(s, {
        fromRow: s.cursor.row,
        fromCol: s.cursor.col,
        toRow: s.cursor.row,
        toCol: Number.MAX_SAFE_INTEGER,
      });
      s.register = res.text;
      s.mode = "insert";
      s.recordingChange = ["C"];
      return;
    }
    case "S": {
      snapshotForUndo(s);
      const l = buf.lines[s.cursor.row] ?? "";
      s.register = l;
      s.linewise = false;
      buf.lines[s.cursor.row] = "";
      s.cursor = { row: s.cursor.row, col: 0 };
      s.mode = "insert";
      s.recordingChange = ["S"];
      return;
    }
    case "s":
      // mini.surround hijacks s only when followed by a/d/r; resolved later
      s.pendingSurround = { stage: "s" };
      return;
    case "~": {
      const l = buf.lines[s.cursor.row] ?? "";
      if (!l[s.cursor.col]) return;
      snapshotForUndo(s);
      const ch = l[s.cursor.col];
      const flipped = ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
      buf.lines[s.cursor.row] = l.slice(0, s.cursor.col) + flipped + l.slice(s.cursor.col + 1);
      s.cursor.col = Math.min(l.length - 1, s.cursor.col + 1);
      s.lastChange = ["~"];
      return;
    }
    case "J": {
      snapshotForUndo(s);
      joinLines(s, s.cursor.row);
      s.cursor.col = Math.max(0, (buf.lines[s.cursor.row] ?? "").length - 1);
      s.lastChange = ["J"];
      return;
    }
    case "u":
      doUndo(s);
      return;
    case "C-z":
      doUndo(s);
      return;
    case "C-r":
      doRedo(s);
      return;
    case "p": {
      snapshotForUndo(s);
      putText(s, s.register, s.linewise, true);
      s.lastChange = ["p"];
      clampCursor(s);
      return;
    }
    case "P": {
      snapshotForUndo(s);
      putText(s, s.register, s.linewise, false);
      s.lastChange = ["P"];
      clampCursor(s);
      return;
    }
    case ".": {
      if (!s.lastChange) {
        s.message = "no previous change to repeat";
        return;
      }
      const keys = [...s.lastChange];
      s.lastChange = null;
      for (const k of keys) {
        applyKeyInPlace(s, k);
      }
      return;
    }
    case "d":
      s.pendingOp = { op: "d", count };
      return;
    case "c":
      s.pendingOp = { op: "c", count };
      return;
    case "y":
      s.pendingOp = { op: "y", count };
      return;
    case ">":
      s.pendingOp = { op: ">", count };
      return;
    case "<":
      s.pendingOp = { op: "<", count };
      return;
    case "g":
      s.pendingG = true;
      return;
    case "[":
      s.pendingD = true;
      s.bracketDir = -1;
      return;
    case "]":
      s.pendingD = true;
      s.bracketDir = 1;
      return;
    case "v": {
      s.mode = "visual";
      s.visualAnchor = { ...s.cursor };
      s.lastVisual = { mode: "visual", anchor: { ...s.cursor }, cursor: { ...s.cursor } };
      return;
    }
    case "V": {
      s.mode = "vline";
      s.visualAnchor = { ...s.cursor };
      s.lastVisual = { mode: "vline", anchor: { ...s.cursor }, cursor: { ...s.cursor } };
      return;
    }
    case "C-v": {
      s.mode = "vblock";
      s.visualAnchor = { ...s.cursor };
      s.blockAnchorCol = s.cursor.col;
      s.lastVisual = { mode: "vblock", anchor: { ...s.cursor }, cursor: { ...s.cursor } };
      return;
    }
    case "C-h":
      focusDirection(s, "h");
      return;
    case "C-j":
      focusDirection(s, "j");
      return;
    case "C-k":
      focusDirection(s, "k");
      return;
    case "C-l":
      focusDirection(s, "l");
      return;
    case ":":
      s.mode = "cmd";
      s.cmdKind = ":";
      s.cmd = "";
      return;
    case "/":
      s.mode = "search";
      s.cmdKind = "/";
      s.cmd = "";
      return;
    case "?":
      s.mode = "search";
      s.cmdKind = "?";
      s.cmd = "";
      return;
    case "Space": {
      s.pendingLeader = true;
      s.leaderSeq = "";
      showWhichKey(s);
      return;
    }
    case "A-j": {
      // this config: move line down (or up with A-k)
      const dir = 1;
      moveLines(s, dir);
      return;
    }
    case "A-k": {
      moveLines(s, -1);
      return;
    }
    case "K":
      lspHover(s);
      return;
    case "H": {
      const target = Math.max(0, s.cursor.row - count * 5);
      s.cursor = { row: target, col: firstNonBlank(buf.lines[target] ?? "") };
      return;
    }
    case "L": {
      const target = Math.min(buf.lines.length - 1, s.cursor.row + count * 5);
      s.cursor = { row: target, col: firstNonBlank(buf.lines[target] ?? "") };
      return;
    }
    default: {
      const res = motion(s, key, count);
      if (res.cursor) {
        s.cursor = res.cursor;
        if (key === "j" || key === "k") {
          s.desiredCol = s.desiredCol ?? s.cursor.col;
        } else {
          s.desiredCol = null;
        }
        clampCursor(s);
      }
      return;
    }
  }
}

// ------------------------------------------------------------------ dispatch

function applyKeyInPlace(s: EngineState, key: string) {
  if (s.mode === "prompt") {
    promptKey(s, key);
    return;
  }
  if (s.mode === "cmd") {
    cmdlineKey(s, key);
    return;
  }
  if (s.mode === "search") {
    searchKey(s, key);
    return;
  }
  if (s.focus === "telescope" && s.telescope) {
    telescopeKey(s, key);
    return;
  }
  if (s.focus === "trouble" && s.troubleOpen) {
    troubleKey(s, key);
    return;
  }
  if (s.focus === "tree") {
    const handled = treeKey(s, key);
    if (handled) return;
    if (key === "Esc") {
      s.tree.focused = false;
      s.focus = "editor";
    }
    return;
  }
  if (s.mode === "insert" || s.mode === "replace") {
    insertKey(s, key);
    return;
  }
  if (s.mode === "visual" || s.mode === "vline" || s.mode === "vblock") {
    visualKey(s, key);
    return;
  }
  normalKey(s, key);
  saveActiveWin(s);
  clampCursor(s);
}

export function applyKey(prev: EngineState, key: string): EngineState {
  const s = cloneState(prev);
  applyKeyInPlace(s, key);
  return s;
}

// ------------------------------------------------------------------ level scaffolding

export function seedFromLevel(
  seed: {
    buffers: { name: string; filetype: string; lines: string[] }[];
    activeBuf?: number;
    cursor: Cursor;
    diagnostics?: Record<string, Diagnostic2[]>;
    gitHunks?: Record<string, Hunk2[]>;
    tree?: EngineState["tree"];
    wins?: { id: number; bufIdx: number; cursor: Cursor }[];
    activeWin?: number;
    layout?: LayoutNode;
  }
): EngineState {
  const s = initEngine();
  s.buffers = seed.buffers.map((b, i) => ({
    id: String(i),
    name: b.name,
    filetype: b.filetype,
    lines: [...b.lines],
    undoStack: [],
    redoStack: [],
  }));
  s.activeBuf = seed.activeBuf ?? 0;
  s.cursor = { ...seed.cursor };
  if (seed.wins && seed.layout) {
    s.wins = seed.wins.map((w) => ({ ...w, desiredCol: null }));
    s.activeWin = seed.activeWin ?? s.wins[0].id;
    s.layout = seed.layout;
  } else {
    s.wins = [{ id: 0, bufIdx: s.activeBuf, cursor: { ...seed.cursor }, desiredCol: null }];
    s.layout = { type: "leaf", win: 0 };
  }
  if (seed.diagnostics) {
    s.diagnostics = Object.fromEntries(
      Object.entries(seed.diagnostics).map(([k, v]) => [k, v.map((d) => ({ ...d }))])
    );
  }
  if (seed.gitHunks) {
    s.gitHunks = Object.fromEntries(
      Object.entries(seed.gitHunks).map(([k, v]) => [k, v.map((d) => ({ ...d, original: d.original ? [...d.original] : null }))])
    );
  }
  if (seed.tree) {
    s.tree = { ...s.tree, ...seed.tree, files: seed.tree.files.map((f) => ({ ...f })) };
    if (s.tree.focused) {
      s.focus = "tree";
      s.tree.open = true;
    }
  }
  return s;
}

type Diagnostic2 = EngineState["diagnostics"][string][number];
type Hunk2 = EngineState["gitHunks"][string][number];

// re-export for level authors
export { ensureBuffer, openTelescope, closeTelescope, isWordChar };
