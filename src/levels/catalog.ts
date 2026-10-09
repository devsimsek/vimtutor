// Level catalog. Each level: teach (line 1), ask (line 2), par keystrokes,
// a state seed, and a pure check over engine state.

import type { EngineState, Cursor, Diagnostic } from "../vim/types";
import type { Level, LevelSeed } from "./types";

// ------------------------------------------------------------- helpers

const buf = (name: string, filetype: string, ...lines: string[]) => ({ name, filetype, lines });

const at = (row: number, col: number): Cursor => ({ row, col });

const diag = (
  row: number,
  col: number,
  len: number,
  severity: Diagnostic["severity"],
  msg: string,
  fix?: { kind: Diagnostic["fixKind"]; label: string; symbol?: string }
): Diagnostic => ({
  row,
  col,
  len,
  severity,
  msg,
  fixKind: fix?.kind,
  fixLabel: fix?.label,
  symbol: fix?.symbol,
});

const cursorWordIs = (s: EngineState, word: string): boolean => {
  const l = s.buffers[s.activeBuf].lines[s.cursor.row] ?? "";
  const rest = l.slice(s.cursor.col);
  return rest.startsWith(word) && (s.cursor.col === 0 || !/\w/.test(l[s.cursor.col - 1] ?? ""));
};

const lineIs = (s: EngineState, row: number, want: string): boolean =>
  (s.buffers[s.activeBuf].lines[row] ?? "") === want;

const bufferIs = (s: EngineState, want: string[]): boolean => {
  const lines = s.buffers[s.activeBuf].lines;
  if (lines.length !== want.length) return false;
  return want.every((w, i) => lines[i] === w);
};

const activeBufferIs = (s: EngineState, name: string): boolean =>
  s.buffers[s.activeBuf].name === name;

const floatKind = (s: EngineState, kind: string): boolean => s.float?.kind === kind;

const goStructTagged = (s: EngineState, tag: string): boolean => {
  const lines = s.buffers[s.activeBuf].lines;
  let inStruct = false;
  let fields = 0;
  let tagged = 0;
  for (const l of lines) {
    if (/^\s*}\s*$/.test(l) && inStruct) inStruct = false;
    if (inStruct && /\w/.test(l)) {
      fields++;
      if (new RegExp(`\`${tag}:"`).test(l)) tagged++;
    }
    if (/\bstruct \{/.test(l)) inStruct = true;
  }
  return fields > 0 && fields === tagged;
};

const winLayoutIs = (s: EngineState, type: "row" | "col"): boolean => s.layout.type === type;

// =========================================================== chapter 1: motions

const motions: Level[] = [
  {
    id: "m-hjkl",
    chapter: "motions",
    title: "hjkl",
    task: [
      "h j k l move left, down, up, right. Muscle memory before anything else.",
      "Land the cursor on the word 'target' using only hjkl.",
    ],
    par: 6,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "walk towards the target and stop", "")],
      cursor: at(0, 0),
    }),
    check: (s) => s.cursor.row === 0 && cursorWordIs(s, "target"),
  },
  {
    id: "m-w",
    chapter: "motions",
    title: "word jump",
    task: [
      "w hops to the start of the next word. It is how you move through code.",
      "Land on 'tmux' in one keypress. Fewer keys, more stars.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "welcome tmux nvim ghostty")],
      cursor: at(0, 0),
    }),
    check: (s) => cursorWordIs(s, "tmux"),
  },
  {
    id: "m-b",
    chapter: "motions",
    title: "back a word",
    task: [
      "b walks backward to the start of the previous word.",
      "Go back to 'backward' in one go.",
    ],
    par: 2,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "step backward one word at a time")],
      cursor: at(0, 24),
    }),
    check: (s) => cursorWordIs(s, "backward"),
  },
  {
    id: "m-e",
    chapter: "motions",
    title: "end of word",
    task: [
      "e jumps to the END of the current or next word (that last letter matters for c and d).",
      "Sit on the last letter of 'end'.",
    ],
    par: 2,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "ride to the end of the word")],
      cursor: at(0, 0),
    }),
    check: (s) => {
      const l = s.buffers[0].lines[0];
      return l.slice(s.cursor.col - 2, s.cursor.col + 1) === "end" && s.cursor.col === l.indexOf("end") + 2;
    },
  },
  {
    id: "m-count",
    chapter: "motions",
    title: "counts",
    task: [
      "Numbers multiply motions: 3w is three words forward, 2j is two lines down.",
      "Reach 'arrive' with a single count + motion.",
    ],
    par: 2,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "one two three four five arrive seven")],
      cursor: at(0, 0),
    }),
    check: (s) => cursorWordIs(s, "arrive"),
  },
  {
    id: "m-f",
    chapter: "motions",
    title: "f{char}",
    task: [
      "f<char> zips to the next <char> on the line; F goes back; t lands one before.",
      "Zip to the opening paren in one go: f then (.",
    ],
    par: 2,
    state: () => ({
      buffers: [buf("main.go", "go", "local ok = pair(a, b)")],
      cursor: at(0, 0),
    }),
    check: (s) => (s.buffers[0].lines[0][s.cursor.col] ?? "") === "(",
  },
  {
    id: "m-semicolon",
    chapter: "motions",
    title: "; and ,",
    task: [
      "; repeats the last f/t/F/T, , repeats it backwards. Hop scotch without typing.",
      "Use f+; to land on the SECOND 'a' in the line.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "a rose is a rose")],
      cursor: at(0, 0),
    }),
    check: (s) => s.cursor.col === 10,
  },
  {
    id: "m-lineends",
    chapter: "motions",
    title: "0 ^ $",
    task: [
      "0 is column zero, ^ the first non-blank, $ the end of the line.",
      "Hit the very end of the line.",
    ],
    par: 1,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "follow the line all the way to its end")],
      cursor: at(0, 0),
    }),
    check: (s) => {
      const l = s.buffers[0].lines[0];
      return s.cursor.col >= l.length - 2;
    },
  },
  {
    id: "m-gg",
    chapter: "motions",
    title: "gg and G",
    task: [
      "gg goes to the first line, G the last. 5G jumps to line five.",
      "Drop to the last line of the file.",
    ],
    par: 1,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "first", "second", "third", "fourth", "fifth and last")],
      cursor: at(0, 0),
    }),
    check: (s) => s.cursor.row === 4,
  },
  {
    id: "m-paragraph",
    chapter: "motions",
    title: "{ }",
    task: [
      "{ and } ride paragraph breaks: blank-line to blank-line.",
      "Jump down to the second paragraph.",
    ],
    par: 2,
    state: () => ({
      buffers: [
        buf("notes.txt", "txt", "first paragraph talks", "and continues here", "", "second paragraph starts", "and goes on"),
      ],
      cursor: at(0, 0),
    }),
    check: (s) => s.cursor.row === 4,
  },
  {
    id: "m-percent",
    chapter: "motions",
    title: "%",
    task: [
      "% matches the bracket under the cursor: ( [ {. Nested pairs are counted properly.",
      "Jump to the closing paren that matches the one under you.",
    ],
    par: 1,
    state: () => ({
      buffers: [buf("main.go", "go", "run(deep(nested(a), b))")],
      cursor: at(0, 3),
    }),
    check: (s) => s.cursor.col === 22,
  },
];

