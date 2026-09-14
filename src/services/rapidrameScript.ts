/**
 * rapidrameScript — a tiny JS interpreter for HDFilmCehennemi's stream decoder.
 *
 * WHY AN INTERPRETER AND NOT A LIST OF SCHEMES
 * --------------------------------------------
 * HDFilm hides the stream URL behind a `var <file> = <decoder>([...])` call on
 * the embed page. The decoder body is generated fresh on EVERY request: the
 * function name, the variable names, the seed strings, the number and order of
 * the pre-passes, and even the placement of dead `if` guards all change per
 * load. Matching it against a fixed list of transforms is a losing game — the
 * list went stale twice, and each time every HDFilm title silently fell
 * through to the WebView player (or to a lower-priority provider with
 * Turkish-only audio).
 *
 * The saving grace is that the generated body is plain, un-minified JS drawn
 * from a small vocabulary. So instead of guessing the scheme we READ it: this
 * module parses the live function body and replays it.
 *
 * THREE DE-SCRAMBLE FAMILIES SEEN IN THE WILD, ALL HANDLED WITHOUT SPECIAL CASES
 *
 *   arithmetic (legacy)       rolling XOR (Aug 2026)     seeded shuffle (Sep 2026)
 *   ------------------        ----------------------     ------------------------
 *   c = s.charCodeAt(i)       acc = (acc + K) % 256      derive an LCG + XOR seed
 *   c = c - (K % (i + N))     plain = c ^ acc            from a literal seed string,
 *   out += fromCharCode(c)    acc = (acc + c) % 256      Fisher-Yates un-shuffle the
 *                                                        chars, THEN rolling XOR
 *
 * The Sep-2026 family is why this file is a general interpreter rather than the
 * single-loop statement runner it started as: that body needs arrays, element
 * assignment, several loops (including descending ones), if/else-if/else
 * chains, multi-declarator `var`, ternaries, and a closure passed to
 * `String.replace`. Growing the supported subset once is cheaper than chasing
 * each new shape, and every shape above still decodes with the same code path.
 *
 * SAFETY
 * ------
 * Nothing here uses eval/Function — Hermes has no eval, and running provider JS
 * would be a code-execution sink besides. The interpreter models only pure
 * string/number/array work: there is no I/O, no property write on anything but
 * a local array, no prototype access, and no host objects. Any construct or
 * call outside the modelled subset throws `UnsupportedScript`, which
 * `runRapidrameDecoder` turns into `null` so the caller falls back to the
 * static schemes rather than playing a wrong URL. Step and size budgets bound
 * a hostile or malformed body to a bounded amount of work.
 */

// ─── Primitives shared with the static fallback path ────────────────────────

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Binary-safe atob. The decoded bytes are latin-1 (each char is one byte), so
 * the platform's `atob` — where it exists at all in React Native — is not a
 * safe substitute.
 */
export function decodeBase64Binary(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9+/=]/g, "");
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const char of cleaned) {
    if (char === "=") break;
    const index = BASE64_CHARS.indexOf(char);
    if (index === -1) continue;

    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  return output;
}

function encodeBase64Binary(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 3) {
    const a = value.charCodeAt(index) & 0xff;
    const b = index + 1 < value.length ? value.charCodeAt(index + 1) & 0xff : NaN;
    const c = index + 2 < value.length ? value.charCodeAt(index + 2) & 0xff : NaN;

    output += BASE64_CHARS[a >> 2];
    output += BASE64_CHARS[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    output += Number.isNaN(b) ? "=" : BASE64_CHARS[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    output += Number.isNaN(c) ? "=" : BASE64_CHARS[c & 63];
  }
  return output;
}

export function caesarShift(value: string, shift: number): string {
  const normalized = ((shift % 26) + 26) % 26;
  return value.replace(/[a-zA-Z]/g, (char) => {
    const code = char.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + normalized) % 26) + base);
  });
}

export function reverseString(value: string): string {
  return value.split("").reverse().join("");
}

// ─── Budgets ────────────────────────────────────────────────────────────────
// A real stream URL is a few hundred bytes and the decoders are linear in that
// length. These ceilings are far above any legitimate body and exist only so a
// malformed or hostile page cannot hang the resolver.

const MAX_STEPS = 5_000_000;
const MAX_STRING_LENGTH = 1_000_000;
const MAX_ARRAY_LENGTH = 1_000_000;

/** Thrown internally whenever the body steps outside the supported subset. */
class UnsupportedScript extends Error {}

function bail(reason: string): never {
  throw new UnsupportedScript(reason);
}

// ─── Tokenizer ──────────────────────────────────────────────────────────────

type TokenKind = "num" | "str" | "regex" | "ident" | "punct" | "eof";

type Token = {
  kind: TokenKind;
  text: string;
  /** Regex flags, for `kind === "regex"` only. */
  flags?: string;
};

