/**
 * rapidrameScript — a tiny interpreter for HDFilmCehennemi's `dc_*()` decoder.
 *
 * WHY AN INTERPRETER AND NOT A LIST OF SCHEMES
 * --------------------------------------------
 * HDFilm hides the stream URL in an obfuscated `s_* = dc_xxx([...])` parts
 * array on the embed page. The `dc_*()` body is generated fresh on EVERY
 * request: the function name, the number and order of the pre-passes
 * (reverse / atob / caesar), the caesar shifts, and the final byte de-scramble
 * all change per load. Matching it against a fixed list of transforms is a
 * losing game — the list went stale twice, and each time every HDFilm title
 * silently fell through to the WebView player (or to a lower-priority
 * provider with Turkish-only audio).
 *
 * The saving grace is that the generated body is plain, un-minified JS drawn
 * from a very small vocabulary. So instead of guessing the scheme we READ it:
 * this module parses the live function body and replays it. A rotation of any
 * constant — or a swap of the whole de-scramble family, which is what happened
 * in Aug 2026 when the arithmetic `c - (CONST % (i + N))` unmix became a
 * rolling-XOR cipher — now costs zero releases.
 *
 * Two de-scramble families seen in the wild, both handled by the same
 * statement interpreter with no special-casing:
 *
 *   arithmetic (legacy)      rolling XOR (current)
 *   ------------------       ---------------------
 *   var c = s.charCodeAt(i)  var b = s.charCodeAt(i)
 *   c = (c - (K % (i+N)))    acc = (acc + K) % 256
 *       ...                  var plain = b ^ acc
 *   out += fromCharCode(c)   acc = (acc + b) % 256
 *                            out += fromCharCode(plain)
 *
 * Nothing here uses eval/Function — Hermes has no eval, and running provider
 * JS would be a code-execution sink besides. The evaluator understands only
 * arithmetic/bitwise operators plus `String.fromCharCode` and `charCodeAt`,
 * so a body doing anything else fails closed (returns null) and the caller
 * falls back to the static schemes.
 */

// ─── Value model ────────────────────────────────────────────────────────────
// The provider's decoders only ever move numbers and strings around.
type Value = number | string;
type Env = Map<string, Value>;

/** Thrown internally whenever the body steps outside the supported subset. */
class UnsupportedScript extends Error {}

function bail(reason: string): never {
  throw new UnsupportedScript(reason);
}

// Iteration ceiling. A real stream URL is a few hundred bytes; anything past
// this is either a parse mistake or a hostile page trying to hang the resolver.
const MAX_LOOP_ITERATIONS = 200_000;

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

// ─── Expression parser + evaluator ──────────────────────────────────────────

type Token = { kind: "num" | "str" | "ident" | "punct"; text: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9]/.test(char)) {
      let text = "";
      // 0x… shows up in `& 0xff` masks.
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

    if (char === "'" || char === '"') {
      const quote = char;
      let text = "";
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          text += source[index + 1] ?? "";
          index += 2;
          continue;
        }
        text += source[index];
        index += 1;
      }
      index += 1; // closing quote
      tokens.push({ kind: "str", text });
      continue;
    }

    // Multi-char operators, longest first.
    const three = source.slice(index, index + 3);
    const two = source.slice(index, index + 2);
    if (three === ">>>") {
      tokens.push({ kind: "punct", text: three });
      index += 3;
      continue;
    }
    if (two === "<<" || two === ">>") {
      tokens.push({ kind: "punct", text: two });
      index += 2;
      continue;
    }

    tokens.push({ kind: "punct", text: char });
    index += 1;
  }

  return tokens;
}

/**
 * Recursive-descent evaluator over the token stream. Precedence follows JS:
 * `|` < `^` < `&` < shift < additive < multiplicative < unary < primary.
 * Evaluating during the parse is fine here — the grammar has no control flow,
 * so there is nothing to short-circuit.
 */
