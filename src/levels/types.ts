import type { Cursor, Diagnostic, EngineState, GitHunk } from "../vim/types";

export interface LevelSeed {
  buffers: { name: string; filetype: string; lines: string[] }[];
  activeBuf?: number;
  cursor: Cursor;
  diagnostics?: Record<string, Diagnostic[]>;
  gitHunks?: Record<string, GitHunk[]>;
  tree?: EngineState["tree"];
  wins?: { id: number; bufIdx: number; cursor: Cursor }[];
  activeWin?: number;
  layout?: EngineState["layout"];
}

export interface Level {
  id: string;
  chapter: string;
  title: string;
  task: [string, string]; // teach, ask
  par: number;
  filetype?: string;
  hint?: string;
  state: () => LevelSeed;
  check: (s: EngineState) => boolean;
}

export type Progress = Record<string, { stars: number; keys: number }>;

export const stars = (par: number, keys: number): number =>
  keys <= par ? 3 : keys <= par * 2 ? 2 : 1;
