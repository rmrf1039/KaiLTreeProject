import { Xorshift32 } from './rng';

export const CAPS = {
  maxIterations: 4,
  maxStringLength: 5_000,
  maxSegments: 200,
  maxLeaves: 80,
  maxDepth: 8,
} as const;

export function expand(seed: number): { str: string; iterations: number } {
  // Lead with plain trunk segments so the root is taller before the first
  // branching — fills the vertical 16:9 display better.
  let str = 'FFFX';
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
        // Symmetric-first so the tree reads as a tree: trunk + paired limbs.
        if (r < 0.70) out += 'F[+X][-X]FX';       // symmetric split (most common)
        else if (r < 0.85) out += 'FF[+X][-X]X';  // taller trunk, then split
        else if (r < 0.93) out += 'F[+X]FX';      // single right
        else out += 'F[-X]FX';                     // single left
      } else if (c === 'F') {
        out += 'F';
      } else {
        out += c;
      }
    }
    if (overflow) return { str, iterations: iter };
    str = out;
  }
  return { str, iterations: iter };
}
