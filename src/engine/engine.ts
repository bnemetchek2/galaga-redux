/**
 * The Galaga simulation.
 *
 * This class is the single source of truth for the game. It contains no DOM,
 * no canvas and no rendering code of any kind: it advances a fixed 1/60 s step
 * and exposes immutable-ish state for whatever wants to draw it. That is what
 * guarantees the classic and enhanced renderers can never disagree -- in
 * side-by-side mode both of them read this exact object.
 */

import {
  BOSS_RADIUS,
  ENEMY_BULLET_H,
  ENEMY_BULLET_W,
  ENEMY_RADIUS,
  EXTRA_LIFE_EVERY,
  EXTRA_LIFE_FIRST,
  FORMATION_COLS,
  MAX_PLAYER_BULLETS,
  MAX_PLAYER_BULLETS_DUAL,
  MAX_STAGE,
  PLAYER_BULLET_SPEED,
  PLAYER_FIRE_COOLDOWN,
  PLAYER_INVULN_TIME,
  PLAYER_MAX_X,
  PLAYER_MIN_X,
  PLAYER_RESPAWN_TIME,
  PLAYER_SPEED,
  PLAYER_Y,
  SCORE,
  SCREEN_H,
  SCREEN_W,
  STARTING_LIVES,
  challengeGroupBonus,
} from './constants.js';
import { Rng, hashString } from './rng.js';
import { BeamPath, angleFromTangent, clamp, lerp, type Vec2 } from './paths.js';
import {
  buildChallengePath,
  buildEntrancePath,
  buildStage,
  scoreFor,
  slotPosition,
  type EntranceKind,
  type StageSpec,
} from './stages.js';
import type {
  Bullet,
  Enemy,
  EnemyKind,
  Explosion,
  FloatingScore,
  GameEvent,
  InputState,
  Phase,
  PlayerShip,
  PlayerState,
  ShotSlot,
  TractorBeamView,
} from './types.js';

interface PendingSpawn {
  at: number;
  kind: EnemyKind;
  entrance: EntranceKind;
  slot: number;
  speed: number;
  challengeGroup: number;
  challenge: boolean;
}

const PLAYER_CENTER_X = SCREEN_W / 2;
const BEAM_LENGTH = 124;
const BEAM_BASE_HALF = 4;
const BEAM_TIP_HALF = 24;
const BEAM_Y = 132;

/**
 * The cabinet keeps enemy fire in eight shared slots. A shot created at X=0 is
 * invisible to the movement routine (X=0 marks a disabled sprite) and the
 * removal routine only looks at Y, so it never leaves the slot. Enough of those
 * and the fleet cannot fire at all -- the famous "no fire" bug.
 */
const SHOT_SLOTS = 8;
/** How close to the screen edge a diving ship must be to drop a shot at X=0. */
const SHOT_JAM_EDGE = 6;
/** Probability per edge shot. The arcade averages one every couple of minutes. */
const SHOT_JAM_CHANCE = 0.075;

export interface EngineOptions {
  seed?: number;
  highScore?: number;
  players?: 1 | 2;
}

export class GalagaEngine {
  phase: Phase = 'attract';
  stage = 1;
  challenge = false;
  time = 0;

  readonly rng: Rng;
  highScore: number;
  players: PlayerState[];
  activePlayer = 0;
  player: PlayerShip;

  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  explosions: Explosion[] = [];
  scorePopups: FloatingScore[] = [];
  tractor: TractorBeamView = {
    active: false,
    enemyId: -1,
    x: 0,
    y: 0,
    length: BEAM_LENGTH,
    halfWidth: BEAM_BASE_HALF,
    intensity: 0,
  };

  input: InputState = {
    left: false,
    right: false,
    fire: false,
    start1: false,
    start2: false,
    coin: false,
  };

  /** Countdown used by the HUD to flash STAGE / READY. */
  stageBanner = 0;
  gameOverTimer = 0;
  credits = 0;

  /**
   * The eight enemy shot slots, in the order the machine scans them.
   * `hung` slots are the arcade bug and persist for the whole credit.
   */
  shotSlots: ShotSlot[] = new Array(SHOT_SLOTS).fill('free') as ShotSlot[];
  /** True when the player forced the bug on from the UI. */
  noFireBugForced = false;

  private events: GameEvent[] = [];
  private spec: StageSpec = buildStage(1);
  private pending: PendingSpawn[] = [];
  private stageClock = 0;
  private diveTimer = 2.4;
  private captureTimer = 14;
  private nextEnemyId = 1;
  private challengeKills: number[] = [];
  private challengeTotals: number[] = [];
  private capturedBossId = -1;
  private capturedStagesLeft = 0;
  private tmpA: Vec2 = { x: 0, y: 0 };
  private tmpB: Vec2 = { x: 0, y: 0 };
  private tmpC: Vec2 = { x: 0, y: 0 };
  private playerCount: 1 | 2 = 1;

  constructor(options: EngineOptions = {}) {
    this.rng = new Rng(options.seed ?? 0x5eed1234);
    this.highScore = options.highScore ?? 20000;
    this.playerCount = options.players ?? 1;
    this.players = [this.makePlayerState(), this.makePlayerState()];
    this.player = {
      x: PLAYER_CENTER_X,
      y: PLAYER_Y,
      cooldown: 0,
      invulnerable: 0,
      respawning: 0,
      visible: false,
    };
    this.buildAttractFleet();
  }