// Longest-first so `>>>=` never tokenizes as `>>` + `>=`.
const PUNCTUATORS = [
  ">>>=",
  "===",
  "!==",
  ">>>",
  "<<=",
  ">>=",
  "&&=",
  "||=",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<",
  ">>",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ";",
  ",",
  ".",
  "?",
  ":",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&",
  "|",
  "^",
  "~",
  "!",
  "<",
  ">",
  "=",
];

/**
 * True when a `/` at this point starts a regex literal rather than division.
 * The standard heuristic: a regex can only follow a token that cannot end an
 * expression.
 */
function regexCanFollow(previous: Token | undefined): boolean {
  if (!previous) return true;
  if (previous.kind === "num" || previous.kind === "str" || previous.kind === "regex") return false;
  if (previous.kind === "ident") {
    // Keywords are operators here; identifiers are values.
    return ["return", "typeof", "in", "of", "new", "delete", "void", "case", "do", "else"].includes(
      previous.text
    );
  }
  return !([")", "]", "}", "++", "--"] as string[]).includes(previous.text);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    // Comments — the generated bodies carry Turkish `//` ones.
    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }

    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[index + 1] ?? ""))) {
      let text = "";
      if (char === "0" && /[xX]/.test(source[index + 1] ?? "")) {
        text = source.slice(index, index + 2);
        index += 2;
        while (index < source.length && /[0-9a-fA-F]/.test(source[index])) {
          text += source[index];
          index += 1;
        }
      } else {
        while (index < source.length && /[0-9.]/.test(source[index])) {
          text += source[index];
          index += 1;
        }
        // Exponent form shows up in some generated constants.
        if (/[eE]/.test(source[index] ?? "") && /[0-9+-]/.test(source[index + 1] ?? "")) {
          text += source[index];
          index += 1;
          if (/[+-]/.test(source[index])) {
            text += source[index];
            index += 1;
          }
          while (index < source.length && /[0-9]/.test(source[index])) {
            text += source[index];
            index += 1;
          }
        }
      }
      tokens.push({ kind: "num", text });
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      let text = "";
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) {
        text += source[index];
        index += 1;
      }
      tokens.push({ kind: "ident", text });
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      let text = "";
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          const escape = source[index + 1] ?? "";
          text +=
            escape === "n"
              ? "\n"
              : escape === "t"
                ? "\t"
                : escape === "r"
                  ? "\r"
                  : escape === "0"
                    ? "\0"
                    : escape;
          index += 2;
          continue;
        }
        text += source[index];
        index += 1;
      }
      if (index >= source.length) bail("unterminated string literal");
      index += 1; // closing quote
      tokens.push({ kind: "str", text });
      continue;
    }

    if (char === "/" && regexCanFollow(tokens[tokens.length - 1])) {
      let pattern = "";
      let inClass = false;
      index += 1;
      while (index < source.length) {
        const current = source[index];
        if (current === "\\") {
          pattern += current + (source[index + 1] ?? "");
          index += 2;
          continue;
        }
        if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) break;
        else if (current === "\n") bail("unterminated regex literal");
        pattern += current;
        index += 1;
      }
      if (index >= source.length) bail("unterminated regex literal");
      index += 1; // closing slash
      let flags = "";
      while (index < source.length && /[a-z]/.test(source[index])) {
        flags += source[index];
        index += 1;
      }
      tokens.push({ kind: "regex", text: pattern, flags });
      continue;
    }

    const punctuator = PUNCTUATORS.find((candidate) => source.startsWith(candidate, index));
    if (!punctuator) bail(`unexpected character: ${char}`);
    tokens.push({ kind: "punct", text: punctuator });
    index += punctuator.length;
  }

  tokens.push({ kind: "eof", text: "" });
  return tokens;
}

// ─── AST ────────────────────────────────────────────────────────────────────

type Expr =
  | { t: "Num"; value: number }
  | { t: "Str"; value: string }
  | { t: "Regex"; pattern: string; flags: string }
  | { t: "Ident"; name: string }
  | { t: "ArrayLit"; items: Expr[] }
  | { t: "Func"; params: string[]; body: Stmt[] }
  | { t: "Member"; object: Expr; property: string }
  | { t: "Index"; object: Expr; index: Expr }
  | { t: "Call"; callee: Expr; args: Expr[] }
  | { t: "Unary"; op: string; argument: Expr }
  | { t: "Update"; op: string; prefix: boolean; argument: Expr }
  | { t: "Binary"; op: string; left: Expr; right: Expr }
  | { t: "Logical"; op: string; left: Expr; right: Expr }
  | { t: "Conditional"; test: Expr; consequent: Expr; alternate: Expr }
  | { t: "Assign"; op: string; target: Expr; value: Expr };

