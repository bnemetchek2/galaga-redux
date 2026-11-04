/**
 * Visual building blocks for the enhanced view: a shared glow texture, cached
 * ship geometry, a GPU particle field and the tractor-beam shader.
 *
 * Everything is authored procedurally so the app has no external art assets.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------- textures --

let glowTexture: THREE.CanvasTexture | null = null;

/** Soft radial sprite used for blooms, engine flares and bullet halos. */
export function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(0.42, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export function glowSprite(color: THREE.ColorRepresentation, size: number, opacity: number): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(size);
  return sprite;
}

// ---------------------------------------------------------------- palettes --

export interface ShipPalette {
  hull: number;
  accent: number;
  glow: number;
  core: number;
}

export const PALETTES: Record<'bee' | 'butterfly' | 'boss' | 'player', ShipPalette> = {
  bee: { hull: 0x1e2f7a, accent: 0xffc233, glow: 0x4d8bff, core: 0xffe08a },
  butterfly: { hull: 0x6e0f1c, accent: 0xff2b4a, glow: 0xff3355, core: 0xffd0d8 },
  boss: { hull: 0x0f4a2a, accent: 0x9dff6b, glow: 0x33ffaa, core: 0xd6ffe0 },
  player: { hull: 0xd6e2ff, accent: 0xff3b3b, glow: 0x66ccff, core: 0xffffff },
};

// ------------------------------------------------------------------ shapes --

function polyShape(points: Array<[number, number]>): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return shape;
}

function extrude(shape: THREE.Shape, depth: number, bevel = 0.4): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.Material>();

function cachedGeometry(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const geometry = build();
  geometryCache.set(key, geometry);
  return geometry;
}

/** Cached standard material with an explicit glow. */
function shipMaterial(
  key: string,
  color: number,
  emissive: number,
  intensity: number,
  metalness = 0.7,
  roughness = 0.32,
): THREE.MeshStandardMaterial {
  const cached = materialCache.get(key);
  if (cached) return cached as THREE.MeshStandardMaterial;
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    metalness,
    roughness,
  });
  materialCache.set(key, material);
  return material;
}

/** A thin wing plate, extruded so it has real thickness. */
function wingPlate(points: Array<[number, number]>, thickness = 0.7): THREE.BufferGeometry {
  return extrude(polyShape(points), thickness, 0.12);
}

/**
 * Player fighter. Authored nose-up: a cone fuselage, dihedral wings, a glass
 * cockpit and twin engine flares.
 */
function buildPlayer(palette: ShipPalette): THREE.Group {
  const group = new THREE.Group();

  const hull = shipMaterial('player:hull', palette.hull, 0x3f6bff, 0.35, 0.85, 0.25);
  const nose = cachedGeometry('player:nose', () => new THREE.ConeGeometry(2.9, 11, 6));
  const fuselage = new THREE.Mesh(nose, hull);
  fuselage.position.y = 1.6;
  group.add(fuselage);

  const rear = new THREE.Mesh(
    cachedGeometry('player:rear', () => new THREE.BoxGeometry(5.4, 5.4, 2.6)),
    hull,
  );
  rear.position.set(0, -4.2, 0);
  group.add(rear);

  const wingMat = shipMaterial('player:wing', 0xb9c8ff, 0xff3355, 0.7, 0.75, 0.3);
  const wingR = cachedGeometry('player:wingR', () =>
    wingPlate([
      [0, 2.4],
      [6.8, -0.4],
      [7.6, -3.2],
      [2.6, -4.2],
      [0, -2.2],
    ]),
  );
  const wingL = cachedGeometry('player:wingL', () =>
    wingPlate([
      [0, 2.4],
      [-6.8, -0.4],
      [-7.6, -3.2],
      [-2.6, -4.2],
      [0, -2.2],
    ]),
  );
  const right = new THREE.Mesh(wingR, wingMat);
  right.position.set(1.2, -1.4, 0);
  right.rotation.y = -0.5;
  right.rotation.z = -0.08;
  group.add(right);

  const left = new THREE.Mesh(wingL, wingMat);
  left.position.set(-1.2, -1.4, 0);
  left.rotation.y = 0.5;
  left.rotation.z = 0.08;
  group.add(left);

  const cockpit = new THREE.Mesh(
    cachedGeometry('player:cockpit', () => new THREE.SphereGeometry(1.55, 16, 12)),
    shipMaterial('player:cockpit', 0x9fd8ff, 0x5ec8ff, 2.4, 0.2, 0.1),
  );
  cockpit.scale.set(1, 1.7, 0.85);
  cockpit.position.set(0, 0.8, 1.4);
  group.add(cockpit);

  const engineMat = shipMaterial('player:engine', 0xffb066, 0xff8a2b, 2.6, 0.3, 0.4);
  const engineGeo = cachedGeometry('player:engine', () => new THREE.CylinderGeometry(0.95, 1.15, 3, 8));
  for (const side of [-1, 1]) {
    const engine = new THREE.Mesh(engineGeo, engineMat);
    engine.position.set(side * 1.9, -5.8, 0);
    group.add(engine);
    const flare = glowSprite(0xffb066, 9, 0.6);
    flare.position.set(side * 1.9, -7.6, 0);
    group.add(flare);
  }

  return group;
}