// =========================================================== chapter 2: editing

const editing: Level[] = [
  {
    id: "e-i",
    chapter: "editing",
    title: "i and Esc",
    task: [
      "i enters insert mode before the cursor; Esc snaps back to normal.",
      "Insert 'very ' before 'good' so the line reads: code is very good.",
    ],
    par: 10,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "code is good")],
      cursor: at(0, 8),
    }),
    check: (s) => lineIs(s, 0, "code is very good") && s.mode === "normal",
  },
  {
    id: "e-a",
    chapter: "editing",
    title: "a and A",
    task: [
      "a inserts after the cursor, A at the end of the line. No more $+i gymnastics.",
      "Append ' there' to the end of the line.",
    ],
    par: 8,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "hello")],
      cursor: at(0, 0),
    }),
    check: (s) => lineIs(s, 0, "hello there"),
  },
  {
    id: "e-o",
    chapter: "editing",
    title: "o and O",
    task: [
      "o opens a line BELOW, O above, and drops you in insert mode.",
      "Open a line below 'one' and type 'two' on it.",
    ],
    par: 5,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "one")],
      cursor: at(0, 0),
    }),
    check: (s) => bufferIs(s, ["one", "two"]),
  },
  {
    id: "e-x",
    chapter: "editing",
    title: "x",
    task: [
      "x deletes the character under the cursor (like a surgical Delete key).",
      "Delete the stray 'z' ruining the word.",
    ],
    par: 1,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "miszpelled")],
      cursor: at(0, 3),
    }),
    check: (s) => lineIs(s, 0, "mispelled"),
  },
  {
    id: "e-r",
    chapter: "editing",
    title: "r",
    task: [
      "r replaces exactly one character without leaving normal mode.",
      "Fix the typo: make 'hellx' read 'hello' with one r.",
    ],
    par: 2,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "hellx there")],
      cursor: at(0, 4),
    }),
    check: (s) => lineIs(s, 0, "hello there"),
  },
  {
    id: "e-ddp",
    chapter: "editing",
    title: "dd and p",
    task: [
      "dd deletes (yanks) a line, p pastes it below. ddp swaps two lines.",
      "Swap 'second' above 'first' with ddp.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "first", "second")],
      cursor: at(0, 0),
    }),
    check: (s) => bufferIs(s, ["second", "first"]),
  },
  {
    id: "e-yy",
    chapter: "editing",
    title: "yy and p",
    task: [
      "yy yanks a whole line without deleting it; p pastes the copy below.",
      "Duplicate the 'keep' line so it appears twice.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "keep", "drop")],
      cursor: at(0, 0),
    }),
    check: (s) => bufferIs(s, ["keep", "keep", "drop"]),
  },
  {
    id: "e-cw",
    chapter: "editing",
    title: "cw",
    task: [
      "cw changes to the end of the word and drops you in insert mode.",
      "Change 'slow' into 'fast'.",
    ],
    par: 7,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "the slow fox")],
      cursor: at(0, 4),
    }),
    check: (s) => lineIs(s, 0, "the fast fox"),
  },
  {
    id: "e-ciw",
    chapter: "editing",
    title: "ciw",
    task: [
      "ciw = change inner word. Works from ANYWHERE in the word, middle included.",
      "Standing mid-word, change 'temporary' to 'final'.",
    ],
    par: 10,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "this is temporary state")],
      cursor: at(0, 10),
    }),
    check: (s) => lineIs(s, 0, "this is final state"),
  },
  {
    id: "e-daw",
    chapter: "editing",
    title: "daw",
    task: [
      "daw = delete a word AND its trailing space. No orphan double spaces.",
      "Delete the word 'ugly' cleanly from the sentence.",
    ],
    par: 4,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "this ugly line is clean now")],
      cursor: at(0, 5),
    }),
    check: (s) => lineIs(s, 0, "this line is clean now"),
  },
  {
    id: "e-J",
    chapter: "editing",
    title: "J",
    task: [
      "J pulls the next line up and welds the two with a single space.",
      "Fuse these lines into one.",
    ],
    par: 1,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "one two", "three four")],
      cursor: at(0, 0),
    }),
    check: (s) => bufferIs(s, ["one two three four"]),
  },
  {
    id: "e-u",
    chapter: "editing",
    title: "u and C-r",
    task: [
      "u undoes the last change, C-r redoes it. This config also binds C-z to undo.",
      "Delete the 'u' with x, undo with u, then redo with C-r.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "undo me")],
      cursor: at(0, 0),
    }),
    check: (s) => lineIs(s, 0, "ndo me"),
  },
  {
    id: "e-dot",
    chapter: "editing",
    title: ".",
    task: [
      ". repeats the last change. x then move then . is batch editing on a budget.",
      "Delete the first char of each line: x, j, ., j, .",
    ],
    par: 5,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "zalpha", "zbeta", "zgamma")],
      cursor: at(0, 0),
    }),
    check: (s) => bufferIs(s, ["alpha", "beta", "gamma"]),
  },
];

