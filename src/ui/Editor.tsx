// The editor surface: windows laid out from the engine's layout tree,
// each rendering its buffer with gutter, cursorline, selection, search
// highlights, diagnostics, and a block cursor.

import type { EngineState } from "../vim/types";
import { winRects } from "../vim/engine";
import { findMatches } from "../vim/search";
import { tokenize } from "./highlight";

interface Span {
  start: number;
  end: number;
  cls: string;
}

function WindowView({ s, bufIdx, cursor, active, top, left, width, height }: {
  s: EngineState;
  bufIdx: number;
  cursor: { row: number; col: number };
  active: boolean;
  top: number;
  left: number;
  width: number;
  height: number;
}) {
  const buf = s.buffers[bufIdx];
  if (!buf) return null;
  const isInsert = s.mode === "insert" || s.mode === "replace";
  const visualAnchor = s.visualAnchor;
  const selActive = active && (s.mode === "visual" || s.mode === "vline" || s.mode === "vblock") && visualAnchor;

  // search highlights
  const searchSpans: Span[] = [];
  if (s.hlSearch && s.searchState) {
    for (const m of findMatches(buf.lines, s.searchState.term, true)) {
      searchSpans.push({ start: m.col, end: m.col + m.len, cls: "vt-search" });
    }
  }
  // inccommand live preview
  if (s.mode === "cmd" && s.cmdKind === ":") {
    const m = s.cmd.match(/^%?s\/([^/]*)/);
    if (m && m[1]) {
      for (const mt of findMatches(buf.lines, m[1], true)) {
        searchSpans.push({ start: mt.col, end: mt.col + mt.len, cls: "vt-search" });
      }
    }
  }

  const diags = s.diagnostics[buf.id] ?? [];

  return (
    <div
      className={`absolute overflow-hidden ${active ? "ring-1 ring-base-300/0" : "opacity-90"}`}
      style={{ top: `${top * 100 / 30}%`, left: `${left * 100 / 100}%`, width: `${width * 100 / 100}%`, height: `${height * 100 / 30}%` }}
    >
      {active && <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />}
      {buf.lines.slice(0, 30).map((line, r) => {
        const rowSpans: Span[] = [...searchSpans.filter((sp) => sp.start <= line.length)];

        // selection spans
        if (selActive && visualAnchor) {
          const a = visualAnchor;
          const c = cursor;
          const topRow = Math.min(a.row, c.row);
          const botRow = Math.max(a.row, c.row);
          if (s.mode === "vline") {
            if (r >= topRow && r <= botRow) rowSpans.push({ start: 0, end: line.length + 2, cls: "vt-sel" });
          } else if (s.mode === "vblock") {
            const l0 = a.col <= c.col ? a.col : c.col;
            const r0 = a.col <= c.col ? c.col : a.col;
            if (r >= topRow && r <= botRow) rowSpans.push({ start: l0, end: r0 + 1, cls: "vt-sel" });
          } else {
            const [r1, c1, r2, c2] = a.row < c.row || (a.row === c.row && a.col <= c.col)
              ? [a.row, a.col, c.row, c.col]
              : [c.row, c.col, a.row, a.col];
            if (r >= r1 && r <= r2) {
              const from = r === r1 ? c1 : 0;
              const to = r === r2 ? c2 + 1 : line.length + 2;
              rowSpans.push({ start: from, end: to, cls: "vt-sel" });
            }
          }
        }

        // diagnostic underlines (by col/len on their row)
        const rowDiags = diags.filter((d) => d.row === r);
        for (const d of rowDiags) {
          rowSpans.push({ start: d.col, end: d.col + Math.max(d.len, 1), cls: "vt-diag" });
        }

        const isCursorLine = active && cursor.row === r && (s.mode !== "insert" || isInsert) && s.focus === "editor";
        const abs = r + 1;
        const rel = Math.abs(abs - (cursor.row + 1));
        const numText = isCursorLine ? String(abs) : String(rel);

        const tokens = tokenize(line, buf.filetype);
        const gutterWidth = String(buf.lines.length).length + 1;

        return (
          <div key={r} className={`vt-line flex ${isCursorLine ? "vt-cursorline" : ""}`}>
            <span className="vt-gutter" style={{ minWidth: `${gutterWidth + 1}ch` }}>
              {numText}
            </span>
            <span className="vt-git-sign" style={{ minWidth: "1ch" }}>
              {(s.gitHunks[buf.id] ?? []).some((h) => h.row === r) ? "▎" : " "}
            </span>
            <span className="relative" style={{ minWidth: "1ch" }}>
              <RenderLine line={line} tokens={tokens} spans={rowSpans} />
              {active && s.focus === "editor" && cursor.row === r && !s.blockInsert && (
                <CharCursor line={line} col={cursor.col} insert={isInsert} />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RenderLine({ line, tokens, spans }: { line: string; tokens: { text: string; cls: string | null }[]; spans: Span[] }) {
  if (line === "") return <span> </span>;
  // render tokens, then overlay span classes by re-slicing: simple approach,
  // render per-char class map for spans on top of token colors
  const clsFor = new Array(line.length).fill("");
  for (const sp of spans) {
    for (let i = sp.start; i < sp.end && i < line.length; i++) {
      clsFor[i] += ` ${sp.cls}`;
    }
  }
  // tokens with their offsets
  const out: React.ReactNode[] = [];
  let idx = 0;
  for (let ti = 0; ti < tokens.length; ti++) {
    const t = tokens[ti];
    const start = line.indexOf(t.text, idx);
    if (start === -1) {
      continue;
    }
    // chunk by span boundaries inside this token
    let pos = start;
    const end = start + t.text.length;
    while (pos < end) {
      const cls = clsFor[pos].trim();
      let next = pos + 1;
      while (next < end && clsFor[next].trim() === cls) next++;
      const chunk = line.slice(pos, next);
      const base = t.cls ?? "";
      out.push(
        cls ? (
          <span key={`${pos}`} className={`${base} ${cls}`}>{chunk}</span>
        ) : (
          <span key={`${pos}`} className={base || undefined}>{chunk}</span>
        )
      );
      pos = next;
    }
    idx = end;
  }
  return <>{out}</>;
}

function CharCursor({ line, col, insert }: { line: string; col: number; insert: boolean }) {
  const clamped = Math.min(col, line.length);
  const ch = line[clamped] ?? " ";
  if (insert) {
    return (
      <span className="absolute top-0 vt-cursor-insert" style={{ left: `${clamped}ch`, height: "1.5rem", width: "2px" }} />
    );
  }
  return (
    <span className="absolute top-0 vt-cursor" style={{ left: `${clamped}ch`, width: "1ch", height: "1.5rem" }}>
      {ch === " " ? "\u00a0" : ch}
    </span>
  );
}

export function Editor({ s }: { s: EngineState }) {
  const rects = winRects(s.layout);
  return (
    <div className="relative w-full h-full bg-base-200 text-base-content font-mono text-sm select-none">
      {s.wins.map((w) => {
        const rect = rects.get(w.id) ?? { top: 0, height: 30, left: 0, width: 100 };
        const cursor = s.activeWin === w.id ? s.cursor : w.cursor;
        return (
          <WindowView
            key={w.id}
            s={s}
            bufIdx={w.bufIdx}
            cursor={cursor}
            active={s.activeWin === w.id}
            top={rect.top}
            left={rect.left}
            width={rect.width}
            height={rect.height}
          />
        );
      })}
      {/* block insert pending indicator */}
      {s.blockInsert && (
        <div className="absolute bottom-2 right-2 badge badge-warning badge-sm font-mono">
          block insert: {s.blockInsert.text || "type..."} + Esc
        </div>
      )}
    </div>
  );
}
