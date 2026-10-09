// Catalog integrity: every level must be solvable with the scripted
// solution and pass its own check. Also asserts the par is achievable
// at 3-star cost (solution keys <= par).

import { describe, expect, it } from "vitest";
import { applyKey, seedFromLevel } from "../vim/engine";
import { allLevels } from "./catalog";

const SOLUTIONS: Record<string, string[]> = {
  // motions
  "m-hjkl": ["w", "w", "w"],
  "m-w": ["w"],
  "m-b": ["4", "b"],
  "m-e": ["4", "e"],
  "m-count": ["5", "w"],
  "m-f": ["f", "("],
  "m-semicolon": ["f", "a", ";"],
  "m-lineends": ["$"],
  "m-gg": ["G"],
  "m-paragraph": ["}", "}"],
  "m-percent": ["%"],
  // editing
  "e-i": ["i", "v", "e", "r", "y", " ", "Esc"],
  "e-a": ["A", " ", "t", "h", "e", "r", "e", "Esc"],
  "e-o": ["o", "t", "w", "o", "Esc"],
  "e-x": ["x"],
  "e-r": ["r", "o"],
  "e-ddp": ["d", "d", "p"],
  "e-yy": ["y", "y", "p"],
  "e-cw": ["c", "w", "f", "a", "s", "t", "Esc"],
  "e-ciw": ["c", "i", "w", "f", "i", "n", "a", "l", "Esc"],
  "e-daw": ["d", "a", "w"],
  "e-J": ["J"],
  "e-u": ["x", "u", "C-r"],
  "e-dot": ["x", "j", ".", "j", "."],
  // visual
  "v-d": ["v", "e", "d"],
  "v-indent": ["V", "j", ">"],
  "v-aj": ["A-j"],
  "v-block-prefix": ["C-v", "j", "j", "I", "-", "-", "Esc"],
  "v-block-append": ["C-v", "j", "j", "$", "A", ";", "Esc"],
  "v-case": ["v", "e", "u"],
  "v-gv": ["V", "j", ">", "g", "v", ">"],
  // search replace
  "s-slash": ["/", "t", "r", "e", "a", "s", "u", "r", "e", "CR"],
  "s-n": ["/", "r", "o", "s", "e", "CR", "n", "n"],
  "s-star": ["*"],
  "s-hash": ["#"],
  "s-substitute": [":", "%", "s", "/", "r", "o", "s", "e", "/", "b", "l", "o", "s", "s", "o", "m", "/", "g", "CR"],
  "s-single": [":", "s", "/", "c", "a", "t", "/", "d", "o", "g", "/", "CR"],
  "s-smartcase": [":", "%", "s", "/", "R", "o", "s", "e", "/", "I", "r", "i", "s", "/", "g", "CR"],
  "s-leader-sr": ["Space", "s", "r", "d", "u", "s", "t", "/", "a", "s", "h", "/", "g", "CR"],
  "s-visual": ["V", "j", ":", "s", "/", "b", "e", "t", "a", "/", "B", "E", "T", "A", "/", "g", "CR"],
  // comments surround
  "c-gcc": ["g", "c", "c"],
  "c-gc-motion": ["g", "c", "2", "j"],
  "c-uncomment": ["g", "c", "c"],
  "sr-add": ["s", "a", "i", "w", '"'],
  "sr-del": ["s", "d", '"'],
  "sr-replace": ["s", "r", '"', "("],
  // files buffers
  "f-tree": ["Space", "e"],
  "f-open": ["j", "j", "j", "j", "j", "CR"],
  "f-create": ["a", "p", "a", "r", "s", "e", ".", "g", "o", "CR"],
  "f-rename": ["r", "BS", "BS", "BS", "BS", "BS", "BS", "BS", "BS", "n", "o", "t", "e", "s", ".", "m", "d", "CR"],
  "f-move": ["x", "k", "k", "p"],
  "f-ff": ["Space", "f", "f", "s", "t", "o", "r", "e", "CR"],
  "f-ff-new": ["Space", "f", "f", "c", "m", "d", "/", "a", "g", "e", "n", "t", "/", "m", "a", "i", "n", ".", "g", "o", "CR"],
  "f-buffers": ["]", "b", "]", "b"],
  "f-bd": ["Space", "b", "d"],
  "f-tabs": ["Space", "t", "n", "Space", "t", "h"],
  "f-grep": ["Space", "f", "g", "P", "r", "i", "n", "t", "l", "n", "CR"],
  // lsp diagnostics
  "l-]d": ["]", "d"],
  "l-float": ["Space", "d"],
  "l-trouble": ["Space", "x", "x"],
  "l-codeaction": ["Space", "c", "a", "1"],
  "l-gd": ["g", "d"],
  "l-K": ["K"],
  "l-rename": [
    "Space", "r", "n",
    "BS", "BS", "BS", "BS", "BS", "BS", "BS", "BS", "BS", "BS",
    "r", "e", "a", "d", "C", "o", "n", "f", "i", "g", "CR",
  ],
  // go gopher
  "g-ga": ["Space", "g", "a"],
  "g-gA": ["Space", "g", "A", "BS", "BS", "BS", "BS", "y", "a", "m", "l", "CR"],
  "g-gx": ["Space", "g", "x"],
  // git gitsigns
  "h-]c": ["]", "c"],
  "h-[c": ["[", "c"],
  "h-reset": ["Space", "g", "r"],
  "h-diff": ["Space", "g", "d"],
  // windows
  "w-split": ["Space", "w", "-"],
  "w-vsplit": ["Space", "w", "|"],
  "w-nav": ["C-j"],
  "w-resize": ["Space", "w", "."],
  "w-close": [":", "q", "CR"],
};

describe("catalog", () => {
  it("every level has a solution", () => {
    for (const level of allLevels()) {
      expect(SOLUTIONS[level.id], `missing solution for ${level.id}`).toBeDefined();
    }
  });

  it("every solution passes the level check at or under par", () => {
    for (const level of allLevels()) {
      const keys = SOLUTIONS[level.id];
      if (!keys) continue; // surfaced by the previous test
      let s = seedFromLevel(level.state());
      for (const k of keys) {
        s = applyKey(s, k);
      }
      let pass = false;
      try {
        pass = level.check(s);
      } catch (err) {
        throw new Error(`check for ${level.id} threw: ${String(err)}`);
      }
      expect(pass, `solution for ${level.id} does not pass its check`).toBe(true);
      expect(
        keys.length,
        `${level.id}: solution uses ${keys.length} keys but par is ${level.par}`
      ).toBeLessThanOrEqual(level.par);
    }
  });

  it("level ids are unique", () => {
    const ids = allLevels().map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