type Stmt =
  | { t: "VarDecl"; declarations: Array<{ name: string; init: Expr | null }> }
  | { t: "ExprStmt"; expression: Expr }
  | { t: "If"; test: Expr; consequent: Stmt; alternate: Stmt | null }
  | { t: "For"; init: Stmt | null; test: Expr | null; update: Expr | null; body: Stmt }
  | { t: "While"; test: Expr; body: Stmt }
  | { t: "Block"; body: Stmt[] }
  | { t: "Return"; argument: Expr | null }
  | { t: "Break" }
  | { t: "Continue" }
  | { t: "Empty" };

type FunctionDecl = { name: string; params: string[]; body: Stmt[] };

// ─── Parser ─────────────────────────────────────────────────────────────────

const ASSIGN_OPERATORS = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<=",
  ">>=",
  ">>>=",
]);

class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[this.position + offset] ?? { kind: "eof", text: "" };
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== "eof") this.position += 1;
    return token;
  }

  private at(text: string): boolean {
    const token = this.peek();
    return token.text === text && (token.kind === "punct" || token.kind === "ident");
  }

  private eat(text: string): boolean {
    if (this.at(text)) {
      this.position += 1;
      return true;
    }
    return false;
  }

  private expect(text: string): void {
    if (!this.eat(text)) bail(`expected "${text}" but found "${this.peek().text}"`);
  }

  /** Optional semicolon — the generated bodies are not always tidy. */
  private semicolon(): void {
    this.eat(";");
  }

  // ── Program ──

  /** Parse the source and return the first function declaration in it. */
  parseFunctionDeclaration(): FunctionDecl {
    while (this.peek().kind !== "eof") {
      if (this.peek().kind === "ident" && this.peek().text === "function") {
        this.position += 1;
        const nameToken = this.next();
        if (nameToken.kind !== "ident") bail("expected function name");
        const params = this.parseParams();
        const body = this.parseBlock().body;
        return { name: nameToken.text, params, body };
      }
      this.position += 1;
    }
    bail("no function declaration found");
  }

  private parseParams(): string[] {
    this.expect("(");
    const params: string[] = [];
    if (this.eat(")")) return params;
    for (;;) {
      const token = this.next();
      if (token.kind !== "ident") bail("expected parameter name");
      params.push(token.text);
      if (this.eat(")")) return params;
      this.expect(",");
    }
  }

  // ── Statements ──

  private parseBlock(): { t: "Block"; body: Stmt[] } {
    this.expect("{");
    const body: Stmt[] = [];
    while (!this.at("}")) {
      if (this.peek().kind === "eof") bail("unterminated block");
      body.push(this.parseStatement());
    }
    this.expect("}");
    return { t: "Block", body };
  }

  parseStatement(): Stmt {
    const token = this.peek();

    if (token.text === "{") return this.parseBlock();
    if (token.text === ";") {
      this.position += 1;
      return { t: "Empty" };
    }

    if (token.kind === "ident") {
      switch (token.text) {
        case "var":
        case "let":
        case "const": {
          this.position += 1;
          const declarations = this.parseDeclarators();
          this.semicolon();
          return { t: "VarDecl", declarations };
        }
        case "if": {
          this.position += 1;
          this.expect("(");
          const test = this.parseExpression();
          this.expect(")");
          const consequent = this.parseStatement();
          const alternate = this.eat("else") ? this.parseStatement() : null;
          return { t: "If", test, consequent, alternate };
        }
        case "for":
          return this.parseFor();
        case "while": {
          this.position += 1;
          this.expect("(");
          const test = this.parseExpression();
          this.expect(")");
          return { t: "While", test, body: this.parseStatement() };
        }
        case "return": {
          this.position += 1;
          const argument = this.at(";") || this.at("}") ? null : this.parseExpression();
          this.semicolon();
          return { t: "Return", argument };
        }
        case "break":
          this.position += 1;
          this.semicolon();
          return { t: "Break" };
        case "continue":
          this.position += 1;
          this.semicolon();
          return { t: "Continue" };
        case "function":
          bail("nested function declarations are not supported");
      }
    }

    const expression = this.parseExpression();
    this.semicolon();
    return { t: "ExprStmt", expression };
  }

  private parseDeclarators(): Array<{ name: string; init: Expr | null }> {
    const declarations: Array<{ name: string; init: Expr | null }> = [];
    for (;;) {
      const nameToken = this.next();
      if (nameToken.kind !== "ident") bail("expected declarator name");
      const init = this.eat("=") ? this.parseAssignment() : null;
      declarations.push({ name: nameToken.text, init });
      if (!this.eat(",")) return declarations;
    }
  }

  private parseFor(): Stmt {
    this.expect("for");
    this.expect("(");

    let init: Stmt | null = null;
    if (!this.at(";")) {
      if (this.at("var") || this.at("let") || this.at("const")) {
        this.position += 1;
        init = { t: "VarDecl", declarations: this.parseDeclarators() };
      } else {
        init = { t: "ExprStmt", expression: this.parseExpression() };
      }
    }
    this.expect(";");

    const test = this.at(";") ? null : this.parseExpression();
    this.expect(";");

    const update = this.at(")") ? null : this.parseExpression();
    this.expect(")");

    return { t: "For", init, test, update, body: this.parseStatement() };
  }

  // ── Expressions ──

  /**
   * No comma/sequence operator: it never appears in these bodies outside of
   * argument lists and declarator lists, and supporting it would make argument
   * parsing ambiguous.
   */
  parseExpression(): Expr {
    return this.parseAssignment();
  }

  private parseAssignment(): Expr {
    const left = this.parseConditional();
    const operator = this.peek().text;
    if (this.peek().kind === "punct" && ASSIGN_OPERATORS.has(operator)) {
      if (left.t !== "Ident" && left.t !== "Index" && left.t !== "Member") {
        bail("invalid assignment target");
      }
      this.position += 1;
      return { t: "Assign", op: operator, target: left, value: this.parseAssignment() };
    }
    return left;
  }

  private parseConditional(): Expr {
    const test = this.parseBinary(0);
    if (!this.eat("?")) return test;
    const consequent = this.parseAssignment();
    this.expect(":");
    return { t: "Conditional", test, consequent, alternate: this.parseAssignment() };
  }

  /** Precedence climbing. Higher number binds tighter. */
  private static readonly BINARY_PRECEDENCE: Record<string, number> = {
    "||": 1,
    "&&": 2,
    "|": 3,
    "^": 4,
    "&": 5,
    "==": 6,
    "!=": 6,
    "===": 6,
    "!==": 6,
    "<": 7,
    ">": 7,
    "<=": 7,
    ">=": 7,
    "<<": 8,
    ">>": 8,
    ">>>": 8,
    "+": 9,
    "-": 9,
    "*": 10,
    "/": 10,
    "%": 10,
  };

  private parseBinary(minPrecedence: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token.kind !== "punct") return left;
      const precedence = Parser.BINARY_PRECEDENCE[token.text];
      if (precedence === undefined || precedence < minPrecedence) return left;
      this.position += 1;
      const right = this.parseBinary(precedence + 1);
      left =
        token.text === "&&" || token.text === "||"
          ? { t: "Logical", op: token.text, left, right }
          : { t: "Binary", op: token.text, left, right };
    }
  }

  private parseUnary(): Expr {
    const token = this.peek();
    if (token.kind === "punct" && ["-", "+", "~", "!"].includes(token.text)) {
      this.position += 1;
      return { t: "Unary", op: token.text, argument: this.parseUnary() };
    }
    if (token.kind === "punct" && (token.text === "++" || token.text === "--")) {
      this.position += 1;
      return { t: "Update", op: token.text, prefix: true, argument: this.parseUnary() };
    }
    if (token.kind === "ident" && token.text === "typeof") {
      bail("typeof is not supported");
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expression = this.parsePrimary();

    for (;;) {
      if (this.eat(".")) {
        const member = this.next();
        if (member.kind !== "ident") bail("expected property name");
        expression = { t: "Member", object: expression, property: member.text };
        continue;
      }
      if (this.eat("[")) {
        const index = this.parseExpression();
        this.expect("]");
        expression = { t: "Index", object: expression, index };
        continue;
      }
      if (this.at("(")) {
        expression = { t: "Call", callee: expression, args: this.parseArguments() };
        continue;
      }
      const token = this.peek();
      if (token.kind === "punct" && (token.text === "++" || token.text === "--")) {
        this.position += 1;
        expression = { t: "Update", op: token.text, prefix: false, argument: expression };
        continue;
      }
      return expression;
    }
  }

  private parseArguments(): Expr[] {
    this.expect("(");
    const args: Expr[] = [];
    if (this.eat(")")) return args;
    for (;;) {
      args.push(this.parseAssignment());
      if (this.eat(")")) return args;
      this.expect(",");
    }
  }

  private parsePrimary(): Expr {
    const token = this.peek();

    if (token.kind === "num") {
      this.position += 1;
      const value = Number(token.text);
      if (!Number.isFinite(value)) bail(`bad number literal: ${token.text}`);
      return { t: "Num", value };
    }

    if (token.kind === "str") {
      this.position += 1;
      return { t: "Str", value: token.text };
    }

    if (token.kind === "regex") {
      this.position += 1;
      return { t: "Regex", pattern: token.text, flags: token.flags ?? "" };
    }

    if (token.text === "(") {
      this.position += 1;
      const expression = this.parseExpression();
      this.expect(")");
      return expression;
    }

    if (token.text === "[") {
      this.position += 1;
      const items: Expr[] = [];
      if (this.eat("]")) return { t: "ArrayLit", items };
      for (;;) {
        items.push(this.parseAssignment());
        if (this.eat("]")) return { t: "ArrayLit", items };
        this.expect(",");
      }
    }

    if (token.kind === "ident") {
      if (token.text === "function") {
        this.position += 1;
        // Optional name on a function expression; it is never referenced.
        if (this.peek().kind === "ident" && !this.at("(")) this.position += 1;
        const params = this.parseParams();
        const body = this.parseBlock().body;
        return { t: "Func", params, body };
      }
      this.position += 1;
      return { t: "Ident", name: token.text };
    }

    bail(`unexpected token: ${token.text || "<eof>"}`);
  }
}

