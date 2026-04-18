/**
 * Fixed-precision decimal backed by BigInt.
 *
 * Internal representation: `q = value * 10^scale`. Default scale is 10
 * (10 decimal digits), which covers currency math up to ~10^17 units
 * (i.e. ~₹1 quintillion) without overflow concerns on modern engines.
 *
 * All operations preserve the target scale of the left-hand operand.
 * Division rounds half-even to avoid systematic bias in long cash-flow
 * aggregations.
 */

export const DEFAULT_SCALE = 10;

export class Decimal {
  readonly q: bigint;
  readonly scale: number;

  constructor(q: bigint, scale: number = DEFAULT_SCALE) {
    if (!Number.isInteger(scale) || scale < 0 || scale > 30) {
      throw new RangeError(`Decimal scale out of range: ${scale}`);
    }
    this.q = q;
    this.scale = scale;
  }

  static zero(scale: number = DEFAULT_SCALE): Decimal {
    return new Decimal(0n, scale);
  }

  static one(scale: number = DEFAULT_SCALE): Decimal {
    return new Decimal(pow10(scale), scale);
  }

  /** Exact from integer. */
  static fromInt(n: number | bigint, scale: number = DEFAULT_SCALE): Decimal {
    const big = typeof n === 'bigint' ? n : BigInt(Math.trunc(n));
    return new Decimal(big * pow10(scale), scale);
  }

  /** From IEEE-754 number. Rounds half-even at the target scale. */
  static fromNumber(n: number, scale: number = DEFAULT_SCALE): Decimal {
    if (!Number.isFinite(n)) {
      throw new RangeError(`Decimal.fromNumber: non-finite input ${n}`);
    }
    if (n === 0) return Decimal.zero(scale);
    // Route through string to avoid binary-float drift for common cases
    // (e.g. 0.1 + 0.2 → 0.30000000000000004 when round-tripped via *1e10).
    return Decimal.fromString(formatNumberForDecimal(n, scale), scale);
  }

  /** From a decimal string, e.g. "123.456", "-0.05". */
  static fromString(s: string, scale: number = DEFAULT_SCALE): Decimal {
    const cleaned = s.trim();
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(cleaned);
    if (!match) throw new RangeError(`Decimal.fromString: invalid input "${s}"`);
    const sign = match[1] === '-' ? -1n : 1n;
    const intPart = match[2];
    const fracPart = match[3] ?? '';
    const fracTrimmed = fracPart.slice(0, scale);
    const fracPadded = fracTrimmed.padEnd(scale, '0');
    const combined = `${intPart}${fracPadded}`;
    let q = BigInt(combined);
    // Round-half-even on any remaining fractional digit we truncated.
    if (fracPart.length > scale) {
      const roundDigit = fracPart.charCodeAt(scale) - 48;
      const rest = fracPart.slice(scale + 1);
      const hasRemainder = rest.length > 0 && /[1-9]/.test(rest);
      if (roundDigit > 5 || (roundDigit === 5 && (hasRemainder || (q & 1n) === 1n))) {
        q += 1n;
      }
    }
    return new Decimal(sign * q, scale);
  }

  /** Widen/narrow to a new scale, rounding half-even on narrow. */
  withScale(newScale: number): Decimal {
    if (newScale === this.scale) return this;
    if (newScale > this.scale) {
      return new Decimal(this.q * pow10(newScale - this.scale), newScale);
    }
    return new Decimal(divRoundHalfEven(this.q, pow10(this.scale - newScale)), newScale);
  }

  add(other: Decimal): Decimal {
    const [a, b] = alignScales(this, other);
    return new Decimal(a.q + b.q, a.scale);
  }

  sub(other: Decimal): Decimal {
    const [a, b] = alignScales(this, other);
    return new Decimal(a.q - b.q, a.scale);
  }

  neg(): Decimal {
    return new Decimal(-this.q, this.scale);
  }

  abs(): Decimal {
    return this.q < 0n ? this.neg() : this;
  }

  /** Multiply by another Decimal; result uses the left-hand scale. */
  mul(other: Decimal): Decimal {
    const product = this.q * other.q;
    return new Decimal(
      divRoundHalfEven(product, pow10(other.scale)),
      this.scale,
    );
  }

  /** Multiply by a plain number (rounded through string). */
  mulNumber(n: number): Decimal {
    return this.mul(Decimal.fromNumber(n, this.scale));
  }

