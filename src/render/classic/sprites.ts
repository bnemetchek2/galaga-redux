/**
 * Hand-authored pixel sprites for the classic view.
 *
 * These are original drawings in the visual language of the 1981 arcade game --
 * a bee drone, a butterfly, a flagship and the player's fighter -- built from
 * symmetric pixel primitives so they stay crisp and readable at 1x.
 */

const RES = 4; // pre-rendered resolution multiplier for rotated drawing

class Grid {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
  }

  set(x: number, y: number, c: number): void {
    const px = x | 0;
    const py = y | 0;
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    this.data[py * this.w + px] = c;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) this.set(px, py, c);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number): void {
    const x0 = Math.floor(cx - rx);
    const x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry);
    const y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const tx = Math.round(x1);
    const ty = Math.round(y1);
    const dx = Math.abs(tx - x);
    const dy = Math.abs(ty - y);
    const sx = x < tx ? 1 : -1;
    const sy = y < ty ? 1 : -1;
    let err = dx - dy;
    for (let guard = 0; guard < 64; guard++) {
      this.set(x, y, c);
      if (x === tx && y === ty) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  poly(points: number[][], c: number): void {
    const ys: number[] = [];
    for (const p of points) ys.push(p[1]);
    const yMin = Math.max(0, Math.floor(Math.min(...ys)));
    const yMax = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = yMin; y <= yMax; y++) {
      const scanY = y + 0.5;
      const crossings: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if (ay === by) continue;
        if (scanY >= Math.min(ay, by) && scanY < Math.max(ay, by)) {
          crossings.push(ax + ((scanY - ay) / (by - ay)) * (bx - ax));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const xa = Math.round(crossings[i]);
        const xb = Math.round(crossings[i + 1]);
        for (let x = xa; x <= xb; x++) this.set(x, y, c);
      }
    }
  }

  /** Fill a polygon and its mirror image across the sprite's vertical axis. */
  symPoly(points: number[][], c: number): void {
    this.poly(points, c);
    this.poly(points.map(([x, y]) => [this.w - 1 - x, y]), c);
  }

  /** Recolor every pixel that currently holds `from`. */
  replace(from: number, to: number): void {
    for (let i = 0; i < this.data.length; i++) if (this.data[i] === from) this.data[i] = to;
  }

  /** Paint horizontal bands only where the body already exists. */
  bands(bodyIndex: number, bandColor: number, rows: number[]): void {
    for (const row of rows) {
      for (let x = 0; x < this.w; x++) if (this.get(x, row) === bodyIndex) this.set(x, row, bandColor);
    }
  }
}

export type SpriteKey = 'bee' | 'butterfly' | 'boss' | 'player' | 'flag';

export interface CachedSprite {
  width: number;
  height: number;
  /** 1 pixel per sprite pixel, for unrotated drawing. */
  lo: HTMLCanvasElement;
  /** RES pixels per sprite pixel, for smooth rotation. */
  hi: HTMLCanvasElement;
  palette: string[];
}

interface SpriteDef {
  key: SpriteKey;
  w: number;
  h: number;
  palette: string[];
  draw: (g: Grid) => void;
}

/** Bee drone: blue wings, banded yellow body, head towards the player. */
const BEE: SpriteDef = {
  key: 'bee',
  w: 16,
  h: 16,
  palette: ['', '#2b4bff', '#7ea2ff', '#ffd23f', '#c96a12', '#ffffff', '#ff4d4d'],
  draw: (g) => {
    // Angled wing blades, mirrored.
    g.symPoly(
      [
        [7, 4],
        [3, 2],
        [0.5, 6],
        [1.5, 11],
        [6, 10],
      ],
      1,
    );
    g.symPoly(
      [
        [6, 5],
        [3, 4],
        [1.8, 7],
        [2.5, 10],
        [5.5, 9],
      ],
      2,
    );
    // Slim body with warm bands.
    g.ellipse(8, 8, 2.3, 5.6, 3);
    g.bands(3, 4, [5, 6, 10]);
    // Head and eyes.
    g.ellipse(8, 13.6, 2.1, 1.7, 1);
    g.set(7, 13, 5);
    g.set(9, 13, 5);
    // Antennae.
    g.line(6.5, 15, 5, 15, 6);
    g.line(9.5, 15, 11, 15, 6);
  },
};

