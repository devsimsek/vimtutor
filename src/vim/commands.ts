// Ex commands: :s/: %s with flags, :noh, :w, :q, :GoTagAdd/GoTagRm.
// Patterns use JS regex semantics with vim-ish magic for the drills.

import type { EngineState } from "./types";
import { activeBuffer, snapshotForUndo } from "./ops";
import { findMatches, termFlags, type Match } from "./search";
import { applyGoTag } from "./gopher";

export interface SubstSpec {
  rangeAll: boolean;
  pattern: string;
  replacement: string;
  flags: string; // g, c, i
}

/** Parse :s/: %s command line. Returns null when not a substitute. */
export function parseSubstitute(cmd: string): SubstSpec | null {
  const m = cmd.match(/^(%?)s(\/)(.*)$/s);
  if (!m) return null;
  const sep = m[2];
  const rest = m[3];
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "\\" && i + 1 < rest.length) {
      const next = rest[i + 1];
      if (next === sep) {
        cur += sep; // escaped separator
        i++;
      } else {
        cur += ch + next;
        i++;
      }
      continue;
    }
    if (ch === sep) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  const pattern = parts[0] ?? "";
  const replacement = parts[1] ?? "";
  const flags = (parts[2] ?? "").replace(/[^gci]/g, "");
  return { rangeAll: m[1] === "%", pattern, replacement, flags };
}

/** Apply a parsed substitute to the buffer. Returns number of replacements. */
export function runSubstitute(s: EngineState, spec: SubstSpec): number {
  const buf = activeBuffer(s);
  let re: RegExp;
  try {
    re = new RegExp(spec.pattern, spec.flags.includes("g") ? termFlags(spec.pattern) : termFlags(spec.pattern).replace("g", ""));
  } catch {
    s.message = "E: bad pattern " + spec.pattern;
    return 0;
  }
  let count = 0;
  const rows = spec.rangeAll
    ? buf.lines.map((_, i) => i)
    : [s.cursor.row];
  for (const r of rows) {
    const line = buf.lines[r] ?? "";
    // scan with a global regex (matchAll requires it), apply first hit when no g flag
    const scan = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    scan.lastIndex = 0;
    const hits = [...line.matchAll(scan)];
    if (hits.length === 0) continue;
    if (spec.flags.includes("g")) {
      buf.lines[r] = line.replace(re, spec.replacement);
      count += hits.length;
    } else {
      const first = hits[0];
      buf.lines[r] = line.slice(0, first.index) + spec.replacement + line.slice((first.index ?? 0) + first[0].length);
      count += 1;
    }
  }
  if (count > 0) snapshotForUndo(s);
  return count;
}

/** Live preview matches for inccommand=split while typing :%s/pat */
export function previewSubstitute(cmd: string, lines: string[]): Match[] | null {
  const spec = parseSubstitute(cmd);
  if (!spec || !spec.pattern) return null;
  return findMatches(lines, spec.pattern, true);
}

/** Run a full : command. Returns true if the command changed the buffer. */
export function runCommand(s: EngineState, cmd: string): boolean {
  const trimmed = cmd.trim();
  if (trimmed === "") {
    s.message = "";
    return false;
  }
  if (trimmed === "noh" || trimmed === "nohlsearch" || trimmed === "nohls") {
    s.hlSearch = false;
    return false;
  }
  if (trimmed === "w" || trimmed === "write") {
    s.message = `"${activeBuffer(s).name}" written`;
    return false;
  }
  if (trimmed === "q" || trimmed === "q!" || trimmed === "qa" || trimmed === "qa!") {
    s.message = "this is a web mock, the tab is your :q";
    return false;
  }
  const subst = parseSubstitute(trimmed);
  if (subst) {
    const n = runSubstitute(s, subst);
    s.message = `${n} substitution${n === 1 ? "" : "s"}`;
    return n > 0;
  }
  const tagAdd = trimmed.match(/^GoTagAdd(?:\s+(\S+))?$/);
  if (tagAdd) {
    applyGoTag(s, tagAdd[1] ?? "json");
    return true;
  }
  const tagRm = trimmed.match(/^GoTagRm(?:\s+(\S+))?$/);
  if (tagRm) {
    removeGoTag(s, tagRm[1] ?? "json");
    return true;
  }
  s.message = `E492: Not an editor command: ${trimmed}`;
  return false;
}

function removeGoTag(s: EngineState, tag: string) {
  const buf = activeBuffer(s);
  const re = new RegExp(`\\s*\`${tag}:"[^"]*"\``, "");
  buf.lines = buf.lines.map((l) => l.replace(re, ""));
}
