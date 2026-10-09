// Minimal syntax highlighting: enough to feel like nvim, not treesitter.

const KEYWORDS: Record<string, string[]> = {
  go: ["package", "import", "func", "type", "struct", "return", "if", "else", "for", "range", "var", "const", "nil", "string", "int", "bool", "error"],
  lua: ["local", "function", "end", "return", "if", "then", "else", "for", "do", "require", "true", "false", "nil"],
  md: [],
  txt: [],
  ts: ["const", "let", "var", "function", "return", "if", "else", "for", "import", "export", "type", "interface", "true", "false", "null", "undefined"],
};

export interface Token {
  text: string;
  cls: string | null;
}

export function tokenize(line: string, ft: string): Token[] {
  const kw = KEYWORDS[ft] ?? [];
  const commentToken = ft === "lua" ? "--" : ft === "py" ? "#" : "//";
  const tokens: Token[] = [];
  const push = (text: string, cls: string | null) => {
    if (text.length > 0) tokens.push({ text, cls });
  };

  let rest = line;
  let buf = "";
  while (rest.length > 0) {
    // comment to end of line
    if (rest.startsWith(commentToken)) {
      push(buf, null);
      push(rest, "text-muted italic");
      return tokens;
    }
    // strings
    const strMatch = rest.match(/^"[^"]*"|^'[^']*'|^`[^`]*`/);
    if (strMatch) {
      push(buf, null);
      push(strMatch[0], "text-warning");
      rest = rest.slice(strMatch[0].length);
      buf = "";
      continue;
    }
    // words
    const wordMatch = rest.match(/^[A-Za-z_]\w*/);
    if (wordMatch) {
      const word = wordMatch[0];
      const cls = kw.includes(word) ? "text-secondary font-medium" : /^[A-Z]/.test(word) ? "text-primary" : null;
      push(buf + word, cls);
      rest = rest.slice(word.length);
      buf = "";
      continue;
    }
    buf += rest[0];
    rest = rest.slice(1);
  }
  push(buf, null);
  return tokens;
}
