export class Xorshift32 {
  private s: number;
  constructor(seed: number) {
    this.s = ((seed >>> 0) || 1) >>> 0;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 0x1_0000_0000;
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
