// Telescope simulation: <leader>ff / <leader>fg / <leader>fb / <leader>st.

import type { EngineState, TelescopeState } from "./types";
import { activeBuffer } from "./ops";
import { openBufferByName } from "./buffers";
import { treeOrder, defaultContents } from "./tree";

export function openTelescope(s: EngineState, kind: TelescopeState["kind"]) {
  s.telescope = { open: true, kind, query: "", selected: 0 };
  s.focus = "telescope";
}

export function closeTelescope(s: EngineState) {
  s.telescope = null;
  s.focus = "editor";
}

export interface TeleResult {
  primary: string;
  secondary?: string;
  row?: number; // target buffer row for jump
  path?: string;
}

export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return 0;
    score += idx === ti ? 3 : 1;
    ti = idx + 1;
  }
  if (t.includes(q)) score += 5;
  return score;
}

export function telescopeResults(s: EngineState): TeleResult[] {
  const t = s.telescope;
  if (!t) return [];
  const q = t.query;
  if (t.kind === "files") {
    const paths = treeOrder(s.tree.files).filter((f) => f.type === "file");
    return paths
      .map((f) => ({ primary: f.path, path: f.path, score: fuzzyScore(q, f.path) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ primary, path }) => ({ primary, path }));
  }
  if (t.kind === "buffers") {
    return s.buffers
      .map((b) => ({ primary: b.name, path: b.name, score: fuzzyScore(q, b.name) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ primary, path }) => ({ primary, path }));
  }
  if (t.kind === "todos") {
    const out: TeleResult[] = [];
    const contents = defaultContents();
    for (const buf of s.buffers) {
      const lines = contents[buf.name] ?? buf.lines;
      for (let r = 0; r < lines.length; r++) {
        const m = (lines[r] ?? "").match(/\b(TODO|FIXME|HACK|NOTE)\b(.*)/);
        if (m) {
          const text = `${m[1]}: ${m[2].trim()}`;
          if (fuzzyScore(q, text) > 0) {
            out.push({ primary: text, secondary: `${buf.name}:${r + 1}`, path: buf.name, row: r });
          }
        }
      }
    }
    return out;
  }
  // grep
  const out: TeleResult[] = [];
  const contents = defaultContents();
  for (const buf of s.buffers) {
    const lines = contents[buf.name] ?? buf.lines;
    for (let r = 0; r < lines.length; r++) {
      const line = lines[r] ?? "";
      if (!q) continue;
      const idx = line.toLowerCase().indexOf(q.toLowerCase());
      if (idx >= 0) {
        out.push({ primary: line, secondary: `${buf.name}:${r + 1}:${idx + 1}`, path: buf.name, row: r });
      }
    }
  }
  return out;
}

/** Handle a key while the telescope window is up. Returns true if handled. */
export function telescopeKey(s: EngineState, key: string): boolean {
  const t = s.telescope;
  if (!t) return false;
  if (key === "Esc") {
    closeTelescope(s);
    return true;
  }
  if (key === "C-n" || key === "Down") {
    const total = telescopeResults(s).length;
    if (total > 0) t.selected = (t.selected + 1) % total;
    return true;
  }
  if (key === "C-p" || key === "Up") {
    const total = telescopeResults(s).length;
    if (total > 0) t.selected = (t.selected - 1 + total) % total;
    return true;
  }
  if (key === "CR") {
    const results = telescopeResults(s);
    const pick = results[t.selected] ?? results[0];
    if (t.kind === "files") {
      // find_files create-on-enter: a typed path with no match creates the file
      const q = t.query.trim();
      const exactExists = s.tree.files.some((f) => f.path === q);
      if (q && (results.length === 0 || (!exactExists && q.includes("/")))) {
        s.tree.files.push({ path: q, type: "file" });
        const bufIdx = openBufferByName(s, q, [""]);
        s.activeBuf = bufIdx;
        s.cursor = { row: 0, col: 0 };
        closeTelescope(s);
        s.message = `created ${q}`;
        return true;
      }
    }
    if (!pick) {
      closeTelescope(s);
      return true;
    }
    if (t.kind === "files" && pick.path) {
      const node = treeOrder(s.tree.files).find((f) => f.path === pick.path);
      const bufIdx = openBufferByName(s, pick.path, node?.content ?? [""]);
      s.activeBuf = bufIdx;
      s.cursor = { row: 0, col: 0 };
      closeTelescope(s);
      s.message = `"${pick.path}" opened`;
      return true;
    }
    if (pick.path) {
      const node = treeOrder(s.tree.files).find((f) => f.path === pick.path);
      const bufIdx = openBufferByName(s, pick.path, node?.content ?? activeBuffer(s).lines);
      s.activeBuf = bufIdx;
      s.cursor = { row: pick.row ?? 0, col: 0 };
      closeTelescope(s);
      s.message = `jumped to ${pick.path}:${(pick.row ?? 0) + 1}`;
      return true;
    }
    closeTelescope(s);
    return true;
  }
  if (key === "BS") {
    t.query = t.query.slice(0, -1);
    t.selected = 0;
    return true;
  }
  if (key.length === 1) {
    t.query += key;
    t.selected = 0;
    return true;
  }
  return false;
}
