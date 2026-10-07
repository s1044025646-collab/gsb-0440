// 基于 BigInt 的精确有理数，全程约分，分母恒为正。
export interface Fraction {
  n: bigint;
  d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a === 0n ? 1n : a;
}

export function frac(n: bigint, d: bigint = 1n): Fraction {
  if (d === 0n) throw new Error("分母不能为零");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function add(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function mul(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.n, a.d * b.d);
}

export function divByInt(a: Fraction, k: bigint): Fraction {
  if (k <= 0n) throw new Error("除数必须为正整数");
  return frac(a.n, a.d * k);
}

export function isZero(a: Fraction): boolean {
  return a.n === 0n;
}

export function equal(a: Fraction, b: Fraction): boolean {
  return a.n === b.n && a.d === b.d;
}

/** 仅供展示的小数，不参与任何计算。 */
export function toDecimal(a: Fraction, digits = 6): string {
  const neg = a.n < 0n;
  const n = neg ? -a.n : a.n;
  const scale = 10n ** BigInt(digits);
  const scaled = (n * scale) / a.d;
  const intPart = scaled / scale;
  const fracPart = (scaled % scale).toString().padStart(digits, "0");
  return (neg ? "-" : "") + intPart.toString() + "." + fracPart;
}

export function parseFraction(num: string, den: string): Fraction {
  if (!/^-?\d+$/.test(num) || !/^-?\d+$/.test(den)) {
    throw new Error("分子分母必须为整数字符串");
  }
  return frac(BigInt(num), BigInt(den));
}