// remove the scripted undo-level override block: e-u is now a plain level

// fix the undo level check with a proper scripted seed

// =========================================================== chapter 3: visual & batch

const visual: Level[] = [
  {
    id: "v-d",
    chapter: "visual batch",
    title: "v + motion",
    task: [
      "v starts characterwise visual; move, then act (d y c s u U).",
      "Visually select 'waste' and delete it.",
    ],
    par: 7,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "this waste word goes")],
      cursor: at(0, 5),
    }),
    check: (s) => lineIs(s, 0, "this  word goes") || lineIs(s, 0, "this word goes"),
  },
  {
    id: "v-indent",
    chapter: "visual batch",
    title: "V + >",
    task: [
      "V is linewise visual. > indents, < dedents; this config reselects so you can chain.",
      "Indent both lines: V, j, then >.",
    ],
    par: 3,
    filetype: "lua",
    state: () => ({
      buffers: [buf("init.lua", "lua", "alpha", "beta")],
      cursor: at(0, 0),
    }),
    check: (s) =>
      (s.buffers[0].lines[0] ?? "").startsWith("  ") && (s.buffers[0].lines[1] ?? "").startsWith("  "),
  },
  {
    id: "v-aj",
    chapter: "visual batch",
    title: "A-j / A-k",
    task: [
      "This config moves lines with Alt+j / Alt+k. No cutting, no pasting.",
      "Slide the first line down one slot (Alt+j, shown as A-j).",
    ],
    par: 1,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "one", "two", "three")],
      cursor: at(0, 0),
    }),
    check: (s) => bufferIs(s, ["two", "one", "three"]),
  },
  {
    id: "v-block-prefix",
    chapter: "visual batch",
    title: "C-v + I",
    task: [
      "C-v is block mode: a rectangle. I inserts on EVERY row at once, Esc commits.",
      "Prefix all three lines with a Lua comment: C-v, jj, I, --, Esc.",
    ],
    par: 7,
    filetype: "lua",
    state: () => ({
      buffers: [buf("init.lua", "lua", "alpha", "beta", "gamma")],
      cursor: at(0, 0),
    }),
    check: (s) => {
      for (const l of s.buffers[0].lines.slice(0, 3)) {
        if (!/^--/.test(l)) return false;
      }
      return true;
    },
  },
  {
    id: "v-block-append",
    chapter: "visual batch",
    title: "C-v + A",
    task: [
      "A in block mode appends at the right edge of the rectangle; $ extends the block to end of line.",
      "Append a semicolon to all three lines: C-v, jj, $, A, ;, Esc.",
    ],
    par: 8,
    state: () => ({
      buffers: [buf("stmts.go", "go", "\tx = 1", "\ty = 2", "\tz = 3")],
      cursor: at(0, 1),
    }),
    check: (s) => {
      const ls = s.buffers[0].lines.slice(0, 3);
      return ls.every((l) => l.trimEnd().endsWith(";")) && ls.every((l) => !l.includes("; ;"));
    },
  },
  {
    id: "v-case",
    chapter: "visual batch",
    title: "visual u / U",
    task: [
      "u lowercases a visual selection, U uppercases it.",
      "Turn 'SCREAMING' into lowercase using v and u.",
    ],
    par: 9,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "stop SCREAMING please")],
      cursor: at(0, 5),
    }),
    check: (s) => lineIs(s, 0, "stop screaming please"),
  },
  {
    id: "v-gv",
    chapter: "visual batch",
    title: "gv",
    task: [
      "gv reselects the last visual selection. Indent twice without re-selecting.",
      "Indent two lines, then reselect (gv) and indent again.",
    ],
    par: 6,
    state: () => ({
      buffers: [buf("init.lua", "lua", "alpha", "beta")],
      cursor: at(0, 0),
    }),
    check: (s) =>
      (s.buffers[0].lines[0] ?? "").startsWith("    ") && (s.buffers[0].lines[1] ?? "").startsWith("    "),
  },
];

// =========================================================== chapter 4: search & replace