// ─── Runtime values ─────────────────────────────────────────────────────────

type Callable = { kind: "closure"; params: string[]; body: Stmt[]; scope: Scope };
type Native = { kind: "native"; name: string };
type RegexValue = { kind: "regex"; pattern: string; flags: string };
type Namespace = { kind: "namespace"; name: "String" | "Math" };

type Value =
  | number
  | string
  | boolean
  | undefined
  | Value[]
  | Callable
  | Native
  | RegexValue
  | Namespace;

class Scope {
  private readonly values = new Map<string, Value>();

  constructor(private readonly parent: Scope | null = null) {}

  declare(name: string, value: Value): void {
    this.values.set(name, value);
  }

  has(name: string): boolean {
    return this.values.has(name) || (this.parent?.has(name) ?? false);
  }

  get(name: string): Value {
    if (this.values.has(name)) return this.values.get(name);
    if (this.parent) return this.parent.get(name);
    bail(`unknown identifier: ${name}`);
  }

  set(name: string, value: Value): void {
    if (this.values.has(name)) {
      this.values.set(name, value);
      return;
    }
    if (this.parent?.has(name)) {
      this.parent.set(name, value);
      return;
    }
    // Implicit global — the generated bodies sometimes assign a loop variable
    // that was only declared in an earlier sibling `var` list.
    this.values.set(name, value);
  }
}

