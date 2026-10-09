// Text utilities: char classes, word motions, indent, comment strings.

const WORD_RE = /[A-Za-z0-9_]/;
const PUNCT_RE = /[!-/:-@[-`{-~]/;

export function charClass(ch: string): 0 | 1 | 2 {
  // 0 = whitespace, 1 = word, 2 = punctuation
  if (ch === undefined || ch === null) return 0;
  if (/\s/.test(ch)) return 0;
  if (WORD_RE.test(ch)) return 1;
  return 2;
}

export function isWordChar(ch: string): boolean {
  return WORD_RE.test(ch);
}

export function isPunct(ch: string): boolean {
  return PUNCT_RE.test(ch);
}

// --- word motion math -------------------------------------------------

function lineAt(lines: string[], row: number): string {
  return lines[row] ?? "";
}

/** Find start of next word forward (w semantics). Returns null if no further word. */
export function nextWordStart(lines: string[], row: number, col: number): Cursor2 | null {
  const clsAt = (line: string, i: number) => charClass(line[i] ?? " ");
  let r = row;
  let c = col;
  // leave the current run (word chars or punctuation) or the whitespace run
  {
    const line = lines[r] ?? "";
    if (c < line.length && clsAt(line, c) !== 0) {
      const cls = clsAt(line, c);
      while (c < line.length && clsAt(line, c) === cls) c++;
      // skip trailing whitespace on this line
      while (c < line.length && clsAt(line, c) === 0) c++;
      if (c < line.length) return { row: r, col: c };
    } else {
      while (c < line.length && clsAt(line, c) === 0) c++;
      if (c < line.length) return { row: r, col: c };
    }
  }
  // first word char of the next non-blank line
  for (let nr = r + 1; nr < lines.length; nr++) {
    const l = lines[nr] ?? "";
    if (l.trim().length === 0) continue;
    let nc = 0;
    while (nc < l.length && clsAt(l, nc) === 0) nc++;
    return { row: nr, col: nc };
  }
  return null;
}

export interface Cursor2 {
  row: number;
  col: number;
}

/** Find start of previous word (b). */
export function prevWordStart(lines: string[], row: number, col: number): Cursor2 | null {
  let r = row;
  let c = col;
  for (let guard = 0; guard < 100000; guard++) {
    const line = lineAt(lines, r);
    if (c <= 0) {
      if (r === 0) return null;
      r -= 1;
      const l = lineAt(lines, r);
      c = l.length; // will scan back
      if (l.trim().length > 0) {
        return { row: r, col: lastWordStartInLine(l) };
      }
      continue;
    }
    // skip whitespace backward
    while (c > 0 && charClass(line[c - 1]) === 0) c--;
    if (c === 0) continue;
    const cls = charClass(line[c - 1]);
    while (c > 0 && charClass(line[c - 1]) === cls) c--;
    return { row: r, col: c };
  }
  return null;
}

function lastWordStartInLine(line: string): number {
  if (line.length === 0) return 0;
  let c = line.length;
  while (c > 0 && charClass(line[c - 1]) === 0) c--;
  if (c === 0) return 0;
  const cls = charClass(line[c - 1]);
  while (c > 0 && charClass(line[c - 1]) === cls) c--;
  return c;
}

/** Find end of current/next word (e). */
export function wordEnd(lines: string[], row: number, col: number): Cursor2 | null {
  let r = row;
  let c = col + 1;
  for (let guard = 0; guard < 100000; guard++) {
    const line = lineAt(lines, r);
    if (c >= line.length) {
      if (r + 1 >= lines.length) return null;
      r += 1;
      c = 0;
      continue;
    }
    if (charClass(line[c]) === 0) {
      c++;
      continue;
    }
    const cls = charClass(line[c]);
    let nc = c;
    while (nc + 1 < line.length && charClass(line[nc + 1]) === cls) nc++;
    if (nc > col || r !== row) return { row: r, col: nc };
    c = nc + 1;
  }
  return null;
}

/** End of previous word for `ge`-ish operations or backward WORD end. */
export function prevWordEnd(lines: string[], row: number, col: number): Cursor2 | null {
  let r = row;
  let c = col;
  for (let guard = 0; guard < 100000; guard++) {
    const line = lineAt(lines, r);
    if (c <= 0) {
      if (r === 0) return null;
      r -= 1;
      c = Math.max(0, lineAt(lines, r).length - 1);
      continue;
    }
    if (charClass(line[c]) === 0) {
      c--;
      continue;
    }
    const cls = charClass(line[c]);
    let nc = c;
    while (nc - 1 >= 0 && charClass(line[nc - 1]) === cls) nc--;
    if (nc < col || r !== row) return { row: r, col: nc };
    c = nc - 1;
  }
  return null;
}

// --- indent / comments ------------------------------------------------

export function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}

export function firstNonBlank(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}

export function commentToken(ft: string): string {
  switch (ft) {
    case "lua":
      return "--";
    case "go":
    case "ts":
    case "js":
    case "jsonc":
      return "//";
    case "py":
      return "#";
    case "md":
      return "";
    default:
      return "#";
  }
}

// --- snake_case for go tags -------------------------------------------

export function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)/g, "_$1")
    .replace(/^_/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// --- matching bracket --------------------------------------------------

const OPEN = "([{";
const CLOSE = ")]}";

export function matchBracket(line: string, col: number): Cursor2 | null {
  const ch = line[col];
  if (!ch) return null;
  const openIdx = OPEN.indexOf(ch);
  const closeIdx = CLOSE.indexOf(ch);
  if (openIdx >= 0) {
    let depth = 0;
    let r = 0; // caller passes whole-buffer search via lines param? keep line-only here
    void r;
    for (let c = col; c < line.length; c++) {
      if (line[c] === ch) depth++;
      else if (line[c] === CLOSE[openIdx]) {
        depth--;
        if (depth === 0) return { row: -1, col: c };
      }
    }
    return null;
  }
  if (closeIdx >= 0) {
    let depth = 0;
    for (let c = col; c >= 0; c--) {
      if (line[c] === ch) depth++;
      else if (line[c] === OPEN[closeIdx]) {
        depth--;
        if (depth === 0) return { row: -1, col: c };
      }
    }
    return null;
  }
  return null;
}

/** Whole-buffer % matching bracket. */
export function matchBracketBuf(
  lines: string[],
  row: number,
  col: number
): Cursor2 | null {
  const line = lineAt(lines, row);
  const ch = line[col];
  if (!ch) return null;
  const openIdx = OPEN.indexOf(ch);
  const closeIdx = CLOSE.indexOf(ch);
  const clamp = (r: number, c: number): Cursor2 => ({
    row: Math.min(r, lines.length - 1),
    col: Math.max(0, Math.min(c, (lines[r] ?? "").length - 1)),
  });
  if (openIdx >= 0) {
    let depth = 0;
    for (let r = row; r < lines.length; r++) {
      const start = r === row ? col : 0;
      const l = lines[r];
      for (let c = start; c < l.length; c++) {
        if (l[c] === ch) depth++;
        else if (l[c] === CLOSE[openIdx]) {
          depth--;
          if (depth === 0) return clamp(r, c);
        }
      }
    }
    return null;
  }
  if (closeIdx >= 0) {
    let depth = 0;
    for (let r = row; r >= 0; r--) {
      const l = lines[r];
      const start = r === row ? col : l.length - 1;
      for (let c = start; c >= 0; c--) {
        if (l[c] === ch) depth++;
        else if (l[c] === OPEN[closeIdx]) {
          depth--;
          if (depth === 0) return clamp(r, c);
        }
      }
    }
    return null;
  }
  return null;
}
