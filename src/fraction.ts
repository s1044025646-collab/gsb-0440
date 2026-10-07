/**
 * 基于 BigInt 的精确有理数。所有份额计算只使用本模块，
 * 展示用小数永远不回流到计算中。
 */

export interface BigFraction {
  n: bigint;
  d: bigint;
}

export function frac(n: bigint | number | string, d: bigint | number | string = 1n): BigFraction {
  const num = BigInt(n);
  const den = BigInt(d);
  if (den === 0n) {
    throw new Error("分母为零");
  }
  return normalize({ n: num, d: den });
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

export function normalize(f: BigFraction): BigFraction {
  if (f.d === 0n) {
    throw new Error("分母为零");
  }
  let { n, d } = f;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) {
    return { n: 0n, d: 1n };
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function add(a: BigFraction, b: BigFraction): BigFraction {
  return normalize({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
}

export function mul(a: BigFraction, b: BigFraction): BigFraction {
  return normalize({ n: a.n * b.n, d: a.d * b.d });
}

/** 返回 1/k。 */
export function reciprocalOfInt(k: number): BigFraction {
  if (k <= 0) {
    throw new Error("合格支系数必须为正");
  }
  return { n: 1n, d: BigInt(k) };
}

export function isZero(f: BigFraction): boolean {
  return f.n === 0n;
}

export function isOne(f: BigFraction): boolean {
  return f.n === f.d;
}

export function equal(a: BigFraction, b: BigFraction): boolean {
  return a.n * b.d === b.n * a.d;
}

/** 仅供展示的小数，默认保留 12 位有效小数（不四舍五入影响份额）。 */
export function toDecimal(f: BigFraction, digits = 12): string {
  if (f.n === 0n) return "0";
  const negative = f.n < 0n;
  let n = negative ? -f.n : f.n;
  const intPart = n / f.d;
  let rem = n % f.d;
  let out = "";
  let produced = 0;
  while (rem !== 0n && produced < digits) {
    rem *= 10n;
    out += (rem / f.d).toString();
    rem %= f.d;
    produced += 1;
  }
  const body = out.length > 0 ? `${intPart.toString()}.${out}` : intPart.toString();
  return negative ? `-${body}` : body;
}

export function toStrings(f: BigFraction): { numerator: string; denominator: string; decimal: string } {
  return {
    numerator: f.n.toString(),
    denominator: f.d.toString(),
    decimal: toDecimal(f),
  };
}

/** 从外部字符串解析分数；失败时抛出错误。 */
export function parseFraction(numerator: string, denominator: string): BigFraction {
  if (!/^[+-]?\d+$/.test(numerator.trim()) || !/^[+-]?\d+$/.test(denominator.trim())) {
    throw new Error("分数必须为整数分子与整数分母");
  }
  return frac(numerator.trim(), denominator.trim());
}