/** Signals a `return` unwinding to the enclosing call. */
class ReturnSignal {
  constructor(readonly value: Value) {}
}
class BreakSignal {}
class ContinueSignal {}

/**
 * Only patterns that cannot backtrack are allowed through to `RegExp`. The
 * bodies use character classes and literals (`/[a-zA-Z]/g`); anything with a
 * quantifier, group, or alternation is rejected so a hostile page cannot hand
 * us a catastrophic-backtracking pattern.
 */
function compileRegex(pattern: string, flags: string): RegExp {
  if (pattern.length > 200) bail("regex pattern too long");
  if (!/^[gimsuy]*$/.test(flags)) bail(`unsupported regex flags: ${flags}`);

  // Strip character classes and escapes, then reject any remaining metacharacter.
  const skeleton = pattern.replace(/\\./g, "").replace(/\[(?:\\.|[^\]\\])*\]/g, "");
  if (/[*+?{}()|]/.test(skeleton)) bail(`unsupported regex construct: /${pattern}/`);

  try {
    return new RegExp(pattern, flags);
  } catch {
    bail(`invalid regex: /${pattern}/`);
  }
}

// ─── Interpreter ────────────────────────────────────────────────────────────

class Interpreter {
  private steps = 0;

  private tick(): void {
    this.steps += 1;
    if (this.steps > MAX_STEPS) bail("step budget exceeded");
  }

  private checkString(value: string): string {
    if (value.length > MAX_STRING_LENGTH) bail("string budget exceeded");
    return value;
  }

  // ── Statements ──

  execBlock(statements: Stmt[], scope: Scope): void {
    for (const statement of statements) this.exec(statement, scope);
  }

  private exec(statement: Stmt, scope: Scope): void {
    this.tick();

    switch (statement.t) {
      case "Empty":
        return;

      case "VarDecl":
        for (const declaration of statement.declarations) {
          scope.declare(
            declaration.name,
            declaration.init ? this.evaluate(declaration.init, scope) : undefined
          );
        }
        return;

      case "ExprStmt":
        this.evaluate(statement.expression, scope);
        return;

      case "Block":
        this.execBlock(statement.body, new Scope(scope));
        return;

      case "If":
        if (truthy(this.evaluate(statement.test, scope))) this.exec(statement.consequent, scope);
        else if (statement.alternate) this.exec(statement.alternate, scope);
        return;

      case "For": {
        const loopScope = new Scope(scope);
        if (statement.init) this.exec(statement.init, loopScope);
        for (;;) {
          this.tick();
          if (statement.test && !truthy(this.evaluate(statement.test, loopScope))) break;
          try {
            this.exec(statement.body, loopScope);
          } catch (error) {
            if (error instanceof BreakSignal) break;
            if (!(error instanceof ContinueSignal)) throw error;
          }
          if (statement.update) this.evaluate(statement.update, loopScope);
        }
        return;
      }

      case "While":
        for (;;) {
          this.tick();
          if (!truthy(this.evaluate(statement.test, scope))) break;
          try {
            this.exec(statement.body, scope);
          } catch (error) {
            if (error instanceof BreakSignal) break;
            if (!(error instanceof ContinueSignal)) throw error;
          }
        }
        return;

      case "Return":
        throw new ReturnSignal(
          statement.argument ? this.evaluate(statement.argument, scope) : undefined
        );

      case "Break":
        throw new BreakSignal();

      case "Continue":
        throw new ContinueSignal();
    }
  }