const searchLevels: Level[] = [
  {
    id: "s-slash",
    chapter: "search replace",
    title: "/ search",
    task: [
      "/ searches forward with live matching; smartcase is on (case-insensitive unless you type caps).",
      "Search for 'treasure' and jump to it.",
    ],
    par: 11,
    state: () => ({
      buffers: [
        buf("map.txt", "txt", "start here", "nothing yet", "the treasure is buried", "end"),
      ],
      cursor: at(0, 0),
    }),
    check: (s) => s.cursor.row === 2,
  },
  {
    id: "s-n",
    chapter: "search replace",
    title: "n and N",
    task: [
      "n hops to the next match, N to the previous. After /roses, ride n to the end.",
      "Find 'rose' then press n until you sit on the last one.",
    ],
    par: 14,
    state: () => ({
      buffers: [
        buf("garden.txt", "txt", "a rose here", "a rose there", "the last rose", "no flower"),
      ],
      cursor: at(0, 0),
    }),
    check: (s) => s.cursor.row === 2 && cursorWordIs(s, "rose"),
  },
  {
    id: "s-star",
    chapter: "search replace",
    title: "*",
    task: [
      "* searches for the word under the cursor and jumps to the next hit.",
      "You're on the first 'the'. Jump to the next with *.",
    ],
    par: 1,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "the cat sat on the mat")],
      cursor: at(0, 0),
    }),
    check: (s) => s.cursor.col > 3 && (s.buffers[0].lines[0] ?? "").slice(s.cursor.col, s.cursor.col + 3) === "the",
  },
  {
    id: "s-hash",
    chapter: "search replace",
    title: "#",
    task: [
      "# is * in reverse: previous occurrence of the word under the cursor.",
      "Jump back to the earlier 'marker'.",
    ],
    par: 1,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "marker one", "filler", "marker two")],
      cursor: at(2, 0),
    }),
    check: (s) => s.cursor.row === 0,
  },
  {
    id: "s-substitute",
    chapter: "search replace",
    title: ":%s with g",
    task: [
      ":%s/old/new/g replaces across the file. Without g you only get the first hit per line.",
      "Every rose becomes a blossom.",
    ],
    par: 19,
    state: () => ({
      buffers: [buf("garden.txt", "txt", "a rose is a rose", "rose by any other rose")],
      cursor: at(0, 0),
    }),
    check: (s) => {
      const lines = s.buffers[0].lines;
      return lines.every((l) => !l.includes("rose") && l.includes("blossom"));
    },
  },
  {
    id: "s-single",
    chapter: "search replace",
    title: ":s first-hit",
    task: [
      ":s/old/new/ (no %) touches only the current line, and only the FIRST hit without g.",
      "On line one, replace just the first 'cat' with 'dog'.",
    ],
    par: 14,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "a cat met a cat", "another cat")] as never,
      cursor: at(0, 0),
    }),
    check: (s) =>
      lineIs(s, 0, "a dog met a cat") && lineIs(s, 1, "another cat"),
  },
  {
    id: "s-smartcase",
    chapter: "search replace",
    title: "smartcase",
    task: [
      "smartcase: lowercase pattern ignores case, a pattern with ANY capital turns case-sensitive.",
      "Replace 'Rose' (capital R only) with 'Iris'. The lowercase roses survive.",
    ],
    par: 18,
    state: () => ({
      buffers: [buf("garden.txt", "txt", "Rose the rose", "rose again")],
      cursor: at(0, 0),
    }),
    check: (s) =>
      lineIs(s, 0, "Iris the rose") && lineIs(s, 1, "rose again"),
  },
  {
    id: "s-leader-sr",
    chapter: "search replace",
    title: "<leader>sr",
    task: [
      "This config binds <leader>sr to start :%s/ so you only type the pattern.",
      "Fire <leader>sr, type dust/ash/g, Enter. Dust becomes ash.",
    ],
    par: 14,
    state: () => ({
      buffers: [buf("room.txt", "txt", "dust on the shelf", "dust on the floor")],
      cursor: at(0, 0),
    }),
    check: (s) =>
      lineIs(s, 0, "ash on the shelf") && lineIs(s, 1, "ash on the floor"),
  },
  {
    id: "s-visual",
    chapter: "search replace",
    title: "visual :s",
    task: [
      "Select lines in V, then :s acts on the selection only ('<,'> range).",
      "Select both lines and swap 'beta' for 'BETA' inside them.",
    ],
    par: 24,
    state: () => ({
      buffers: [buf("notes.txt", "txt", "beta alpha", "alpha beta")],
      cursor: at(0, 0),
    }),
    check: (s) =>
      lineIs(s, 0, "BETA alpha") && lineIs(s, 1, "alpha BETA"),
  },
];

// =========================================================== chapter 5: comments & surround

