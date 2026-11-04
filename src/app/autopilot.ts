/**
 * Expert demo pilot.
 *
 * There is no usable prior art for this game: the published Galaga agents
 * (GaRLaga, Galaga_AI) are reinforcement learners trained against NES/Atari ROM
 * emulators, which this project deliberately does not have. This pilot is a
 * hand-written player built from the tactics top players describe, plus a
 * receding-horizon planner that uses the simulation's own dive splines.
 *
 * Movement decision (every few frames):
 *   1. Predict every bullet analytically and every diving ship from its spline.
 *   2. Build a small cost grid: for the next ~0.7 s, how dangerous is each lane?
 *   3. Dynamic-programme backwards to find the cheapest path, preferring lanes
 *      that also line up with the best target.
 *   4. Execute the first step of that plan, then replan.
 *
 * Firing is separate and simple: keep the stream going whenever a ship is in
 * the lane. The pilot only ever produces left, right and fire, exactly the
 * inputs a person has.
 */

import { PLAYER_MAX_X, PLAYER_MIN_X, SCREEN_H, SCREEN_W } from '../engine/constants.js';
import type { GalagaEngine } from '../engine/engine.js';
import type { Enemy } from '../engine/types.js';
import type { Vec2 } from '../engine/paths.js';

// Planner geometry: lanes are 6 px apart, one lane per 3 simulation frames,
// which matches the fighter's speed (126 px/s ≈ 6.3 px per 0.05 s).
const LANE_STEP = 6;
const MIN_LANE_X = PLAYER_MIN_X + 3;
const MAX_LANE_X = PLAYER_MAX_X - 3;
const LANES = Math.floor((MAX_LANE_X - MIN_LANE_X) / LANE_STEP) + 1;

const HORIZON_STEPS = 26; // × 0.05 s ≈ 1.3 s
const STEP_SECONDS = 3 / 60;

const MOVE_PENALTY = 0.04;
const ALIGN_WEIGHT = 0.001;
const WALL_WEIGHT = 0.004;

interface Decision {
  moveLeft: boolean;
  moveRight: boolean;
  fire: boolean;
  targetX: number;
  threat: number;
  reason: string;
}

function emptyDecision(): Decision {
  return {
    moveLeft: false,
    moveRight: false,
    fire: false,
    targetX: SCREEN_W / 2,
    threat: 0,
    reason: 'idle',
  };
}

export class AutoPilot {
  /** danger[step][lane] scratch grid. */
  private readonly danger = new Float32Array(HORIZON_STEPS * LANES);
  /** cost[step][lane] scratch grid. */
  private readonly cost = new Float32Array(HORIZON_STEPS * LANES);
  private readonly scratch: Vec2 = { x: 0, y: 0 };
  private readonly previous = new Map<number, { x: number; y: number }>();

  private clock = 0;
  private nextPlan = 0;
  private direction = 0;
  private lastDecision: Decision = emptyDecision();

  get decision(): Decision {
    return this.lastDecision;
  }

  reset(): void {
    this.clock = 0;
    this.nextPlan = 0;
    this.direction = 0;
    this.previous.clear();
    this.lastDecision = emptyDecision();
  }

  /** Compute and apply one frame of input. */
  step(engine: GalagaEngine): Decision {
    this.clock += 1 / 60;

    if (engine.phase !== 'playing' || !engine.player.visible) {
      this.direction = 0;
      engine.setInput('left', false);
      engine.setInput('right', false);
      engine.setInput('fire', false);
      this.lastDecision = emptyDecision();
      return this.lastDecision;
    }

    const px = engine.player.x;
    const py = engine.player.y;
    const target = this.pickTarget(engine, px, py);

    if (this.clock >= this.nextPlan) {
      this.nextPlan = this.clock + 0.05;
      this.direction = this.planLane(engine, px, py, target ? target.x : px);
    }

    // Keep moving while the plan is being re-evaluated; stop inside a 2 px dead
    // zone so the ship does not jitter on the spot.
    const move = this.direction;
    const decision: Decision = {
      moveLeft: move < 0,
      moveRight: move > 0,
      fire: this.shouldFire(engine, px, py, target),
      targetX: target ? target.x : px,
      threat: this.currentThreat(engine, px, py),
      reason: this.describe(target, move),
    };
    this.lastDecision = decision;

    engine.setInput('left', decision.moveLeft);
    engine.setInput('right', decision.moveRight);
    engine.setInput('fire', decision.fire);
    this.remember(engine);
    return decision;
  }

