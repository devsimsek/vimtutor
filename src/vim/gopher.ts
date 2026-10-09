// gopher.nvim simulation: <leader>ga / <leader>gA / <leader>gx struct tags.

import type { EngineState } from "./types";
import { activeBuffer, snapshotForUndo } from "./ops";
import { toSnakeCase } from "./text";

const FIELD_RE = /^\s*([A-Z]\w*)\s+[\w\[\]\*\.]+(?:\s*`[^`]*`)?\s*$/;

function findStructBlock(lines: string[], row: number): { start: number; end: number } | null {
  // scan up from the cursor for "type X struct {"
  let start = -1;
  for (let r = Math.min(row, lines.length - 1); r >= 0; r--) {
    if (/\bstruct \{/.test(lines[r] ?? "")) {
      start = r;
      break;
    }
  }
  if (start === -1) return null;
  for (let r = start + 1; r < lines.length; r++) {
    if (/^\s*}\s*$/.test(lines[r] ?? "")) {
      return { start, end: r - 1 };
    }
  }
  return { start, end: lines.length - 1 };
}

/** Add `tag:"snake_case"` tags to every field of the struct under the cursor. */
export function applyGoTag(s: EngineState, tag: string): number {
  const buf = activeBuffer(s);
  const block = findStructBlock(buf.lines, s.cursor.row);
  if (!block) {
    s.message = "gopher: no struct found";
    return 0;
  }
  snapshotForUndo(s);
  let tagged = 0;
  const re = new RegExp(`\`${tag}:"([^"]*)"\``);
  for (let r = block.start + 1; r <= block.end; r++) {
    const line = buf.lines[r] ?? "";
    if (line.trim() === "" || line.trim().startsWith("//")) continue;
    const fm = line.match(FIELD_RE);
    if (!fm) continue;
    const existing = line.match(re);
    if (existing) continue;
    const jsonName = toSnakeCase(fm[1]);
    buf.lines[r] = line.replace(/\s*$/, "") + " `" + tag + `:"` + jsonName + `"` + "`";
    tagged++;
  }
  s.message = tagged > 0 ? `gopher: tagged ${tagged} field(s)` : "gopher: fields already tagged";
  return tagged;
}

/** Remove tags from struct fields. */
export function removeGoTags(s: EngineState, tag?: string): number {
  const buf = activeBuffer(s);
  const block = findStructBlock(buf.lines, s.cursor.row);
  if (!block) {
    s.message = "gopher: no struct found";
    return 0;
  }
  snapshotForUndo(s);
  const re = tag
    ? new RegExp(`\\s*\`${tag}:"[^"]*"\``)
    : /\s*`[^`]*`/;
  let removed = 0;
  for (let r = block.start + 1; r <= block.end; r++) {
    const line = buf.lines[r] ?? "";
    const stripped = line.replace(re, "");
    if (stripped !== line) {
      buf.lines[r] = stripped.replace(/\s+$/, "");
      removed++;
    }
  }
  s.message = removed > 0 ? `gopher: removed ${removed} tag(s)` : "gopher: nothing to remove";
  return removed;
}
