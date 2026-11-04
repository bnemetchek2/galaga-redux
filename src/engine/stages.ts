/**
 * Stage composition and entrance choreography.
 *
 * Galaga's fleet is a 8 x 5 grid. Stage composition is 4 Boss Galaga on the
 * top row, two ranks of sixteen Goei (butterflies) and two ranks of sixteen
 * Zako (bees). Challenging stages instead send 40 ships straight through the
 * screen in five flights of eight.
 */

import {
  FORMATION_CENTER_X,
  FORMATION_DX,
  FORMATION_DY,
  FORMATION_LEFT,
  FORMATION_TOP,
  MAX_STAGE,
  SCREEN_H,
  SCREEN_W,
} from './constants.js';
import { BeamPath, type CubicSegment, type Vec2 } from './paths.js';
import type { EnemyKind } from './types.js';

/** Formation slot position in logical pixels (row 0 is the top rank). */
export function slotPosition(col: number, row: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  out.x = FORMATION_LEFT + col * FORMATION_DX;
  out.y = FORMATION_TOP + row * FORMATION_DY;
  return out;
}

export function slotIndex(col: number, row: number): number {
  return row * 8 + col;
}

/** Circular arc expressed as cubic segments, starting at `startAngle`. */
export function circleLoop(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  clockwise: boolean,
  turns = 1,
): CubicSegment[] {
  const segments: CubicSegment[] = [];
  const steps = 4 * turns;
  const stepAngle = ((clockwise ? 1 : -1) * Math.PI * 2 * turns) / steps;
  let angle = startAngle;
  for (let i = 0; i < steps; i++) {
    const a0 = angle;
    const a1 = angle + stepAngle;
    const p0 = { x: cx + radius * Math.cos(a0), y: cy + radius * Math.sin(a0) };
    const p3 = { x: cx + radius * Math.cos(a1), y: cy + radius * Math.sin(a1) };
    const k = (4 / 3) * Math.tan((a1 - a0) / 4) * radius;
    const p1 = { x: p0.x - k * Math.sin(a0), y: p0.y + k * Math.cos(a0) };
    const p2 = { x: p3.x + k * Math.sin(a1), y: p3.y - k * Math.cos(a1) };
    segments.push({ p0, p1, p2, p3 });
    angle = a1;
  }
  return segments;
}

export type EntranceKind = 'left' | 'right' | 'top' | 'bossDouble';

/**
 * Build the flight path an enemy takes from off-screen into its formation slot.
 *
 * The shapes follow the arcade grammar: flights pour in from the lower corners,
 * loop once near the top, then slide sideways into their rank.
 */
