// Buffer registry: open/create buffers over the fake FS.

import type { Buffer, EngineState } from "./types";
import { defaultContents } from "./tree";

export function makeBuffer(id: string, name: string, filetype: string, lines: string[]): Buffer {
  return {
    id,
    name,
    filetype,
    lines,
    undoStack: [],
    redoStack: [],
  };
}

export function filetypeOf(name: string): string {
  if (name.endsWith(".go")) return "go";
  if (name.endsWith(".lua")) return "lua";
  if (name.endsWith(".md")) return "md";
  if (name.endsWith(".ts")) return "ts";
  return "txt";
}

/** Find an open buffer by name. */
export function findBuffer(s: EngineState, name: string): number {
  return s.buffers.findIndex((b) => b.name === name);
}

/** Ensure a buffer exists for path (creating one with contents from the fake FS), return its index. */
export function ensureBuffer(s: EngineState, path: string, content?: string[]): number {
  const existing = findBuffer(s, path);
  if (existing >= 0) return existing;
  const lines = content ?? defaultContents()[path] ?? [""];
  const buf = makeBuffer(String(s.buffers.length), path, filetypeOf(path), [...lines]);
  s.buffers.push(buf);
  return s.buffers.length - 1;
}

/** Open (or focus) a buffer, switching active. */
export function openBufferByName(s: EngineState, name: string, content?: string[]): number {
  const idx = ensureBuffer(s, name, content);
  s.activeBuf = idx;
  return idx;
}

/** Close a buffer by index, switching to a sane neighbour. */
export function closeBuffer(s: EngineState, idx: number) {
  if (s.buffers.length <= 1) {
    s.message = "E444: last buffer, not closing (you live here now)";
    return;
  }
  s.buffers.splice(idx, 1);
  s.activeBuf = Math.max(0, Math.min(s.activeBuf, s.buffers.length - 1));
  s.cursor = { row: 0, col: 0 };
}

/** Cycle buffers like [b / ]b. */
export function cycleBuffer(s: EngineState, dir: 1 | -1) {
  s.activeBuf = (s.activeBuf + dir + s.buffers.length) % s.buffers.length;
  s.cursor = { row: 0, col: 0 };
  s.message = `"${activeName(s)}" ${s.activeBuf + 1} of ${s.buffers.length}`;
}

export function activeName(s: EngineState): string {
  return s.buffers[s.activeBuf]?.name ?? "";
}