const commentsSurround: Level[] = [
  {
    id: "c-gcc",
    chapter: "comments surround",
    title: "gcc",
    task: [
      "gcc toggles the comment on the current line (Comment.nvim, commentstring-aware).",
      "Comment out this Lua line.",
    ],
    par: 3,
    filetype: "lua",
    state: () => ({
      buffers: [buf("init.lua", "lua", "return 42")],
      cursor: at(0, 0),
    }),
    check: (s) => /^--/.test(s.buffers[0].lines[0] ?? ""),
  },
  {
    id: "c-gc-motion",
    chapter: "comments surround",
    title: "gc + motion",
    task: [
      "gc is a comment OPERATOR: gc then a motion comments that range.",
      "Comment the next two lines: gc, 2j.",
    ],
    par: 4,
    filetype: "go",
    state: () => ({
      buffers: [buf("main.go", "go", "one", "two", "three")],
      cursor: at(0, 0),
    }),
    check: (s) => {
      const ls = s.buffers[0].lines.slice(0, 2);
      return ls.every((l) => l.trimStart().startsWith("//"));
    },
  },
  {
    id: "c-uncomment",
    chapter: "comments surround",
    title: "gcc again",
    task: [
      "Same key, opposite direction: gcc on a commented line uncomments it.",
      "Uncomment the line below.",
    ],
    par: 3,
    filetype: "lua",
    state: () => ({
      buffers: [buf("init.lua", "lua", "-- return 42")],
      cursor: at(0, 2),
    }),
    check: (s) => lineIs(s, 0, "return 42"),
  },
  {
    id: "sr-add",
    chapter: "comments surround",
    title: "saiw\"",
    task: [
      "mini.surround: sa + motion/object + char ADDS a pair. saiw\" wraps a word.",
      "Wrap the word in double quotes: sa, iw, then \".",
    ],
    par: 5,
    state: () => ({
      buffers: [buf("init.lua", "lua", "print(hello)")],
      cursor: at(0, 6),
    }),
    check: (s) => lineIs(s, 0, 'print("hello")'),
  },
  {
    id: "sr-del",
    chapter: "comments surround",
    title: "sd\"",
    task: [
      "sd + char DELETES the surrounding pair. The char names the pair.",
      "Strip the quotes: sd then \".",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("init.lua", "lua", 'print("hello")')],
      cursor: at(0, 7),
    }),
    check: (s) => lineIs(s, 0, "print(hello)"),
  },
  {
    id: "sr-replace",
    chapter: "comments surround",
    title: "sr\"",
    task: [
      "sr + old + new REPLACES one surrounding pair with another.",
      "Swap the quotes for parens: sr then \" then (.",
    ],
    par: 4,
    state: () => ({
      buffers: [buf("init.lua", "lua", 'print("hello")')],
      cursor: at(0, 7),
    }),
    check: (s) => lineIs(s, 0, "print((hello))") || lineIs(s, 0, "print( hello )") || /print\(\s*hello\s*\)/.test(s.buffers[0].lines[0] ?? ""),
  },
];

// =========================================================== chapter 6: files buffers tabs

