/** Shared entity and event types. Renderers only read from these. */

import type { BeamPath, Vec2 } from './paths.js';

export type EnemyKind = 'bee' | 'butterfly' | 'boss';

/**
 * Enemy behaviour states.
 *
 * - `enter`     following an entrance spline towards its formation slot
 * - `formation` holding station and swaying with the fleet
 * - `dive`      attacking the player along a spline
 * - `return`    climbing back into formation after a dive
 * - `beam`      boss holding the player in a tractor beam
 * - `challenge` flying through a challenging stage and off the far side
 */
export type EnemyState = 'enter' | 'formation' | 'dive' | 'return' | 'beam' | 'challenge';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  state: EnemyState;
  x: number;
  y: number;
  angle: number;
  col: number;
  row: number;
  hp: number;
  /** Normalized progress along `path`. */
  t: number;
  path: BeamPath | null;
  pathDuration: number;
  /** Seconds to wait before starting to move along the path. */
  delay: number;
  phase: number;
  fireTimer: number;
  /** Challenge stage bookkeeping. */
  challengeGroup: number;
  /** Boss tractor-beam sub-state timer. */
  beamTimer: number;
  beamPhase: 'approach' | 'open' | 'hold' | 'close';
  beamIntensity: number;
  /** True while this boss is holding a captured player fighter. */
  capturedShip: boolean;
  diveRole: 'none' | 'leader' | 'escort';
  escorts: number;
  /** Brief hit flash, used by the enhanced renderer. */
  flash: number;
  /** Shots this ship may still fire during its current dive. */
  shotsLeft: number;
  /** Cleared when the ship is destroyed or leaves the field. */
  alive: boolean;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
  from: 'player' | 'enemy';
  /** Visual variant; enemy bullets use 0 for straight, 1 for aimed. */
  variant: number;
  /**
   * Which of the machine's eight shared shot slots this round occupies.
   * Enemy shots are limited to eight; the arcade's no-fire bug is a corruption
   * of this slot table. Player bullets use -1.
   */
  slot: number;
}

export interface Explosion {
  x: number;
  y: number;
  age: number;
  duration: number;
  size: number;
  kind: 'enemy' | 'player' | 'boss' | 'spark';
  alive: boolean;
}

export interface FloatingScore {
  x: number;
  y: number;
  value: number;
  age: number;
  duration: number;
  alive: boolean;
}

export interface Star {
  x: number;
  y: number;
  speed: number;
  layer: number;
  brightness: number;
}

export interface TractorBeamView {
  active: boolean;
  enemyId: number;
  x: number;
  y: number;
  length: number;
  halfWidth: number;
  intensity: number;
}

export type GameEvent =
  | { type: 'shoot' }
  | { type: 'enemyShoot'; x: number; y: number }
  | { type: 'enemyExplode'; x: number; y: number; kind: EnemyKind; points: number }
  | { type: 'playerExplode'; x: number; y: number }
  | { type: 'capture'; x: number; y: number }
  | { type: 'rescue'; x: number; y: number }
  | { type: 'dive'; kind: EnemyKind }
  | { type: 'stageStart'; stage: number; challenge: boolean }
  | { type: 'stageClear'; stage: number }
  | { type: 'extraLife' }
  | { type: 'gameOver' }
  | { type: 'groupBonus'; points: number; x: number; y: number }
  | { type: 'perfect'; points: number }
  /** Stage 255 has been cleared: the machine has been beaten. */
  | { type: 'victory'; score: number }
  /** A shot was created at the left edge and will never be freed. */
  | { type: 'shotJam'; slot: number }
  /** The last shot slot jammed: the fleet can no longer fire. */
  | { type: 'noFire' };

export interface PlayerState {
  score: number;
  lives: number;
  nextExtraLife: number;
  alive: boolean;
  /** Number of fighters flying as one: 1 normally, 2 after a rescue. */
  ships: 1 | 2;
}

export interface PlayerShip {
  x: number;
  y: number;
  cooldown: number;
  invulnerable: number;
  respawning: number;
  visible: boolean;
}

export type Phase = 'attract' | 'stageIntro' | 'playing' | 'stageClear' | 'gameOver' | 'victory';

/**
 * State of one of the eight enemy shot slots.
 *
 * `hung` is the arcade fault: a shot created at X=0 is never moved and never
 * removed, so the slot stays taken for the rest of the credit.
 */
export type ShotSlot = 'free' | 'live' | 'hung';

export interface InputState {
  left: boolean;
  right: boolean;
  fire: boolean;
  start1: boolean;
  start2: boolean;
  coin: boolean;
}

export interface EngineSnapshot {
  phase: Phase;
  stage: number;
  challenge: boolean;
  player: PlayerShip;
  players: PlayerState[];
  activePlayer: number;
  enemies: Enemy[];
  bullets: Bullet[];
  explosions: Explosion[];
  scores: FloatingScore[];
  tractor: TractorBeamView;
  highScore: number;
  score: number;
  lives: number;
  stageBanner: number;
  gameOverTimer: number;
  shipsLeft: Vec2[];
}