  // ── Expressions ──

  evaluate(expression: Expr, scope: Scope): Value {
    this.tick();

    switch (expression.t) {
      case "Num":
        return expression.value;

      case "Str":
        return expression.value;

      case "Regex":
        return { kind: "regex", pattern: expression.pattern, flags: expression.flags };

      case "Ident":
        return scope.get(expression.name);

      case "ArrayLit":
        return expression.items.map((item) => this.evaluate(item, scope));

      case "Func":
        return { kind: "closure", params: expression.params, body: expression.body, scope };

      case "Member":
        return this.readProperty(this.evaluate(expression.object, scope), expression.property);

      case "Index": {
        const object = this.evaluate(expression.object, scope);
        const index = this.evaluate(expression.index, scope);
        if (Array.isArray(object)) return object[toNumber(index)];
        if (typeof object === "string") return object.charAt(toNumber(index));
        return bail("index on unsupported value");
      }

      case "Call":
        return this.evaluateCall(expression, scope);

      case "Unary": {
        const value = this.evaluate(expression.argument, scope);
        switch (expression.op) {
          case "-":
            return -toNumber(value);
          case "+":
            return toNumber(value);
          case "~":
            return ~toNumber(value);
          case "!":
            return !truthy(value);
        }
        return bail(`unsupported unary operator: ${expression.op}`);
      }

      case "Update": {
        const old = toNumber(this.evaluate(expression.argument, scope));
        const updated = expression.op === "++" ? old + 1 : old - 1;
        this.assignTo(expression.argument, updated, scope);
        return expression.prefix ? updated : old;
      }

      case "Logical": {
        const left = this.evaluate(expression.left, scope);
        if (expression.op === "&&") return truthy(left) ? this.evaluate(expression.right, scope) : left;
        return truthy(left) ? left : this.evaluate(expression.right, scope);
      }

      case "Conditional":
        return truthy(this.evaluate(expression.test, scope))
          ? this.evaluate(expression.consequent, scope)
          : this.evaluate(expression.alternate, scope);

      case "Binary":
        return this.evaluateBinary(
          expression.op,
          this.evaluate(expression.left, scope),
          this.evaluate(expression.right, scope)
        );

      case "Assign": {
        if (expression.op === "=") {
          const value = this.evaluate(expression.value, scope);
          this.assignTo(expression.target, value, scope);
          return value;
        }
        const current = this.evaluate(expression.target, scope);
        const operand = this.evaluate(expression.value, scope);
        const value = this.evaluateBinary(expression.op.slice(0, -1), current, operand);
        this.assignTo(expression.target, value, scope);
        return value;
      }
    }
  }

  private evaluateBinary(op: string, left: Value, right: Value): Value {
    switch (op) {
      case "+":
        if (typeof left === "string" || typeof right === "string") {
          return this.checkString(stringify(left) + stringify(right));
        }
        return toNumber(left) + toNumber(right);
      case "-":
        return toNumber(left) - toNumber(right);
      case "*":
        return toNumber(left) * toNumber(right);
      case "/": {
        const divisor = toNumber(right);
        if (divisor === 0) bail("division by zero");
        return toNumber(left) / divisor;
      }
      case "%": {
        const divisor = toNumber(right);
        if (divisor === 0) bail("modulo by zero");
        return toNumber(left) % divisor;
      }
      case "&":
        return toNumber(left) & toNumber(right);
      case "|":
        return toNumber(left) | toNumber(right);
      case "^":
        return toNumber(left) ^ toNumber(right);
      case "<<":
        return toNumber(left) << toNumber(right);
      case ">>":
        return toNumber(left) >> toNumber(right);
      case ">>>":
        return toNumber(left) >>> toNumber(right);
      case "<":
        return compare(left, right) < 0;
      case ">":
        return compare(left, right) > 0;
      case "<=":
        return compare(left, right) <= 0;
      case ">=":
        return compare(left, right) >= 0;
      case "==":
      case "===":
        return looseEqual(left, right);
      case "!=":
      case "!==":
        return !looseEqual(left, right);
    }
    return bail(`unsupported operator: ${op}`);
  }

  private assignTo(target: Expr, value: Value, scope: Scope): void {
    if (target.t === "Ident") {
      scope.set(target.name, value);
      return;
    }
    if (target.t === "Index") {
      const object = this.evaluate(target.object, scope);
      if (!Array.isArray(object)) bail("element assignment on non-array");
      const index = toNumber(target.index ? this.evaluate(target.index, scope) : 0);
      if (!Number.isInteger(index) || index < 0 || index >= MAX_ARRAY_LENGTH) {
        bail("array index out of range");
      }
      object[index] = value;
      return;
    }
    bail("unsupported assignment target");
  }