const filesLevels: Level[] = [
  {
    id: "f-tree",
    chapter: "files buffers",
    title: "<leader>e",
    task: [
      "<leader>e toggles nvim-tree. While the tree has focus, j/k walk and Enter opens.",
      "Toggle the file explorer open.",
    ],
    par: 2,
    state: () => ({
      buffers: [buf("readme.md", "md", "# demo")],
      cursor: at(0, 0),
      tree: {
        open: false,
        focused: false,
        files: [
          { path: "cmd", type: "dir" },
          { path: "cmd/server", type: "dir" },
          { path: "cmd/server/main.go", type: "file" },
          { path: "internal", type: "dir" },
          { path: "internal/tags", type: "dir" },
          { path: "internal/tags/tags.go", type: "file" },
          { path: "readme.md", type: "file" },
        ],
        selected: "cmd",
        cut: null,
        message: "",
      },
    }),
    check: (s) => s.tree.open === true,
  },
  {
    id: "f-open",
    chapter: "files buffers",
    title: "open a file",
    task: [
      "With the tree focused: j to move down, Enter opens the file under the cursor.",
      "The tree is open. Open internal/tags/tags.go.",
    ],
    par: 6,
    state: () => ({
      buffers: [buf("readme.md", "md", "# demo")],
      cursor: at(0, 0),
      tree: {
        open: true,
        focused: true,
        files: [
          { path: "cmd", type: "dir" },
          { path: "cmd/server", type: "dir" },
          { path: "cmd/server/main.go", type: "file" },
          { path: "internal", type: "dir" },
          { path: "internal/tags", type: "dir" },
          { path: "internal/tags/tags.go", type: "file" },
          { path: "readme.md", type: "file" },
        ],
        selected: "cmd",
        cut: null,
        message: "",
      },
    }),
    check: (s) => activeBufferIs(s, "internal/tags/tags.go"),
  },
  {
    id: "f-create",
    chapter: "files buffers",
    title: "a: create file",
    task: [
      "a in the tree creates a file (or dir with a trailing /) next to the cursor.",
      "Create internal/tags/parse.go: press a and type the path.",
    ],
    par: 20,
    state: () => ({
      buffers: [buf("readme.md", "md", "# demo")],
      cursor: at(0, 0),
      tree: {
        open: true,
        focused: true,
        files: [
          { path: "internal", type: "dir" },
          { path: "internal/tags", type: "dir" },
          { path: "internal/tags/tags.go", type: "file" },
          { path: "readme.md", type: "file" },
        ],
        selected: "internal/tags",
        cut: null,
        message: "",
      },
    }),
    check: (s) => s.tree.files.some((f) => f.path === "internal/tags/parse.go"),
  },
  {
    id: "f-rename",
    chapter: "files buffers",
    title: "r: rename",
    task: [
      "r renames the file under the cursor (same as moving within a folder).",
      "Rename draft.md to notes.md.",
    ],
    par: 18,
    state: () => ({
      buffers: [buf("draft.md", "md", "# draft")],
      cursor: at(0, 0),
      tree: {
        open: true,
        focused: true,
        files: [
          { path: "draft.md", type: "file" },
          { path: "readme.md", type: "file" },
        ],
        selected: "draft.md",
        cut: null,
        message: "",
      },
    }),
    check: (s) => s.tree.files.some((f) => f.path === "notes.md") && !s.tree.files.some((f) => f.path === "draft.md"),
  },
  {
    id: "f-move",
    chapter: "files buffers",
    title: "x then p: move",
    task: [
      "x cuts, c copies, p pastes into the folder under the cursor. That's a file move.",
      "Move stray.txt into the archive folder: x, j to archive, p.",
    ],
    par: 4,
    state: () => ({
      buffers: [buf("readme.md", "md", "# demo")],
      cursor: at(0, 0),
      tree: {
        open: true,
        focused: true,
        files: [
          { path: "archive", type: "dir" },
          { path: "readme.md", type: "file" },
          { path: "stray.txt", type: "file" },
        ],
        selected: "stray.txt",
        cut: null,
        message: "",
      },
    }),
    check: (s) => s.tree.files.some((f) => f.path === "archive/stray.txt") && !s.tree.files.some((f) => f.path === "stray.txt"),
  },
  {
    id: "f-ff",
    chapter: "files buffers",
    title: "<leader>ff",
    task: [
      "<leader>ff opens telescope: fuzzy-find files, type to filter, Enter opens.",
      "Summon the finder and open store.go.",
    ],
    par: 12,
    state: () => ({
      buffers: [buf("readme.md", "md", "# demo")],
      cursor: at(0, 0),
      tree: {
        open: false,
        focused: false,
        files: [
          { path: "internal/store/store.go", type: "file" },
          { path: "internal/tags/tags.go", type: "file" },
          { path: "readme.md", type: "file" },
        ],
        selected: null,
        cut: null,
        message: "",
      },
    }),
    check: (s) => activeBufferIs(s, "internal/store/store.go"),
  },
  {
    id: "f-ff-new",
    chapter: "files buffers",
    title: "<leader>ff creates",
    task: [
      "In <leader>ff, typing a path with no match + Enter CREATES the file. No :e needed.",
      "Create cmd/agent/main.go straight from the finder.",
    ],
    par: 22,
    state: () => ({
      buffers: [buf("readme.md", "md", "# demo")],
      cursor: at(0, 0),
      tree: {
        open: false,
        focused: false,
        files: [
          { path: "cmd", type: "dir" },
          { path: "readme.md", type: "file" },
        ],
        selected: null,
        cut: null,
        message: "",
      },
    }),
    check: (s) =>
      s.tree.files.some((f) => f.path === "cmd/agent/main.go") || s.buffers.some((b) => b.name === "cmd/agent/main.go"),
  },
  {
    id: "f-buffers",
    chapter: "files buffers",
    title: "[b and ]b",
    task: [
      "[b goes to the previous buffer, ]b to the next. Cycle without the picker.",
      "You have three buffers. Hop to the last one with ]b, ]b.",
    ],
    par: 4,
    state: () => ({
      buffers: [buf("a.txt", "txt", "a"), buf("b.txt", "txt", "b"), buf("c.txt", "txt", "c")],
      activeBuf: 0,
      cursor: at(0, 0),
    }),
    check: (s) => activeBufferIs(s, "c.txt"),
  },
  {
    id: "f-bd",
    chapter: "files buffers",
    title: "<leader>bd",
    task: [
      "<leader>bd closes the current buffer and lands you on the next.",
      "Delete 'junk.txt'.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("junk.txt", "txt", "junk"), buf("keep.txt", "txt", "keep")],
      activeBuf: 0,
      cursor: at(0, 0),
    }),
    check: (s) => !s.buffers.some((b) => b.name === "junk.txt") && activeBufferIs(s, "keep.txt"),
  },
  {
    id: "f-tabs",
    chapter: "files buffers",
    title: "<leader>tn / tl",
    task: [
      "<leader>tn makes a tab, <leader>tl next, <leader>th previous, <leader>tc close.",
      "Make a new tab, then walk back to the first one.",
    ],
    par: 6,
    state: () => ({
      buffers: [buf("a.txt", "txt", "a")],
      cursor: at(0, 0),
    }),
    check: (s) => s.tabs.length === 2 && s.activeTab === 0,
  },
  {
    id: "f-grep",
    chapter: "files buffers",
    title: "<leader>fg",
    task: [
      "<leader>fg live-greps the project; Enter jumps to the hit.",
      "Grep for 'Println' and jump to the match in main.go.",
    ],
    par: 12,
    state: () => ({
      buffers: [
        buf("cmd/server/main.go", "go", "package main", "", 'import "fmt"', "", "func main() {", "\tfmt.Println(\"server up\")", "}"),
        buf("readme.md", "md", "# demo"),
      ],
      activeBuf: 1,
      cursor: at(0, 0),
      tree: {
        open: false,
        focused: false,
        files: [
          { path: "cmd/server/main.go", type: "file" },
          { path: "readme.md", type: "file" },
        ],
        selected: null,
        cut: null,
        message: "",
      },
    }),
    check: (s) => activeBufferIs(s, "cmd/server/main.go") && s.cursor.row === 5,
  },
];

// =========================================================== chapter 7: lsp & diagnostics

