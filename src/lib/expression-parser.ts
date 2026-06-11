// ============================================================
// PixelMorpher - Safe Math Expression Parser & Sandbox
// ============================================================
//
// A safe recursive descent parser for math expressions.
// NO eval(), NO Function(), NO access to DOM or globals.
// All functions and variables must be explicitly provided.
//
// Supported:
//   - Math functions: sin, cos, tan, abs, sqrt, pow, exp, log,
//     floor, ceil, round, min, max, clamp, lerp
//   - Math constants: PI, E, TAU (provided via vars)
//   - Variables: t, f, period, phase, amplitude, fps, totalFrames, etc.
//   - Operators: + - * / % ** (power)
//   - Comparison: < > <= >= == !=
//   - Logical: && || !
//   - Ternary: condition ? value_if_true : value_if_false
//   - Parentheses for grouping
// ============================================================

// ---- Token Types ----

type TokenType = 'number' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'question' | 'colon' | 'eof';

interface Token {
  type: TokenType;
  value: string;
}

// ---- Tokenizer ----

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Numbers (integer and decimal)
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        num += expr[i];
        i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Identifiers (variables and function names)
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let ident = '';
      while (i < expr.length && ((expr[i] >= 'a' && expr[i] <= 'z') || (expr[i] >= 'A' && expr[i] <= 'Z') || (expr[i] >= '0' && expr[i] <= '9') || expr[i] === '_')) {
        ident += expr[i];
        i++;
      }
      tokens.push({ type: 'ident', value: ident });
      continue;
    }

    // Two-character operators
    if (i + 1 < expr.length) {
      const two = expr[i] + expr[i + 1];
      if (two === '**' || two === '<=' || two === '>=' || two === '==' || two === '!=' || two === '&&' || two === '||') {
        tokens.push({ type: 'op', value: two });
        i += 2;
        continue;
      }
    }

    // Single-character operators and punctuation
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '<' || ch === '>' || ch === '!') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    if (ch === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma', value: ',' }); i++; continue; }
    if (ch === '?') { tokens.push({ type: 'question', value: '?' }); i++; continue; }
    if (ch === ':') { tokens.push({ type: 'colon', value: ':' }); i++; continue; }

    // Unknown character — skip (graceful degradation)
    i++;
  }

  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

// ---- AST Node Types ----

type ASTNode =
  | { type: 'number'; value: number }
  | { type: 'variable'; name: string }
  | { type: 'unary'; op: string; operand: ASTNode }
  | { type: 'binary'; op: string; left: ASTNode; right: ASTNode }
  | { type: 'call'; name: string; args: ASTNode[] }
  | { type: 'ternary'; condition: ASTNode; ifTrue: ASTNode; ifFalse: ASTNode };

// ---- Parser (Recursive Descent) ----
//
// Operator precedence (lowest to highest):
//   1. Ternary: ? :
//   2. Logical OR: ||
//   3. Logical AND: &&
//   4. Equality: == !=
//   5. Comparison: < > <= >=
//   6. Addition: + -
//   7. Multiplication: * / %
//   8. Power: **
//   9. Unary: - !
//  10. Primary: number, variable, function call, (expr)