  // ---------------------------------------------------------------- public --

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  get score(): number {
    return this.players[this.activePlayer].score;
  }

  get lives(): number {
    return this.players[this.activePlayer].lives;
  }

  get ships(): 1 | 2 {
    return this.players[this.activePlayer].ships;
  }

  get isTwoPlayer(): boolean {
    return this.playerCount === 2;
  }

  /** Number of slots permanently jammed by the arcade fault. */
  get shotSlotsHung(): number {
    return this.shotSlots.reduce((n, s) => n + (s === 'hung' ? 1 : 0), 0);
  }

  /** True once every slot is jammed: no enemy in the game can fire. */
  get noFireActive(): boolean {
    return this.shotSlotsHung >= SHOT_SLOTS;
  }

  /** True when the bug is either forced on or has happened naturally. */
  get noFireBugEnabled(): boolean {
    return this.noFireBugForced || this.noFireActive;
  }

  /**
   * Force the no-fire bug on or off.
   *
   * On: every slot is corrupted at once, which is what fifteen minutes of
   * edge-bee diving does to the real machine. Off: the slot table is cleared.
   */
  setNoFireBug(enabled: boolean): void {
    this.noFireBugForced = enabled;
    if (enabled) {
      for (let i = 0; i < SHOT_SLOTS; i++) this.shotSlots[i] = 'hung';
      this.events.push({ type: 'noFire' });
    } else {
      for (let i = 0; i < SHOT_SLOTS; i++) this.shotSlots[i] = 'free';
    }
  }

  /** Test/demo hook: jam the first `count` free slots, as edge divers would. */
  debugJamShots(count = SHOT_SLOTS): void {
    let remaining = count;
    for (let i = 0; i < SHOT_SLOTS && remaining > 0; i++) {
      if (this.shotSlots[i] === 'free') {
        this.shotSlots[i] = 'hung';
        remaining--;
      }
    }
    if (this.noFireActive) this.events.push({ type: 'noFire' });
  }

  /** True while the fleet is still arriving (used by the HUD). */
  get wavesRemaining(): number {
    return this.pending.length;
  }

  setInput(key: keyof InputState, down: boolean): void {
    if (down && !this.input[key] && (key === 'start1' || key === 'start2')) {
      // Starting a game is only meaningful from the attract screen, after a
      // game over, or after the machine has been beaten.
      if (this.phase === 'attract' || this.phase === 'gameOver' || this.phase === 'victory') {
        this.startGame(key === 'start1' ? 1 : 2);
      }
    }
    if (down && !this.input[key] && key === 'coin') {
      this.credits++;
    }
    this.input[key] = down;
  }

  /** Begin a new game. Also used by the attract screen. */
  startGame(players: 1 | 2): void {
    this.playerCount = players;
    this.players = [this.makePlayerState(), this.makePlayerState()];
    this.activePlayer = 0;
    this.players[1].lives = players === 2 ? STARTING_LIVES : 0;
    this.stage = 1;
    this.capturedBossId = -1;
    this.capturedStagesLeft = 0;
    // A new credit gets a fresh shot-slot table: the bug is per game.
    this.noFireBugForced = false;
    for (let i = 0; i < SHOT_SLOTS; i++) this.shotSlots[i] = 'free';
    this.clearField();
    this.beginStage(1);
  }

  /** Return to the attract screen. */
  attract(): void {
    this.clearField();
    this.phase = 'attract';
    this.player.visible = false;
    this.player.respawning = 0;
    this.player.invulnerable = 0;
    this.buildAttractFleet();
  }

  /**
   * Advance the simulation by one fixed step.
   * Rendering never calls this with a variable delta; the app owns the
   * accumulator so the simulation is frame-rate independent and reproducible.
   */
  update(dt: number): void {
    this.time += dt;

    switch (this.phase) {
      case 'attract':
        this.updateFormationSway(dt);
        break;
      case 'stageIntro':
        this.updatePlayer(dt);
        this.updateFormationSway(dt);
        this.stageBanner -= dt;
        if (this.stageBanner <= 0) {
          this.phase = 'playing';
          this.stageBanner = 0;
        }
        break;
      case 'playing':
        this.stageClock += dt;
        this.updatePlayer(dt);
        this.spawnPending();
        this.updateEnemies(dt);
        this.updateBullets(dt);
        this.updateScheduling(dt);
        this.resolveCollisions();
        this.checkStageClear();
        break;
      case 'stageClear':
        this.updateFormationSway(dt);
        this.stageBanner -= dt;
        if (this.stageBanner <= 0) {
          this.beginStage(this.stage + 1);
        }
        break;
      case 'victory':
        this.updateFormationSway(dt);
        this.stageBanner -= dt;
        if (this.stageBanner <= 0) this.attract();
        break;
      case 'gameOver':
        this.updateFormationSway(dt);
        this.gameOverTimer -= dt;
        if (this.gameOverTimer <= 0) this.attract();
        break;
    }

    this.updateEffects(dt);
  }