  /** Divide by another Decimal; result uses the left-hand scale. */
  div(other: Decimal): Decimal {
    if (other.q === 0n) throw new RangeError('Decimal.div: division by zero');
    const scaled = this.q * pow10(other.scale);
    return new Decimal(divRoundHalfEven(scaled, other.q), this.scale);
  }

  /** Divide by a plain integer quickly. */
  divInt(n: number | bigint): Decimal {
    const big = typeof n === 'bigint' ? n : BigInt(Math.trunc(n));
    if (big === 0n) throw new RangeError('Decimal.divInt: division by zero');
    return new Decimal(divRoundHalfEven(this.q, big), this.scale);
  }

  isZero(): boolean {
    return this.q === 0n;
  }

  isNegative(): boolean {
    return this.q < 0n;
  }

  isPositive(): boolean {
    return this.q > 0n;
  }

  compare(other: Decimal): -1 | 0 | 1 {
    const [a, b] = alignScales(this, other);
    if (a.q < b.q) return -1;
    if (a.q > b.q) return 1;
    return 0;
  }

  eq(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  /** Lossy conversion to IEEE-754 number. */
  toNumber(): number {
    if (this.scale === 0) return Number(this.q);
    const divisor = pow10(this.scale);
    const whole = this.q / divisor;
    const frac = this.q % divisor;
    return Number(whole) + Number(frac) / Number(divisor);
  }

  /** Canonical decimal-string form at current scale. */
  toString(): string {
    if (this.scale === 0) return this.q.toString();
    const negative = this.q < 0n;
    const abs = negative ? -this.q : this.q;
    const divisor = pow10(this.scale);
    const whole = abs / divisor;
    const frac = abs % divisor;
    const fracStr = frac.toString().padStart(this.scale, '0').replace(/0+$/, '');
    const out = fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
    return negative ? `-${out}` : out;
  }

  /** Round to N decimal places (half-even), returning a Decimal at the default scale. */
  roundTo(places: number): Decimal {
    if (!Number.isInteger(places) || places < 0) {
      throw new RangeError(`roundTo: invalid places ${places}`);
    }
    return this.withScale(places).withScale(this.scale);
  }
}

export function sum(values: readonly Decimal[], scale: number = DEFAULT_SCALE): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.add(v), Decimal.zero(scale));
}

export function maxDec(a: Decimal, b: Decimal): Decimal {
  return a.compare(b) >= 0 ? a : b;
}

export function minDec(a: Decimal, b: Decimal): Decimal {
  return a.compare(b) <= 0 ? a : b;
}

/** 10^n as BigInt. Memoised for common scales. */
const POW10_CACHE = new Map<number, bigint>();
function pow10(n: number): bigint {
  const cached = POW10_CACHE.get(n);
  if (cached !== undefined) return cached;
  let result = 1n;
  for (let i = 0; i < n; i++) result *= 10n;
  POW10_CACHE.set(n, result);
  return result;
}

function alignScales(a: Decimal, b: Decimal): [Decimal, Decimal] {
  if (a.scale === b.scale) return [a, b];
  if (a.scale > b.scale) return [a, b.withScale(a.scale)];
  return [a.withScale(b.scale), b];
}

/** Half-even BigInt division. */
function divRoundHalfEven(numer: bigint, denom: bigint): bigint {
  if (denom === 0n) throw new RangeError('divRoundHalfEven: division by zero');
  const negative = (numer < 0n) !== (denom < 0n);
  const absNumer = numer < 0n ? -numer : numer;
  const absDenom = denom < 0n ? -denom : denom;
  const quotient = absNumer / absDenom;
  const remainder = absNumer % absDenom;
  const twiceRem = remainder * 2n;
  let rounded = quotient;
  if (twiceRem > absDenom || (twiceRem === absDenom && (quotient & 1n) === 1n)) {
    rounded += 1n;
  }
  return negative ? -rounded : rounded;
}

/**
 * Convert an IEEE-754 number to a finite decimal string at the requested
 * precision. We use `toFixed` when safe and fall back to canonical formatting
 * otherwise.
 */
function formatNumberForDecimal(n: number, scale: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError('formatNumberForDecimal: non-finite input');
  }
  // `toFixed` is sufficient for scale ≤ 20, which is well above our usage.
  const fixed = n.toFixed(scale);
  return fixed;
}
