// Buffer mutation helpers shared by the keystroke engine and : commands.
// All functions mutate the state's active buffer directly; the engine clones
// state (and snapshots undo) before calling into them.

import type { Buffer, EngineState, Range } from "./types";

export type { Range };

export function activeBuffer(s: EngineState): Buffer {
  return s.buffers[s.activeBuf];
}

export function snapshotForUndo(s: EngineState) {
  const buf = activeBuffer(s);
  buf.undoStack.push(buf.lines.map((l) => l));
  if (buf.undoStack.length > 200) buf.undoStack.shift();
  buf.redoStack = [];
}

export function cloneBuffer(b: Buffer): Buffer {
  return {
    ...b,
    lines: [...b.lines],
    undoStack: b.undoStack.map((l) => [...l]),
    redoStack: b.redoStack.map((l) => [...l]),
  };
}

export function clampCursor(s: EngineState) {
  const lines = activeBuffer(s).lines;
  s.cursor.row = Math.max(0, Math.min(s.cursor.row, lines.length - 1));
  const line = lines[s.cursor.row] ?? "";
  // normal mode may sit on the last char; insert mode cannot
  const max = s.mode === "insert" || s.mode === "replace" ? line.length : Math.max(0, line.length - 1);
  s.cursor.col = Math.max(0, Math.min(s.cursor.col, max));
}

export function setLines(s: EngineState, lines: string[]) {
  activeBuffer(s).lines = lines;
}

/** Delete a charwise range within one line. Returns deleted text. */
export function deleteCharRange(s: EngineState, row: number, start: number, end: number): string {
  const buf = activeBuffer(s);
  const line = buf.lines[row] ?? "";
  const removed = line.slice(start, end);
  buf.lines[row] = line.slice(0, start) + line.slice(end);
  return removed;
}

/** Delete whole lines [from, to]. Returns deleted lines. */
export function deleteLines(s: EngineState, from: number, to: number): string[] {
  const buf = activeBuffer(s);
  const removed = buf.lines.slice(from, to + 1);
  buf.lines.splice(from, to - from + 1);
  if (buf.lines.length === 0) buf.lines = [""];
  return removed;
}

/** Insert text at cursor (insert mode), text may contain \n. */
export function insertText(s: EngineState, text: string) {
  const buf = activeBuffer(s);
  const { row, col } = s.cursor;
  const line = buf.lines[row] ?? "";
  const insertedLines = text.split("\n");
  if (insertedLines.length === 1) {
    buf.lines[row] = line.slice(0, col) + text + line.slice(col);
    s.cursor.col += text.length;
    return;
  }
  const before = line.slice(0, col);
  const after = line.slice(col);
  const head = before + insertedLines[0];
  const tail = insertedLines[insertedLines.length - 1] + after;
  const midLines = insertedLines.slice(1, -1);
  const replacement = [head, ...midLines, tail];
  buf.lines.splice(row, 1, ...replacement);
  s.cursor = {
    row: row + insertedLines.length - 1,
    col: tail.length - after.length,
  };
}

/** Delete an arbitrary range (charwise within a line, linewise across lines). */
export function deleteRange(s: EngineState, r: Range): { text: string; linewise: boolean } {
  const buf = activeBuffer(s);
  if (r.fromRow === r.toRow) {
    const line = buf.lines[r.fromRow] ?? "";
    const lo = Math.min(r.fromCol, r.toCol);
    const hi = Math.max(r.fromCol, r.toCol);
    const text = line.slice(lo, hi);
    buf.lines[r.fromRow] = line.slice(0, lo) + line.slice(hi);
    s.cursor = { row: r.fromRow, col: lo };
    if (buf.lines[r.fromRow].length === 0 && buf.lines.length > 1) {
      // vim keeps empty lines on charwise delete; keep it
    }
    return { text, linewise: false };
  }
  const lo = r.fromRow < r.toRow ? r : { fromRow: r.toRow, toRow: r.fromRow, fromCol: r.toCol, toCol: r.fromCol };
  const first = buf.lines[lo.fromRow] ?? "";
  const last = buf.lines[lo.toRow] ?? "";
  const text =
    buf.lines
      .slice(lo.fromRow, lo.toRow + 1)
      .join("\n");
  const merged = first.slice(0, lo.fromCol) + last.slice(lo.toCol);
  buf.lines.splice(lo.fromRow, lo.toRow - lo.fromRow + 1, merged);
  if (buf.lines.length === 0) buf.lines = [""];
  s.cursor = { row: Math.min(lo.fromRow, buf.lines.length - 1), col: Math.min(lo.fromCol, Math.max(0, merged.length - 1)) };
  return { text, linewise: true };
}

