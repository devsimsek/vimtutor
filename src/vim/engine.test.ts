// Engine tests: real keystrokes in, assertions on the buffer out.
// If a test can't fail, it doesn't belong here.

import { describe, expect, it } from "vitest";
import { applyKey, seedFromLevel } from "./engine";
import type { EngineState } from "./types";
import type { LevelSeed } from "../levels/types";

function run(seed: LevelSeed, keys: string[]): EngineState {
  let s = seedFromLevel(seed);
  for (const k of keys) {
    s = applyKey(s, k);
  }
  return s;
}

const lines = (...l: string[]): LevelSeed => ({
  buffers: [{ name: "test.txt", filetype: "txt", lines: l }],
  cursor: { row: 0, col: 0 },
});

const withCursor = (seed: LevelSeed, row: number, col: number): LevelSeed => ({
  ...seed,
  cursor: { row, col },
});

describe("motions", () => {
  it("w hops words", () => {
    const s = run(lines("welcome tmux nvim ghostty"), ["w"]);
    expect(s.buffers[0].lines[s.cursor.row].slice(s.cursor.col)).toMatch(/^tmux/);
  });

  it("3w uses the count", () => {
    const s = run(lines("one two three four five"), ["3", "w"]);
    expect(s.buffers[0].lines[0].slice(s.cursor.col)).toMatch(/^four/);
  });

  it("f( lands on the paren and ; repeats", () => {
    const s1 = run(lines("local ok = pair(a, b)"), ["f", "("]);
    expect(s1.buffers[0].lines[0][s1.cursor.col]).toBe("(");
    const s2 = run(lines("call(one, two(other))"), ["f", "(", ";"]);
    expect(s2.buffers[0].lines[0][s2.cursor.col]).toBe("(");
    expect(s2.cursor.col).toBe(13);
  });

  it("$ hits the end, gg/G travel", () => {
    const s = run(lines("start", "middle", "the end"), ["G"]);
    expect(s.cursor.row).toBe(2);
    const s2 = run(lines("start", "middle", "the end"), ["G", "g", "g"]);
    expect(s2.cursor.row).toBe(0);
  });

  it("% matches nested brackets", () => {
    const s = run(withCursor(lines("run(deep(nested(a), b))"), 0, 3), ["%"]);
    expect(s.cursor.col).toBe(22);
  });

  it("* jumps to the next occurrence of the cword", () => {
    const s = run(lines("the cat sat on the mat"), ["*"]);
    expect(s.cursor.col).toBe(15);
  });
});

describe("editing", () => {
  it("dd then p swaps lines", () => {
    const s = run(lines("first", "second"), ["d", "d", "p"]);
    expect(s.buffers[0].lines).toEqual(["second", "first"]);
  });

  it("yy p duplicates", () => {
    const s = run(lines("keep", "drop"), ["y", "y", "p"]);
    expect(s.buffers[0].lines).toEqual(["keep", "keep", "drop"]);
  });

  it("cw changes a word", () => {
    const s = run(withCursor(lines("the slow fox"), 0, 4), ["c", "w", "f", "a", "s", "t", "Esc"]);
    expect(s.buffers[0].lines[0]).toBe("the fast fox");
  });

  it("ciw changes from mid-word", () => {
    const s = run(withCursor(lines("this is temporary state"), 0, 10), [
      "c", "i", "w", "f", "i", "n", "a", "l", "Esc",
    ]);
    expect(s.buffers[0].lines[0]).toBe("this is final state");
  });

  it("daw removes the word and one space", () => {
    const s = run(withCursor(lines("this ugly line"), 0, 5), ["d", "a", "w"]);
    expect(s.buffers[0].lines[0]).toBe("this line");
  });

  it("J joins with a single space", () => {
    const s = run(lines("one two", "three four"), ["J"]);
    expect(s.buffers[0].lines[0]).toBe("one two three four");
  });

  it("o opens below and inserts", () => {
    const s = run(lines("one"), ["o", "t", "w", "o", "Esc"]);
    expect(s.buffers[0].lines).toEqual(["one", "two"]);
  });

  it("A appends at end of line", () => {
    const s = run(lines("hello"), ["A", " ", "t", "h", "e", "r", "e", "Esc"]);
    expect(s.buffers[0].lines[0]).toBe("hello there");
  });

  it("x deletes under the cursor", () => {
    const s = run(lines("abc"), ["x"]);
    expect(s.buffers[0].lines[0]).toBe("bc");
  });

  it("r replaces one char", () => {
    const s = run(lines("kllo"), ["r", "h"]);
    expect(s.buffers[0].lines[0]).toBe("hllo");
  });

  it("u undoes a change", () => {
    const s = run(lines("abc"), ["x", "u"]);
    expect(s.buffers[0].lines[0]).toBe("abc");
  });

  it(". repeats the last change", () => {
    const s = run(lines("zalpha", "zbeta", "zgamma"), ["x", "j", "."]);
    expect(s.buffers[0].lines).toEqual(["alpha", "beta", "zgamma"]);
  });

  it("A-j moves the line down, A-k back up", () => {
    const s = run(lines("one", "two", "three"), ["A-j"]);
    expect(s.buffers[0].lines).toEqual(["two", "one", "three"]);
    const s2 = run(lines("one", "two", "three"), ["A-j", "A-k"]);
    expect(s2.buffers[0].lines).toEqual(["one", "two", "three"]);
  });
});

