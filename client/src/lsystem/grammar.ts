import { Xorshift32 } from './rng';

export const CAPS = {
  maxIterations: 5,
  maxStringLength: 20_000,
  maxSegments: 1_800,
  maxLeaves: 240,
  maxDepth: 12,
} as const;

export function expand(seed: number): { str: string; iterations: number } {
  let str = 'X';
  let iter = 0;
  const rng = new Xorshift32(seed);
  for (iter = 0; iter < CAPS.maxIterations; iter++) {
    let out = '';
    let overflow = false;
    for (let i = 0; i < str.length; i++) {
      if (out.length > CAPS.maxStringLength) {
        overflow = true;
        break;
      }
      const c = str[i];
      if (c === 'X') {
        const r = rng.next();
        if (r < 0.6) out += 'F[+X][-X]FX';
        else if (r < 0.8) out += 'F[+X]FX';
        else out += 'F[-X]FX';
      } else if (c === 'F') {
        out += 'FF';
      } else {
        out += c;
      }
    }
    if (overflow) return { str, iterations: iter };
    str = out;
  }
  return { str, iterations: iter };
}