/** Bee drone: a tapered body with banded abdomen and angled blue wings. */
function buildBee(): THREE.Group {
  const group = new THREE.Group();

  const bodyMat = shipMaterial('bee:body', 0xffc233, 0xff9d00, 0.45, 0.55, 0.4);
  const body = new THREE.Mesh(
    cachedGeometry('bee:body', () => new THREE.CylinderGeometry(0.9, 2.5, 8, 8)),
    bodyMat,
  );
  group.add(body);

  const bandMat = shipMaterial('bee:band', 0x2b1a05, 0x000000, 0, 0.6, 0.6);
  const bandGeo = cachedGeometry('bee:band', () => new THREE.TorusGeometry(2.05, 0.38, 6, 14));
  for (const y of [-1.6, 1.4]) {
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    group.add(band);
  }

  const headMat = shipMaterial('bee:head', 0x2b4bff, 0x1b3bff, 0.9, 0.5, 0.4);
  const head = new THREE.Mesh(
    cachedGeometry('bee:head', () => new THREE.SphereGeometry(2.05, 14, 10)),
    headMat,
  );
  head.position.y = -4.6;
  group.add(head);

  const eyeMat = shipMaterial('bee:eye', 0xffffff, 0xaad4ff, 3, 0.1, 0.2);
  const eyeGeo = cachedGeometry('bee:eye', () => new THREE.SphereGeometry(0.62, 8, 6));
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 1.05, -4.9, 1.45);
    group.add(eye);
  }

  const wingMat = shipMaterial('bee:wing', 0x3b6bff, 0x2b4bff, 0.85, 0.5, 0.25);
  const wingR = cachedGeometry('bee:wingR', () =>
    wingPlate([
      [0, 3],
      [3.8, 1],
      [4.6, -1.8],
      [1.6, -3.4],
      [0, -2],
    ]),
  );
  const wingL = cachedGeometry('bee:wingL', () =>
    wingPlate([
      [0, 3],
      [-3.8, 1],
      [-4.6, -1.8],
      [-1.6, -3.4],
      [0, -2],
    ]),
  );
  const right = new THREE.Mesh(wingR, wingMat);
  right.position.set(1.5, 0.6, 0);
  right.rotation.y = -0.95;
  right.rotation.z = -0.2;
  group.add(right);

  const left = new THREE.Mesh(wingL, wingMat);
  left.position.set(-1.5, 0.6, 0);
  left.rotation.y = 0.95;
  left.rotation.z = 0.2;
  group.add(left);

  return group;
}

/** Butterfly raider: slender body, broad crimson wings with blue wing-eyes. */
function buildButterfly(): THREE.Group {
  const group = new THREE.Group();

  const bodyMat = shipMaterial('butterfly:body', 0xf1f4ff, 0xff6b7f, 0.35, 0.6, 0.3);
  const body = new THREE.Mesh(
    cachedGeometry('butterfly:body', () => new THREE.CylinderGeometry(0.85, 1.7, 9, 8)),
    bodyMat,
  );
  group.add(body);

  const headMat = shipMaterial('butterfly:head', 0xd81f36, 0xff2b4a, 1.2, 0.5, 0.35);
  const head = new THREE.Mesh(
    cachedGeometry('butterfly:head', () => new THREE.SphereGeometry(1.7, 14, 10)),
    headMat,
  );
  head.position.y = -5.1;
  group.add(head);

  const eyeMat = shipMaterial('butterfly:eye', 0x6fa8ff, 0x3a6bff, 2.6, 0.2, 0.2);
  const eyeGeo = cachedGeometry('butterfly:eye', () => new THREE.SphereGeometry(0.55, 8, 6));
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.95, -5.4, 1.2);
    group.add(eye);
  }

  const wingMat = shipMaterial('butterfly:wing', 0xd81f36, 0xff2233, 0.55, 0.55, 0.3);
  const wingR = cachedGeometry('butterfly:wingR', () =>
    wingPlate([
      [0, 3.6],
      [5.6, 2.6],
      [8.6, -0.4],
      [6.8, -3.8],
      [2.2, -4.2],
      [0, -2],
    ]),
  );
  const wingL = cachedGeometry('butterfly:wingL', () =>
    wingPlate([
      [0, 3.6],
      [-5.6, 2.6],
      [-8.6, -0.4],
      [-6.8, -3.8],
      [-2.2, -4.2],
      [0, -2],
    ]),
  );
  const right = new THREE.Mesh(wingR, wingMat);
  right.position.set(1.1, 0.2, 0);
  right.rotation.y = -0.62;
  group.add(right);

  const left = new THREE.Mesh(wingL, wingMat);
  left.position.set(-1.1, 0.2, 0);
  left.rotation.y = 0.62;
  group.add(left);

  // Wing eyes catch the bloom.
  const spotMat = shipMaterial('butterfly:spot', 0x3a6bff, 0x3a6bff, 2.2, 0.2, 0.25);
  const spotGeo = cachedGeometry('butterfly:spot', () => new THREE.SphereGeometry(1.05, 10, 8));
  for (const side of [-1, 1]) {
    const spot = new THREE.Mesh(spotGeo, spotMat);
    spot.position.set(side * 5.1, 0.4, 0.9);
    group.add(spot);
  }

  return group;
}