/** Butterfly: broad swept wings with pale panels and a slim body. */
const BUTTERFLY: SpriteDef = {
  key: 'butterfly',
  w: 18,
  h: 16,
  palette: ['', '#ff3b3b', '#ff9a9a', '#f7f7f7', '#3a6bff', '#ffd23f'],
  draw: (g) => {
    g.symPoly(
      [
        [8, 4],
        [3, 1],
        [0.5, 6],
        [1.5, 11],
        [3, 13],
        [7, 10],
      ],
      1,
    );
    g.symPoly(
      [
        [7, 5],
        [3.5, 3],
        [2, 7],
        [2.6, 10],
        [6, 9],
      ],
      2,
    );
    // Wing spots.
    g.ellipse(3.2, 7.5, 1.3, 2, 4);
    g.ellipse(14.8, 7.5, 1.3, 2, 4);
    // Body.
    g.ellipse(9, 7.8, 1.7, 5.2, 3);
    g.ellipse(9, 13.2, 1.7, 1.6, 1);
    g.set(8, 13, 4);
    g.set(10, 13, 4);
    g.line(7.5, 15, 6.5, 15, 5);
    g.line(10.5, 15, 11.5, 15, 5);
  },
};

/** Flagship: heavy green hull with blue wings and a yellow crest. */
const BOSS: SpriteDef = {
  key: 'boss',
  w: 20,
  h: 18,
  palette: ['', '#3ddc6b', '#1f9e46', '#3a4dff', '#8f9dff', '#ffd23f', '#ff5cc8', '#ffffff'],
  draw: (g) => {
    // Wings swept back from the hull.
    g.symPoly(
      [
        [9, 5],
        [4, 3],
        [1.5, 8],
        [2.5, 13],
        [8, 12],
      ],
      3,
    );
    g.symPoly(
      [
        [8.4, 6],
        [4.6, 5],
        [3.2, 8],
        [3.8, 11.4],
        [7.6, 10.6],
      ],
      4,
    );
    // Legs.
    g.line(3, 14, 2, 16, 2);
    g.line(17, 14, 18, 16, 2);
    // Hull.
    g.ellipse(10, 8, 3.3, 6.6, 1);
    g.bands(1, 2, [5, 10]);
    // Crest.
    g.poly(
      [
        [10, 0],
        [12.4, 4],
        [7.6, 4],
      ],
      5,
    );
    // Eyes.
    g.set(8.5, 13, 7);
    g.set(11.5, 13, 7);
    g.rect(8, 14, 1, 1, 6);
    g.rect(11, 14, 1, 1, 6);
  },
};

/** Player fighter, nose pointing up the screen. */
const PLAYER: SpriteDef = {
  key: 'player',
  w: 16,
  h: 16,
  palette: ['', '#e8ecff', '#b7c2ff', '#ff3b3b', '#4aa8ff', '#ffd23f'],
  draw: (g) => {
    // Fuselage.
    g.poly(
      [
        [8, 0],
        [5, 7],
        [5, 12],
        [8, 14],
        [11, 12],
        [11, 7],
      ],
      1,
    );
    // Swept wings.
    g.symPoly(
      [
        [6, 6],
        [0, 11],
        [1, 13],
        [6, 11],
      ],
      2,
    );
    // Wing tips.
    g.rect(0, 11, 2, 2, 3);
    g.rect(14, 11, 2, 2, 3);
    // Cockpit.
    g.rect(7, 3, 2, 4, 4);
    // Engine glow.
    g.rect(6, 14, 1, 2, 5);
    g.rect(9, 14, 1, 2, 5);
    g.set(8, 14, 3);
  },
};

/** Stage-completion flag in the bottom right corner. */
const FLAG: SpriteDef = {
  key: 'flag',
  w: 7,
  h: 8,
  palette: ['', '#ff3b3b', '#ffffff'],
  draw: (g) => {
    g.line(0, 0, 0, 7, 2);
    g.poly(
      [
        [1, 0],
        [6, 1],
        [1, 3],
      ],
      1,
    );
  },
};

const DEFS: SpriteDef[] = [BEE, BUTTERFLY, BOSS, PLAYER, FLAG];
const cache = new Map<SpriteKey, CachedSprite>();

function renderToCanvas(def: SpriteDef, grid: Grid, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = def.w * scale;
  canvas.height = def.h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < def.h; y++) {
    for (let x = 0; x < def.w; x++) {
      const index = grid.get(x, y);
      if (index === 0) continue;
      ctx.fillStyle = def.palette[index] ?? '#fff';
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas;
}

export function sprite(key: SpriteKey): CachedSprite {
  const cached = cache.get(key);
  if (cached) return cached;
  const def = DEFS.find((d) => d.key === key)!;
  const grid = new Grid(def.w, def.h);
  def.draw(grid);
  const entry: CachedSprite = {
    width: def.w,
    height: def.h,
    lo: renderToCanvas(def, grid, 1),
    hi: renderToCanvas(def, grid, RES),
    palette: def.palette,
  };
  cache.set(key, entry);
  return entry;
}

/** Warm the cache so the first frame is not spent rasterising sprites. */
export function preloadSprites(): void {
  for (const def of DEFS) sprite(def.key);
}
