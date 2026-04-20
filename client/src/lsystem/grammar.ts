import { Xorshift32 } from './rng';

export const CAPS = {
  maxIterations: 5,
  maxStringLength: 10_000,
  maxSegments: 500,
  maxLeaves: 160,
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
        // Every branching point keeps BOTH left and right children so no
        // limb looks lopsided — variation comes from trunk-length choices.
        if (r < 0.75) out += 'F[+X][-X]FX';       // symmetric split, short trunk
        else out += 'FF[+X][-X]FX';               // symmetric split, taller trunk
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