export function yankRange(s: EngineState, r: Range): { text: string; linewise: boolean } {
  const buf = activeBuffer(s);
  if (r.fromRow === r.toRow) {
    const line = buf.lines[r.fromRow] ?? "";
    const lo = Math.min(r.fromCol, r.toCol);
    const hi = Math.max(r.fromCol, r.toCol);
    return { text: line.slice(lo, hi), linewise: false };
  }
  const lo = r.fromRow < r.toRow ? r : { fromRow: r.toRow, toRow: r.fromRow, fromCol: r.toCol, toCol: r.fromCol };
  const lines = buf.lines.slice(lo.fromRow, lo.toRow + 1);
  void lo;
  return { text: lines.join("\n"), linewise: true };
}

/** Put register text after (p) or before (P) the cursor. */
export function putText(s: EngineState, text: string, linewise: boolean, after: boolean) {
  const buf = activeBuffer(s);
  const { row, col } = s.cursor;
  if (linewise) {
    const insertAt = after ? row + 1 : row;
    const lines = text.split("\n");
    buf.lines.splice(insertAt, 0, ...lines);
    s.cursor = { row: insertAt, col: firstNonBlankOf(lines[0] ?? "") };
  } else {
    const line = buf.lines[row] ?? "";
    const at = after ? Math.min(col + 1, line.length) : col;
    buf.lines[row] = line.slice(0, at) + text + line.slice(at);
    s.cursor = { row, col: at + text.length - 1 };
  }
}

function firstNonBlankOf(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}

/** Apply indent change (>) to a range of lines. */
export function indentLines(s: EngineState, from: number, to: number, dir: 1 | -1) {
  const buf = activeBuffer(s);
  for (let r = from; r <= to; r++) {
    const line = buf.lines[r] ?? "";
    if (dir === 1) {
      if (line.trim().length > 0 || line.length > 0) buf.lines[r] = "  " + line;
    } else {
      let remove = 0;
      while (remove < 2 && line[remove] === " ") remove++;
      buf.lines[r] = line.slice(remove);
    }
  }
}

/** Toggle comment on lines [from, to] honoring commentstring per filetype. */
export function toggleComment(s: EngineState, from: number, to: number) {
  const buf = activeBuffer(s);
  const token = commentTokenFor(buf.filetype);
  if (!token) return;
  // decide by first non-blank line in the range
  let anyCommented = false;
  for (let r = from; r <= to; r++) {
    const line = buf.lines[r] ?? "";
    if (line.trim().length > 0) {
      anyCommented = line.trimStart().startsWith(token);
      break;
    }
  }
  for (let r = from; r <= to; r++) {
    const line = buf.lines[r] ?? "";
    if (line.trim().length === 0) continue;
    if (anyCommented) {
      const idx = line.indexOf(token);
      if (idx >= 0) {
        let after = line.slice(idx + token.length);
        if (after.startsWith(" ")) after = after.slice(1);
        buf.lines[r] = line.slice(0, idx) + after;
      }
    } else {
      const ws = line.slice(0, line.length - line.trimStart().length);
      buf.lines[r] = ws + token + " " + line.trimStart();
    }
  }
}

function commentTokenFor(ft: string): string {
  switch (ft) {
    case "lua":
      return "--";
    case "go":
      return "//";
    case "py":
      return "#";
    default:
      return "//";
  }
}

export function joinLines(s: EngineState, row: number): boolean {
  const buf = activeBuffer(s);
  if (row + 1 >= buf.lines.length) return false;
  const a = buf.lines[row] ?? "";
  const b = buf.lines[row + 1] ?? "";
  buf.lines[row] = a.replace(/\s+$/, "") + " " + b.replace(/^\s+/, "");
  buf.lines.splice(row + 1, 1);
  return true;
}