  /** Stable fingerprint of the whole simulation, for determinism tests. */
  snapshotHash(): string {
    const parts: (string | number)[] = [
      this.phase,
      this.stage,
      this.time.toFixed(4),
      this.rng.getState(),
      this.score,
      this.lives,
      this.player.x.toFixed(3),
      this.player.visible ? 1 : 0,
      this.enemies.length,
    ];
    for (const e of this.enemies) {
      parts.push(e.id, e.kind, e.state, e.x.toFixed(2), e.y.toFixed(2), e.t.toFixed(3));
    }
    for (const b of this.bullets) {
      parts.push(b.x.toFixed(2), b.y.toFixed(2), b.from);
    }
    return hashString(parts.join('|')).toString(16);
  }

  // --------------------------------------------------------------- set-up --

  private makePlayerState(): PlayerState {
    return {
      score: 0,
      lives: STARTING_LIVES,
      nextExtraLife: EXTRA_LIFE_FIRST,
      alive: true,
      ships: 1,
    };
  }

  private clearField(): void {
    this.enemies = [];
    this.bullets = [];
    this.pending = [];
    this.explosions = [];
    this.scorePopups = [];
    this.stageClock = 0;
    this.tractor.active = false;
    this.tractor.intensity = 0;
  }

  private buildAttractFleet(): void {
    this.enemies = [];
    this.nextEnemyId = 1;
    const layout: [EnemyKind, number, number[]][] = [
      ['boss', 0, [2, 3, 4, 5]],
      ['butterfly', 1, [0, 1, 2, 3, 4, 5, 6, 7]],
      ['butterfly', 2, [0, 1, 2, 3, 4, 5, 6, 7]],
      ['bee', 3, [0, 1, 2, 3, 4, 5, 6, 7]],
      ['bee', 4, [0, 1, 2, 3, 4, 5, 6, 7]],
    ];
    for (const [kind, row, cols] of layout) {
      for (const col of cols) {
        const pos = slotPosition(col, row, { x: 0, y: 0 });
        this.enemies.push(this.makeEnemy(kind, col, row, pos.x, pos.y, 'formation'));
      }
    }
  }

  private makeEnemy(
    kind: EnemyKind,
    col: number,
    row: number,
    x: number,
    y: number,
    state: Enemy['state'],
  ): Enemy {
    return {
      id: this.nextEnemyId++,
      kind,
      state,
      x,
      y,
      angle: 0,
      col,
      row,
      hp: kind === 'boss' ? 2 : 1,
      t: 0,
      path: null,
      pathDuration: 1,
      delay: 0,
      phase: this.rng.range(0, Math.PI * 2),
      fireTimer: this.rng.range(0.4, 2.2),
      challengeGroup: 0,
      beamTimer: 0,
      beamPhase: 'approach',
      beamIntensity: 0,
      capturedShip: false,
      diveRole: 'none',
      escorts: 0,
      flash: 0,
      shotsLeft: 0,
      alive: true,
    };
  }

  private beginStage(stage: number): void {
    this.stage = ((stage - 1) % MAX_STAGE) + 1;
    this.spec = buildStage(this.stage);
    this.challenge = this.spec.challenge;
    this.clearField();
    this.phase = 'stageIntro';
    this.stageBanner = 2.1;
    this.stageClock = 0;
    this.diveTimer = 2.6;
    this.captureTimer = 12 + this.rng.range(0, 8);

    this.player.x = PLAYER_CENTER_X;
    this.player.y = PLAYER_Y;
    this.player.visible = true;
    this.player.respawning = 0;
    this.player.invulnerable = PLAYER_INVULN_TIME;

    const spec = this.spec;
    const pending: PendingSpawn[] = [];
    if (spec.challenge) {
      this.challengeTotals = new Array(5).fill(8);
      this.challengeKills = new Array(5).fill(0);
      let group = 0;
      for (const wave of spec.waves) {
        for (let i = 0; i < wave.slots.length; i++) {
          pending.push({
            at: wave.startDelay + i * wave.spacing,
            kind: wave.kind,
            entrance: wave.entrance,
            slot: wave.slots[i],
            speed: wave.speed,
            challengeGroup: group,
            challenge: true,
          });
        }
        group++;
      }
    } else {
      for (const wave of this.spec.waves) {
        for (let i = 0; i < wave.slots.length; i++) {
          pending.push({
            at: wave.startDelay + i * wave.spacing,
            kind: wave.kind,
            entrance: wave.entrance,
            slot: wave.slots[i],
            speed: wave.speed,
            challengeGroup: 0,
            challenge: false,
          });
        }
      }
    }
    pending.sort((a, b) => a.at - b.at);
    this.pending = pending;

    this.events.push({ type: 'stageStart', stage: this.stage, challenge: this.challenge });
  }

  private spawnPending(): void {
    while (this.pending.length > 0 && this.pending[0].at <= this.stageClock) {
      const p = this.pending.shift()!;
      this.spawnEnemy(p);
    }
  }