  release(engine: GalagaEngine): void {
    engine.setInput('left', false);
    engine.setInput('right', false);
    engine.setInput('fire', false);
    this.lastDecision = emptyDecision();
  }

  // ------------------------------------------------------------- planning --

  /** Returns -1, 0 or 1: the first move of the cheapest safe path. */
  private planLane(engine: GalagaEngine, px: number, py: number, desired: number): number {
    this.danger.fill(0);

    // --- bullets: exact straight-line prediction -------------------------
    for (const b of engine.bullets) {
      if (b.from !== 'enemy' || !b.alive || b.vy <= 0) continue;
      for (let s = 0; s < HORIZON_STEPS; s++) {
        const t = s * STEP_SECONDS;
        const by = b.y + b.vy * t;
        if (by < py - 14) continue;
        if (by > py + 18) break;
        const bx = b.x + b.vx * t;
        this.paint(s, bx, 11, 2.6);
      }
    }

    // --- divers: exact prediction along the dive spline -------------------
    for (const e of engine.enemies) {
      if (!e.alive) continue;
      if (e.state === 'enter' || e.state === 'challenge' || e.state === 'formation') continue;
      for (let s = 0; s < HORIZON_STEPS; s += 2) {
        const future = this.enemyFuture(e, s * STEP_SECONDS);
        if (!future) break;
        if (future.y < py - 26) continue;
        if (future.y > py + 30) break;
        const weight = e.kind === 'boss' ? 7 : 6;
        this.paint(s, future.x, 20, weight);
        if (s + 1 < HORIZON_STEPS) this.paint(s + 1, future.x, 20, weight);
      }
    }

    // --- tractor beam: a permanent no-go band ----------------------------
    if (engine.tractor.active && engine.tractor.intensity > 0.15) {
      for (let s = 0; s < HORIZON_STEPS; s++) {
        this.paint(s, engine.tractor.x, engine.tractor.halfWidth + 9, 5);
      }
    }

    // --- alignment and wall bias ----------------------------------------
    for (let s = 0; s < HORIZON_STEPS; s++) {
      const row = s * LANES;
      for (let i = 0; i < LANES; i++) {
        const x = MIN_LANE_X + i * LANE_STEP;
        const wall = i === 0 || i === LANES - 1 ? 1 : 0;
        this.danger[row + i] +=
          Math.abs(x - desired) * ALIGN_WEIGHT + wall * WALL_WEIGHT * (1 + s * 0.05);
      }
    }

    // --- backward dynamic programme -------------------------------------
    this.cost.set(this.danger);
    for (let s = HORIZON_STEPS - 2; s >= 0; s--) {
      const row = s * LANES;
      const next = (s + 1) * LANES;
      for (let i = 0; i < LANES; i++) {
        let best = this.cost[next + i];
        if (i > 0) {
          const left = this.cost[next + i - 1] + MOVE_PENALTY;
          if (left < best) best = left;
        }
        if (i < LANES - 1) {
          const right = this.cost[next + i + 1] + MOVE_PENALTY;
          if (right < best) best = right;
        }
        this.cost[row + i] = this.danger[row + i] + best;
      }
    }

    const here = Math.round((px - MIN_LANE_X) / LANE_STEP);
    const startLane = Math.max(0, Math.min(LANES - 1, here));
    let bestLane = startLane;
    let bestCost = this.cost[LANES + startLane];
    if (startLane > 0) {
      const left = this.cost[LANES + startLane - 1];
      if (left < bestCost) {
        bestCost = left;
        bestLane = startLane - 1;
      }
    }
    if (startLane < LANES - 1) {
      const right = this.cost[LANES + startLane + 1];
      if (right < bestCost) {
        bestCost = right;
        bestLane = startLane + 1;
      }
    }

    const targetX = MIN_LANE_X + bestLane * LANE_STEP;
    if (Math.abs(targetX - px) < 2) return 0;
    return targetX > px ? 1 : -1;
  }

