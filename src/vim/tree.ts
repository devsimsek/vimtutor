// nvim-tree simulation: fake project FS + tree key handling.

import type { EngineState, TreeFile, TreeState } from "./types";
import { ensureBuffer } from "./buffers";

export function defaultTree(): TreeState {
  return {
    open: false,
    focused: false,
    files: [
      { path: "cmd", type: "dir" },
      { path: "cmd/server", type: "dir" },
      { path: "cmd/server/main.go", type: "file" },
      { path: "internal", type: "dir" },
      { path: "internal/store", type: "dir" },
      { path: "internal/store/store.go", type: "file" },
      { path: "internal/tags", type: "dir" },
      { path: "internal/tags/tags.go", type: "file" },
      { path: "go.mod", type: "file" },
      { path: "readme.md", type: "file" },
    ],
    selected: "cmd/server/main.go",
    cut: null,
    message: "",
  };
}

export function defaultContents(): Record<string, string[]> {
  return {
    "cmd/server/main.go": [
      "package main",
      "",
      'import "fmt"',
      "",
      "func main() {",
      "\tfmt.Println(\"server up\")",
      "}",
    ],
    "internal/store/store.go": [
      "package store",
      "",
      "// Store keeps your things.",
      "type Store struct {",
      "\tName string",
      "\tSize int",
      "}",
    ],
    "internal/tags/tags.go": [
      "package tags",
      "",
      "type User struct {",
      "\tName string",
      "\tEmail string",
      "\tAge int",
      "}",
    ],
    "go.mod": ["module smsk.dev/demo", "", "go 1.23"],
    "readme.md": ["# demo project", "", "A small tree for the tutor."],
  };
}

export function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function baseName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Sorted render order: depth-first, dirs before their files. */
export function treeOrder(files: TreeFile[]): TreeFile[] {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const dirs = sorted.filter((f) => f.type === "dir");
  const out: TreeFile[] = [];
  const seen = new Set<string>();
  const byParent = new Map<string, TreeFile[]>();
  for (const f of sorted) {
    const p = parentOf(f.path);
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(f);
  }
  const walk = (parent: string) => {
    const kids = byParent.get(parent) ?? [];
    kids.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    for (const k of kids) {
      out.push(k);
      seen.add(k.path);
      if (k.type === "dir") walk(k.path);
    }
  };
  walk("");
  // safety: anything unreachable (weird nesting) appends sorted
  for (const f of sorted) if (!seen.has(f.path)) out.push(f);
  void dirs;
  return out;
}

export function fsGet(tree: TreeState, path: string): TreeFile | undefined {
  return tree.files.find((f) => f.path === path);
}

function fsUniquePath(tree: TreeState, path: string): string {
  let candidate = path;
  let n = 1;
  while (fsGet(tree, candidate)) {
    const dot = candidate.lastIndexOf(".");
    const slash = candidate.lastIndexOf("/");
    candidate =
      dot > slash
        ? candidate.slice(0, dot) + `-${n}` + candidate.slice(dot)
        : candidate + `-${n}`;
    n++;
  }
  return candidate;
}

export function toggleTree(s: EngineState) {
  s.tree.open = !s.tree.open;
  s.tree.focused = s.tree.open;
  s.focus = s.tree.open ? "tree" : "editor";
}

// --- tree key handling (focus === "tree") ------------------------------

export function treeKey(s: EngineState, key: string): boolean {
  const t = s.tree;
  const order = treeOrder(t.files);
  const idx = Math.max(0, order.findIndex((f) => f.path === t.selected));
  switch (key) {
    case "j":
    case "Down": {
      if (idx < order.length - 1) t.selected = order[idx + 1].path;
      return true;
    }
    case "k":
    case "Up": {
      if (idx > 0) t.selected = order[idx - 1].path;
      return true;
    }
    case "CR": {
      const node = fsGet(t, t.selected ?? "");
      if (!node) return true;
      if (node.type === "file") {
        const bufIdx = ensureBuffer(s, node.path, node.content ?? [""]);
        s.activeBuf = bufIdx;
        s.cursor = { row: 0, col: 0 };
        s.tree.open = false;
        s.tree.focused = false;
        s.focus = "editor";
        s.message = `"${node.path}" ${bufIdx + 1}L`;
      } else {
        s.message = `${node.path}/ is a directory`;
      }
      return true;
    }
    case "a": {
      const node = fsGet(t, t.selected ?? "");
      const dir = node && node.type === "dir" ? node.path : parentOf(node?.path ?? "");
      startPrompt(s, { kind: "tree-create", dir });
      s.cmd = dir ? dir + "/" : "";
      return true;
    }
    case "r": {
      if (!t.selected) return true;
      startPrompt(s, { kind: "tree-rename", path: t.selected });
      s.cmd = baseName(t.selected);
      return true;
    }
    case "d": {
      if (!t.selected) return true;
      startPrompt(s, { kind: "tree-delete", path: t.selected });
      s.cmd = "";
      return true;
    }
    case "x": {
      if (t.selected) {
        t.cut = { path: t.selected, mode: "cut" };
        t.message = `${baseName(t.selected)} cut (x) - p pastes it`;
      }
      return true;
    }
    case "c": {
      if (t.selected) {
        t.cut = { path: t.selected, mode: "copy" };
        t.message = `${baseName(t.selected)} copied (c) - p pastes a copy`;
      }
      return true;
    }
    case "p": {
      if (!t.cut) {
        t.message = "nothing to paste: x or c first";
        return true;
      }
      const src = fsGet(t, t.cut.path);
      if (!src) {
        t.cut = null;
        return true;
      }
      const node = fsGet(t, t.selected ?? "");
      let dir = "";
      if (node && node.type === "dir") dir = node.path;
      else dir = parentOf(node?.path ?? "");
      const dest = fsUniquePath(t, dir ? `${dir}/${baseName(src.path)}` : baseName(src.path));
      t.files = t.files.filter((f) => f.path !== src.path);
      t.files.push({ path: dest, type: src.type, content: src.content });
      t.selected = dest;
      if (t.cut.mode === "cut") t.cut = null;
      t.message = `pasted -> ${dest}`;
      return true;
    }
    case "q": {
      toggleTree(s);
      return true;
    }
    default:
      return false;
  }
}

function startPrompt(s: EngineState, action: EngineState["promptAction"]) {
  s.mode = "prompt";
  s.cmdKind = "prompt";
  s.promptAction = action;
}