  private spawnEnemy(p: PendingSpawn): void {
    const col = p.slot % FORMATION_COLS;
    const row = Math.floor(p.slot / FORMATION_COLS);
    const slot = slotPosition(col, row, { x: 0, y: 0 });

    let path: BeamPath;
    if (p.challenge) {
      path = buildChallengePath(p.challengeGroup, slot);
    } else {
      path = buildEntrancePath(p.entrance, slot);
    }
    const length = path.length();
    const duration = clamp(length / p.speed, 0.8, 7);

    const start = path.sample(0, { x: 0, y: 0 });
    const enemy = this.makeEnemy(p.kind, col, row, start.x, start.y, p.challenge ? 'challenge' : 'enter');
    enemy.path = path;
    enemy.pathDuration = duration;
    enemy.challengeGroup = p.challengeGroup;
    this.enemies.push(enemy);
  }

  // --------------------------------------------------------------- player --

  private updatePlayer(dt: number): void {
    const p = this.players[this.activePlayer];
    if (!p.alive) return;

    if (this.player.respawning > 0) {
      this.player.respawning -= dt;
      this.player.visible = false;
      if (this.player.respawning <= 0) {
        this.player.visible = true;
        this.player.invulnerable = PLAYER_INVULN_TIME;
      }
      return;
    }

    let dx = 0;
    if (this.input.left) dx -= 1;
    if (this.input.right) dx += 1;
    if (dx !== 0) {
      this.player.x = clamp(this.player.x + dx * PLAYER_SPEED * dt, PLAYER_MIN_X, PLAYER_MAX_X);
    }

    if (this.tractor.active && this.tractor.intensity > 0.2) {
      // The beam drags the fighter toward its axis.
      const pull = 46 * this.tractor.intensity * dt;
      const delta = this.tractor.x - this.player.x;
      this.player.x = clamp(this.player.x + Math.sign(delta) * Math.min(Math.abs(delta), pull), PLAYER_MIN_X, PLAYER_MAX_X);
    }

    if (this.player.invulnerable > 0) this.player.invulnerable -= dt;
    if (this.player.cooldown > 0) this.player.cooldown -= dt;

    if (this.input.fire && this.player.cooldown <= 0) this.firePlayerWeapon();
  }

  private firePlayerWeapon(): void {
    const dual = this.ships === 2;
    const max = dual ? MAX_PLAYER_BULLETS_DUAL : MAX_PLAYER_BULLETS;
    const live = this.bullets.reduce((n, b) => n + (b.from === 'player' && b.alive ? 1 : 0), 0);
    const offsets = dual ? [-6, 6] : [0];
    if (live + offsets.length > max) return;

    for (const offset of offsets) {
      this.bullets.push({
        x: this.player.x + offset,
        y: this.player.y - 10,
        vx: 0,
        vy: -PLAYER_BULLET_SPEED,
        alive: true,
        from: 'player',
        variant: dual ? 1 : 0,
        slot: -1,
      });
    }
    this.player.cooldown = PLAYER_FIRE_COOLDOWN * (dual ? 0.85 : 1);
    this.events.push({ type: 'shoot' });
  }

  private killPlayer(capturedBy: Enemy | null): void {
    const p = this.players[this.activePlayer];
    if (this.player.invulnerable > 0 && !capturedBy) return;

    this.events.push(
      capturedBy
        ? { type: 'capture', x: this.player.x, y: this.player.y }
        : { type: 'playerExplode', x: this.player.x, y: this.player.y },
    );
    this.pushExplosion(this.player.x, this.player.y, 'player', 18);

    p.lives = Math.max(0, p.lives - 1);
    p.ships = 1;
    this.player.visible = false;
    this.player.respawning = PLAYER_RESPAWN_TIME;
    this.player.cooldown = 0;

    if (capturedBy) {
      capturedBy.capturedShip = true;
      capturedBy.state = 'return';
      capturedBy.path = this.returnPath(capturedBy);
      capturedBy.t = 0;
      capturedBy.pathDuration = 1.5;
      capturedBy.beamIntensity = 0;
      capturedBy.beamPhase = 'close';
      this.capturedBossId = capturedBy.id;
      this.capturedStagesLeft = 3;
      this.tractor.active = false;
      this.tractor.intensity = 0;
    }

    if (this.playerCount === 2) {
      const other = this.players[1 - this.activePlayer];
      if (other.lives > 0) {
        this.activePlayer = 1 - this.activePlayer;
        this.player.x = PLAYER_CENTER_X;
        this.player.respawning = PLAYER_RESPAWN_TIME * 0.8;
        return;
      }
    }

    if (p.lives <= 0) {
      this.endGame();
    }
  }

  private endGame(): void {
    this.phase = 'gameOver';
    this.gameOverTimer = 3.2;
    this.player.visible = false;
    if (this.score > this.highScore) this.highScore = this.score;
    this.events.push({ type: 'gameOver' });
  }

  // -------------------------------------------------------------- enemies --

  private updateFormationSway(dt: number): void {
    for (const e of this.enemies) {
      if (e.state !== 'formation') continue;
      this.moveTowardFormation(e, dt);
    }
  }

