/**
 * Logical playfield constants.
 *
 * The arcade machine this project re-implements renders a 224 x 288 framebuffer
 * (see docs/REVERSE-ENGINEERING.md). Every value here is expressed in those
 * logical pixels; renderers are free to scale them up.
 */

export const SCREEN_W = 224;
export const SCREEN_H = 288;

/** Height of the score band at the top of the screen. */
export const HUD_H = 26;

export const PLAY_TOP = HUD_H;
export const PLAY_BOTTOM = SCREEN_H;

/** Player fighter. */
export const PLAYER_Y = 252;
export const PLAYER_HALF_W = 7;
export const PLAYER_WINGSPAN = 9;
export const PLAYER_MIN_X = 12;
export const PLAYER_MAX_X = SCREEN_W - 12;
export const PLAYER_SPEED = 126;
export const PLAYER_FIRE_COOLDOWN = 0.15;
export const PLAYER_RESPAWN_TIME = 1.4;
export const PLAYER_INVULN_TIME = 2.2;
export const MAX_PLAYER_BULLETS = 2;
export const MAX_PLAYER_BULLETS_DUAL = 4;

/** Bullets. */
export const PLAYER_BULLET_SPEED = 430;
export const PLAYER_BULLET_W = 2;
export const PLAYER_BULLET_H = 6;
export const ENEMY_BULLET_W = 3;
export const ENEMY_BULLET_H = 6;

/** Formation grid: 8 columns x 5 rows = 40 slots. */
export const FORMATION_COLS = 8;
export const FORMATION_ROWS = 5;
export const FORMATION_DX = 21.7;
export const FORMATION_DY = 17.2;
export const FORMATION_TOP = 58;
export const FORMATION_LEFT = SCREEN_W / 2 - (FORMATION_DX * (FORMATION_COLS - 1)) / 2;

export const FORMATION_CENTER_X = SCREEN_W / 2;

/** Enemy tuning. */
export const ENEMY_RADIUS = 7;
export const BOSS_RADIUS = 9;
export const ENEMY_FORMATION_FIRE_RATE = 3.4;

/** Scoring table (arcade values). */
export const SCORE = {
  bee: 50,
  butterfly: 80,
  boss: 150,
  beeDive: 100,
  butterflyDive: 160,
  bossDive: 400,
  bossDiveOneEscort: 800,
  bossDiveTwoEscorts: 1600,
  rescue: 1000,
  challengeHit: 100,
  perfect: 10000,
} as const;

/** Group bonus awarded for clearing a full flight of 8 in a challenging stage. */
export function challengeGroupBonus(stage: number): number {
  if (stage <= 2) return 1000;
  if (stage <= 4) return 1500;
  if (stage <= 6) return 2000;
  return 3000;
}

export const EXTRA_LIFE_FIRST = 20000;
export const EXTRA_LIFE_EVERY = 70000;
export const MAX_STAGE = 255;
export const STARTING_LIVES = 3;

/** The fixed simulation rate. The engine only ever advances in this increment. */
export const FIXED_DT = 1 / 60;
export const MAX_CATCHUP_STEPS = 5;