class ExpressionEvaluator {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly env: Env
  ) {}

  static evaluate(source: string, env: Env): Value {
    const evaluator = new ExpressionEvaluator(tokenize(source), env);
    const value = evaluator.parseBitOr();
    if (evaluator.position !== evaluator.tokens.length) {
      bail(`trailing tokens in expression: ${source}`);
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private eat(text: string): boolean {
    if (this.peek()?.text === text) {
      this.position += 1;
      return true;
    }
    return false;
  }

  private expect(text: string): void {
    if (!this.eat(text)) bail(`expected "${text}"`);
  }

  private toNumber(value: Value): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) bail("non-numeric operand");
    return numeric;
  }

  private parseBitOr(): Value {
    let left = this.parseBitXor();
    while (this.peek()?.text === "|") {
      this.position += 1;
      left = this.toNumber(left) | this.toNumber(this.parseBitXor());
    }
    return left;
  }

  private parseBitXor(): Value {
    let left = this.parseBitAnd();
    while (this.peek()?.text === "^") {
      this.position += 1;
      left = this.toNumber(left) ^ this.toNumber(this.parseBitAnd());
    }
    return left;
  }

  private parseBitAnd(): Value {
    let left = this.parseShift();
    while (this.peek()?.text === "&") {
      this.position += 1;
      left = this.toNumber(left) & this.toNumber(this.parseShift());
    }
    return left;
  }

  private parseShift(): Value {
    let left = this.parseAdditive();
    for (;;) {
      const op = this.peek()?.text;
      if (op !== "<<" && op !== ">>" && op !== ">>>") return left;
      this.position += 1;
      const right = this.toNumber(this.parseAdditive());
      const leftNumber = this.toNumber(left);
      left = op === "<<" ? leftNumber << right : op === ">>" ? leftNumber >> right : leftNumber >>> right;
    }
  }

  private parseAdditive(): Value {
    let left = this.parseMultiplicative();
    for (;;) {
      const op = this.peek()?.text;
      if (op !== "+" && op !== "-") return left;
      this.position += 1;
      const right = this.parseMultiplicative();
      if (op === "+") {
        // `out += String.fromCharCode(x)` relies on string concatenation.
        left =
          typeof left === "string" || typeof right === "string"
            ? String(left) + String(right)
            : this.toNumber(left) + this.toNumber(right);
      } else {
        left = this.toNumber(left) - this.toNumber(right);
      }
    }
  }

  private parseMultiplicative(): Value {
    let left = this.parseUnary();
    for (;;) {
      const op = this.peek()?.text;
      if (op !== "*" && op !== "/" && op !== "%") return left;
      this.position += 1;
      const right = this.toNumber(this.parseUnary());
      const leftNumber = this.toNumber(left);
      if ((op === "/" || op === "%") && right === 0) bail("division by zero");
      left = op === "*" ? leftNumber * right : op === "/" ? leftNumber / right : leftNumber % right;
    }
  }

  private parseUnary(): Value {
    const op = this.peek()?.text;
    if (op === "-" || op === "+" || op === "~") {
      this.position += 1;
      const operand = this.toNumber(this.parseUnary());
      return op === "-" ? -operand : op === "+" ? operand : ~operand;
    }
    return this.parsePrimary();
  }

  private parseArguments(): Value[] {
    this.expect("(");
    const args: Value[] = [];
    if (this.eat(")")) return args;
    for (;;) {
      args.push(this.parseBitOr());
      if (this.eat(")")) return args;
      this.expect(",");
    }
  }

  private parsePrimary(): Value {
    const token = this.peek();
    if (!token) bail("unexpected end of expression");

    if (token.kind === "num") {
      this.position += 1;
      const value = Number(token.text);
      if (!Number.isFinite(value)) bail(`bad number literal: ${token.text}`);
      return value;
    }

    if (token.kind === "str") {
      this.position += 1;
      return token.text;
    }

    if (token.text === "(") {
      this.position += 1;
      const value = this.parseBitOr();
      this.expect(")");
      return value;
    }

    if (token.kind !== "ident") bail(`unexpected token: ${token.text}`);
    this.position += 1;
    const name = token.text;

    // Method call — `x.charCodeAt(i)`, `String.fromCharCode(c)`, `x.charAt(i)`.
    if (this.peek()?.text === ".") {
      this.position += 1;
      const member = this.peek();
      if (member?.kind !== "ident") bail("expected member name");
      this.position += 1;

      if (this.peek()?.text !== "(") {
        // Property read — only `.length` is meaningful here.
        if (member.text !== "length") bail(`unsupported property: .${member.text}`);
        const target = this.env.get(name);
        if (typeof target !== "string") bail(`.length on non-string ${name}`);
        return target.length;
      }

      const args = this.parseArguments();

      if (name === "String" && member.text === "fromCharCode") {
        return String.fromCharCode(...args.map((arg) => this.toNumber(arg) & 0xff));
      }

      const target = this.env.get(name);
      if (typeof target !== "string") bail(`method call on non-string ${name}`);
      const index = args.length > 0 ? this.toNumber(args[0]) : 0;
      if (member.text === "charCodeAt") return target.charCodeAt(index);
      if (member.text === "charAt") return target.charAt(index);
      bail(`unsupported method: .${member.text}`);
    }

    if (this.peek()?.text === "(") bail(`unsupported call: ${name}(...)`);

    const value = this.env.get(name);
    if (value === undefined) bail(`unknown identifier: ${name}`);
    return value;
  }
}

