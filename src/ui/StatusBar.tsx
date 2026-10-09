// Statusline + command line (with inccommand=split preview line).

import type { EngineState } from "../vim/types";
import { parseSubstitute } from "../vim/commands";
import { findMatches } from "../vim/search";

const MODE_LABEL: Record<string, { label: string; cls: string }> = {
  normal: { label: " NORMAL ", cls: "bg-primary text-base-200" },
  insert: { label: " INSERT ", cls: "bg-warning text-base-200" },
  replace: { label: " REPLACE ", cls: "bg-error text-base-200" },
  visual: { label: " VISUAL ", cls: "bg-accent text-base-200" },
  vline: { label: " V-LINE ", cls: "bg-accent text-base-200" },
  vblock: { label: " V-BLOCK ", cls: "bg-secondary text-base-200" },
  cmd: { label: " COMMAND ", cls: "bg-neutral text-base-content" },
  search: { label: " SEARCH ", cls: "bg-neutral text-base-content" },
  prompt: { label: " PROMPT ", cls: "bg-neutral text-base-content" },
};

export function StatusBar({ s }: { s: EngineState }) {
  const buf = s.buffers[s.activeBuf];
  const mode = MODE_LABEL[s.mode] ?? MODE_LABEL.normal;
  return (
    <div className="flex items-center font-mono text-xs border-t border-base-300 bg-base-300/60">
      <span className={mode.cls + " px-2 py-0.5 font-bold"}>{mode.label}</span>
      <span className="px-2 truncate">
        {buf?.name ?? ""}
        {s.tree.cut ? <span className="text-info ml-2">✂ {s.tree.cut.path}</span> : null}
      </span>
      <span className="flex-1" />
      {s.tree.message && <span className="px-2 text-info">{s.tree.message}</span>}
      <span className="px-2 text-base-content/60">
        {s.wins.length > 1 ? `win ${s.wins.findIndex((w) => w.id === s.activeWin) + 1}/${s.wins.length} ` : ""}
        {buf?.lines.length}L
      </span>
      <span className="px-2 text-base-content/60">
        {s.cursor.row + 1}:{s.cursor.col + 1}
      </span>
    </div>
  );
}

export function CommandLine({ s }: { s: EngineState }) {
  const showCmd = s.mode === "cmd" || s.mode === "search" || s.mode === "prompt";
  const prefix = s.cmdKind === ":" ? ":" : s.cmdKind === "/" ? "/" : s.cmdKind === "?" ? "?" : "";

  // inccommand=split preview
  let preview: string | null = null;
  if (s.mode === "cmd" && s.cmdKind === ":") {
    const spec = parseSubstitute(s.cmd);
    if (spec && spec.pattern) {
      const n = findMatches(s.buffers[s.activeBuf].lines, spec.pattern, true).length;
      preview = `[preview] ${n} match${n === 1 ? "" : "es"} for /${spec.pattern}/`;
    }
  }

  return (
    <div className="font-mono text-xs bg-base-300 px-2 py-1 min-h-7">
      {showCmd ? (
        <span>
          <span className="text-accent">{prefix === ":" ? ":" : `${prefix}`}</span>
          <span className="text-base-content">{s.cmd}</span>
          <span className="animate-pulse">▌</span>
          {s.promptAction.kind !== "none" && (
            <span className="text-info ml-3">
              {s.promptAction.kind === "gopher-tag" && "tag name (Enter confirms, Esc cancels)"}
              {s.promptAction.kind === "tree-create" && "new path, / suffix = directory"}
              {s.promptAction.kind === "tree-rename" && `rename ${s.promptAction.path}`}
              {s.promptAction.kind === "tree-delete" && `delete ${s.promptAction.path}? type y + Enter`}
              {s.promptAction.kind === "lsp-rename" && `rename symbol "${s.promptAction.symbol}" to:`}
            </span>
          )}
        </span>
      ) : s.message ? (
        <span className="text-secondary">{s.message}</span>
      ) : preview ? (
        <span className="text-warning">{preview}</span>
      ) : (
        <span className="text-base-content/30">press Space and wait for which-key hints</span>
      )}
    </div>
  );
}