/** Flagship: hexagonal green hull, heavy blue wings and a spinning gold ring. */
function buildBoss(): THREE.Group {
  const group = new THREE.Group();

  const hullMat = shipMaterial('boss:hull', 0x2fbf5a, 0x1f9e46, 0.5, 0.75, 0.28);
  const body = new THREE.Mesh(
    cachedGeometry('boss:body', () => new THREE.CylinderGeometry(2.2, 4.1, 10, 6)),
    hullMat,
  );
  group.add(body);

  const head = new THREE.Mesh(
    cachedGeometry('boss:head', () => new THREE.SphereGeometry(2.6, 16, 12)),
    shipMaterial('boss:head', 0x39d36b, 0x2fbf5a, 0.9, 0.6, 0.3),
  );
  head.position.y = -5.2;
  group.add(head);

  const eyeMat = shipMaterial('boss:eye', 0xff5cc8, 0xff5cc8, 2.8, 0.2, 0.2);
  const eyeGeo = cachedGeometry('boss:eye', () => new THREE.SphereGeometry(0.7, 8, 6));
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 1.4, -5.6, 2);
    group.add(eye);
  }

  const crestMat = shipMaterial('boss:crest', 0xffd23f, 0xffb300, 1.4, 0.5, 0.3);
  const crest = new THREE.Mesh(
    cachedGeometry('boss:crest', () => new THREE.ConeGeometry(1.6, 4.2, 4)),
    crestMat,
  );
  crest.position.y = 6.2;
  group.add(crest);

  const wingMat = shipMaterial('boss:wing', 0x3a4dff, 0x2b3bff, 0.7, 0.6, 0.3);
  const wingR = cachedGeometry('boss:wingR', () =>
    wingPlate([
      [0, 4.2],
      [7.2, 2.4],
      [9.8, -1.4],
      [7.2, -5.2],
      [2.2, -5],
      [0, -2.4],
    ]),
  );
  const wingL = cachedGeometry('boss:wingL', () =>
    wingPlate([
      [0, 4.2],
      [-7.2, 2.4],
      [-9.8, -1.4],
      [-7.2, -5.2],
      [-2.2, -5],
      [0, -2.4],
    ]),
  );
  const right = new THREE.Mesh(wingR, wingMat);
  right.position.set(2.4, 0.4, 0);
  right.rotation.y = -0.55;
  group.add(right);

  const left = new THREE.Mesh(wingL, wingMat);
  left.position.set(-2.4, 0.4, 0);
  left.rotation.y = 0.55;
  group.add(left);

  const ring = new THREE.Mesh(
    cachedGeometry('boss:ring', () => new THREE.TorusGeometry(5.4, 0.36, 6, 26)),
    shipMaterial('boss:ring', 0xffd23f, 0xffb300, 2.2, 0.4, 0.3),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.6;
  ring.name = 'ring';
  group.add(ring);

  return group;
}

export type ShipKey = 'bee' | 'butterfly' | 'boss' | 'player';

export function createShip(key: ShipKey): THREE.Group {
  switch (key) {
    case 'player':
      return buildPlayer(PALETTES.player);
    case 'bee':
      return buildBee();
    case 'butterfly':
      return buildButterfly();
    case 'boss':
      return buildBoss();
  }
}