// ─── Statement splitting ────────────────────────────────────────────────────

/**
 * Split on `;` at nesting depth 0 only. Depth tracking matters: the caesar
 * pre-pass is written as `.replace(/../g, function (c) { …; … })`, so a naive
 * split would tear that callback into fragments.
 */
function splitStatements(source: string): string[] {
  const statements: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;
  let inRegex = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];

    if (quote) {
      current += char;
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }

    if (inRegex) {
      current += char;
      if (char === "/" && previous !== "\\") inRegex = false;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    // A `/` that starts a regex literal always follows `(` or `,` in these
    // bodies (`.replace(/[a-zA-Z]/g, …)`), never a value — so this is
    // unambiguous without full expression context.
    if (char === "/" && /[(,=:]\s*$/.test(current)) {
      inRegex = true;
      current += char;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;

    if (char === ";" && depth === 0) {
      statements.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements.filter((statement) => statement.length > 0);
}

/** Strip `//` line comments (the generated bodies carry Turkish ones). */
function stripComments(source: string): string {
  return source.replace(/^[ \t]*\/\/[^\n]*$/gm, "");
}

// ─── String pre-pass detection ──────────────────────────────────────────────

type StringOp = { at: number; depth: number; apply: (value: string) => string };

/**
 * Collect the string transforms a head statement applies, ordered the way JS
 * would evaluate them: deepest nesting first (`atob(x.reverse())` reverses
 * before decoding), then left-to-right within the same depth (a `.a().b()`
 * chain runs a then b).
 */
/**
 * Every call the provider's string pre-passes are allowed to make. Anything
 * else means the body does something we do not model, and silently skipping it
 * would yield a WRONG url rather than no url — so an unknown call must fail the
 * whole decode and let the caller fall back.
 */
const ALLOWED_HEAD_CALLS = new Set([
  "join",
  "split",
  "reverse",
  "atob",
  "btoa",
  "replace",
  "charCodeAt",
  "charAt",
  "fromCharCode",
  "String",
  "function",
  "return",
  "var",
  "if",
]);

function assertOnlyKnownCalls(rhs: string): void {
  for (const match of rhs.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!ALLOWED_HEAD_CALLS.has(match[1])) {
      bail(`unsupported call in pre-pass: ${match[1]}()`);
    }
  }
}

function collectStringOps(rhs: string): StringOp[] {
  const depths = new Array<number>(rhs.length).fill(0);
  let depth = 0;
  for (let index = 0; index < rhs.length; index += 1) {
    depths[index] = depth;
    const char = rhs[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
  }

  const ops: StringOp[] = [];

  for (const match of rhs.matchAll(/\.reverse\s*\(\s*\)/g)) {
    const at = match.index ?? 0;
    ops.push({ at, depth: depths[at] ?? 0, apply: reverseString });
  }

  for (const match of rhs.matchAll(/\batob\s*\(/g)) {
    const at = match.index ?? 0;
    ops.push({ at, depth: depths[at] ?? 0, apply: decodeBase64Binary });
  }

  // Caesar: `.replace(/[a-zA-Z]/g, function (c) { … (o - base + 15) % 26 + base … })`.
  // Anchor on `.replace(` so the recorded position is the call itself, not the
  // shift constant buried inside the callback.
  for (const match of rhs.matchAll(/\.replace\s*\(/g)) {
    const at = match.index ?? 0;
    const tail = rhs.slice(at, at + 400);
    const shiftMatch = tail.match(/\+\s*(\d+)\s*\)\s*%\s*26\b/);
    if (!shiftMatch) continue;
    const shift = Number(shiftMatch[1]);
    if (!Number.isFinite(shift)) continue;
    ops.push({ at, depth: depths[at] ?? 0, apply: (value) => caesarShift(value, shift) });
  }

  return ops.sort((left, right) => right.depth - left.depth || left.at - right.at);
}

// ─── Loop header ────────────────────────────────────────────────────────────

type LoopHeader = { indexName: string; start: number; limitVar: string; step: number };

function parseLoopHeader(header: string): LoopHeader {
  const parts = splitStatements(header);
  if (parts.length < 3) bail("unsupported for-header shape");

  const init = parts[0].match(/^(?:var|let|const)?\s*([A-Za-z_$][\w$]*)\s*=\s*(\d+)$/);
  if (!init) bail("unsupported loop init");

  const condition = parts[1].match(/^([A-Za-z_$][\w$]*)\s*<\s*([A-Za-z_$][\w$]*)\.length$/);
  if (!condition) bail("unsupported loop condition");

  const update = parts[2].trim();
  const indexName = init[1];
  const incrementsIndex =
    update === `${indexName}++` ||
    update === `++${indexName}` ||
    new RegExp(`^${indexName}\\s*\\+=\\s*1$`).test(update) ||
    new RegExp(`^${indexName}\\s*=\\s*${indexName}\\s*\\+\\s*1$`).test(update);
  if (!incrementsIndex) bail("unsupported loop update");
  if (condition[1] !== indexName) bail("loop condition uses a different variable");

  return { indexName, start: Number(init[2]), limitVar: condition[2], step: 1 };
}

// ─── Statement execution ────────────────────────────────────────────────────

function runAssignment(statement: string, env: Env): boolean {
  const match = statement.match(/^(?:(?:var|let|const)\s+)?([A-Za-z_$][\w$]*)\s*(\+?=)\s*([\s\S]+)$/);
  if (!match) return false;

  const [, name, operator, rhs] = match;
  const value = ExpressionEvaluator.evaluate(rhs, env);

  if (operator === "+=") {
    const previous = env.get(name);
    if (previous === undefined) bail(`+= on undeclared ${name}`);
    env.set(
      name,
      typeof previous === "string" || typeof value === "string"
        ? String(previous) + String(value)
        : (previous as number) + (value as number)
    );
    return true;
  }

  env.set(name, value);
  return true;
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Execute a live `dc_*()` decoder body against its parts array.
 *
 * `functionSource` must be the whole `function dc_xxx(parts) { … }` text as it
 * appears on the embed page. Returns the decoded string, or null when the body
 * uses anything outside the supported subset — callers should then fall back
 * to the static schemes rather than treat null as "no stream".
 */
export function runRapidrameDecoder(functionSource: string, valueParts: string[]): string | null {
  try {
    return execute(functionSource, valueParts);
  } catch {
    // UnsupportedScript, or any parse slip — fail closed.
    return null;
  }
}

function execute(functionSource: string, valueParts: string[]): string | null {
  const source = stripComments(functionSource);

  const signature = source.match(/function\s+[A-Za-z_$][\w$]*\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/);
  if (!signature) bail("no function signature");
  const partsName = signature[1];

  const braceStart = source.indexOf("{", signature.index ?? 0);
  if (braceStart === -1) bail("no function body");

  let depth = 0;
  let braceEnd = -1;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        braceEnd = index;
        break;
      }
    }
  }
  if (braceEnd === -1) bail("unbalanced function body");

  const body = source.slice(braceStart + 1, braceEnd);

  const loopStart = body.search(/\bfor\s*\(/);
  if (loopStart === -1) bail("no de-scramble loop");

  const env: Env = new Map();
  // The parts array is only ever consumed as `parts.join('')`, so seed the
  // environment with the joined string and treat `.join('')` as identity.
  env.set(partsName, valueParts.join(""));

  runHead(body.slice(0, loopStart), env, partsName);

  const headerStart = body.indexOf("(", loopStart);
  let headerDepth = 0;
  let headerEnd = -1;
  for (let index = headerStart; index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") headerDepth += 1;
    else if (char === ")") {
      headerDepth -= 1;
      if (headerDepth === 0) {
        headerEnd = index;
        break;
      }
    }
  }
  if (headerEnd === -1) bail("unbalanced for-header");

  const header = parseLoopHeader(body.slice(headerStart + 1, headerEnd));

  const loopBraceStart = body.indexOf("{", headerEnd);
  if (loopBraceStart === -1) bail("loop body must be a block");
  let loopDepth = 0;
  let loopBraceEnd = -1;
  for (let index = loopBraceStart; index < body.length; index += 1) {
    const char = body[index];
    if (char === "{") loopDepth += 1;
    else if (char === "}") {
      loopDepth -= 1;
      if (loopDepth === 0) {
        loopBraceEnd = index;
        break;
      }
    }
  }
  if (loopBraceEnd === -1) bail("unbalanced loop body");

  const loopStatements = splitStatements(body.slice(loopBraceStart + 1, loopBraceEnd));

  const limit = env.get(header.limitVar);
  if (typeof limit !== "string") bail(`loop bound ${header.limitVar} is not a string`);
  if (limit.length > MAX_LOOP_ITERATIONS) bail("loop bound too large");

  for (let index = header.start; index < limit.length; index += header.step) {
    env.set(header.indexName, index);
    for (const statement of loopStatements) {
      if (!runAssignment(statement, env)) bail(`unsupported loop statement: ${statement}`);
    }
  }

  const returned = body.slice(loopBraceEnd).match(/\breturn\s+([A-Za-z_$][\w$]*)\s*;?/);
  if (!returned) bail("no return statement");

  const result = env.get(returned[1]);
  return typeof result === "string" ? result : null;
}

/**
 * Run the statements before the de-scramble loop: the `parts.join('')` seed,
 * the string pre-passes, and any numeric constants the loop reads (the XOR
 * accumulator seed lives here).
 */
function runHead(head: string, env: Env, partsName: string): void {
  for (const statement of splitStatements(head)) {
    const match = statement.match(/^(?:(?:var|let|const)\s+)?([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/);
    if (!match) bail(`unsupported head statement: ${statement}`);
    const [, name, rhs] = match;

    const numeric = rhs.match(/^-?\d+$/);
    if (numeric) {
      env.set(name, Number(numeric[0]));
      continue;
    }

    if (/^(''|"")$/.test(rhs.trim())) {
      env.set(name, "");
      continue;
    }

    assertOnlyKnownCalls(rhs);

    // Find the string this statement reads from. `.join('')`, `.split('')` and
    // the regex/callback literals are noise; the first identifier that names a
    // known string is the input.
    const source = [...rhs.matchAll(/[A-Za-z_$][\w$]*/g)]
      .map((identifier) => identifier[0])
      .find((identifier) => typeof env.get(identifier) === "string");
    if (source === undefined) bail(`no string source in: ${statement}`);

    let value = env.get(source) as string;
    for (const op of collectStringOps(rhs)) {
      value = op.apply(value);
    }
    env.set(name, value);
  }

  if (typeof env.get(partsName) !== "string") bail("parts variable was clobbered");
}
