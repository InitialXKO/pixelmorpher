// ============================================================
// PixelMorpher - Formula Evaluator（程序化动画「公式」类型）
// 小型递归下降解析器，严禁 eval / new Function。语法规格与
// proc-runtime/dynamic-src.ts 的 dynFormulaValue 逐行孪生，两端
// 逐值一致（探针逐帧对拍）。
//
// 变量（由调用方按条目帧范围算好后传入）：
//   f = 局部帧（frame − startFrame，≥0）  F = 全局帧（frame）
//   p = 条目进度（(frame − startFrame)/(endFrame − startFrame)
//       钳 [0,1]；endFrame ≤ startFrame 时为 0）
// 语法：数字（整数/小数）、常量 pi、二元运算 + - * / % ^
// （^ 为幂、右结合；优先级 ^ > * / % > + -）、一元负号、括号、
// 函数 sin cos tan abs sqrt exp log（单参）与 pow min max
// （双参，逗号分隔）。表达式长度上限 200 字符、括号/函数调用
// 嵌套上限 32 层。解析错误（未知标识符/函数、括号不配对等）
// 或结果非有限（NaN/Infinity，如除以零）一律取值 0、不抛异常。
// ============================================================

const MAX_LENGTH = 200;
const MAX_DEPTH = 32;

const UNARY_FNS: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  sqrt: Math.sqrt,
  exp: Math.exp,
  log: Math.log,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

const BINARY_FNS: Record<string, (a: number, b: number) => number> = {
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
};

const hasOwn = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

interface FormulaState {
  src: string;
  pos: number;
  depth: number;
  f: number;
  F: number;
  p: number;
}

function errAt(st: FormulaState, msg: string): Error {
  return new Error(`第 ${st.pos + 1} 个字符处：${msg}`);
}

function skipWs(st: FormulaState): void {
  while (st.pos < st.src.length) {
    const c = st.src.charCodeAt(st.pos);
    if (c === 32 || c === 9 || c === 10 || c === 13) st.pos++;
    else break;
  }
}

/** 当前字符（先跳空白）；已到结尾回 '' */
function peek(st: FormulaState): string {
  skipWs(st);
  return st.pos < st.src.length ? st.src[st.pos] : '';
}

// expr := term (('+' | '-') term)*
function parseExpr(st: FormulaState): number {
  let v = parseTerm(st);
  for (;;) {
    const c = peek(st);
    if (c === '+') { st.pos++; v = v + parseTerm(st); }
    else if (c === '-') { st.pos++; v = v - parseTerm(st); }
    else return v;
  }
}

// term := unary (('*' | '/' | '%') unary)*
function parseTerm(st: FormulaState): number {
  let v = parseUnary(st);
  for (;;) {
    const c = peek(st);
    if (c === '*') { st.pos++; v = v * parseUnary(st); }
    else if (c === '/') { st.pos++; v = v / parseUnary(st); }
    else if (c === '%') { st.pos++; v = v % parseUnary(st); }
    else return v;
  }
}

// unary := '-' unary | power（一元负号比 ^ 松：-2^2 = -(2^2)）
function parseUnary(st: FormulaState): number {
  if (peek(st) === '-') { st.pos++; return -parseUnary(st); }
  return parsePower(st);
}

// power := primary ('^' unary)?（指数走 unary → ^ 右结合、容 2^-3）
function parsePower(st: FormulaState): number {
  const base = parsePrimary(st);
  if (peek(st) === '^') {
    st.pos++;
    return Math.pow(base, parseUnary(st));
  }
  return base;
}

function parsePrimary(st: FormulaState): number {
  const c = peek(st);
  if (c === '') throw errAt(st, '表达式不完整');
  if (c === ')' || c === ',') throw errAt(st, '这里缺一个数或子表达式');
  if (c === '(') {
    st.pos++;
    st.depth++;
    if (st.depth > MAX_DEPTH) throw errAt(st, `嵌套超过 ${MAX_DEPTH} 层上限`);
    const v = parseExpr(st);
    if (peek(st) !== ')') throw errAt(st, '括号不配对，缺「)」');
    st.pos++;
    st.depth--;
    return v;
  }
  const code = st.src.charCodeAt(st.pos);
  if ((code >= 48 && code <= 57) || c === '.') {
    const start = st.pos;
    let dot = false;
    let digit = false;
    while (st.pos < st.src.length) {
      const d = st.src[st.pos];
      if (d >= '0' && d <= '9') { digit = true; st.pos++; }
      else if (d === '.') { if (dot) break; dot = true; st.pos++; }
      else break;
    }
    if (!digit) throw errAt(st, '数字格式不对');
    return parseFloat(st.src.slice(start, st.pos));
  }
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || c === '_') {
    const start = st.pos;
    while (st.pos < st.src.length) {
      const d = st.src.charCodeAt(st.pos);
      if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 95) st.pos++;
      else break;
    }
    const name = st.src.slice(start, st.pos);
    if (peek(st) === '(') {
      const unary = hasOwn(UNARY_FNS, name) ? UNARY_FNS[name] : undefined;
      const binary = hasOwn(BINARY_FNS, name) ? BINARY_FNS[name] : undefined;
      if (!unary && !binary) throw errAt(st, `未知函数「${name}」`);
      st.pos++;
      st.depth++;
      if (st.depth > MAX_DEPTH) throw errAt(st, `嵌套超过 ${MAX_DEPTH} 层上限`);
      const args: number[] = [parseExpr(st)];
      while (peek(st) === ',') { st.pos++; args.push(parseExpr(st)); }
      if (peek(st) !== ')') throw errAt(st, '括号不配对，缺「)」');
      st.pos++;
      st.depth--;
      const need = unary ? 1 : 2;
      if (args.length !== need) {
        throw errAt(st, `函数「${name}」需要 ${need} 个参数，实际 ${args.length} 个`);
      }
      return unary ? unary(args[0]) : binary!(args[0], args[1]);
    }
    if (name === 'f') return st.f;
    if (name === 'F') return st.F;
    if (name === 'p') return st.p;
    if (name === 'pi') return Math.PI;
    if (hasOwn(UNARY_FNS, name) || hasOwn(BINARY_FNS, name)) {
      throw errAt(st, `函数「${name}」后面要带括号和参数`);
    }
    throw errAt(st, `未知变量「${name}」`);
  }
  throw errAt(st, `无法识别的字符「${c}」`);
}

function parseFormula(src: string, f: number, F: number, p: number): number {
  const st: FormulaState = { src, pos: 0, depth: 0, f, F, p };
  const v = parseExpr(st);
  if (peek(st) !== '') throw errAt(st, '后面多出了无法识别的内容');
  return v;
}

/**
 * 公式取值：解析或求值出任何问题（语法错误、除零等非有限结果）
 * 都回 0，不抛异常——坏公式在画布与包里的表现都是「不出增量」。
 */
export function evaluateFormula(expression: string, f: number, F: number, p: number): number {
  if (typeof expression !== 'string' || expression.length > MAX_LENGTH) return 0;
  try {
    const v = parseFormula(expression, f, F, p);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/** 面板即时校验：只查语法（长度/括号/标识符/参数个数），不查取值 */
export function validateFormula(expression: string): { ok: boolean; error?: string } {
  if (typeof expression !== 'string' || expression.trim() === '') {
    return { ok: false, error: '公式为空' };
  }
  if (expression.length > MAX_LENGTH) {
    return { ok: false, error: `公式超过 ${MAX_LENGTH} 字符上限` };
  }
  try {
    parseFormula(expression, 0, 0, 0);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '公式无法解析' };
  }
}