// ---------------------------------------------------------------- particles --

interface ParticleArrays {
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  life: Float32Array;
}

export class ParticleField {
  readonly points: THREE.Points;
  private readonly count: number;
  private readonly velocity: Float32Array;
  private readonly duration: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly arrays: ParticleArrays;
  private cursor = 0;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor(count = 900) {
    this.count = count;
    this.arrays = {
      position: new Float32Array(count * 3),
      color: new Float32Array(count * 3),
      size: new Float32Array(count),
      life: new Float32Array(count),
    };
    this.velocity = new Float32Array(count * 3);
    this.duration = new Float32Array(count);
    this.baseSize = new Float32Array(count);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.arrays.position, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.arrays.color, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.arrays.size, 1));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.arrays.life, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aLife;
        varying float vLife;
        varying vec3 vColor;
        void main() {
          vLife = aLife;
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float falloff = smoothstep(0.5, 0.0, d);
          float alpha = falloff * clamp(vLife, 0.0, 1.0);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vColor * (1.2 + vLife), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  spawnBurst(
    origin: THREE.Vector3,
    count: number,
    colors: THREE.Color[],
    speed: number,
    size: number,
    duration: number,
    spread = 1,
  ): void {
    for (let i = 0; i < count; i++) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const magnitude = speed * (0.35 + Math.random() * 0.9);
      this.velocity[index * 3] = Math.sin(phi) * Math.cos(theta) * magnitude;
      this.velocity[index * 3 + 1] = Math.sin(phi) * Math.sin(theta) * magnitude;
      this.velocity[index * 3 + 2] = Math.cos(phi) * magnitude * 0.6 * spread;
      this.arrays.position[index * 3] = origin.x;
      this.arrays.position[index * 3 + 1] = origin.y;
      this.arrays.position[index * 3 + 2] = origin.z;
      const color = colors[Math.floor(Math.random() * colors.length)];
      this.arrays.color[index * 3] = color.r;
      this.arrays.color[index * 3 + 1] = color.g;
      this.arrays.color[index * 3 + 2] = color.b;
      this.baseSize[index] = size * (0.5 + Math.random());
      this.arrays.size[index] = this.baseSize[index];
      this.duration[index] = duration * (0.6 + Math.random() * 0.8);
      this.arrays.life[index] = 1;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aLife.needsUpdate = true;
  }

  /** Single particle with an explicit velocity, used for engine trails. */
  emit(
    origin: THREE.Vector3,
    velocity: THREE.Vector3,
    color: THREE.Color,
    size: number,
    life: number,
  ): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.velocity[index * 3] = velocity.x;
    this.velocity[index * 3 + 1] = velocity.y;
    this.velocity[index * 3 + 2] = velocity.z;
    this.arrays.position[index * 3] = origin.x;
    this.arrays.position[index * 3 + 1] = origin.y;
    this.arrays.position[index * 3 + 2] = origin.z;
    this.arrays.color[index * 3] = color.r;
    this.arrays.color[index * 3 + 1] = color.g;
    this.arrays.color[index * 3 + 2] = color.b;
    this.baseSize[index] = size;
    this.arrays.size[index] = size;
    this.duration[index] = life;
    this.arrays.life[index] = 1;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aLife.needsUpdate = true;
  }

  update(dt: number): void {
    const { position, life, size } = this.arrays;
    for (let i = 0; i < this.count; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt / Math.max(0.05, this.duration[i]);
      if (life[i] <= 0) {
        life[i] = 0;
        size[i] = 0;
        continue;
      }
      position[i * 3] += this.velocity[i * 3] * dt;
      position[i * 3 + 1] += this.velocity[i * 3 + 1] * dt;
      position[i * 3 + 2] += this.velocity[i * 3 + 2] * dt;
      this.velocity[i * 3] *= 1 - dt * 1.6;
      this.velocity[i * 3 + 1] *= 1 - dt * 1.6;
      this.velocity[i * 3 + 2] *= 1 - dt * 1.6;
      size[i] = this.baseSize[i] * (0.35 + life[i] * 0.85);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aLife.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ------------------------------------------------------------ tractor beam --

export function createBeamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uColorA: { value: new THREE.Color(0x66e0ff) },
      uColorB: { value: new THREE.Color(0xb46bff) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 3.0);
        float bands = 0.6 + 0.4 * sin(vUv.y * 30.0 - uTime * 8.0);
        float sweep = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        vec3 color = mix(uColorA, uColorB, vUv.y);
        float alpha = (0.02 + fres * 0.5) * bands * sweep * uIntensity;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color * (0.7 + fres * 0.9), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
