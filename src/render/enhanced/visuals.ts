/**
 * Visual building blocks for the enhanced view: a shared glow texture, cached
 * ship geometry, a GPU particle field and the tractor-beam shader.
 *
 * Everything is authored procedurally so the app has no external art assets.
 */

import * as THREE from 'three';

import { shipHullGeometry } from './shipGeometry.js';

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

// ------------------------------------------------------------------- ships --

/**
 * Ships are extruded from the classic pixel sprites themselves (see
 * shipGeometry.ts), so the 3D fleet keeps the original silhouettes and colour
 * layout: blue-winged bees, crimson butterflies, green flagships, the white
 * arrow fighter. Metal, bevelled edges and an additive rim shell are the modern
 * part.
 */
let hullMaterialRef: THREE.MeshStandardMaterial | null = null;

function hullMaterial(): THREE.MeshStandardMaterial {
  if (hullMaterialRef) return hullMaterialRef;
  hullMaterialRef = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.38,
    roughness: 0.46,
    emissive: new THREE.Color(0x0b1024),
    emissiveIntensity: 0.12,
  });
  return hullMaterialRef;
}

export type ShipKey = 'bee' | 'butterfly' | 'boss' | 'player';

export function createShip(key: ShipKey): THREE.Group {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(shipHullGeometry(key), hullMaterial());
  group.add(hull);

  if (key === 'player') {
    // Twin engine flares under the tail.
    for (const side of [-1, 1]) {
      const flare = glowSprite(0xffb066, 8, 0.55);
      flare.position.set(side * 2, -8.2, 1);
      group.add(flare);
    }
  }

  if (key === 'boss') {
    // Flagships carry a slow halo so they read at a glance in a crowded fleet.
    const halo = glowSprite(0x33ffaa, 20, 0.12);
    halo.position.set(0, 0, -2.5);
    group.add(halo);
  }

  return group;
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