const lspLevels: Level[] = [
  {
    id: "l-]d",
    chapter: "lsp diagnostics",
    title: "]d",
    task: [
      "]d jumps to the next diagnostic (error squiggle), [d back. The problem announces itself.",
      "Jump to the first problem in the file.",
    ],
    par: 2,
    state: () => ({
      buffers: [
        buf("main.go", "go", "package main", "", "func main() {", "\tuser := loadUser()", "\tuser.Nmae()", "}"),
      ],
      cursor: at(0, 0),
      diagnostics: {
        "0": [diag(5, 6, 4, "error", "user.Nmae undefined (type *User has no field Nmae)")],
      },
    }),
    check: (s) => s.cursor.row === 5,
  },
  {
    id: "l-float",
    chapter: "lsp diagnostics",
    title: "<leader>d",
    task: [
      "<leader>d opens a float with the FULL problem text for the line you're on.",
      "Stand on the broken line and open the diagnostic float.",
    ],
    par: 3,
    state: () => ({
      buffers: [
        buf("main.go", "go", "func main() {", "\tuser.Nmae()", "}"),
      ],
      cursor: at(1, 1),
      diagnostics: {
        "0": [diag(1, 6, 4, "error", "user.Nmae undefined (type *User has no field Nmae)")],
      },
    }),
    check: (s) => floatKind(s, "diagnostic"),
  },
  {
    id: "l-trouble",
    chapter: "lsp diagnostics",
    title: "<leader>xx",
    task: [
      "<leader>xx opens Trouble: every problem in the workspace, listed. Enter jumps.",
      "Open the diagnostics list.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("main.go", "go", "user.Nmae()")],
      cursor: at(0, 0),
      diagnostics: {
        "0": [diag(0, 6, 4, "error", "user.Nmae undefined")],
      },
    }),
    check: (s) => s.troubleOpen === true,
  },
  {
    id: "l-codeaction",
    chapter: "lsp diagnostics",
    title: "<leader>ca",
    task: [
      "<leader>ca opens code actions on the cursor: quickfix, organize imports, the works.",
      "Fire code actions and pick 1 to quickfix the unused variable.",
    ],
    par: 4,
    state: () => ({
      buffers: [
        buf("main.go", "go", "func run() {", "\ttemp := compute()", "\treturn nil", "}"),
      ],
      cursor: at(1, 1),
      diagnostics: {
        "0": [
          diag(1, 1, 4, "warn", "declared and not used: temp", {
            kind: "unused",
            label: "rename to _temp",
            symbol: "temp",
          }),
        ],
      },
    }),
    check: (s) => (s.buffers[0].lines[1] ?? "").includes("_temp"),
  },
  {
    id: "l-gd",
    chapter: "lsp diagnostics",
    title: "gd",
    task: [
      "gd jumps to the definition of the symbol under the cursor.",
      "Stand on loadConfig and gd into its definition.",
    ],
    par: 2,
    state: () => ({
      buffers: [
        buf(
          "config.go",
          "go",
          "func boot() {",
          "\tcfg := loadConfig()",
          "\tuse(cfg)",
          "}",
          "",
          "func loadConfig() Config {",
          "\treturn Config{}",
          "}"
        ),
      ],
      cursor: at(1, 9),
    }),
    check: (s) => s.cursor.row === 5,
  },
  {
    id: "l-K",
    chapter: "lsp diagnostics",
    title: "K hover",
    task: [
      "K pops the hover float: signature and where the thing is defined.",
      "Hover the loadConfig symbol.",
    ],
    par: 1,
    state: () => ({
      buffers: [
        buf(
          "config.go",
          "go",
          "func boot() {",
          "\tcfg := loadConfig()",
          "}",
          "",
          "func loadConfig() Config {",
          "\treturn Config{}",
          "}"
        ),
      ],
      cursor: at(1, 9),
    }),
    check: (s) => floatKind(s, "hover"),
  },
  {
    id: "l-rename",
    chapter: "lsp diagnostics",
    title: "<leader>rn",
    task: [
      "<leader>rn renames the symbol EVERYWHERE in the buffer, not just here.",
      "Rename loadConfig to readConfig (clear the prompt, type the new name, Enter).",
    ],
    par: 24,
    state: () => ({
      buffers: [
        buf(
          "config.go",
          "go",
          "func boot() {",
          "\tcfg := loadConfig()",
          "\tbackup(loadConfig)",
          "}",
          "",
          "func loadConfig() Config {",
          "\treturn Config{}",
          "}"
        ),
      ],
      cursor: at(1, 9),
    }),
    check: (s) => {
      const joined = s.buffers[0].lines.join("\n");
      return joined.includes("readConfig") && !joined.includes("loadConfig");
    },
  },
];

// =========================================================== chapter 8: go

const goLevels: Level[] = [
  {
    id: "g-ga",
    chapter: "go gopher",
    title: "<leader>ga",
    task: [
      "gopher.nvim: <leader>ga adds json struct tags with snake_case names, whole struct at once.",
      "Stand anywhere in the User struct and add json tags.",
    ],
    par: 3,
    state: () => ({
      buffers: [
        buf(
          "tags.go",
          "go",
          "package tags",
          "",
          "type User struct {",
          "\tName string",
          "\tEmail string",
          "\tAge int",
          "}"
        ),
      ],
      cursor: at(4, 5),
    }),
    check: (s) => goStructTagged(s, "json"),
  },
  {
    id: "g-gA",
    chapter: "go gopher",
    title: "<leader>gA",
    task: [
      "<leader>gA is the same but prompts for the tag name. db needs yaml today.",
      "Add yaml tags: <leader>gA, clear the prompt, type yaml, Enter.",
    ],
    par: 12,
    state: () => ({
      buffers: [
        buf("tags.go", "go", "type User struct {", "\tName string", "\tEmail string", "\tAge int", "}"),
      ],
      cursor: at(1, 1),
    }),
    check: (s) => goStructTagged(s, "yaml"),
  },
  {
    id: "g-gx",
    chapter: "go gopher",
    title: "<leader>gx",
    task: [
      "<leader>gx strips struct tags back off. Clean slate.",
      "Remove the json tags from the struct.",
    ],
    par: 3,
    state: () => ({
      buffers: [
        buf(
          "tags.go",
          "go",
          "type User struct {",
          "\tName string `json:\"name\"`",
          "\tEmail string `json:\"email\"`",
          "\tAge int `json:\"age\"`",
          "}"
        ),
      ],
      cursor: at(1, 1),
    }),
    check: (s) => {
      const joined = s.buffers[0].lines.join("\n");
      return !joined.includes("json:");
    },
  },
];

// =========================================================== chapter 9: git