  private readProperty(object: Value, property: string): Value {
    if (property === "length") {
      if (typeof object === "string") return object.length;
      if (Array.isArray(object)) return object.length;
      bail(".length on unsupported value");
    }
    if (isNamespace(object)) return { kind: "native", name: `${object.name}.${property}` };
    // Everything else is a method, resolved at the call site so the receiver
    // is available. Reading a method without calling it is not supported.
    bail(`unsupported property read: .${property}`);
  }

  private evaluateCall(expression: Expr & { t: "Call" }, scope: Scope): Value {
    const callee = expression.callee;

    if (callee.t === "Member") {
      const receiver = this.evaluate(callee.object, scope);
      if (isNamespace(receiver)) {
        const args = expression.args.map((argument) => this.evaluate(argument, scope));
        return this.callNamespace(receiver.name, callee.property, args);
      }
      const args = expression.args.map((argument) => this.evaluate(argument, scope));
      return this.callMethod(receiver, callee.property, args, scope);
    }

    if (callee.t === "Ident") {
      const args = expression.args.map((argument) => this.evaluate(argument, scope));
      if (!scope.has(callee.name)) bail(`unsupported call: ${callee.name}()`);
      const target = scope.get(callee.name);
      if (isNative(target)) return this.callNative(target.name, args);
      if (isClosure(target)) return this.callClosure(target, args);
      bail(`not callable: ${callee.name}`);
    }

    const target = this.evaluate(callee, scope);
    const args = expression.args.map((argument) => this.evaluate(argument, scope));
    if (isClosure(target)) return this.callClosure(target, args);
    return bail("unsupported call target");
  }

  callClosure(target: Callable, args: Value[]): Value {
    this.tick();
    const scope = new Scope(target.scope);
    target.params.forEach((name, index) => scope.declare(name, args[index]));
    try {
      this.execBlock(target.body, scope);
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value;
      throw error;
    }
    return undefined;
  }

  private callNative(name: string, args: Value[]): Value {
    switch (name) {
      case "atob":
        return this.checkString(decodeBase64Binary(stringify(args[0])));
      case "btoa":
        return this.checkString(encodeBase64Binary(stringify(args[0])));
      case "parseInt": {
        const radix = args[1] === undefined ? 10 : toNumber(args[1]);
        return parseInt(stringify(args[0]), radix);
      }
      case "Number":
        return toNumber(args[0]);
      case "String.fromCharCode":
        return this.checkString(
          String.fromCharCode(...args.map((argument) => toNumber(argument) & 0xffff))
        );
      case "Math.floor":
        return Math.floor(toNumber(args[0]));
      case "Math.ceil":
        return Math.ceil(toNumber(args[0]));
      case "Math.round":
        return Math.round(toNumber(args[0]));
      case "Math.abs":
        return Math.abs(toNumber(args[0]));
      case "Math.max":
        return Math.max(...args.map(toNumber));
      case "Math.min":
        return Math.min(...args.map(toNumber));
    }
    return bail(`unsupported call: ${name}()`);
  }

  private callNamespace(namespace: "String" | "Math", property: string, args: Value[]): Value {
    return this.callNative(`${namespace}.${property}`, args);
  }

  private callMethod(receiver: Value, method: string, args: Value[], scope: Scope): Value {
    if (typeof receiver === "string") return this.callStringMethod(receiver, method, args, scope);
    if (Array.isArray(receiver)) return this.callArrayMethod(receiver, method, args);
    if (typeof receiver === "number") {
      if (method === "toString") {
        const radix = args[0] === undefined ? 10 : toNumber(args[0]);
        return receiver.toString(radix);
      }
    }
    return bail(`unsupported method: .${method}()`);
  }

  private callStringMethod(receiver: string, method: string, args: Value[], scope: Scope): Value {
    switch (method) {
      case "charCodeAt":
        return receiver.charCodeAt(toNumber(args[0] ?? 0));
      case "charAt":
        return receiver.charAt(toNumber(args[0] ?? 0));
      case "split": {
        const separator = args[0] === undefined ? undefined : stringify(args[0]);
        const parts = separator === undefined ? [receiver] : receiver.split(separator);
        if (parts.length > MAX_ARRAY_LENGTH) bail("array budget exceeded");
        return parts;
      }
      case "slice":
        return receiver.slice(
          toNumber(args[0] ?? 0),
          args[1] === undefined ? undefined : toNumber(args[1])
        );
      case "substring":
        return receiver.substring(
          toNumber(args[0] ?? 0),
          args[1] === undefined ? undefined : toNumber(args[1])
        );
      case "substr":
        return receiver.substr(
          toNumber(args[0] ?? 0),
          args[1] === undefined ? undefined : toNumber(args[1])
        );
      case "indexOf":
        return receiver.indexOf(stringify(args[0]));
      case "lastIndexOf":
        return receiver.lastIndexOf(stringify(args[0]));
      case "toLowerCase":
        return receiver.toLowerCase();
      case "toUpperCase":
        return receiver.toUpperCase();
      case "trim":
        return receiver.trim();
      case "concat":
        return this.checkString(receiver + args.map(stringify).join(""));
      case "toString":
        return receiver;
      case "join":
        // `'abc'.join` is not real JS, but a body that reaches here has already
        // gone wrong — fail closed rather than guess.
        return bail("join on a string");
      case "replace":
        return this.checkString(this.stringReplace(receiver, args, scope));
    }
    return bail(`unsupported string method: .${method}()`);
  }

