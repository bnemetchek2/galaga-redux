/**
 * Small cubic-bezier path toolkit used for enemy entrances, dives and returns.
 *
 * Enemy motion in the arcade is a set of scripted splines; keeping the same
 * representation here means a dive looks the same in both renderers because it
 * *is* the same data.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface CubicSegment {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

const EPSILON = 1e-6;

function bezierPoint(seg: CubicSegment, t: number, out: Vec2): Vec2 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  out.x = a * seg.p0.x + b * seg.p1.x + c * seg.p2.x + d * seg.p3.x;
  out.y = a * seg.p0.y + b * seg.p1.y + c * seg.p2.y + d * seg.p3.y;
  return out;
}

function bezierTangent(seg: CubicSegment, t: number, out: Vec2): Vec2 {
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const b = 6 * mt * t;
  const c = 3 * t * t;
  out.x = a * (seg.p1.x - seg.p0.x) + b * (seg.p2.x - seg.p1.x) + c * (seg.p3.x - seg.p2.x);
  out.y = a * (seg.p1.y - seg.p0.y) + b * (seg.p2.y - seg.p1.y) + c * (seg.p3.y - seg.p2.y);
  return out;
}

/**
 * A continuous path made of cubic segments, sampled by normalized time.
 *
 * Segments may carry a relative duration weight so a long sweeping arc can take
 * longer than a short snap into formation.
 */
export class BeamPath {
  readonly segments: CubicSegment[];
  private readonly weights: number[];
  private readonly totalWeight: number;
  private readonly pointA: Vec2 = { x: 0, y: 0 };

  constructor(segments: CubicSegment[], weights?: number[]) {
    if (segments.length === 0) throw new Error('BeamPath needs at least one segment');
    this.segments = segments;
    this.weights = weights ?? segments.map(() => 1);
    this.totalWeight = this.weights.reduce((sum, w) => sum + w, 0) || 1;
  }

  /** Position at normalized time t (clamped to [0, 1]). */
  sample(t: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const { index, local } = this.locate(t);
    return bezierPoint(this.segments[index], local, out);
  }

  /** Tangent direction at normalized time t (not normalized to unit length). */
  tangent(t: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const { index, local } = this.locate(t);
    return bezierTangent(this.segments[index], local, out);
  }

  get start(): Vec2 {
    return this.segments[0].p0;
  }

  get end(): Vec2 {
    return this.segments[this.segments.length - 1].p3;
  }

  /** Approximate arc length, used to derive a sensible travel duration. */
  length(samplesPerSegment = 12): number {
    let total = 0;
    for (const seg of this.segments) {
      let prevX = seg.p0.x;
      let prevY = seg.p0.y;
      for (let i = 1; i <= samplesPerSegment; i++) {
        const t = i / samplesPerSegment;
        bezierPoint(seg, t, this.pointA);
        total += Math.hypot(this.pointA.x - prevX, this.pointA.y - prevY);
        prevX = this.pointA.x;
        prevY = this.pointA.y;
      }
    }
    return total;
  }

  private locate(t: number): { index: number; local: number } {
    const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
    let remaining = clamped * this.totalWeight;
    for (let i = 0; i < this.segments.length; i++) {
      const w = this.weights[i];
      if (remaining <= w || i === this.segments.length - 1) {
        const local = w <= EPSILON ? 1 : Math.min(1, remaining / w);
        return { index: i, local };
      }
      remaining -= w;
    }
    return { index: this.segments.length - 1, local: 1 };
  }
}

/** Smooth step, used to ease path progress so chains do not snap. */
export function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Gentle ease-out for dives that should accelerate then coast. */
export function easeOut(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - (1 - c) * (1 - c);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function angleFromTangent(dx: number, dy: number): number {
  // Sprites are authored facing "down" (towards the player), i.e. +y.
  // A tangent pointing straight down should yield zero rotation.
  return Math.atan2(dx, dy);
}
