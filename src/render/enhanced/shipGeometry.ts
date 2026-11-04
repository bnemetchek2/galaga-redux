/**
 * 3D ship geometry generated from the classic pixel sprites.
 *
 * The enhanced view used to be built from generic primitives, which read as
 * abstract shapes rather than Galaga ships. This module traces the *actual*
 * sprite silhouettes -- one contour per palette colour -- and extrudes them into
 * a layered hull, so the 3D fleet is recognisably the same fleet as the arcade
 * view, only with depth, bevelled edges and metal.
 */

import * as THREE from 'three';
import { spritePixels, type SpriteKey } from '../classic/sprites.js';

const DEPTH_BASE = 2.6;
const DEPTH_STEP = 0.5;
const BEVEL = 0.38;

interface Loop {
  /** Points in sprite grid space, y pointing down. */
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

/** Drop points that sit on a straight run. */
function simplify(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length <= 3) return points;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const cur = points[i];
    const next = points[(i + 1) % points.length];
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    if (cross !== 0) out.push(cur);
  }
  return out.length >= 3 ? out : points;
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

const cache = new Map<SpriteKey, THREE.BufferGeometry>();

/**
 * One hull per ship, coloured per palette entry and layered by colour so the
 * wings, body and canopy sit at different reliefs.
 */
export function shipHullGeometry(key: SpriteKey): THREE.BufferGeometry {
  const cached = cache.get(key);
  if (cached) return cached;

  const { width: w, height: h, data, palette } = spritePixels(key);
  const parts: THREE.BufferGeometry[] = [];
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

    // Convert to shape space (y up), then classify loops by containment.
    const loops = traceLoops(mask, w, h).map((loop) => {
      const points = loop.points.map(([x, y]) => [x, h - y] as [number, number]);
      return signedArea(points) < 0 ? points.reverse() : points;
    });
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
    });
  }

  const merged = parts.length > 0 ? mergeGeometries(parts) : new THREE.BoxGeometry(w, h, 2);
  merged.translate(-w / 2, -h / 2, 0);
  merged.computeVertexNormals();
  if (isPlayer) merged.computeBoundingSphere();

  cache.set(key, merged);
  return merged;
}

