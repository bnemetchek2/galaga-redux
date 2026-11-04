/**
 * Deterministic pseudo-random number generator.
 *
 * The whole game draws randomness from one of these, seeded per game. That is
 * what makes a run reproducible: the same seed and the same inputs always
 * produce the same sequence of events, so the classic renderer and the
 * enhanced renderer can never disagree about what happened.
 */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    // Any non-zero 32-bit seed works; xorshift degenerates at zero.
    this.state = (seed | 0) || 0x9e3779b9;
  }

  /** Raw 32-bit state, useful for snapshotting. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state | 0 || 0x9e3779b9;
  }

  /** Next uint32. */
  nextUint32(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return this.state >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }
}

/** FNV-1a hash over a string, used to label deterministic state snapshots. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
