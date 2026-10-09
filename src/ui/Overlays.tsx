// Overlays: file tree rail, telescope, trouble, floats, which-key.

import type { EngineState } from "../vim/types";
import { telescopeResults } from "../vim/telescope";
import { treeOrder } from "../vim/tree";

function indentOfPath(path: string): number {
  return path.split("/").length - 1;
}

export function FileTree({ s }: { s: EngineState }) {
  if (!s.tree.open) return null;
  const order = treeOrder(s.tree.files);
  return (
    <div
      className={`absolute top-0 left-0 bottom-0 w-64 z-20 font-mono text-xs overflow-y-auto border-r border-base-300 bg-base-200 ${
        s.focus === "tree" ? "ring-1 ring-primary/60" : "opacity-95"
      }`}
    >
      <div className="px-2 py-1 text-base-content/50 border-b border-base-300 sticky top-0 bg-base-200">
        nvim-tree {s.focus === "tree" ? "(focused: j/k, Enter, a, r, d, x/c, p, q)" : "(<leader>e to focus)"}
      </div>
      {order.map((f) => {
        const selected = s.tree.selected === f.path;
        const cutHere = s.tree.cut?.path === f.path;
        return (
          <div
            key={f.path}
            className={`flex items-center px-2 py-0.5 ${selected ? "bg-primary/30 text-base-content" : "text-base-content/80"}`}
            style={{ paddingLeft: `${0.5 + indentOfPath(f.path)}rem` }}
          >
            <span className="mr-1">{f.type === "dir" ? "▸" : "│"}</span>
            <span className={f.type === "dir" ? "text-primary" : "text-secondary"}>{f.path.split("/").pop()}</span>
            {cutHere && <span className="ml-auto text-warning">✂</span>}
          </div>
        );
      })}
    </div>
  );
}

export function Telescope({ s }: { s: EngineState }) {
  if (!s.telescope) return null;
  const t = s.telescope;
  const results = telescopeResults(s);
  const title =
    t.kind === "files" ? "find files (<leader>ff)" :
    t.kind === "grep" ? "live grep (<leader>fg)" :
    t.kind === "buffers" ? "buffers (<leader>fb)" :
    "todos (<leader>st)";
  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center pt-16 bg-black/30">
      <div className="w-2/3 max-w-2xl border border-base-300 bg-base-100 shadow-xl font-mono text-sm">
        <div className="px-3 py-1.5 text-base-content/60 border-b border-base-300 flex items-center">
          <span className="mr-2 text-accent">🔎 {title}</span>
          <span className="flex-1" />
          <span className="text-base-content/40">C-n/C-p move · Enter open · Esc close</span>
        </div>
        <div className="px-3 py-2 border-b border-base-300 bg-base-200">
          <span className="text-primary">{t.query}</span>
          <span className="animate-pulse">▌</span>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {results.length === 0 && <div className="px-3 py-2 text-base-content/40">no results</div>}
          {results.map((r, i) => (
            <div
              key={i}
              className={`px-3 py-1 flex ${i === t.selected ? "bg-primary/30" : ""}`}
            >
              <span className="truncate">{r.primary}</span>
              <span className="flex-1" />
              {r.secondary && <span className="text-base-content/50 text-xs">{r.secondary}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TroublePanel({ s }: { s: EngineState }) {
  if (!s.troubleOpen) return null;
  const entries: { name: string; row: number; msg: string; severity: string }[] = [];
  for (const buf of s.buffers) {
    for (const d of s.diagnostics[buf.id] ?? []) {
      entries.push({ name: buf.name, row: d.row, msg: d.msg, severity: d.severity });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.row - b.row);
  return (
    <div className={`absolute top-0 right-0 bottom-0 w-96 z-20 font-mono text-xs border-l border-base-300 bg-base-200 overflow-y-auto ${
      s.focus === "trouble" ? "ring-1 ring-primary/60" : ""
    }`}>
      <div className="px-2 py-1 text-base-content/50 border-b border-base-300">
        Diagnostics (j/k move · Enter jump · q close)
      </div>
      {entries.length === 0 && <div className="px-2 py-2 text-base-content/40">✓ no problems</div>}
      {entries.map((e, i) => (
        <div
          key={i}
          className={`px-2 py-1 ${i === s.troubleSelected ? "bg-primary/30" : ""}`}
        >
          <span className={e.severity === "error" ? "text-error" : e.severity === "warn" ? "text-warning" : "text-info"}>
            {e.severity === "error" ? "✘" : e.severity === "warn" ? "▲" : "ℹ"}
          </span>{" "}
          <span className="text-base-content/80">{e.msg}</span>
          <div className="text-base-content/40 pl-4">{e.name}:{e.row + 1}</div>
        </div>
      ))}
    </div>
  );
}

export function Floats({ s }: { s: EngineState }) {
  const f = s.float;
  if (!f) return null;
  if (f.kind === "whichkey") {
    return (
      <div className="absolute bottom-8 left-4 z-40 border border-base-300 bg-base-100 shadow-xl font-mono text-xs p-3 max-w-xl">
        <div className="text-accent mb-1">{"which-key · <leader> pressed"}</div>
        {f.text?.map((t, i) => (
          <div key={i} className="whitespace-pre text-base-content/80">{t}</div>
        ))}
      </div>
    );
  }
  if (f.kind === "actions") {
    return (
      <div className="absolute top-10 left-1/2 -translate-x-1/2 z-40 border border-base-300 bg-base-100 shadow-xl font-mono text-sm min-w-96">
        <div className="px-3 py-1.5 border-b border-base-300 text-base-content/60">{f.title}</div>
        {f.items?.map((it, i) => (
          <div key={i} className="px-3 py-1.5">
            <span className="text-primary mr-2">{i + 1}</span>
            {it.label}
          </div>
        ))}
        <div className="px-3 py-1 text-base-content/40 border-t border-base-300 text-xs">press a number · Esc cancels</div>
      </div>
    );
  }
  // hover | diagnostic
  return (
    <div className="absolute top-10 left-1/2 -translate-x-1/2 z-40 border border-base-300 bg-base-100 shadow-xl font-mono text-sm p-3 max-w-xl">
      {f.text?.map((t, i) => (
        <div key={i} className={`whitespace-pre ${i === 0 ? "text-primary font-bold" : "text-base-content/80"}`}>{t}</div>
      ))}
      <div className="text-base-content/40 text-xs mt-1">Esc or q closes</div>
    </div>
  );
}
