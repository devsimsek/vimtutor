# dotfiles-tutor web

A browser drill for vim motions and this dotfiles' nvim keymaps. A mock vim
(react + vite + daisyui, Rosé Pine Moon theme) runs a real key-to-state
engine: normal/insert/visual/visual-line/visual-block modes, operators, text
objects, registers, undo, search, `:s`, splits, and simulated plugins that
mirror the config - nvim-tree, telescope, gitsigns, gopher.nvim struct tags,
LSP (`gd`, `K`, `<leader>rn`), diagnostics with trouble and code actions.

## Run it

```bash
npm install
npm run dev      # vite dev server
npm run build    # tsc + vite production build -> dist/
npm test         # vitest: engine tests + every level must be solvable
```

## The drill

Roughly 50 levels across ten chapters, each with a par keystroke count and a
star rating (3 stars at par, 2 at 2x par, 1 after that). Progress persists in
localStorage. Chapters:

1. **motions** - hjkl, w/b/e, counts, `f{char}` with `;`/`,`, `0 ^ $`, `gg`/`G`, `{ }`, `%`
2. **editing** - i/a/o/O/A/I, x, r, dd+p, yy+p, cw, ciw, daw, J, u/C-r, dot repeat
3. **visual batch** - v/V/C-v, block insert (`I`) and append (`A`), `Vj>`, this config's `<A-j>`/`<A-k>` line moves, `gv` reselect, case ops
4. **search replace** - `/`, n/N, `*`/`#`, smartcase semantics, `:s` vs `:%s` with `g`, this config's `<leader>sr`, visual `'<,'>s`
5. **comments surround** - gcc / gc+motion (commentstring-aware), mini.surround `sa`/`sd`/`sr` (plain `s` still works)
6. **files buffers** - `<leader>e` tree with `a`/`r`/`d`/`x`/`c`/`p` (create, rename, delete, move), `<leader>ff` with create-on-enter, `<leader>fg` grep jump, `[b`/`]b`, `<leader>bd`, tabs, `<leader>st` todos
7. **lsp diagnostics** - `]d`/`[d`, `<leader>d` problem float, `<leader>xx` trouble list, `<leader>ca` numbered code actions with quickfix, `gd`, `K`, `<leader>rn`
8. **go gopher** - `<leader>ga` (json tags, snake_case), `<leader>gA` (named tag prompt), `<leader>gx`
9. **git gitsigns** - sign column, `]c`/`[c` hunk nav, `<leader>gr` reset, `<leader>gd` diff preview
10. **windows** - `<leader>w-`/`<leader>w|` splits (splitbelow/splitright honored), `C-h/j/k/l` focus walk, `<leader>we`/`w,`/`w.`, `:q` closes a window

Config details honored: leader is Space, relativenumber, cursorline,
smartcase + ignorecase, expandtab shiftwidth 2 (visual `>`/`<` reselect via
the `<gv`/`>gv` mappings), `inccommand=split` live preview while typing `:%s`,
which-key popup when leader is pressed.

## Architecture

- `src/vim/engine.ts` - pure key-to-state machine; `applyKey(state, key)`.
  Windows are first-class: layout tree with one cursor per window.
- `src/vim/` - text math, search (smartcase), `:` commands, gopher/tree/
  telescope simulations.
- `src/levels/catalog.ts` - level data: task, par, state seed, pure check.
- `src/ui/` - editor renderer (windows, gutter, selection, search highlight,
  diagnostics, git signs), overlays, panels.

Every level is verified solvable by `src/levels/catalog.test.ts`: scripted
solutions replay through the real engine and must pass the level's check at
or under par.

## Scope notes

Splits are real enough to teach (`<leader>w-`, `w|`, focus, resize, close) but
there are no terminal/process features, no macros, no marks - mock vim, not
nvim. The tmux quiz levels from `:dotfiles-tutor` are intentionally absent
here (that stays in the in-nvim tutor).
