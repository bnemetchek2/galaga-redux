/**
 * The classic view: an authentic 224x288 arcade framebuffer.
 *
 * Everything is drawn at 4x into an offscreen resolution so sprite rotation and
 * bitmap text stay sharp, then the canvas is CSS-scaled with nearest-neighbour
 * filtering. A CSS overlay supplies the scanlines and phosphor vignette.
 */

import { HUD_H, SCREEN_H, SCREEN_W } from '../../engine/constants.js';
import type { GalagaEngine } from '../../engine/engine.js';
import { drawText } from '../shared/font.js';
import { sprite, preloadSprites } from './sprites.js';
import type { GameRenderer } from '../renderer.js';

const SCALE = 4;

const COLOR = {
  red: '#ff2b2b',
  white: '#ffffff',
  dim: '#8f9bb3',
  cyan: '#5ad1ff',
  yellow: '#ffd23f',
  orange: '#ff8a2b',
  green: '#5affa0',
  violet: '#c07bff',
};

interface StarDot {
  x: number;
  y: number;
  speed: number;
  brightness: number;
  color: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class ClassicRenderer implements GameRenderer {
  readonly kind = 'classic' as const;

  private frame: HTMLDivElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stars: StarDot[] = [];
  private scroll = 0;
  private time = 0;
  private shake = 0;
  private lastLives = 3;
  private lastVisible = false;
  private blink = 0;

  mount(container: HTMLElement): void {
    preloadSprites();

    const canvas = document.createElement('canvas');
    canvas.width = SCREEN_W * SCALE;
    canvas.height = SCREEN_H * SCALE;
    canvas.className = 'classic-canvas';
    canvas.setAttribute('aria-label', 'Classic Galaga view');

    // A fixed-aspect frame keeps the 224x288 framebuffer from being stretched
    // when the pane is wider than the game.
    const frame = document.createElement('div');
    frame.className = 'classic-frame';
    frame.appendChild(canvas);
    container.appendChild(frame);
    this.frame = frame;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;

    const rand = mulberry32(0x1a2b3c4d);
    const palette = ['#ffffff', '#bfd8ff', '#ffd9a8', '#9fa8da'];
    this.stars = Array.from({ length: 64 }, () => ({
      x: rand() * SCREEN_W,
      y: rand() * SCREEN_H,
      speed: 4 + rand() * 22,
      brightness: 0.25 + rand() * 0.75,
      color: palette[Math.floor(rand() * palette.length)],
    }));
  }

  resize(): void {
    // The canvas is fixed-resolution; CSS scales it to the container.
  }

  dispose(): void {
    this.frame?.remove();
    this.frame = null;
    this.ctx = null;
  }

  render(engine: GalagaEngine, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Clamp effects: at 256× a frame covers seconds of game time and the
    // starfield would smear into a solid streak.
    const step = Math.min(dt, 0.05);
    this.blink += step;
    this.time += step;

    if (engine.lives < this.lastLives) this.shake = Math.min(1, this.shake + 0.9);
    this.lastLives = engine.lives;
    if (this.lastVisible && !engine.player.visible && engine.phase === 'playing') {
      this.shake = Math.min(1, this.shake + 0.6);
    }
    this.lastVisible = engine.player.visible;
    this.shake = Math.max(0, this.shake - step * 2.4);

    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    const shakeX = this.shake > 0.02 ? (hash2(this.blink * 1000, 1) - 0.5) * 5 * this.shake : 0;
    const shakeY = this.shake > 0.02 ? (hash2(this.blink * 1000, 2) - 0.5) * 5 * this.shake : 0;
    ctx.translate(shakeX, shakeY);

    this.drawBackground(ctx, engine, step);
    this.drawEnemies(ctx, engine);
    this.drawTractor(ctx, engine);
    this.drawPlayer(ctx, engine);
    this.drawBullets(ctx, engine);
    this.drawExplosions(ctx, engine);
    this.drawPopups(ctx, engine);
    this.drawHud(ctx, engine);
    this.drawOverlays(ctx, engine);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ------------------------------------------------------------ background --

  private drawBackground(ctx: CanvasRenderingContext2D, engine: GalagaEngine, dt: number): void {
    const boost = engine.phase === 'stageIntro' || engine.phase === 'stageClear' ? 3.4 : 1;
    this.scroll += dt;

    for (const star of this.stars) {
      star.y += star.speed * dt * boost;
      if (star.y > SCREEN_H) {
        star.y -= SCREEN_H;
        star.x = (star.x + 37.3) % SCREEN_W;
      }
      const flicker = 0.75 + 0.25 * Math.sin(this.scroll * 3 + star.x);
      ctx.globalAlpha = Math.min(1, star.brightness * flicker);
      ctx.fillStyle = star.color;
      ctx.fillRect(Math.round(star.x), Math.round(star.y), star.speed > 18 ? 2 : 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // --------------------------------------------------------------- sprites --

  private drawSpriteRotated(
    ctx: CanvasRenderingContext2D,
    key: 'bee' | 'butterfly' | 'boss' | 'player',
    x: number,
    y: number,
    angle: number,
    alpha = 1,
  ): void {
    const art = sprite(key);
    ctx.globalAlpha = alpha;
    if (Math.abs(angle) < 0.02) {
      ctx.drawImage(art.lo, Math.round(x - art.width / 2), Math.round(y - art.height / 2));
    } else {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.drawImage(art.lo, -art.width / 2, -art.height / 2, art.width, art.height);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, engine: GalagaEngine): void {
    for (const e of engine.enemies) {
      const x = Math.round(e.x);
      const y = Math.round(e.y);
      if (x < -20 || x > SCREEN_W + 20 || y < -24 || y > SCREEN_H + 24) continue;

      // A captured fighter is displayed tucked underneath the flagship.
      if (e.capturedShip) {
        this.drawSpriteRotated(ctx, 'player', e.x, e.y + 12, Math.PI, 1);
      }

      const key: 'bee' | 'butterfly' | 'boss' = e.kind;
      this.drawSpriteRotated(ctx, key, e.x, e.y, e.angle);

      if (e.flash > 0) {
        ctx.globalAlpha = Math.min(0.9, e.flash * 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 8, y - 8, 16, 16);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawTractor(ctx: CanvasRenderingContext2D, engine: GalagaEngine): void {
    const beam = engine.tractor;
    if (!beam.active && beam.intensity <= 0.01) return;
    const top = beam.y;
    const height = beam.length * beam.intensity;
    if (height <= 1) return;

    const half = 4 + (beam.halfWidth - 4) * beam.intensity;
    const gradient = ctx.createLinearGradient(beam.x, top, beam.x, top + height);
    gradient.addColorStop(0, 'rgba(120, 220, 255, 0.9)');
    gradient.addColorStop(0.45, 'rgba(70, 160, 255, 0.55)');
    gradient.addColorStop(1, 'rgba(200, 120, 255, 0.15)');

    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(beam.x - 3, top);
    ctx.lineTo(beam.x + 3, top);
    ctx.lineTo(beam.x + half, top + height);
    ctx.lineTo(beam.x - half, top + height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Sweeping rings travelling down the beam. Uses the renderer's own clock
    // (not wall time) so a paused frame is genuinely frozen.
    const t = this.time;
    for (let i = 0; i < 5; i++) {
      const p = ((t * 0.55 + i / 5) % 1) * beam.intensity;
      const w = 3 + (half - 3) * p;
      ctx.globalAlpha = 0.55 * (1 - p) * beam.intensity;
      ctx.fillStyle = COLOR.cyan;
      ctx.fillRect(beam.x - w, top + height * p, w * 2, 1.5);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, engine: GalagaEngine): void {
    if (!engine.player.visible) return;
    const invuln = engine.player.invulnerable > 0;
    if (invuln && Math.floor(this.blink * 14) % 2 === 0) return;

    const ships = engine.ships;
    const offsets = ships === 2 ? [-6, 6] : [0];
    for (const offset of offsets) {
      this.drawSpriteRotated(ctx, 'player', engine.player.x + offset, engine.player.y, 0);
    }

    // Thruster flicker.
    ctx.globalCompositeOperation = 'lighter';
    for (const offset of offsets) {
      const flick = 2 + (hash2(this.blink * 900, offset) > 0.5 ? 2 : 0);
      ctx.fillStyle = 'rgba(255, 190, 90, 0.9)';
      ctx.fillRect(engine.player.x + offset - 1, engine.player.y + 7, 2, flick);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawBullets(ctx: CanvasRenderingContext2D, engine: GalagaEngine): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of engine.bullets) {
      if (b.from === 'player') {
        ctx.fillStyle = '#eaf6ff';
        ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 3, 2, 7);
        ctx.fillStyle = 'rgba(120, 220, 255, 0.45)';
        ctx.fillRect(Math.round(b.x) - 2, Math.round(b.y) - 4, 4, 9);
      } else {
        ctx.fillStyle = '#ffd0a0';
        ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 3, 2, 6);
        ctx.fillStyle = 'rgba(255, 90, 40, 0.55)';
        ctx.fillRect(Math.round(b.x) - 2, Math.round(b.y) - 4, 4, 8);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawExplosions(ctx: CanvasRenderingContext2D, engine: GalagaEngine): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const ex of engine.explosions) {
      const t = ex.age / ex.duration;
      const radius = ex.size * (0.35 + t * 0.9);
      const alpha = 1 - t;
      const seed = hash2(ex.x * 7, ex.y * 13);

      if (ex.kind === 'spark') {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#fff3c4';
        ctx.fillRect(ex.x - 2, ex.y - 2, 4, 4);
        ctx.globalAlpha = 1;
        continue;
      }

      // Radial shards: deterministic from the explosion's position so both
      // views agree on the pattern.
      const shards = ex.kind === 'boss' ? 12 : 8;
      for (let i = 0; i < shards; i++) {
        const angle = ((i + seed) / shards) * Math.PI * 2;
        const dist = radius * (0.7 + ((i * 37) % 10) / 20);
        const px = ex.x + Math.cos(angle) * dist;
        const py = ex.y + Math.sin(angle) * dist;
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? COLOR.yellow : COLOR.orange;
        const size = Math.max(1, Math.round(3 - t * 2));
        ctx.fillRect(Math.round(px) - size / 2, Math.round(py) - size / 2, size, size);
      }

      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = t < 0.4 ? '#ffffff' : 'rgba(255, 170, 60, 0.7)';
      const core = Math.max(0, 4 * (1 - t));
      ctx.fillRect(ex.x - core / 2, ex.y - core / 2, core, core);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawPopups(ctx: CanvasRenderingContext2D, engine: GalagaEngine): void {
    for (const p of engine.scorePopups) {
      const alpha = Math.min(1, (p.duration - p.age) * 3);
      ctx.globalAlpha = alpha;
      drawText(ctx, String(p.value), p.x, p.y, {
        color: COLOR.yellow,
        align: 'center',
        scale: 1,
        shadow: '#000000',
      });
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------- hud --

  private drawHud(ctx: CanvasRenderingContext2D, engine: GalagaEngine): void {
    const p = engine.players[engine.activePlayer];
    drawText(ctx, '1UP', 4, 2, { color: COLOR.red, scale: 1 });
    drawText(ctx, String(engine.players[0].score).padStart(5, '0'), 4, 11, {
      color: COLOR.white,
      scale: 1,
    });

    if (engine.isTwoPlayer) {
      drawText(ctx, '2UP', SCREEN_W - 4, 2, { color: COLOR.red, scale: 1, align: 'right' });
      drawText(ctx, String(engine.players[1].score).padStart(5, '0'), SCREEN_W - 4, 11, {
        color: engine.activePlayer === 1 ? COLOR.white : COLOR.dim,
        scale: 1,
        align: 'right',
      });
    }

    drawText(ctx, 'HIGH SCORE', SCREEN_W / 2, 2, { color: COLOR.red, scale: 1, align: 'center' });
    drawText(ctx, String(engine.highScore).padStart(5, '0'), SCREEN_W / 2, 11, {
      color: COLOR.white,
      scale: 1,
      align: 'center',
    });

    // Lives.
    const flag = sprite('flag');
    const lives = engine.phase === 'attract' ? 0 : p.lives;
    for (let i = 0; i < Math.min(lives, 6); i++) {
      this.drawSpriteRotated(ctx, 'player', 8 + i * 11, SCREEN_H - 10, 0, 0.95);
    }

    // Stage flags, drawn as small pennants.
    const flags = Math.min(8, engine.stage - 1);
    for (let i = 0; i < flags; i++) {
      ctx.drawImage(flag.lo, SCREEN_W - 8 - i * 7, SCREEN_H - 12);
    }

    // Status line under the score band: the two things the player can switch on.
    if (engine.noFireBugEnabled) {
      const blink = engine.noFireBugForced || Math.floor(this.blink * 2) % 2 === 0;
      if (blink) {
        drawText(ctx, 'NO FIRE', 4, HUD_H + 2, { color: '#ff5a7a', scale: 1 });
      }
    }
    if (document.body.classList.contains('is-demo')) {
      drawText(ctx, 'DEMO', SCREEN_W - 4, HUD_H + 2, {
        color: COLOR.cyan,
        scale: 1,
        align: 'right',
      });
    }

    ctx.globalAlpha = 1;
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, engine: GalagaEngine): void {
    const cx = SCREEN_W / 2;

    if (engine.phase === 'attract') {
      drawText(ctx, 'GALAGA', cx, 150, {
        color: COLOR.yellow,
        scale: 3,
        align: 'center',
        shadow: '#7a3b00',
      });

      if (Math.floor(this.blink * 1.6) % 2 === 0) {
        drawText(ctx, 'PRESS 1 OR 2 TO START', cx, 196, {
          color: COLOR.white,
          scale: 1,
          align: 'center',
        });
      }
      drawText(ctx, 'ARROWS MOVE   CTRL FIRE', cx, 232, {
        color: COLOR.dim,
        scale: 1,
        align: 'center',
      });
      drawText(ctx, 'PRESS 0 FOR CREDIT', cx, 246, {
        color: COLOR.dim,
        scale: 1,
        align: 'center',
      });
      drawText(ctx, `CREDIT ${String(engine.credits).padStart(2, '0')}`, cx, 262, {
        color: COLOR.cyan,
        scale: 1,
        align: 'center',
      });
      return;
    }

    if (engine.phase === 'stageIntro') {
      const challenge = engine.challenge;
      const title = challenge ? 'CHALLENGING STAGE' : `STAGE ${engine.stage}`;
      drawText(ctx, title, cx, 118, {
        color: challenge ? COLOR.violet : COLOR.yellow,
        scale: challenge ? 1 : 2,
        align: 'center',
      });
      if (engine.stageBanner < 0.9 && Math.floor(this.blink * 5) % 2 === 0) {
        drawText(ctx, 'READY', cx, 146, { color: COLOR.white, scale: 2, align: 'center' });
      }
      if (engine.isTwoPlayer) {
        drawText(ctx, `PLAYER ${engine.activePlayer + 1}`, cx, 170, {
          color: engine.activePlayer === 0 ? COLOR.cyan : COLOR.violet,
          scale: 1,
          align: 'center',
        });
      }
    }

    if (engine.phase === 'stageClear') {
      drawText(ctx, 'STAGE CLEAR', cx, 128, { color: COLOR.green, scale: 2, align: 'center' });
      if (engine.challenge) {
        drawText(ctx, 'BONUS AWARDED', cx, 150, { color: COLOR.yellow, scale: 1, align: 'center' });
      }
    }

    if (engine.phase === 'gameOver') {
      drawText(ctx, 'GAME OVER', cx, 132, { color: COLOR.red, scale: 3, align: 'center' });
      drawText(ctx, `SCORE ${engine.score}`, cx, 162, {
        color: COLOR.white,
        scale: 1,
        align: 'center',
      });
    }

    if (engine.phase === 'victory') {
      drawText(ctx, 'MISSION', cx, 108, { color: COLOR.yellow, scale: 3, align: 'center' });
      drawText(ctx, 'COMPLETE', cx, 132, { color: COLOR.yellow, scale: 3, align: 'center' });
      drawText(ctx, 'STAGE 255 CLEARED', cx, 162, {
        color: COLOR.white,
        scale: 1,
        align: 'center',
      });
      drawText(ctx, `SCORE ${engine.score}`, cx, 176, {
        color: COLOR.cyan,
        scale: 1,
        align: 'center',
      });
      if (Math.floor(this.blink * 1.6) % 2 === 0) {
        drawText(ctx, 'PRESS 1 OR 2 TO PLAY AGAIN', cx, 206, {
          color: COLOR.white,
          scale: 1,
          align: 'center',
        });
      }
    }

    // Two-player turn indicator while playing.
    if (engine.phase === 'playing' && engine.isTwoPlayer) {
      const label = `PLAYER ${engine.activePlayer + 1}`;
      drawText(ctx, label, 4, HUD_H + 11, {
        color: engine.activePlayer === 0 ? COLOR.cyan : COLOR.violet,
        scale: 1,
      });
    }

    // Keep the score band visually separated from the playfield.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#4a6cff';
    ctx.fillRect(0, HUD_H - 1, SCREEN_W, 1);
    ctx.globalAlpha = 1;
  }
}

