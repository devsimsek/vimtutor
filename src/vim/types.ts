// Core types for the vim engine.

export type Mode =
  | "normal"
  | "insert"
  | "replace"
  | "visual"
  | "vline"
  | "vblock"
  | "cmd"
  | "search"
  | "prompt";

export type OpPending = {
  op: "d" | "c" | "y" | ">" | "<" | "gc" | "gU" | "gu";
  count: number;
};

export type CmdKind = ":" | "/" | "?" | "prompt";

export type PromptAction =
  | { kind: "gopher-tag" }
  | { kind: "tree-create"; dir: string }
  | { kind: "tree-rename"; path: string }
  | { kind: "tree-delete"; path: string }
  | { kind: "lsp-rename"; symbol: string }
  | { kind: "none" };

export interface Range {
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number; // exclusive
}

export type PendingSurround =
  | { stage: "s" }
  | { stage: "action"; action: "add" | "del" | "replace"; objAround?: boolean; replaceOld?: string }
  | { stage: "obj"; action: "add"; objAround: boolean }
  | { stage: "pair"; action: "add"; range: Range };

export interface Cursor {
  row: number;
  col: number; // char index into the line
}

export interface Buffer {
  id: string;
  name: string;
  filetype: string; // "lua" | "go" | "md" | "txt" | ...
  lines: string[];
  undoStack: string[][]; // snapshots of lines
  redoStack: string[][];
}

export interface Win {
  id: number;
  bufIdx: number;
  cursor: Cursor;
  desiredCol: number | null;
}

export type LayoutNode =
  | { type: "leaf"; win: number }
  | { type: "row"; children: LayoutNode[]; weights?: number[] } // side by side
  | { type: "col"; children: LayoutNode[]; weights?: number[] }; // stacked

export interface TreeFile {
  path: string; // "src/main.go"
  type: "file" | "dir";
  content?: string[];
}

export interface TreeState {
  open: boolean;
  focused: boolean;
  files: TreeFile[]; // flat, sorted on render
  selected: string | null;
  cut: { path: string; mode: "cut" | "copy" } | null;
  message: string;
}

export interface TelescopeState {
  open: boolean;
  kind: "files" | "grep" | "buffers" | "todos";
  query: string;
  selected: number;
}

export type FixKind = "unused" | "import" | "typo" | "nilcheck";

export interface Diagnostic {
  row: number;
  col: number;
  len: number;
  severity: "error" | "warn" | "info";
  msg: string;
  fixKind?: FixKind;
  fixLabel?: string;
  symbol?: string;
}

export interface GitHunk {
  row: number;
  type: "add" | "change" | "delete";
  original: string[] | null; // for delete/changedelete reset
}

export type FloatState = {
  kind: "hover" | "diagnostic" | "whichkey" | "actions";
  text?: string[];
  title?: string;
  items?: { label: string; kind: FixKind | "imports" | "mock"; symbol?: string }[];
};

export interface EngineState {
  buffers: Buffer[];  activeBuf: number;
  // active window state (saved into wins[] when focus moves)
  cursor: Cursor;
  desiredCol: number | null;
  mode: Mode;
  visualAnchor: Cursor | null;
  lastVisual: { mode: "visual" | "vline" | "vblock"; anchor: Cursor; cursor: Cursor } | null;
  // windows
  wins: Win[];
  activeWin: number;
  layout: LayoutNode;
  // pending key state
  pendingOp: OpPending | null;
  pendingFind: { type: "f" | "t" | "F" | "T"; char: string } | null;
  pendingG: boolean;
  pendingD: boolean;
  bracketDir: 1 | -1;
  pendingLeader: boolean;
  leaderSeq: string;
  pendingReplace: boolean;
  pendingTextObj: boolean;
  pendingObjAround: boolean;
  pendingOpForObj: OpPending | null;
  pendingSurround: PendingSurround | null;
  count: string;
  register: string;
  linewise: boolean;
  blockAnchorCol: number;
  lastFind: { type: "f" | "t" | "F" | "T"; char: string } | null;
  searchState: { term: string; dir: 1 | -1 } | null;
  hlSearch: boolean;
  cmdKind: CmdKind;
  cmd: string;
  promptAction: PromptAction;
  message: string;
  // dot repeat: keys of the last change command
  lastChange: string[] | null;
  recordingChange: string[] | null;
  // visual block pending insert
  blockInsert: { col: number; rows: number[]; text: string; append: boolean } | null;
  // range captured when a visual selection starts a : command
  visualLines: { fromRow: number; toRow: number } | null;
  // simulated plugins
  tree: TreeState;
  telescope: TelescopeState | null;
  diagnostics: Record<string, Diagnostic[]>; // by buffer id
  gitHunks: Record<string, GitHunk[]>; // by buffer id
  float: FloatState | null;
  troubleOpen: boolean;
  troubleSelected: number;
  tabs: { name: string; bufIds: number[] }[];
  activeTab: number;
  focus: "editor" | "tree" | "telescope" | "trouble";
}

export interface LevelResult {
  keys: number;
  par: number;
  seconds: number;
  stars: number;
}