describe("visual", () => {
  it("V j > indents two lines", () => {
    const s = run(lines("alpha", "beta"), ["V", "j", ">"]);
    expect(s.buffers[0].lines).toEqual(["  alpha", "  beta"]);
  });

  it("visual d deletes the selection", () => {
    const s = run(lines("the quick brown fox"), ["v", "e", "d"]);
    expect(s.buffers[0].lines[0]).toBe(" quick brown fox");
  });

  it("block insert prefixes every row", () => {
    const s = run(lines("alpha", "beta", "gamma"), ["C-v", "j", "j", "I", "-", "-", "Esc"]);
    expect(s.buffers[0].lines).toEqual(["--alpha", "--beta", "--gamma"]);
  });

  it("visual gc comments the selection", () => {
    const s = run(
      { buffers: [{ name: "x.lua", filetype: "lua", lines: ["alpha", "beta"] }], cursor: { row: 0, col: 0 } },
      ["V", "j", "g", "c"]
    );
    expect(s.buffers[0].lines[0]).toBe("-- alpha");
    expect(s.buffers[0].lines[1]).toBe("-- beta");
  });
});

describe("search and substitute", () => {
  it("/ jumps to the match", () => {
    const s = run(lines("start", "the treasure", "end"), ["/", "t", "r", "e", "a", "s", "u", "r", "e", "CR"]);
    expect(s.cursor.row).toBe(1);
  });

  it("n rides to the last match", () => {
    const s = run(lines("a rose here", "a rose there", "the last rose"), ["/", "r", "o", "s", "e", "CR", "n", "n"]);
    expect(s.cursor.row).toBe(2);
  });

  it(":%s/g replaces every occurrence", () => {
    const s = run(lines("a rose is a rose", "rose"), [":", "%", "s", "/", "r", "o", "s", "e", "/", "b", "l", "o", "s", "s", "o", "m", "/", "g", "CR"]);
    expect(s.buffers[0].lines).toEqual(["a blossom is a blossom", "blossom"]);
  });

  it(":s without g replaces only the first hit on the line", () => {
    const s = run(lines("a cat met a cat", "another cat"), [":", "s", "/", "c", "a", "t", "/", "d", "o", "g", "/", "CR"]);
    expect(s.buffers[0].lines[0]).toBe("a dog met a cat");
    expect(s.buffers[0].lines[1]).toBe("another cat");
  });

  it("smartcase: capital pattern is case-sensitive", () => {
    const s = run(lines("Rose the rose"), [":", "%", "s", "/", "R", "o", "s", "e", "/", "I", "r", "i", "s", "/", "g", "CR"]);
    expect(s.buffers[0].lines[0]).toBe("Iris the rose");
  });

  it("gcc toggles the line comment", () => {
    const s = run(
      { buffers: [{ name: "x.lua", filetype: "lua", lines: ["return 42"] }], cursor: { row: 0, col: 0 } },
      ["g", "c", "c"]
    );
    expect(s.buffers[0].lines[0]).toBe("-- return 42");
    const s2 = run(
      { buffers: [{ name: "x.lua", filetype: "lua", lines: ["-- return 42"] }], cursor: { row: 0, col: 2 } },
      ["g", "c", "c"]
    );
    expect(s2.buffers[0].lines[0]).toBe("return 42");
  });
});

describe("surround", () => {
  it('saiw" wraps the word', () => {
    const s = run(withCursor(lines("print(hello)"), 0, 6), ["s", "a", "i", "w", '"']);
    expect(s.buffers[0].lines[0]).toBe('print("hello")');
  });

  it('sd" strips the pair', () => {
    const s = run(withCursor(lines('print("hello")'), 0, 7), ["s", "d", '"']);
    expect(s.buffers[0].lines[0]).toBe("print(hello)");
  });

  it('sr"( swaps the pair', () => {
    const s = run(withCursor(lines('print("hello")'), 0, 7), ["s", "r", '"', "("]);
    expect(s.buffers[0].lines[0]).toBe("print((hello))");
  });

  it("plain s still deletes a char and inserts", () => {
    const s = run(lines("abc"), ["s", "X", "Esc"]);
    expect(s.buffers[0].lines[0]).toBe("Xbc");
  });
});