  private moveTowardFormation(e: Enemy, dt: number): void {
    const slot = slotPosition(e.col, e.row, this.tmpA);
    const swayX = Math.sin(this.time * 1.1 + e.row * 0.8 + e.col * 0.24) * 2.4;
    const swayY = Math.cos(this.time * 0.85 + e.col * 0.45 + e.row * 0.2) * 1.2;
    const k = 1 - Math.exp(-dt * 7);
    e.x = lerp(e.x, slot.x + swayX, k);
    e.y = lerp(e.y, slot.y + swayY, k);
    e.angle = lerp(e.angle, Math.sin(this.time * 1.1 + e.phase) * 0.06, k);
  }

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt);

      switch (e.state) {
        case 'enter':
        case 'challenge': {
          if (!e.path) {
            e.alive = false;
            break;
          }
          e.t += dt / e.pathDuration;
          if (e.t >= 1) {
            if (e.state === 'challenge') {
              e.alive = false;
              break;
            }
            e.state = 'formation';
            e.t = 0;
            e.path = null;
            break;
          }
          const p = e.path!.sample(e.t, this.tmpB);
          const tan = e.path!.tangent(e.t, this.tmpC);
          e.x = p.x;
          e.y = p.y;
          e.angle = angleFromTangent(tan.x, tan.y);
          break;
        }
        case 'formation':
          this.moveTowardFormation(e, dt);
          break;
        case 'dive': {
          if (e.delay > 0) {
            e.delay -= dt;
            break;
          }
          e.t += dt / e.pathDuration;
          if (e.t >= 1) {
            // Off the bottom of the screen: wrap to the top and climb home.
            const exit = e.path!.sample(1, this.tmpB);
            e.x = exit.x;
            e.y = -20;
            e.path = this.returnPath(e);
            e.t = 0;
            e.pathDuration = 1.35;
            e.state = 'return';
            break;
          }
          const p = e.path!.sample(e.t, this.tmpB);
          const tan = e.path!.tangent(e.t, this.tmpC);
          e.x = p.x;
          e.y = p.y;
          e.angle = angleFromTangent(tan.x, tan.y);
          this.maybeDiveFire(e, dt);
          break;
        }
        case 'return': {
          e.t += dt / e.pathDuration;
          if (e.t >= 1) {
            e.state = 'formation';
            e.t = 0;
            e.path = null;
            e.diveRole = 'none';
            e.escorts = 0;
            break;
          }
          const p = e.path!.sample(e.t, this.tmpB);
          const tan = e.path!.tangent(e.t, this.tmpC);
          e.x = p.x;
          e.y = p.y;
          e.angle = angleFromTangent(tan.x, tan.y);
          break;
        }
        case 'beam':
          this.updateBeam(e, dt);
          break;
        default:
          break;
      }

      if (e.state === 'formation' && !this.challenge) {
        e.fireTimer -= dt;
        if (e.fireTimer <= 0) {
          e.fireTimer = this.rng.range(3.5, 8);
          if (this.rng.chance(this.spec.formationFireRate * 0.25)) this.enemyShoot(e);
        }
      }
    }

    this.enemies = this.enemies.filter((e) => e.alive);
    if (this.capturedBossId !== -1 && !this.enemies.some((e) => e.id === this.capturedBossId)) {
      // The boss holding the captured fighter was destroyed elsewhere.
      this.capturedBossId = -1;
    }
  }

  private maybeDiveFire(e: Enemy, dt: number): void {
    if (this.challenge || e.shotsLeft <= 0) return;
    e.fireTimer -= dt;
    if (e.fireTimer > 0) return;
    if (e.t < 0.3 || e.t > 0.8) return;
    e.fireTimer = this.rng.range(0.55, 1.2);
    if (this.rng.chance(0.8)) {
      e.shotsLeft -= 1;
      this.enemyShoot(e);
    }
  }

  private enemyShoot(e: Enemy): void {
    // No free slot? No shot. That is the whole machine: eight rounds, shared.
    const free = this.shotSlots.indexOf('free');
    if (free === -1) return;

    // A ship hugging the screen edge drops its shot at X=0. The movement
    // routine ignores X=0 and the removal routine only watches Y, so that slot
    // is gone for good.
    const atEdge = e.x <= SHOT_JAM_EDGE || e.x >= SCREEN_W - SHOT_JAM_EDGE;
    if (atEdge && this.rng.chance(SHOT_JAM_CHANCE)) {
      this.shotSlots[free] = 'hung';
      this.events.push({ type: 'shotJam', slot: free });
      if (this.noFireActive) this.events.push({ type: 'noFire' });
      return;
    }

    const speed = this.spec.enemyBulletSpeed || 150;
    const targetX = this.player.x + this.rng.range(-12, 12);
    const dx = targetX - e.x;
    const dy = this.player.y + 8 - e.y;
    const len = Math.hypot(dx, dy) || 1;
    const spread = this.rng.range(-0.06, 0.06);
    this.shotSlots[free] = 'live';
    this.bullets.push({
      x: e.x,
      y: e.y + 8,
      vx: (dx / len) * speed * Math.cos(spread),
      vy: (dy / len) * speed,
      alive: true,
      from: 'enemy',
      variant: 0,
      slot: free,
    });
    this.events.push({ type: 'enemyShoot', x: e.x, y: e.y });
  }

  /** Release slots whose bullet has left play (or was consumed by a hit). */
  private syncShotSlots(): void {
    const live = new Set<number>();
    for (const b of this.bullets) {
      if (b.alive && b.from === 'enemy') live.add(b.slot);
    }
    for (let i = 0; i < SHOT_SLOTS; i++) {
      if (this.shotSlots[i] === 'live' && !live.has(i)) this.shotSlots[i] = 'free';
    }
  }

  private turnToBeam(e: Enemy): void {
    e.state = 'beam';
    e.beamTimer = 0;
    e.beamPhase = 'approach';
    e.beamIntensity = 0;
    e.t = 0;
    e.path = null;
    this.tractor.active = false;
    this.tractor.enemyId = e.id;
    this.tractor.x = e.x;
    this.tractor.y = e.y;
    this.tractor.intensity = 0;
  }

  private updateBeam(e: Enemy, dt: number): void {
    e.beamTimer += dt;
    const targetX = clamp(this.player.x, 34, SCREEN_W - 34);

    if (e.beamPhase === 'approach') {
      const k = 1 - Math.exp(-dt * 3.2);
      e.x = lerp(e.x, targetX, k);
      e.y = lerp(e.y, BEAM_Y, k);
      if (e.beamTimer >= 0.9) {
        e.beamPhase = 'open';
        e.beamTimer = 0;
      }
    } else if (e.beamPhase === 'open') {
      e.x = lerp(e.x, targetX, 1 - Math.exp(-dt * 2));
      e.beamIntensity = Math.min(1, e.beamTimer / 0.55);
      if (e.beamTimer >= 0.55) {
        e.beamPhase = 'hold';
        e.beamTimer = 0;
        this.tractor.active = true;
      }
    } else if (e.beamPhase === 'hold') {
      e.beamIntensity = 1;
      e.x = lerp(e.x, targetX, 1 - Math.exp(-dt * 1.2));
      if (this.playerCaughtByBeam(e) && this.player.visible) {
        this.killPlayer(e);
        return;
      }
      if (e.beamTimer >= 2.5) {
        e.beamPhase = 'close';
        e.beamTimer = 0;
      }
    } else {
      e.beamIntensity = Math.max(0, e.beamIntensity - dt / 0.45);
      if (e.beamIntensity <= 0) {
        this.tractor.active = false;
        e.state = 'return';
        e.path = this.returnPath(e);
        e.t = 0;
        e.pathDuration = 1.4;
        e.beamPhase = 'approach';
        return;
      }
    }

    this.tractor.x = e.x;
    this.tractor.y = e.y + 8;
    this.tractor.length = BEAM_LENGTH;
    this.tractor.halfWidth = lerp(BEAM_BASE_HALF, BEAM_TIP_HALF, e.beamIntensity);
    this.tractor.intensity = e.beamIntensity;
  }

  private playerCaughtByBeam(e: Enemy): boolean {
    const top = e.y + 8;
    const bottom = top + BEAM_LENGTH * 0.95;
    if (this.player.y < top || this.player.y > bottom) return false;
    const d = (this.player.y - top) / (bottom - top);
    const half = lerp(BEAM_BASE_HALF, BEAM_TIP_HALF, d) * (0.55 + 0.45 * e.beamIntensity);
    return Math.abs(this.player.x - e.x) <= half;
  }

  private returnPath(e: Enemy): BeamPath {
    const slot = slotPosition(e.col, e.row, { x: 0, y: 0 });
    const startX = e.x;
    const startY = e.y;
    return new BeamPath(
      [
        {
          p0: { x: startX, y: startY },
          p1: { x: startX + (slot.x - startX) * 0.35, y: startY - 40 },
          p2: { x: slot.x, y: slot.y + 46 },
          p3: { x: slot.x, y: slot.y },
        },
      ],
      [1],
    );
  }

  // --------------------------------------------------------- dive & spawn --

  private updateScheduling(dt: number): void {
    if (this.challenge) return;

    this.diveTimer -= dt;
    if (this.diveTimer <= 0) {
      this.diveTimer = this.rng.range(1.5, 3.4) / Math.max(0.4, this.spec.divePressure);
      this.launchDive();
    }

    if (this.spec.bossCapture && this.capturedBossId === -1) {
      this.captureTimer -= dt;
      if (this.captureTimer <= 0) {
        this.captureTimer = this.rng.range(18, 30);
        const bosses = this.enemies.filter((e) => e.kind === 'boss' && e.alive);
        const boss = bosses.find(
          (e) => e.state === 'formation' && !e.capturedShip,
        );
        // A lone flagship never attempts a capture (Jordan Dorrington's rule).
        if (boss && bosses.length > 1) this.turnToBeam(boss);
      }
    }
  }

  private launchDive(): void {
    const candidates = this.enemies.filter((e) => e.state === 'formation');
    if (candidates.length === 0) return;
    const divers = this.enemies.filter((e) => e.state === 'dive').length;
    if (divers >= this.spec.maxDivers) return;

    // Prefer the lowest ranks: they are the classic aggressors.
    candidates.sort((a, b) => b.row - a.row || a.id - b.id);
    const pool = candidates.slice(0, Math.max(3, Math.ceil(candidates.length / 2)));
    const leader = this.rng.pick(pool);

    if (leader.kind === 'boss') {
      const escortsWanted = this.rng.chance(0.65) ? this.rng.int(1, 2) : 0;
      const escorts = this.nearestEscorts(leader, escortsWanted);
      leader.diveRole = 'leader';
      leader.escorts = escorts.length;
      this.startDive(leader, 0);
      for (const [i, escort] of escorts.entries()) {
        escort.diveRole = 'escort';
        this.startDive(escort, (i + 1) * 0.12);
      }
      this.events.push({ type: 'dive', kind: 'boss' });
      return;
    }

    this.startDive(leader, 0);
    this.events.push({ type: 'dive', kind: leader.kind });

    if (this.rng.chance(0.35) && candidates.length > 3) {
      const partner = this.rng.pick(pool.filter((e) => e.id !== leader.id));
      if (partner) this.startDive(partner, 0.14);
    }
  }

  private nearestEscorts(boss: Enemy, count: number): Enemy[] {
    if (count <= 0) return [];
    return this.enemies
      .filter((e) => e.state === 'formation' && e.kind !== 'boss' && e.id !== boss.id)
      .sort((a, b) => {
        const da = Math.abs(a.col - boss.col) + Math.abs(a.row - boss.row) * 1.5;
        const db = Math.abs(b.col - boss.col) + Math.abs(b.row - boss.row) * 1.5;
        return da - db;
      })
      .slice(0, count);
  }

  private startDive(e: Enemy, delay: number): void {
    const dir = this.rng.chance(0.5) ? -1 : 1;
    const targetX = clamp(this.player.x + this.rng.range(-34, 34), 22, SCREEN_W - 22);
    const start = { x: e.x, y: e.y };
    const midY = this.rng.range(140, 196);
    // With fewer than seven ships left the machine commits to its wide
    // "end game" sweep, which is what takes edge ships off the screen -- and
    // what eventually lets them drop a shot at X=0.
    const sweep = this.enemies.length < 7 ? 78 : 46;
    e.path = new BeamPath(
      [
        {
          p0: start,
          p1: { x: start.x + dir * 34, y: start.y + 38 },
          p2: { x: targetX + dir * sweep, y: midY - 40 },
          p3: { x: targetX, y: midY },
        },
        {
          p0: { x: targetX, y: midY },
          p1: { x: targetX - dir * sweep, y: midY + 34 },
          p2: { x: targetX - dir * 30, y: SCREEN_H - 30 },
          p3: { x: targetX - dir * 26, y: SCREEN_H + 30 },
        },
      ],
      [1.2, 1],
    );
    e.pathDuration = clamp(e.path.length() / (110 + this.stage * 2), 0.9, 2.6);
    e.state = 'dive';
    e.t = 0;
    e.delay = delay;
    e.fireTimer = 0.18;
    e.shotsLeft = e.kind === 'boss' ? 4 : this.rng.chance(0.5) ? 3 : 2;
    e.angle = 0;
  }

  // -------------------------------------------------------------- bullets --

  private updateBullets(dt: number): void {
    for (const b of this.bullets) {
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -12 || b.y > SCREEN_H + 12 || b.x < -12 || b.x > SCREEN_W + 12) b.alive = false;
    }
    this.bullets = this.bullets.filter((b) => b.alive);
    this.syncShotSlots();
  }

  // ----------------------------------------------------------- collisions --

  private resolveCollisions(): void {
    const shipHalf = this.ships === 2 ? 9 : 5;

    for (const b of this.bullets) {
      if (!b.alive) continue;
      if (b.from === 'player') {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const r = e.kind === 'boss' ? BOSS_RADIUS : ENEMY_RADIUS;
          if (Math.abs(b.x - e.x) < r && Math.abs(b.y - e.y) < r + 3) {
            b.alive = false;
            this.damageEnemy(e);
            break;
          }
        }
      } else if (this.player.visible && this.player.invulnerable <= 0) {
        if (
          Math.abs(b.x - this.player.x) < shipHalf + ENEMY_BULLET_W / 2 &&
          Math.abs(b.y - (this.player.y - 2)) < ENEMY_BULLET_H / 2 + 4
        ) {
          b.alive = false;
          this.killPlayer(null);
          if (this.phase === 'gameOver') return;
        }
      }
    }

    if (!this.player.visible || this.player.invulnerable > 0) return;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      // Ships that are still flying in (or crossing a challenging stage) pass
      // harmlessly: only ships that have broken formation can ram the fighter.
      if (e.state !== 'dive' && e.state !== 'return') continue;
      const r = e.kind === 'boss' ? BOSS_RADIUS : ENEMY_RADIUS;
      if (
        Math.abs(e.x - this.player.x) < r + shipHalf &&
        Math.abs(e.y - (this.player.y - 2)) < r + 6
      ) {
        this.pushExplosion(e.x, e.y, 'enemy', 14);
        e.alive = false;
        this.killPlayer(null);
        return;
      }
    }
  }

  private damageEnemy(e: Enemy): void {
    if (e.kind === 'boss' && !e.capturedShip && e.hp > 1) {
      e.hp -= 1;
      e.flash = 0.12;
      this.pushExplosion(e.x, e.y, 'spark', 6);
      return;
    }
    this.destroyEnemy(e);
  }

  private destroyEnemy(e: Enemy): void {
    e.alive = false;
    const diving = e.state === 'dive' || e.state === 'return' || e.state === 'beam';
    let points: number;

    if (this.challenge) {
      points = SCORE.challengeHit;
      const group = e.challengeGroup;
      this.challengeKills[group] = (this.challengeKills[group] ?? 0) + 1;
      if (this.challengeKills[group] === this.challengeTotals[group]) {
        const bonus = challengeGroupBonus(this.stage);
        this.addScore(bonus);
        this.events.push({ type: 'groupBonus', points: bonus, x: e.x, y: e.y });
        this.pushPopup(SCREEN_W / 2, 150, bonus);
      }
    } else {
      points = scoreFor(e.kind, diving, e.escorts);
      if (e.capturedShip) {
        points = SCORE.rescue;
        this.capturedBossId = -1;
        this.players[this.activePlayer].ships = 2;
        this.events.push({ type: 'rescue', x: e.x, y: e.y });
      }
    }

    this.addScore(points);
    this.pushExplosion(e.x, e.y, e.kind === 'boss' ? 'boss' : 'enemy', e.kind === 'boss' ? 20 : 13);
    this.events.push({ type: 'enemyExplode', x: e.x, y: e.y, kind: e.kind, points });
    if (points >= 400) this.pushPopup(e.x, e.y, points);
  }

  private addScore(points: number): void {
    const p = this.players[this.activePlayer];
    p.score += points;
    if (p.score > this.highScore) this.highScore = p.score;
    while (p.score >= p.nextExtraLife) {
      p.lives += 1;
      p.nextExtraLife += EXTRA_LIFE_EVERY;
      this.events.push({ type: 'extraLife' });
    }
  }

  private checkStageClear(): void {
    if (this.pending.length > 0) return;
    if (this.enemies.length > 0) return;

    if (this.challenge) {
      const kills = this.challengeKills.reduce((a, b) => a + b, 0);
      if (kills >= 40) {
        this.addScore(SCORE.perfect);
        this.events.push({ type: 'perfect', points: SCORE.perfect });
        this.pushPopup(SCREEN_W / 2, 160, SCORE.perfect);
      }
    }

    // Clearing the 255th stage beats the machine: this is the "kill screen"
    // moment, handled as a win rather than silently wrapping to stage 1.
    if (this.stage >= MAX_STAGE) {
      this.phase = 'victory';
      this.stageBanner = 9;
      if (this.score > this.highScore) this.highScore = this.score;
      this.events.push({ type: 'victory', score: this.score });
      return;
    }

    this.phase = 'stageClear';
    this.stageBanner = 1.7;
    this.events.push({ type: 'stageClear', stage: this.stage });

    if (this.capturedBossId !== -1) {
      this.capturedStagesLeft -= 1;
      if (this.capturedStagesLeft <= 0) this.capturedBossId = -1;
    }
  }

  // ---------------------------------------------------------------- effects --

  private pushExplosion(
    x: number,
    y: number,
    kind: Explosion['kind'],
    size: number,
  ): void {
    this.explosions.push({ x, y, age: 0, duration: kind === 'player' ? 0.85 : 0.5, size, kind, alive: true });
    if (this.explosions.length > 40) this.explosions.shift();
  }

  private pushPopup(x: number, y: number, value: number): void {
    this.scorePopups.push({ x, y, value, age: 0, duration: 0.9, alive: true });
  }

  private updateEffects(dt: number): void {
    for (const ex of this.explosions) {
      ex.age += dt;
      if (ex.age >= ex.duration) ex.alive = false;
    }
    this.explosions = this.explosions.filter((e) => e.alive);
    for (const s of this.scorePopups) {
      s.age += dt;
      s.y -= 12 * dt;
      if (s.age >= s.duration) s.alive = false;
    }
    this.scorePopups = this.scorePopups.filter((s) => s.alive);
  }

  // ------------------------------------------------------------ debugging --

  /** Force the fleet into formation instantly (used by tests and the demo). */
  populateFleet(): void {
    this.pending = [];
    this.clearField();
    this.buildAttractFleet();
    for (const e of this.enemies) e.state = 'formation';
  }

  /** Test hook: dive immediately. */
  forceDive(): void {
    this.launchDive();
  }

  /** Test hook: start a boss capture attempt if possible. */
  forceCapture(): boolean {
    const boss = this.enemies.find((e) => e.kind === 'boss' && e.state === 'formation');
    if (!boss) return false;
    this.turnToBeam(boss);
    return true;
  }

  /** Test hook: destroy an enemy as if it had been shot. */
  debugKill(enemyId: number): boolean {
    const enemy = this.enemies.find((e) => e.id === enemyId && e.alive);
    if (!enemy) return false;
    this.destroyEnemy(enemy);
    return true;
  }

  /** Test hook: give the active player the captured-fighter upgrade. */
  debugGrantDual(): void {
    this.players[this.activePlayer].ships = 2;
  }

  /** Test/demo hook: jump straight to a stage. */
  debugStage(stage: number): void {
    this.beginStage(stage);
  }
}

export type { Enemy, Bullet, EnemyKind, PlayerShip, PlayerState, Phase };
