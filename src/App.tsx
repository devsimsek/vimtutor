import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineState, LevelResult } from "./vim/types";
import { applyKey, seedFromLevel } from "./vim/engine";
import { allLevels } from "./levels/catalog";
import type { Progress } from "./levels/types";
import { stars } from "./levels/types";
import { Editor } from "./ui/Editor";
import { StatusBar, CommandLine } from "./ui/StatusBar";
import { FileTree, Telescope, TroublePanel, Floats } from "./ui/Overlays";
import { LevelList, TaskPanel, ScoreCard, prettyKey } from "./ui/Panels";

const STORAGE_KEY = "dotfiles-tutor-web:progress:v1";

function loadProgress(): Progress {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Progress;
  } catch {
    return {};
  }
}

function keyFromEvent(e: KeyboardEvent): string | null {
  if (e.metaKey) return null; // OS/browser shortcuts stay untouched
  if (e.ctrlKey || e.altKey) {
    let name: string;
    if (e.code.startsWith("Key")) {
      name = e.code.slice(3).toLowerCase();
    } else if (e.code.startsWith("Digit")) {
      name = e.code.slice(5);
    } else if (e.key.length === 1) {
      name = e.key.toLowerCase();
    } else {
      return null;
    }
    if (e.ctrlKey) return "C-" + name;
    if (e.altKey) return "A-" + name;
  }
  switch (e.key) {
    case "Escape": return "Esc";
    case "Enter": return "CR";
    case "Backspace": return "BS";
    case "Tab": return "Tab";
    case "ArrowUp": return "Up";
    case "ArrowDown": return "Down";
    case "ArrowLeft": return "Left";
    case "ArrowRight": return "Right";
    case " ": return "Space";
    case "Shift":
    case "Control":
    case "Alt":
    case "Meta":
    case "CapsLock":
      return null;
    default:
      return e.key.length === 1 ? e.key : null;
  }
}

export default function App() {
  const levels = useMemo(() => allLevels(), []);
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [levelIdx, setLevelIdx] = useState<number>(() => {
    const p = loadProgress();
    const firstUndone = levels.findIndex((l) => !p[l.id]);
    return firstUndone === -1 ? 0 : firstUndone;
  });
  const [engine, setEngine] = useState<EngineState>(() =>
    seedFromLevel(levels[0].state())
  );
  const engineRef = useRef(engine);
  const keysRef = useRef(0);
  const [keys, setKeys] = useState(0);
  const [keyLog, setKeyLog] = useState<string[]>([]);
  const [results, setResults] = useState<LevelResult[]>([]);
  const [finished, setFinished] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const busy = useRef(false);

  const startLevel = useCallback(
    (idx: number) => {
      const level = levels[idx];
      const seeded = seedFromLevel(level.state());
      engineRef.current = seeded;
      keysRef.current = 0;
      setEngine(seeded);
      setLevelIdx(idx);
      setKeys(0);
      setKeyLog([]);
      setFlash(null);
    },
    [levels]
  );

  const advance = useCallback(
    (usedKeys: number) => {
      const level = levels[levelIdx];
      const result: LevelResult = {
        keys: usedKeys,
        par: level.par,
        seconds: 0,
        stars: stars(level.par, usedKeys),
      };
      setResults((rs) => {
        const next = [...rs.filter((r) => r !== undefined && levels[rs.indexOf(r)]?.id !== level.id), result];
        return next;
      });
      setProgress((p) => {
        const next = { ...p, [level.id]: { stars: result.stars, keys: result.stars < (p[level.id]?.stars ?? 0) ? p[level.id].keys : usedKeys } };
        // keep the best result
        const prev = p[level.id];
        if (prev && prev.stars >= result.stars) {
          next[level.id] = prev;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      setFlash(`✓ ${level.title} - ${result.stars} star${result.stars === 1 ? "" : "s"} (${usedKeys} keys, par ${level.par})`);
      window.setTimeout(() => {
        if (levelIdx + 1 >= levels.length) {
          setFinished(true);
        } else {
          startLevel(levelIdx + 1);
        }
      }, 900);
    },
    [levels, levelIdx, startLevel]
  );

  const handleKey = useCallback(
    (token: string) => {
      if (busy.current || finished) return;
      busy.current = true;
      try {
        setKeyLog((kl) => [...kl.slice(-40), token]);
        const used = keysRef.current + 1;
        keysRef.current = used;
        setKeys(used);
        const level = levels[levelIdx];
        // apply outside any setState updater: updaters double-run in dev
        const next = applyKey(engineRef.current, token);
        engineRef.current = next;
        setEngine(next);
        // evaluate the level check after the key lands (clean stack)
        window.setTimeout(() => {
          try {
            if (!finished && level.check(next)) {
              advance(used);
            }
          } catch (err) {
            console.error("level check failed", err);
          }
          busy.current = false;
        }, 0);
      } catch (err) {
        console.error("key apply failed", err);
        busy.current = false;
      }
    },
    [levels, levelIdx, finished, advance]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const token = keyFromEvent(e);
      if (token === null) return;
      e.preventDefault();
      handleKey(token);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleKey]);

  const totalStars = Object.values(progress).reduce((a, p) => a + p.stars, 0);

  return (
    <div className="h-full flex flex-col bg-base-100 text-base-content">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-200">
        <span className="font-mono font-bold text-primary">dotfiles-tutor</span>
        <span className="text-xs text-base-content/50 font-mono">web edition · vim drills for this dotfiles stack</span>
        <span className="flex-1" />
        <span className="text-xs font-mono text-warning">
          ★ {totalStars}/{levels.length * 3}
        </span>
        <button
          className="btn btn-ghost btn-xs font-mono"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            setProgress({});
            setResults([]);
            startLevel(0);
          }}
        >
          reset progress
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        <LevelList levels={levels} currentIdx={levelIdx} progress={progress} onPick={startLevel} />

        <div className="flex-1 flex flex-col min-w-0 relative">
          <div className="flex-1 relative min-h-0">
            <Editor s={engine} />
            <FileTree s={engine} />
            <TroublePanel s={engine} />
            <Telescope s={engine} />
            <Floats s={engine} />
            {flash && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 badge badge-success badge-lg font-mono shadow-lg">
                {flash}
              </div>
            )}
          </div>
          <StatusBar s={engine} />
          <CommandLine s={engine} />
        </div>

        <TaskPanel
          level={levels[levelIdx]}
          keys={keys}
          lastKeys={keyLog}
          onReset={() => startLevel(levelIdx)}
          onSkip={() => {
            if (levelIdx + 1 >= levels.length) setFinished(true);
            else startLevel(levelIdx + 1);
          }}
        />
      </div>

      {finished && (
        <ScoreCard
          results={results}
          levels={levels}
          onRestart={() => {
            setFinished(false);
            setResults([]);
            startLevel(0);
          }}
        />
      )}
    </div>
  );
}

export { prettyKey };
