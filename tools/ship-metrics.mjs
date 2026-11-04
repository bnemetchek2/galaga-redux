/**
 * Compares each 3D hull's bounding box to the sprite it came from, so the
 * ships keep the original's proportions.
 */
import * as THREE from 'three';
import { spritePixels } from '../dist/src/render/classic/sprites.js';
import { shipGeometries } from '../dist/src/render/enhanced/shipGeometry.js';

function spriteBox(key) {
  const { width: w, height: h, data } = spritePixels(key);
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

for (const key of ['bee', 'butterfly', 'boss', 'player']) {
  const sprite = spriteBox(key);
  const { hull } = shipGeometries(key);
  hull.computeBoundingBox();
  const box = hull.boundingBox ?? new THREE.Box3();
  const size = new THREE.Vector3();
  box.getSize(size);
  const aspectSprite = (sprite.width / sprite.height).toFixed(3);
  const aspectGeom = (size.x / size.y).toFixed(3);
  console.log(
    key.padEnd(10),
    'sprite', `${sprite.width}x${sprite.height} (${aspectSprite})`,
    '| hull', `${size.x.toFixed(2)}x${size.y.toFixed(2)} (${aspectGeom})`,
    '| ratio', `${(size.x / sprite.width).toFixed(2)}x ${(size.y / sprite.height).toFixed(2)}y`,
  );
}
