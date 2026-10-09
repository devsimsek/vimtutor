// Search: /, ?, n, N, *, # with ignorecase + smartcase (options.lua).

import type { Cursor, EngineState } from "./types";

export interface Match extends Cursor {
  len: number;
}

/** smartcase: uppercase anywhere in the pattern makes it case-sensitive. */
export function termFlags(term: string): "g" | "gi" {
  return /[A-Z]/.test(term) ? "g" : "gi";
}

export function findMatches(lines: string[], term: string, regex = false): Match[] {
  const out: Match[] = [];
  if (!term) return out;
  let re: RegExp;
  try {
    re = regex ? new RegExp(term, termFlags(term) + "l") : new RegExp(escapeRe(term), termFlags(term));
  } catch {
    try {
      re = new RegExp(escapeRe(term), termFlags(term));
    } catch {
      return out;
    }
  }
  for (let row = 0; row < lines.length; row++) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[row])) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      out.push({ row, col: m.index, len: m[0].length });
    }
  }
  return out;
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Next match strictly after (row, col) wrapping the buffer. */
export function nextMatch(
  lines: string[],
  from: Cursor,
  term: string,
  dir: 1 | -1,
  regex = false
): Match | null {
  const all = findMatches(lines, term, regex);
  if (all.length === 0) return null;
  if (dir === 1) {
    for (const m of all) {
      if (m.row > from.row || (m.row === from.row && m.col > from.col)) return m;
    }
    return all[0];
  }
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    if (m.row < from.row || (m.row === from.row && m.col < from.col)) return m;
  }
  return all[all.length - 1];
}

/** Star search: word under cursor, jump to next occurrence. */
export function cwordAt(lines: string[], cursor: Cursor): { word: string; start: number } {
  const line = lines[cursor.row] ?? "";
  let start = cursor.col;
  if (start >= line.length) start = line.length - 1;
  const isW = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);
  if (!isW(line[start])) {
    // snap right then left
    let c = cursor.col;
    while (c < line.length && !isW(line[c])) c++;
    if (c < line.length) start = c;
    else {
      c = cursor.col;
      while (c > 0 && !isW(line[c - 1])) c--;
      start = Math.max(0, c - 1);
    }
  }
  let s = start;
  while (s > 0 && isW(line[s - 1])) s--;
  let e = start;
  while (e < line.length - 1 && isW(line[e + 1])) e++;
  return { word: line.slice(s, e + 1), start: s };
}

export function searchActive(s: EngineState): { term: string; dir: 1 | -1 } | null {
  return s.searchState;
}
