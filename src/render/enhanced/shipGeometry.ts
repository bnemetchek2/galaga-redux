/**
 * 3D ship geometry generated from the classic pixel sprites.
 *
 * The silhouettes come from the sprites themselves, but they are supersampled
 * and smoothed before extrusion: tracing the raw 16x16 grid gives stair-stepped
 * edges that read as "granular" once the ships are on screen. Upsampling the
 * mask, tracing at 4x and relaxing the contour keeps the original shapes
 * (antennae, wing tips, cockpits) while giving smooth outlines.
 */

import * as THREE from 'three';
import { spritePixels, type SpriteKey } from '../classic/sprites.js';

const DEPTH_BASE = 2.6;
const DEPTH_STEP = 0.5;
const BEVEL = 0.42;

/** Supersampling factor for contour extraction. */
const SS = 4;
/** Contour relaxation passes, in supersampled units. */
const SMOOTH_PASSES = 3;
const SMOOTH_STRENGTH = 0.45;

/** Palette colours brighter than this get the unlit "glow" treatment. */
const GLOW_LUMINANCE = 0.72;
/** Only small bright regions glow -- eyes and wing spots, not a whole body. */
const GLOW_MAX_AREA = 8;

function luminance(cssColor: string): number {
  const hex = cssColor.replace('#', '');
  if (hex.length !== 6) return 0;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

interface Loop {
  /** Points in supersampled grid space, y pointing down. */
  points: Array<[number, number]>;
}

/** Closed boundary loops of a binary mask, traced on the pixel lattice. */
function traceLoops(mask: Uint8Array, w: number, h: number): Loop[] {
  const edges = new Map<string, Array<[number, number]>>();
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const key = `${x0},${y0}`;
    const list = edges.get(key);
    if (list) list.push([x1, y1]);
    else edges.set(key, [[x1, y1]]);
  };
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (!filled(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!filled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const loops: Loop[] = [];
  let guard = 0;
  while (edges.size > 0 && guard++ < 5000) {
    const firstKey = edges.keys().next().value as string;
    const [sx, sy] = firstKey.split(',').map(Number);
    let cx = sx;
    let cy = sy;
    const points: Array<[number, number]> = [[sx, sy]];

    for (let step = 0; step < 4000; step++) {
      const key = `${cx},${cy}`;
      const list = edges.get(key);
      if (!list || list.length === 0) {
        edges.delete(key);
        break;
      }
      const [nx, ny] = list.pop() as [number, number];
      if (list.length === 0) edges.delete(key);
      cx = nx;
      cy = ny;
      if (cx === sx && cy === sy) break;
      points.push([cx, cy]);
    }
    if (points.length >= 3) loops.push({ points: simplify(points) });
  }
  return loops;
}

/** Drop points that sit within `tolerance` of the chord between their neighbours. */
function simplify(points: Array<[number, number]>, tolerance = 0.35): Array<[number, number]> {
  if (points.length <= 4) return points;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const cur = points[i];
    const next = points[(i + 1) % points.length];
    const cx = next[0] - prev[0];
    const cy = next[1] - prev[1];
    const len = Math.hypot(cx, cy) || 1;
    const distance = Math.abs((cur[0] - prev[0]) * cy - (cur[1] - prev[1]) * cx) / len;
    if (distance > tolerance) out.push(cur);
  }
  return out.length >= 4 ? out : points;
}

/** Laplacian relaxation: rounds off the stair steps left by pixel contours. */
function relax(
  points: Array<[number, number]>,
  passes: number,
  strength: number,
): Array<[number, number]> {
  let current = points;
  for (let pass = 0; pass < passes; pass++) {
    const next: Array<[number, number]> = [];
    for (let i = 0; i < current.length; i++) {
      const prev = current[(i - 1 + current.length) % current.length];
      const cur = current[i];
      const then = current[(i + 1) % current.length];
      next.push([
        cur[0] + ((prev[0] + then[0]) / 2 - cur[0]) * strength,
        cur[1] + ((prev[1] + then[1]) / 2 - cur[1]) * strength,
      ]);
    }
    current = next;
  }
  return current;
}

/**
 * Bilinear-supersample a binary mask. A 16x16 sprite becomes a 64x64 field, so
 * the traced contour has quarter-pixel resolution and thin features (antennae,
 * wing tips) survive the smoothing pass.
 */
function upsample(
  mask: Uint8Array,
  w: number,
  h: number,
): { data: Uint8Array; w: number; h: number } {
  const width = w * SS;
  const height = h * SS;
  const data = new Uint8Array(width * height);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) / SS - 0.5;
      const fy = (y + 0.5) / SS - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const value =
        at(x0, y0) * (1 - tx) * (1 - ty) +
        at(x0 + 1, y0) * tx * (1 - ty) +
        at(x0, y0 + 1) * (1 - tx) * ty +
        at(x0 + 1, y0 + 1) * tx * ty;
      data[y * width + x] = value >= 0.5 ? 1 : 0;
    }
  }
  return { data, w: width, h: height };
}

function signedArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > point[1] !== yj > point[1];
    if (intersects && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function paint(geometry: THREE.BufferGeometry, cssColor: string): void {
  const count = geometry.getAttribute('position').count;
  const color = new THREE.Color(cssColor);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const part of parts) total += part.getAttribute('position').count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  let offset = 0;

  for (const part of parts) {
    const p = part.getAttribute('position');
    const n = part.getAttribute('normal');
    const c = part.getAttribute('color');
    position.set(p.array as Float32Array, offset * 3);
    if (n) normal.set(n.array as Float32Array, offset * 3);
    if (c) color.set(c.array as Float32Array, offset * 3);
    offset += p.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return merged;
}

const cache = new Map<SpriteKey, ShipGeometry>();

export interface ShipGeometry {
  /** Lit, vertex-coloured hull. */
  hull: THREE.BufferGeometry;
  /** Bright palette regions, rendered unlit so they glow and bloom. */
  glow: THREE.BufferGeometry | null;
}

/**
 * One hull per ship, coloured per palette entry and layered by colour so the
 * wings, body and canopy sit at different reliefs. Bright palette entries are
 * duplicated as an unlit shell so eyes, canopies and wing tips keep the punch
 * they have in the arcade original.
 */
export function shipGeometries(key: SpriteKey): ShipGeometry {
  const cached = cache.get(key);
  if (cached) return cached;

  const { width: w, height: h, data, palette } = spritePixels(key);
  const parts: THREE.BufferGeometry[] = [];
  const glowParts: THREE.BufferGeometry[] = [];
  const isPlayer = key === 'player';

  for (let colour = 1; colour < palette.length; colour++) {
    const mask = new Uint8Array(w * h);
    let used = false;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === colour) {
        mask[i] = 1;
        used = true;
      }
    }
    if (!used) continue;

    // Supersample, trace and relax: smooth hull edges that still follow the
    // original sprite, then convert back to sprite units with y pointing up.
    const up = upsample(mask, w, h);
    const loops = traceLoops(up.data, up.w, up.h)
      .map((loop) => {
        const smoothed = simplify(relax(loop.points, SMOOTH_PASSES, SMOOTH_STRENGTH), 0.22);
        const points = smoothed.map(([x, y]) => [x / SS, (up.h - y) / SS] as [number, number]);
        return signedArea(points) < 0 ? points.reverse() : points;
      })
      .filter((points) => points.length >= 3 && Math.abs(signedArea(points)) > 0.5);
    loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));

    const outers: Array<{ points: Array<[number, number]>; area: number }> = [];
    const holes: Array<{ points: Array<[number, number]>; parent: number }> = [];
    for (const points of loops) {
      const area = Math.abs(signedArea(points));
      const parent = outers.findIndex((outer) => pointInPolygon(points[0], outer.points));
      if (parent >= 0) holes.push({ points, parent });
      else outers.push({ points, area });
    }

    const depth = DEPTH_BASE + ((colour - 1) % 4) * DEPTH_STEP;
    outers.forEach((outer, index) => {
      const shape = new THREE.Shape(outer.points.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const hole of holes) {
        if (hole.parent !== index) continue;
        shape.holes.push(new THREE.Path(hole.points.map(([x, y]) => new THREE.Vector2(x, y))));
      }
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        steps: 1,
        bevelEnabled: true,
        bevelThickness: BEVEL,
        bevelSize: BEVEL * 0.75,
        bevelSegments: 2,
        curveSegments: 1,
      });
      geometry.translate(0, 0, -depth / 2);
      paint(geometry, palette[colour]);
      parts.push(geometry);

      if (luminance(palette[colour]) > GLOW_LUMINANCE && outer.area <= GLOW_MAX_AREA) {
        const accent = geometry.clone();
        accent.translate(0, 0, 0.3);
        glowParts.push(accent);
      }
    });
  }

  const merged = parts.length > 0 ? mergeGeometries(parts) : new THREE.BoxGeometry(w, h, 2);
  merged.translate(-w / 2, -h / 2, 0);
  merged.computeVertexNormals();
  if (isPlayer) merged.computeBoundingSphere();

  const glow = glowParts.length > 0 ? mergeGeometries(glowParts) : null;
  if (glow) glow.translate(-w / 2, -h / 2, 0);

  const result: ShipGeometry = { hull: merged, glow };
  cache.set(key, result);
  return result;
}