  /** Paint a triangular danger blob for one planner time step. */
  private paint(step: number, centerX: number, radius: number, weight: number): void {
    const row = step * LANES;
    const from = Math.max(0, Math.round((centerX - radius - MIN_LANE_X) / LANE_STEP));
    const to = Math.min(LANES - 1, Math.round((centerX + radius - MIN_LANE_X) / LANE_STEP));
    for (let i = from; i <= to; i++) {
      const x = MIN_LANE_X + i * LANE_STEP;
      const d = Math.abs(x - centerX) / radius;
      if (d >= 1) continue;
      this.danger[row + i] += weight * (1 - d * d);
    }
  }

  /** Exact future position for a ship on a spline, null when unknown. */
  private enemyFuture(e: Enemy, secondsAhead: number): Vec2 | null {
    if (!e.path) {
      const prior = this.previous.get(e.id);
      if (!prior) return { x: e.x, y: e.y };
      const vx = (e.x - prior.x) * 60;
      const vy = (e.y - prior.y) * 60;
      if (Math.abs(vy) > 900) return { x: e.x, y: e.y };
      return { x: e.x + vx * secondsAhead, y: e.y + vy * secondsAhead };
    }
    const t = e.t + secondsAhead / e.pathDuration;
    if (t > 1) return null;
    return e.path.sample(t, this.scratch);
  }

  private remember(engine: GalagaEngine): void {
    for (const e of engine.enemies) {
      if (!e.alive) {
        this.previous.delete(e.id);
        continue;
      }
      this.previous.set(e.id, { x: e.x, y: e.y });
    }
  }

  /** Coarse instantaneous danger, used only for reporting. */
  private currentThreat(engine: GalagaEngine, px: number, py: number): number {
    let threat = 0;
    for (const b of engine.bullets) {
      if (b.from !== 'enemy' || !b.alive || b.vy <= 0) continue;
      const t = (py - b.y) / b.vy;
      if (t < -0.05 || t > 0.6) continue;
      const x = b.x + b.vx * Math.max(0, t);
      const d = Math.abs(x - px);
      if (d < 12) threat += 1 - d / 12;
    }
    return threat;
  }

  // ---------------------------------------------------------- target choice --

  private pickTarget(engine: GalagaEngine, px: number, py: number): Enemy | null {
    let best: Enemy | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const e of engine.enemies) {
      if (!e.alive) continue;
      if (e.state === 'enter' && !engine.challenge) continue;

      let score = 0;
      if (e.capturedShip) score += 5.5;
      if (e.state === 'dive' || e.state === 'beam') score += 3.2;
      if (e.state === 'return') score += 1.2;
      if (e.kind === 'boss') score += 0.5;
      score += 1 - (py - e.y) / (SCREEN_H * 1.1);
      score -= Math.abs(e.x - px) / 420;
      if (e.y > py - 30) score -= 4;

      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private describe(target: Enemy | null, move: number): string {
    if (target?.capturedShip) return 'rescue';
    if (target && (target.state === 'dive' || target.state === 'beam')) return 'dive';
    if (move !== 0) return 'reposition';
    return target ? 'aim' : 'sweep';
  }

  private shouldFire(engine: GalagaEngine, px: number, py: number, target: Enemy | null): boolean {
    if (engine.challenge) return true;

    for (const e of engine.enemies) {
      if (!e.alive) continue;
      if (e.y > py - 8) continue;
      const width = e.kind === 'boss' ? 12 : 9;
      if (Math.abs(e.x - px) < width + 8) return true;
    }
    if (!target) return false;
    const distance = Math.hypot(target.x - px, target.y - py);
    return Math.abs(target.x - px) < 14 && distance < 220;
  }
}