export function buildEntrancePath(kind: EntranceKind, slot: Vec2): BeamPath {
  const segments: CubicSegment[] = [];
  const weights: number[] = [];

  if (kind === 'left' || kind === 'right') {
    const mirror = kind === 'right';
    const mx = (x: number) => (mirror ? SCREEN_W - x : x);
    // Climb the near-side wall.
    segments.push({
      p0: { x: mx(-20), y: 306 },
      p1: { x: mx(-14), y: 238 },
      p2: { x: mx(8), y: 158 },
      p3: { x: mx(44), y: 104 },
    });
    weights.push(2.6);
    // A single tight loop at the top of the climb.
    const loopCenter = { x: mx(44), y: 104 + 17 };
    segments.push(...circleLoop(loopCenter.x, loopCenter.y, 17, -Math.PI / 2, !mirror, 1));
    weights.push(1.7);
    // Peel out of the loop and settle into the rank.
    segments.push({
      p0: { x: mx(44), y: 104 },
      p1: { x: mx(78), y: 74 },
      p2: { x: slot.x - (mirror ? 34 : -34), y: slot.y + 40 },
      p3: slot,
    });
    weights.push(2.4);
  } else if (kind === 'top') {
    segments.push({
      p0: { x: FORMATION_CENTER_X + (slot.x - FORMATION_CENTER_X) * 0.2, y: -34 },
      p1: { x: FORMATION_CENTER_X, y: 30 },
      p2: { x: slot.x + (slot.x < FORMATION_CENTER_X ? 60 : -60), y: 44 },
      p3: { x: slot.x + (slot.x < FORMATION_CENTER_X ? 34 : -34), y: 78 },
    });
    weights.push(3.2);
    segments.push({
      p0: { x: slot.x + (slot.x < FORMATION_CENTER_X ? 34 : -34), y: 78 },
      p1: { x: slot.x, y: 96 },
      p2: { x: slot.x, y: slot.y + 30 },
      p3: slot,
    });
    weights.push(2.2);
  } else {
    // Boss double loop: climb in from the lower left, loop twice at centre and
    // peel into the top rank. Starting off-centre keeps the entry clear of the
    // fighter, which starts in the middle of the bottom edge.
    const entryX = FORMATION_CENTER_X - 62;
    segments.push({
      p0: { x: entryX, y: 320 },
      p1: { x: entryX - 4, y: 268 },
      p2: { x: entryX + 16, y: 222 },
      p3: { x: FORMATION_CENTER_X + 26, y: 186 },
    });
    weights.push(2.4);
    segments.push(...circleLoop(FORMATION_CENTER_X + 28, 166, 18, Math.PI / 2, true, 2));
    weights.push(2.6);
    segments.push({
      p0: { x: FORMATION_CENTER_X + 28, y: 184 },
      p1: { x: FORMATION_CENTER_X + 54, y: 216 },
      p2: { x: slot.x + 26, y: slot.y + 48 },
      p3: slot,
    });
    weights.push(2.6);
  }

  return new BeamPath(segments, weights);
}

/** A flight that crosses the playfield and leaves, used by challenging stages. */
export function buildChallengePath(index: number, slot: Vec2): BeamPath {
  const lane = index % 5;
  const fromLeft = lane % 2 === 0;
  const startX = fromLeft ? -22 : SCREEN_W + 22;
  const endX = fromLeft ? SCREEN_W + 22 : -22;
  const startY = 300 - lane * 26;
  const apexY = 48 + lane * 14;
  // Each flight loops over its own column so the five flights interleave
  // instead of piling up in the middle of the screen.
  const loopX = 36 + lane * 38;
  const segments: CubicSegment[] = [
    {
      p0: { x: startX, y: startY },
      p1: { x: fromLeft ? 26 : SCREEN_W - 26, y: 250 },
      p2: { x: fromLeft ? 40 : SCREEN_W - 40, y: 140 },
      p3: { x: fromLeft ? 64 : SCREEN_W - 64, y: apexY },
    },
    {
      p0: { x: fromLeft ? 64 : SCREEN_W - 64, y: apexY },
      p1: { x: loopX + (fromLeft ? 26 : -26), y: apexY - 30 },
      p2: { x: loopX + (fromLeft ? 30 : -30), y: apexY + 26 },
      p3: { x: fromLeft ? 64 : SCREEN_W - 64, y: apexY + 52 },
    },
    {
      p0: { x: fromLeft ? 64 : SCREEN_W - 64, y: apexY + 52 },
      p1: { x: fromLeft ? 34 : SCREEN_W - 34, y: 220 },
      p2: { x: endX, y: 200 },
      p3: { x: endX, y: 140 },
    },
  ];
  // `slot` is unused for challenge paths but keeps the call signature uniform.
  void slot;
  return new BeamPath(segments, [3, 2, 3]);
}

export interface WaveSpec {
  kind: EnemyKind;
  entrance: EntranceKind;
  /** Formation slots, in the order ships peel off into them. */
  slots: number[];
  startDelay: number;
  spacing: number;
  speed: number;
}

export interface StageSpec {
  stage: number;
  challenge: boolean;
  waves: WaveSpec[];
  /** Ships per second the fleet is willing to commit to attacks. */
  divePressure: number;
  maxDivers: number;
  enemyBulletSpeed: number;
  formationFireRate: number;
  bossCapture: boolean;
}

