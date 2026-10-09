// Side panels: level list (left) and current task (right).

import type { LevelResult } from "../vim/types";
import type { Level, Progress } from "../levels/types";

export function LevelList({ levels, currentIdx, progress, onPick }: {
  levels: Level[];
  currentIdx: number;
  progress: Progress;
  onPick: (idx: number) => void;
}) {
  const chapters: { name: string; levels: { level: Level; idx: number }[] }[] = [];
  levels.forEach((level, idx) => {
    let c = chapters.find((x) => x.name === level.chapter);
    if (!c) {
      c = { name: level.chapter, levels: [] };
      chapters.push(c);
    }
    c.levels.push({ level, idx });
  });

  return (
    <div className="w-56 shrink-0 overflow-y-auto border-r border-base-300 bg-base-200 font-mono text-xs">
      <div className="px-3 py-2 text-base-content/50 sticky top-0 bg-base-200 border-b border-base-300">
        levels
      </div>
      {chapters.map((c) => (
        <div key={c.name} className="mb-2">
          <div className="px-3 py-1 text-primary/80 uppercase tracking-wider">{c.name}</div>
          {c.levels.map(({ level, idx }) => {
            const p = progress[level.id];
            const done = !!p;
            return (
              <button
                key={level.id}
                onClick={() => onPick(idx)}
                className={`w-full text-left px-3 py-1 hover:bg-base-300/60 flex items-center gap-2 ${
                  idx === currentIdx ? "bg-primary/25 text-base-content" : done ? "text-base-content/50" : "text-base-content/80"
                }`}
              >
                <span className="text-warning shrink-0">
                  {done ? "★".repeat(p.stars) + "☆".repeat(3 - p.stars) : "·"}
                </span>
                <span className="truncate">{level.title}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function TaskPanel({ level, keys, lastKeys, onReset, onSkip }: {
  level: Level;
  keys: number;
  lastKeys: string[];
  onReset: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="w-80 shrink-0 border-l border-base-300 bg-base-200 font-mono text-sm flex flex-col">
      <div className="px-4 py-3 border-b border-base-300">
        <div className="text-primary/80 text-xs uppercase tracking-wider">{level.chapter}</div>
        <div className="text-lg text-base-content">{level.title}</div>
        <div className="text-xs text-base-content/50 mt-1">par {level.par} keystrokes</div>
      </div>
      <div className="px-4 py-3 space-y-2 flex-1 overflow-y-auto">
        <p className="text-base-content/70">{level.task[0]}</p>
        <p className="text-base-content">{level.task[1]}</p>
        {level.hint && (
          <div className="mt-2 text-xs border border-base-300 rounded p-2 bg-base-300/40">
            <span className="text-warning">hint: </span>
            {level.hint}
          </div>
        )}
      </div>
      <div className="px-4 py-3 border-t border-base-300">
        <div className="text-xs text-base-content/50 mb-1">keystrokes this level: <span className={keys <= level.par ? "text-success" : "text-warning"}>{keys}</span> / par {level.par}</div>
        <div className="flex flex-wrap gap-1 mb-3 min-h-6">
          {lastKeys.slice(-24).map((k, i) => (
            <span key={i} className="vt-key text-[10px]">{prettyKey(k)}</span>
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-xs btn-outline flex-1" onClick={onReset}>reset level</button>
          <button className="btn btn-xs btn-ghost flex-1 text-base-content/50" onClick={onSkip}>skip</button>
        </div>
      </div>
    </div>
  );
}

export function prettyKey(k: string): string {
  switch (k) {
    case "Space": return "<space>";
    case "CR": return "<CR>";
    case "Esc": return "<Esc>";
    case "BS": return "<BS>";
    case "Tab": return "<Tab>";
    default: return k;
  }
}

export function ScoreCard({ results, levels, onRestart }: {
  results: LevelResult[];
  levels: Level[];
  onRestart: () => void;
}) {
  const totalPar = levels.reduce((a, l) => a + l.par, 0);
  const totalKeys = results.reduce((a, r) => a + r.keys, 0);
  const totalStars = results.reduce((a, r) => a + r.stars, 0);
  const pct = Math.min(100, Math.floor((totalPar / Math.max(totalKeys, 1)) * 100));
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-base-100 border border-base-300 shadow-2xl p-6 max-w-2xl w-full font-mono text-sm">
        <h2 className="text-xl text-primary mb-1">dotfiles-tutor: complete</h2>
        <p className="text-base-content/60 text-xs mb-4">
          {totalStars}/{levels.length * 3} stars · {totalKeys} keys vs par {totalPar} → {pct}%
        </p>
        <div className="max-h-96 overflow-y-auto border border-base-300 mb-4">
          <table className="table table-xs">
            <thead>
              <tr><th>level</th><th>keys</th><th>par</th><th></th></tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{levels[i].title}</td>
                  <td className={r.keys <= r.par ? "text-success" : "text-warning"}>{r.keys}</td>
                  <td className="text-base-content/50">{r.par}</td>
                  <td className="text-warning">{"★".repeat(r.stars)}{"☆".repeat(3 - r.stars)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onRestart}>run it again</button>
      </div>
    </div>
  );
}