const gitLevels: Level[] = [
  {
    id: "h-]c",
    chapter: "git gitsigns",
    title: "]c",
    task: [
      "gitsigns marks changed lines in the sign column; ]c jumps to the next hunk.",
      "Hop to the next git change.",
    ],
    par: 2,
    state: () => ({
      buffers: [
        buf("main.go", "go", "untouched", "added line", "untouched", "added too", "end"),
      ],
      cursor: at(0, 0),
      gitHunks: {
        "0": [
          { row: 1, type: "add", original: null },
          { row: 3, type: "add", original: null },
        ],
      },
    }),
    check: (s) => s.cursor.row === 1,
  },
  {
    id: "h-[c",
    chapter: "git gitsigns",
    title: "[c",
    task: [
      "[c goes to the previous hunk. Hunk-hopping beats scrolling.",
      "You're on the last hunk. Go back.",
    ],
    par: 2,
    state: () => ({
      buffers: [buf("main.go", "go", "one", "two", "three changed", "four", "five changed")],
      cursor: at(4, 0),
      gitHunks: {
        "0": [
          { row: 2, type: "change", original: ["three before"] },
          { row: 4, type: "change", original: ["five before"] },
        ],
      },
    }),
    check: (s) => s.cursor.row === 2,
  },
  {
    id: "h-reset",
    chapter: "git gitsigns",
    title: "<leader>gr",
    task: [
      "<leader>gr resets the hunk under the cursor back to the index version.",
      "Undo that hunk with gitsigns (not u).",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("main.go", "go", "keep this", "changed line", "keep this too")],
      cursor: at(1, 0),
      gitHunks: {
        "0": [{ row: 1, type: "change", original: ["original line"] }],
      },
    }),
    check: (s) => lineIs(s, 1, "original line") && (s.gitHunks["0"] ?? []).length === 0,
  },
  {
    id: "h-diff",
    chapter: "git gitsigns",
    title: "<leader>gd",
    task: [
      "<leader>gd previews the hunk: minus is the index, plus is your working copy.",
      "Preview the hunk under the cursor.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("main.go", "go", "a changed line")],
      cursor: at(0, 0),
      gitHunks: {
        "0": [{ row: 0, type: "change", original: ["the old line"] }],
      },
    }),
    check: (s) => floatKind(s, "diagnostic"),
  },
];

// =========================================================== chapter 10: windows

const windowLevels: Level[] = [
  {
    id: "w-split",
    chapter: "windows",
    title: "<leader>w-",
    task: [
      "<leader>w- splits top/bottom (splitbelow is on). C-w s does the same.",
      "Split the window horizontally.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("main.go", "go", "one", "two")],
      cursor: at(0, 0),
    }),
    check: (s) => winLayoutIs(s, "col") && s.wins.length === 2,
  },
  {
    id: "w-vsplit",
    chapter: "windows",
    title: "<leader>w|",
    task: [
      "<leader>w| splits side-by-side (splitright is on). C-w v does the same.",
      "Split the window vertically.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("main.go", "go", "one", "two")],
      cursor: at(0, 0),
    }),
    check: (s) => winLayoutIs(s, "row") && s.wins.length === 2,
  },
  {
    id: "w-nav",
    chapter: "windows",
    title: "C-h j k l",
    task: [
      "C-h/j/k/l walk between windows: left, down, up, right. You're in the top one.",
      "Focus the bottom window with C-j.",
    ],
    par: 1,
    state: () => ({
      buffers: [buf("main.go", "go", "one", "two")],
      cursor: at(0, 0),
      wins: [
        { id: 1, bufIdx: 0, cursor: at(0, 0) },
        { id: 2, bufIdx: 0, cursor: at(1, 0) },
      ],
      activeWin: 1,
      layout: { type: "col", children: [{ type: "leaf", win: 1 }, { type: "leaf", win: 2 }] },
    }),
    check: (s) => s.activeWin === 2,
  },
  {
    id: "w-resize",
    chapter: "windows",
    title: "<leader>w, and w.",
    task: [
      "<leader>w, shrinks the split, <leader>w. grows it, <leader>we equalizes.",
      "Grow the right window once with <leader>w..",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("main.go", "go", "one", "two")],
      cursor: at(0, 0),
      wins: [
        { id: 1, bufIdx: 0, cursor: at(0, 0) },
        { id: 2, bufIdx: 0, cursor: at(0, 0) },
      ],
      activeWin: 2,
      layout: { type: "row", children: [{ type: "leaf", win: 1 }, { type: "leaf", win: 2 }] },
    }),
    check: (s) => {
      const row = s.layout;
      if (row.type !== "row") return false;
      const w = row.weights;
      return !!w && w.length === 2 && w[1] > w[0];
    },
  },
  {
    id: "w-close",
    chapter: "windows",
    title: ":q closes the window",
    task: [
      ":q closes the current window (not the app). Keep at least one and it just works.",
      "Close the bottom window with :q.",
    ],
    par: 3,
    state: () => ({
      buffers: [buf("main.go", "go", "one", "two")],
      cursor: at(0, 0),
      wins: [
        { id: 1, bufIdx: 0, cursor: at(0, 0) },
        { id: 2, bufIdx: 0, cursor: at(1, 0) },
      ],
      activeWin: 2,
      layout: { type: "col", children: [{ type: "leaf", win: 1 }, { type: "leaf", win: 2 }] },
    }),
    check: (s) => s.wins.length === 1,
  },
];

// =========================================================== export

export function allLevels(): Level[] {
  return [
    ...motions,
    ...editing,
    ...visual,
    ...searchLevels,
    ...commentsSurround,
    ...filesLevels,
    ...lspLevels,
    ...goLevels,
    ...gitLevels,
    ...windowLevels,
  ];
}

export function chapters(): string[] {
  const out: string[] = [];
  for (const l of allLevels()) {
    if (!out.includes(l.chapter)) out.push(l.chapter);
  }
  return out;
}

export type { LevelSeed };