function slotsForRow(row: number, columns: number[]): number[] {
  return columns.map((col) => slotIndex(col, row));
}

/** Columns ordered centre-out, so flights land from the middle of a rank. */
const CENTER_OUT_8 = [3, 4, 2, 5, 1, 6, 0, 7];

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildStage(stage: number): StageSpec {
  const clamped = ((stage - 1) % MAX_STAGE) + 1;
  const challenge = clamped >= 3 && clamped % 4 === 3;

  if (challenge) {
    const waves: WaveSpec[] = [];
    for (let lane = 0; lane < 5; lane++) {
      waves.push({
        kind: lane < 3 ? 'bee' : 'butterfly',
        entrance: lane % 2 === 0 ? 'left' : 'right',
        slots: Array.from({ length: 8 }, (_, i) => lane * 8 + i),
        startDelay: lane * 0.5,
        spacing: 0.17,
        speed: 210 + lane * 6,
      });
    }
    return {
      stage: clamped,
      challenge: true,
      waves,
      divePressure: 0,
      maxDivers: 0,
      enemyBulletSpeed: 0,
      formationFireRate: 0,
      bossCapture: false,
    };
  }

  const cycle = Math.floor((clamped - 1) / 4);
  const beeSpeed = 118 + Math.min(70, cycle * 9);
  const butterflySpeed = 126 + Math.min(74, cycle * 9);
  const bossSpeed = 132 + Math.min(60, cycle * 8);

  const beeSlots = [...slotsForRow(3, CENTER_OUT_8), ...slotsForRow(4, CENTER_OUT_8)];
  const butterflySlots = [...slotsForRow(1, CENTER_OUT_8), ...slotsForRow(2, CENTER_OUT_8)];
  const bossSlots = slotsForRow(0, [2, 3, 4, 5]);

  const waves: WaveSpec[] = [];
  let clock = 0;
  let side = 0;
  const sideOf = () => (side++ % 2 === 0 ? 'left' : 'right');

  // Four flights of bees.
  for (const group of chunk(beeSlots, 8)) {
    waves.push({
      kind: 'bee',
      entrance: sideOf(),
      slots: group,
      startDelay: clock,
      spacing: 0.17,
      speed: beeSpeed,
    });
    clock += 0.34;
  }
  // Four flights of butterflies.
  for (const group of chunk(butterflySlots, 8)) {
    waves.push({
      kind: 'butterfly',
      entrance: sideOf(),
      slots: group,
      startDelay: clock,
      spacing: 0.17,
      speed: butterflySpeed,
    });
    clock += 0.34;
  }
  // The bosses bring up the rear with their double loop.
  for (const group of chunk(bossSlots, 4)) {
    waves.push({
      kind: 'boss',
      entrance: 'bossDouble',
      slots: group,
      startDelay: clock + 0.25,
      spacing: 0.22,
      speed: bossSpeed,
    });
    clock += 0.5;
  }

  return {
    stage: clamped,
    challenge: false,
    waves,
    divePressure: Math.min(1.9, 0.5 + cycle * 0.14),
    maxDivers: Math.min(9, 2 + cycle),
    enemyBulletSpeed: Math.min(230, 126 + cycle * 9),
    formationFireRate: Math.min(1.0, 0.28 + cycle * 0.06),
    bossCapture: clamped >= 2,
  };
}

/** Score value of a kill. */
export function scoreFor(kind: EnemyKind, diving: boolean, escorts = 0): number {
  if (kind === 'bee') return diving ? 100 : 50;
  if (kind === 'butterfly') return diving ? 160 : 80;
  if (!diving) return 150;
  if (escorts >= 2) return 1600;
  if (escorts === 1) return 800;
  return 400;
}

/** Whether the given stage is a challenging (bonus) stage. */
export function isChallengeStage(stage: number): boolean {
  return stage >= 3 && stage % 4 === 3;
}

/** Screen bounds used when deciding that a diving enemy has left the field. */
export const DIVE_EXIT_Y = SCREEN_H + 24;