  private stringReplace(receiver: string, args: Value[], _scope: Scope): string {
    const pattern = args[0];
    const replacement = args[1];

    const replace = (matched: string): string => {
      this.tick();
      if (isClosure(replacement)) return stringify(this.callClosure(replacement, [matched]));
      if (typeof replacement === "string") {
        if (/\$[&`'0-9<]/.test(replacement)) bail("replacement patterns are not supported");
        return replacement;
      }
      return bail("unsupported replacement argument");
    };

    if (isRegex(pattern)) {
      const regex = compileRegex(pattern.pattern, pattern.flags);
      return receiver.replace(regex, (matched) => replace(matched));
    }
    if (typeof pattern === "string") {
      const index = receiver.indexOf(pattern);
      if (index === -1) return receiver;
      return receiver.slice(0, index) + replace(pattern) + receiver.slice(index + pattern.length);
    }
    return bail("unsupported replace pattern");
  }

  private callArrayMethod(receiver: Value[], method: string, args: Value[]): Value {
    switch (method) {
      case "join":
        return this.checkString(
          receiver.map((item) => (item === undefined ? "" : stringify(item))).join(
            args[0] === undefined ? "," : stringify(args[0])
          )
        );
      case "reverse":
        receiver.reverse();
        return receiver;
      case "push":
        if (receiver.length + args.length > MAX_ARRAY_LENGTH) bail("array budget exceeded");
        receiver.push(...args);
        return receiver.length;
      case "pop":
        return receiver.pop();
      case "shift":
        return receiver.shift();
      case "slice":
        return receiver.slice(
          args[0] === undefined ? undefined : toNumber(args[0]),
          args[1] === undefined ? undefined : toNumber(args[1])
        );
      case "indexOf":
        return receiver.indexOf(args[0]);
      case "concat":
        return receiver.concat(...args.map((argument) => (Array.isArray(argument) ? argument : [argument])));
    }
    return bail(`unsupported array method: .${method}()`);
  }
}

// ─── Value helpers ──────────────────────────────────────────────────────────

function isClosure(value: Value): value is Callable {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as Callable).kind === "closure";
}

function isNative(value: Value): value is Native {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as Native).kind === "native";
}

function isRegex(value: Value): value is RegexValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as RegexValue).kind === "regex";
}

function isNamespace(value: Value): value is Namespace {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && (value as Namespace).kind === "namespace"
  );
}

function stringify(value: Value): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return value.map(stringify).join(",");
  return bail("cannot stringify value");
}

function toNumber(value: Value): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const numeric = value === "" ? 0 : Number(value);
    if (!Number.isFinite(numeric)) bail("non-numeric operand");
    return numeric;
  }
  return bail("non-numeric operand");
}

function truthy(value: Value): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") return value.length > 0;
  if (value === undefined) return false;
  return true;
}

function compare(left: Value, right: Value): number {
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  const a = toNumber(left);
  const b = toNumber(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function looseEqual(left: Value, right: Value): boolean {
  if (typeof left === typeof right) return left === right;
  if (left === undefined || right === undefined) return false;
  if (typeof left === "string" && typeof right === "number") return toNumber(left) === right;
  if (typeof left === "number" && typeof right === "string") return left === toNumber(right);
  return left === right;
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Execute a live decoder body against its parts array.
 *
 * `functionSource` must be the whole `function name(parts) { … }` text as it
 * appears on the embed page. Returns the decoded string, or null when the body
 * uses anything outside the supported subset — callers should then fall back
 * to the static schemes rather than treat null as "no stream".
 */
export function runRapidrameDecoder(functionSource: string, valueParts: string[]): string | null {
  try {
    const declaration = new Parser(tokenize(functionSource)).parseFunctionDeclaration();

    const globals = new Scope(null);
    for (const name of ["atob", "btoa", "parseInt", "Number"]) {
      globals.declare(name, { kind: "native", name });
    }
    globals.declare("String", { kind: "namespace", name: "String" });
    globals.declare("Math", { kind: "namespace", name: "Math" });
    globals.declare("undefined", undefined);

    const interpreter = new Interpreter();
    const result = interpreter.callClosure(
      { kind: "closure", params: declaration.params, body: declaration.body, scope: globals },
      [valueParts.slice()]
    );

    return typeof result === "string" ? result : null;
  } catch {
    // UnsupportedScript, or any parse slip — fail closed.
    return null;
  }
}