class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: 'eof', value: '' };
  }

  private advance(): Token {
    const token = this.tokens[this.pos] || { type: 'eof', value: '' };
    this.pos++;
    return token;
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.advance();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new ParseError(`Expected ${type}${value ? ` '${value}'` : ''} but got ${token.type} '${token.value}'`);
    }
    return token;
  }

  parse(): ASTNode {
    const ast = this.parseTernary();
    if (this.peek().type !== 'eof') {
      throw new ParseError(`Unexpected token: '${this.peek().value}'`);
    }
    return ast;
  }

  // Level 1: Ternary (right-to-left)
  private parseTernary(): ASTNode {
    let left = this.parseLogicalOr();

    if (this.peek().type === 'question') {
      this.advance(); // consume '?'
      const ifTrue = this.parseTernary();
      this.expect('colon');
      const ifFalse = this.parseTernary();
      return { type: 'ternary', condition: left, ifTrue, ifFalse };
    }

    return left;
  }

  // Level 2: Logical OR
  private parseLogicalOr(): ASTNode {
    let left = this.parseLogicalAnd();
    while (this.peek().type === 'op' && this.peek().value === '||') {
      this.advance();
      const right = this.parseLogicalAnd();
      left = { type: 'binary', op: '||', left, right };
    }
    return left;
  }

  // Level 3: Logical AND
  private parseLogicalAnd(): ASTNode {
    let left = this.parseEquality();
    while (this.peek().type === 'op' && this.peek().value === '&&') {
      this.advance();
      const right = this.parseEquality();
      left = { type: 'binary', op: '&&', left, right };
    }
    return left;
  }

  // Level 4: Equality
  private parseEquality(): ASTNode {
    let left = this.parseComparison();
    while (this.peek().type === 'op' && (this.peek().value === '==' || this.peek().value === '!=')) {
      const op = this.advance().value;
      const right = this.parseComparison();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // Level 5: Comparison
  private parseComparison(): ASTNode {
    let left = this.parseAddition();
    while (this.peek().type === 'op' && (this.peek().value === '<' || this.peek().value === '>' || this.peek().value === '<=' || this.peek().value === '>=')) {
      const op = this.advance().value;
      const right = this.parseAddition();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // Level 6: Addition
  private parseAddition(): ASTNode {
    let left = this.parseMultiplication();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value;
      const right = this.parseMultiplication();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // Level 7: Multiplication
  private parseMultiplication(): ASTNode {
    let left = this.parsePower();
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')) {
      const op = this.advance().value;
      const right = this.parsePower();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // Level 8: Power (right-to-left)
  private parsePower(): ASTNode {
    let base = this.parseUnary();
    if (this.peek().type === 'op' && this.peek().value === '**') {
      this.advance();
      const exponent = this.parsePower(); // right-to-left associativity
      return { type: 'binary', op: '**', left: base, right: exponent };
    }
    return base;
  }

  // Level 9: Unary
  private parseUnary(): ASTNode {
    if (this.peek().type === 'op' && this.peek().value === '-') {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'unary', op: '-', operand };
    }
    if (this.peek().type === 'op' && this.peek().value === '!') {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'unary', op: '!', operand };
    }
    return this.parsePrimary();
  }

  // Level 10: Primary
  private parsePrimary(): ASTNode {
    const token = this.peek();

    // Number literal
    if (token.type === 'number') {
      this.advance();
      return { type: 'number', value: parseFloat(token.value) };
    }

    // Identifier (variable or function call)
    if (token.type === 'ident') {
      this.advance();
      const name = token.value;

      // Function call?
      if (this.peek().type === 'lparen') {
        this.advance(); // consume '('
        const args: ASTNode[] = [];

        if (this.peek().type !== 'rparen') {
          args.push(this.parseTernary());
          while (this.peek().type === 'comma') {
            this.advance(); // consume ','
            args.push(this.parseTernary());
          }
        }

        this.expect('rparen');
        return { type: 'call', name, args };
      }

      // Variable
      return { type: 'variable', name };
    }

    // Parenthesized expression
    if (token.type === 'lparen') {
      this.advance(); // consume '('
      const expr = this.parseTernary();
      this.expect('rparen');
      return expr;
    }

    throw new ParseError(`Unexpected token: ${token.type} '${token.value}'`);
  }
}

// ---- Evaluator ----

/** Allowed math functions — explicitly whitelisted for safety */
const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  sqrt: (x) => Math.sqrt(Math.max(0, x)), // safe: clamp negative to 0
  pow: Math.pow,
  exp: Math.exp,
  log: (x) => (x > 0 ? Math.log(x) : 0), // safe: return 0 for non-positive
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  clamp: (value, min, max) => Math.min(Math.max(value, min), max),
  lerp: (a, b, t) => a + (b - a) * t,
};

function evaluate(ast: ASTNode, vars: Record<string, number>): number {
  switch (ast.type) {
    case 'number':
      return ast.value;

    case 'variable': {
      if (ast.name in vars) {
        return vars[ast.name];
      }
      throw new ParseError(`Unknown variable: '${ast.name}'`);
    }

    case 'unary': {
      const operand = evaluate(ast.operand, vars);
      switch (ast.op) {
        case '-': return -operand;
        case '!': return operand === 0 ? 1 : 0;
        default:
          throw new ParseError(`Unknown unary operator: '${ast.op}'`);
      }
    }

    case 'binary': {
      const left = evaluate(ast.left, vars);
      const right = evaluate(ast.right, vars);
      switch (ast.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return right !== 0 ? left / right : 0; // safe: return 0 for division by zero
        case '%': return right !== 0 ? left % right : 0;
        case '**': return Math.pow(left, right);
        case '<': return left < right ? 1 : 0;
        case '>': return left > right ? 1 : 0;
        case '<=': return left <= right ? 1 : 0;
        case '>=': return left >= right ? 1 : 0;
        case '==': return left === right ? 1 : 0;
        case '!=': return left !== right ? 1 : 0;
        case '&&': return (left !== 0 && right !== 0) ? 1 : 0;
        case '||': return (left !== 0 || right !== 0) ? 1 : 0;
        default:
          throw new ParseError(`Unknown binary operator: '${ast.op}'`);
      }
    }

    case 'call': {
      const fn = MATH_FUNCTIONS[ast.name];
      if (!fn) {
        throw new ParseError(`Unknown function: '${ast.name}'`);
      }
      const args = ast.args.map((arg) => evaluate(arg, vars));
      return fn(...args);
    }

    case 'ternary': {
      const condition = evaluate(ast.condition, vars);
      return condition !== 0 ? evaluate(ast.ifTrue, vars) : evaluate(ast.ifFalse, vars);
    }
  }
}

// ---- Public API ----

/**
 * Evaluate a math expression string with the given variables.
 * Safe: no eval(), no Function(), no access to DOM or globals.
 *
 * @param expr The expression string (e.g., "amplitude * sin(2 * PI * t / period + phase * PI / 180)")
 * @param vars Variable bindings (e.g., { t: 5, amplitude: 10, period: 16, phase: 0, PI: Math.PI })
 * @returns The numeric result of the expression
 * @throws ParseError if the expression is syntactically invalid or references unknown variables/functions
 */
export function evalExpression(expr: string, vars: Record<string, number>): number {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return evaluate(ast, vars);
}

/**
 * Validate whether an expression is syntactically valid.
 * Does NOT evaluate the expression — only checks parsing.
 *
 * @param expr The expression string to validate
 * @returns { valid: true } or { valid: false, error: string }
 */
function validateExpression(expr: string): { valid: boolean; error?: string } {
  try {
    const tokens = tokenize(expr);
    const parser = new Parser(tokens);
    parser.parse();
    return { valid: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { valid: false, error: message };
  }
}