describe("go tags", () => {
  it("leader ga adds json tags to the whole struct", () => {
    const s = run(
      {
        buffers: [{
          name: "tags.go",
          filetype: "go",
          lines: ["type User struct {", "\tName string", "\tEmail string", "\tAge int", "}"],
        }],
        cursor: { row: 1, col: 1 },
      },
      ["Space", "g", "a"]
    );
    expect(s.buffers[0].lines[1]).toContain('`json:"name"`');
    expect(s.buffers[0].lines[3]).toContain('`json:"age"`');
  });

  it("leader gx removes tags", () => {
    const s = run(
      {
        buffers: [{
          name: "tags.go",
          filetype: "go",
          lines: ["type User struct {", "\tName string `json:\"name\"`", "}"],
        }],
        cursor: { row: 1, col: 1 },
      },
      ["Space", "g", "x"]
    );
    expect(s.buffers[0].lines[1]).not.toContain("json:");
  });
});

describe("windows", () => {
  it("leader w- splits horizontally", () => {
    const s = run(lines("one", "two"), ["Space", "w", "-"]);
    expect(s.wins.length).toBe(2);
    expect(s.layout.type).toBe("col");
  });

  it("leader w| splits vertically", () => {
    const s = run(lines("one"), ["Space", "w", "|"]);
    expect(s.wins.length).toBe(2);
    expect(s.layout.type).toBe("row");
  });

  it("C-j focuses the bottom window", () => {
    let s = run(lines("one", "two"), ["Space", "w", "-"]);
    const topWin = s.activeWin;
    s = applyKey(s, "C-j");
    expect(s.activeWin).not.toBe(topWin);
  });

  it(":q closes a window but not the last", () => {
    let s = run(lines("one"), ["Space", "w", "-"]);
    s = applyKey(s, ":");
    s = applyKey(s, "q");
    s = applyKey(s, "CR");
    expect(s.wins.length).toBe(1);
  });
});

describe("file tree", () => {
  it("cut and paste moves a file into a folder", () => {
    const seed: LevelSeed = {
      buffers: [{ name: "readme.md", filetype: "md", lines: ["# demo"] }],
      cursor: { row: 0, col: 0 },
      tree: {
        open: true,
        focused: true,
        files: [
          { path: "archive", type: "dir" },
          { path: "stray.txt", type: "file" },
        ],
        selected: "stray.txt",
        cut: null,
        message: "",
      },
    };
    const s = run(seed, ["x", "k", "p"]);
    expect(s.tree.files.some((f) => f.path === "archive/stray.txt")).toBe(true);
    expect(s.tree.files.some((f) => f.path === "stray.txt")).toBe(false);
  });

  it("r renames a file", () => {
    const seed: LevelSeed = {
      buffers: [{ name: "readme.md", filetype: "md", lines: ["# demo"] }],
      cursor: { row: 0, col: 0 },
      tree: {
        open: true,
        focused: true,
        files: [{ path: "draft.md", type: "file" }],
        selected: "draft.md",
        cut: null,
        message: "",
      },
    };
    const s = run(seed, [
      "r",
      "BS", "BS", "BS", "BS", "BS", "BS", "BS", "BS",
      "n", "o", "t", "e", "s", ".", "m", "d", "CR",
    ]);
    expect(s.tree.files.some((f) => f.path === "notes.md")).toBe(true);
    expect(s.tree.files.some((f) => f.path === "draft.md")).toBe(false);
  });
});

describe("diagnostics and code actions", () => {
  it("leader ca applies the quickfix by number", () => {
    const seed: LevelSeed = {
      buffers: [{ name: "main.go", filetype: "go", lines: ["func run() {", "\ttemp := compute()", "}"] }],
      cursor: { row: 1, col: 1 },
      diagnostics: {
        "0": [{ row: 1, col: 1, len: 4, severity: "warn", msg: "declared and not used: temp", fixKind: "unused", fixLabel: "rename to _temp", symbol: "temp" }],
      },
    };
    const s = run(seed, ["Space", "c", "a", "1"]);
    expect(s.buffers[0].lines[1]).toContain("_temp");
  });

  it("]d jumps to the next diagnostic", () => {
    const seed: LevelSeed = {
      buffers: [{ name: "main.go", filetype: "go", lines: ["ok", "broken()"] }],
      cursor: { row: 0, col: 0 },
      diagnostics: {
        "0": [{ row: 1, col: 0, len: 6, severity: "error", msg: "undefined: broken" }],
      },
    };
    const s = run(seed, ["]", "d"]);
    expect(s.cursor.row).toBe(1);
  });
});
