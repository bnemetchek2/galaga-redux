/**
 * The enhanced view: the same simulation rendered as a lit 3D scene with
 * bloom, particles and a volumetric tractor beam.
 *
 * It reads the engine directly, exactly like the classic view does, so the two
 * can never drift apart.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import { SCREEN_H, SCREEN_W } from '../../engine/constants.js';
import type { GalagaEngine } from '../../engine/engine.js';
import type { Explosion } from '../../engine/types.js';
import type { GameRenderer } from '../renderer.js';
import {
  PALETTES,
  ParticleField,
  createBeamMaterial,
  createShip,
  getGlowTexture,
  type ShipKey,
} from './visuals.js';

const HALF_W = SCREEN_W / 2;
const HALF_H = SCREEN_H / 2;

const worldX = (px: number): number => px - HALF_W;
const worldY = (py: number): number => HALF_H - py;

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uStrength: { value: 0.45 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 centered = vUv - 0.5;
      float vignette = 1.0 - dot(centered, centered) * uStrength * 2.2;
      color.rgb *= clamp(vignette, 0.0, 1.0);
      // Fine scanlines keep a hint of the arcade CRT in the 3D view.
      float scan = 0.985 + 0.015 * sin(vUv.y * 900.0);
      color.rgb *= scan;
      float grain = (hash(vUv * 1024.0 + uTime) - 0.5) * 0.025;
      color.rgb += grain;
      gl_FragColor = color;
    }
  `,
};

interface BulletVisual {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  active: boolean;
}

interface Shockwave {
  mesh: THREE.Mesh;
  age: number;
  duration: number;
}

const EXPLOSION_COLORS: Record<Explosion['kind'], number[]> = {
  enemy: [0xffd27a, 0xff8a3c, 0xffffff],
  boss: [0x9dff9d, 0x4dffc3, 0xffffff, 0xffe066],
  player: [0x9fd8ff, 0xffffff, 0x66aaff, 0xff5a5a],
  spark: [0xffffff, 0xffe066],
};

export class EnhancedRenderer implements GameRenderer {
  readonly kind = 'enhanced' as const;

  private host: HTMLDivElement | null = null;
  private hud: {
    root: HTMLDivElement;
    score: HTMLSpanElement;
    high: HTMLSpanElement;
    lives: HTMLDivElement;
    stage: HTMLDivElement;
    banner: HTMLDivElement;
    sub: HTMLDivElement;
    player: HTMLDivElement;
  } | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private vignette: ShaderPass | null = null;

  private ships = new Map<number, THREE.Group>();
  private playerGroup: THREE.Group | null = null;
  private twinGroup: THREE.Group | null = null;
  private playerBulletPool: BulletVisual[] = [];
  private enemyBulletPool: BulletVisual[] = [];

  private beamMesh: THREE.Mesh | null = null;
  private beamMaterial: THREE.ShaderMaterial | null = null;
  private beamLight: THREE.PointLight | null = null;

  private particles: ParticleField | null = null;
  private shockwaves: Shockwave[] = [];
  private seenExplosions = new WeakSet<Explosion>();

  private starLayers: { points: THREE.Points; speed: number }[] = [];
  private nebula: THREE.Mesh | null = null;

  private cameraDistance = 380;
  private shake = 0;
  private time = 0;
  private lastLives = 3;
  private stageFlash = 0;
  private lastStage = 1;
  private victoryStarted = -1;
  private fireworkTimer = 0;
  private trailTimer = 0;
  private readonly trailColors = [new THREE.Color(0xffb066), new THREE.Color(0x7fd8ff)];
  private resizeObserver: ResizeObserver | null = null;

  // ------------------------------------------------------------------ setup --

  mount(container: HTMLElement): void {
    const host = document.createElement('div');
    host.className = 'enh-host';
    container.appendChild(host);
    this.host = host;
    this.buildHud(host);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.setClearColor(0x03040c, 1);
    renderer.domElement.className = 'enh-canvas';
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05060f, 0.00095);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(48, 1, 1, 2400);
    camera.position.set(0, -130, 370);
    this.camera = camera;

    this.addLights(scene);
    this.addStarfield(scene);
    this.addNebula(scene);
    this.buildBeam(scene);
    this.addEnvironment(renderer, scene);

    this.particles = new ParticleField(1200);
    scene.add(this.particles.points);

    this.playerGroup = createShip('player');
    this.playerGroup.scale.setScalar(1.45);
    scene.add(this.playerGroup);

    this.buildBulletPools(scene);
    this.buildComposer(renderer, scene, camera);

    const width = host.clientWidth || 800;
    const height = host.clientHeight || 600;
    this.resizeTo(width, height);

    this.resizeObserver = new ResizeObserver(() => {
      if (this.host) this.resizeTo(this.host.clientWidth, this.host.clientHeight);
    });
    this.resizeObserver.observe(host);
  }

  /**
   * A tiny procedural environment, baked once into a PMREM. It gives the metal
   * hulls something to reflect, which is what makes them read as solid objects
   * rather than flat cut-outs.
   */
  private addEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const envScene = new THREE.Scene();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vPos;
          void main() {
            float h = normalize(vPos).y * 0.5 + 0.5;
            vec3 low = vec3(0.03, 0.02, 0.09);
            vec3 mid = vec3(0.08, 0.12, 0.32);
            vec3 high = vec3(0.55, 0.72, 1.0);
            vec3 col = mix(low, mid, smoothstep(0.0, 0.55, h));
            col = mix(col, high, smoothstep(0.62, 1.0, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    envScene.add(shell);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(40, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff2d0 }),
    );
    sun.position.set(-120, 160, 120);
    envScene.add(sun);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(55, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x3a4dff }),
    );
    glow.position.set(180, -40, -120);
    envScene.add(glow);

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromScene(envScene, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();
    shell.geometry.dispose();
    (shell.material as THREE.Material).dispose();
  }

  private addLights(scene: THREE.Scene): void {
    scene.add(new THREE.AmbientLight(0x2a3866, 0.85));

    const key = new THREE.DirectionalLight(0xdfe9ff, 1.7);
    key.position.set(60, 160, 260);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x6b8bff, 0.7);
    rim.position.set(-200, -60, 90);
    scene.add(rim);

    const cyan = new THREE.PointLight(0x3fd0ff, 2100, 700, 2);
    cyan.position.set(-170, -60, 140);
    scene.add(cyan);

    // A soft fill from the camera side keeps the hull colours readable.
    const fill = new THREE.PointLight(0xcfe0ff, 700, 900, 2);
    fill.position.set(0, -70, 260);
    scene.add(fill);

    const magenta = new THREE.PointLight(0xff4ea8, 1500, 700, 2);
    magenta.position.set(170, 110, 120);
    scene.add(magenta);
  }

  private addStarfield(scene: THREE.Scene): void {
    const layers = [
      { count: 700, z: -320, size: 1.0, speed: 6, color: 0x8fb4ff },
      { count: 550, z: -160, size: 1.5, speed: 14, color: 0xdfe9ff },
      { count: 320, z: -40, size: 2.1, speed: 26, color: 0xffd9a8 },
    ];

    for (const layer of layers) {
      const positions = new Float32Array(layer.count * 3);
      const colors = new Float32Array(layer.count * 3);
      const base = new THREE.Color(layer.color);
      for (let i = 0; i < layer.count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 900;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 700;
        positions[i * 3 + 2] = layer.z + (Math.random() - 0.5) * 80;
        const tint = base.clone().multiplyScalar(0.55 + Math.random() * 0.65);
        colors[i * 3] = tint.r;
        colors[i * 3 + 1] = tint.g;
        colors[i * 3 + 2] = tint.b;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const material = new THREE.PointsMaterial({
        size: layer.size,
        vertexColors: true,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      scene.add(points);
      this.starLayers.push({ points, speed: layer.speed });
    }
  }

  private addNebula(scene: THREE.Scene): void {
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float a = sin(p.x * 5.0 + uTime * 0.08) * 0.5 + 0.5;
          float b = cos(p.y * 7.0 - uTime * 0.05) * 0.5 + 0.5;
          float clouds = smoothstep(0.3, 0.95, a * b);
          vec3 deep = vec3(0.004, 0.006, 0.02);
          vec3 glow = vec3(0.026, 0.014, 0.09);
          vec3 color = mix(deep, glow, clouds);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2200, 1500), material);
    mesh.position.z = -620;
    scene.add(mesh);
    this.nebula = mesh;
  }

  private buildBeam(scene: THREE.Scene): void {
    const geometry = new THREE.ConeGeometry(1, 1, 28, 1, true);
    geometry.translate(0, -0.5, 0);
    const material = createBeamMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    this.beamMesh = mesh;
    this.beamMaterial = material;

    const light = new THREE.PointLight(0x66e0ff, 0, 260, 2);
    scene.add(light);
    this.beamLight = light;
  }

  private buildBulletPools(scene: THREE.Scene): void {
    const playerGeo = new THREE.CapsuleGeometry(0.85, 5, 4, 8);
    const enemyGeo = new THREE.SphereGeometry(1.5, 10, 8);
    const playerMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff });
    const enemyMat = new THREE.MeshBasicMaterial({ color: 0xffb066 });

    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(playerGeo, playerMat);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: 0x6fd8ff,
          transparent: true,
          opacity: 0.8,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glow.scale.setScalar(12);
      mesh.add(glow);
      mesh.visible = false;
      scene.add(mesh);
      this.playerBulletPool.push({ mesh, glow, active: false });
    }

    for (let i = 0; i < 60; i++) {
      const mesh = new THREE.Mesh(enemyGeo, enemyMat);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: 0xff5a1e,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glow.scale.setScalar(14);
      mesh.add(glow);
      mesh.visible = false;
      scene.add(mesh);
      this.enemyBulletPool.push({ mesh, glow, active: false });
    }
  }

  private buildComposer(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ): void {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.55, 0.88);
    composer.addPass(bloom);
    this.bloom = bloom;

    composer.addPass(new OutputPass());

    const vignette = new ShaderPass(VignetteShader);
    composer.addPass(vignette);
    this.vignette = vignette;

    this.composer = composer;
  }

  private buildHud(host: HTMLDivElement): void {
    const root = document.createElement('div');
    root.className = 'enh-hud';
    root.innerHTML = `
      <div class="enh-hud__left">
        <span class="enh-label">1UP</span>
        <span class="enh-score">00000</span>
      </div>
      <div class="enh-hud__center">
        <span class="enh-label">HIGH SCORE</span>
        <span class="enh-high">20000</span>
      </div>
      <div class="enh-hud__right">
        <span class="enh-label">STAGE</span>
        <span class="enh-stage">1</span>
      </div>
      <div class="enh-lives"></div>
      <div class="enh-player"></div>
      <div class="enh-badges">
        <span class="enh-badge enh-badge--demo">EXPERT DEMO</span>
        <span class="enh-badge enh-badge--jam">NO-FIRE BUG</span>
      </div>
      <div class="enh-banner">
        <div class="enh-banner__title"></div>
        <div class="enh-banner__sub"></div>
      </div>
    `;
    host.appendChild(root);
    this.hud = {
      root,
      score: root.querySelector('.enh-score') as HTMLSpanElement,
      high: root.querySelector('.enh-high') as HTMLSpanElement,
      lives: root.querySelector('.enh-lives') as HTMLDivElement,
      stage: root.querySelector('.enh-stage') as HTMLDivElement,
      banner: root.querySelector('.enh-banner') as HTMLDivElement,
      sub: root.querySelector('.enh-banner__sub') as HTMLDivElement,
      player: root.querySelector('.enh-player') as HTMLDivElement,
    };
  }

  resize(): void {
    if (this.host) this.resizeTo(this.host.clientWidth, this.host.clientHeight);
  }

  private resizeTo(width: number, height: number): void {
    if (!this.renderer || !this.camera || !this.composer) return;
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;

    // Fit the whole 224x288 playfield with a little margin, whichever axis binds.
    const fov = (this.camera.fov * Math.PI) / 180;
    const fitHeight = ((SCREEN_H * 1.02) / 2) / Math.tan(fov / 2);
    const fitWidth = ((SCREEN_W * 1.02) / 2) / (Math.tan(fov / 2) * this.camera.aspect);
    this.cameraDistance = Math.max(fitHeight, fitWidth);
    this.camera.position.z = this.cameraDistance;
    this.camera.updateProjectionMatrix();
  }

  // ----------------------------------------------------------------- update --

  render(engine: GalagaEngine, dt: number): void {
    if (!this.renderer || !this.scene || !this.camera || !this.composer) return;
    const step = Math.min(dt, 0.5);
    this.time += step;

    if (engine.lives < this.lastLives) this.shake = Math.min(1, this.shake + 0.85);
    this.lastLives = engine.lives;
    if (engine.stage !== this.lastStage) {
      this.lastStage = engine.stage;
      this.stageFlash = 1;
    }
    this.shake = Math.max(0, this.shake - step * 2.2);
    this.stageFlash = Math.max(0, this.stageFlash - step * 1.4);

    this.updateStars(step, engine);
    this.updateShips(engine, step);
    this.updatePlayer(engine, step);
    this.updateBullets(engine);
    this.updateBeam(engine, step);
    this.updateExplosions(engine, step);
    this.updateVictory(engine, step);
    this.particles?.update(step);
    this.updateShockwaves(step);
    this.updateCamera(engine, step);
    this.updateHud(engine);

    if (this.vignette) this.vignette.uniforms.uTime.value = this.time;
    if (this.nebula) {
      (this.nebula.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    }
    if (this.bloom) {
      this.bloom.strength = 0.45 + this.stageFlash * 1.1 + (this.victoryStarted >= 0 ? 0.45 : 0);
    }

    this.composer.render();
  }

  /** Fireworks and gold light once the machine has been beaten. */
  private updateVictory(engine: GalagaEngine, dt: number): void {
    if (engine.phase !== 'victory') {
      this.victoryStarted = -1;
      return;
    }
    if (this.victoryStarted < 0) {
      this.victoryStarted = this.time;
      this.fireworkTimer = 0;
    }
    this.fireworkTimer -= dt;
    if (this.fireworkTimer > 0) return;
    this.fireworkTimer = 0.32;

    const origin = new THREE.Vector3(
      (Math.random() - 0.5) * 190,
      (Math.random() - 0.25) * 150,
      12,
    );
    const palette = [0xffd23f, 0xffffff, 0x5ee7ff, 0xff4ea8].map((c) => new THREE.Color(c));
    this.particles?.spawnBurst(origin, 46, palette, 62, 6.5, 1.15);
    this.spawnShockwave(origin, 22, 'boss');
  }

  private updateStars(dt: number, engine: GalagaEngine): void {
    const boost = engine.phase === 'stageIntro' || engine.phase === 'stageClear' ? 4 : 1;
    for (const layer of this.starLayers) {
      const positions = layer.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = positions.array as Float32Array;
      const delta = layer.speed * dt * boost;
      for (let i = 1; i < array.length; i += 3) {
        array[i] -= delta;
        if (array[i] < -350) {
          array[i] += 700;
          array[i - 1] = (Math.random() - 0.5) * 900;
        }
      }
      positions.needsUpdate = true;
    }
  }

  private updateShips(engine: GalagaEngine, dt: number): void {
    if (!this.scene) return;
    const alive = new Set<number>();

    for (const enemy of engine.enemies) {
      alive.add(enemy.id);
      let group = this.ships.get(enemy.id);
      if (!group) {
        group = createShip(enemy.kind as ShipKey);
        group.position.set(worldX(enemy.x), worldY(enemy.y), 0);
        this.scene.add(group);
        this.ships.set(enemy.id, group);
      }
      group.position.x = worldX(enemy.x);
      group.position.y = worldY(enemy.y);
      group.position.z = enemy.state === 'formation' ? -enemy.row * 4 : 4;
      group.rotation.z = -enemy.angle;
      group.rotation.x = -0.34;
      group.rotation.y = Math.sin(this.time * 2 + enemy.phase) * 0.08 - enemy.angle * 0.4;

      const scale = enemy.kind === 'boss' ? 1.62 : enemy.kind === 'butterfly' ? 1.28 : 1.36;
      const pulse = enemy.flash > 0 ? 1.18 : 1;
      group.scale.setScalar(scale * pulse);

      const ring = group.getObjectByName('ring');
      if (ring) ring.rotation.z += dt * 1.6;

      // Attach a rescue marker under a flagship carrying the captured fighter.
      if (enemy.capturedShip && !group.getObjectByName('captive')) {
        const captive = createShip('player');
        captive.name = 'captive';
        captive.scale.setScalar(0.8);
        captive.position.set(0, -14, 0);
        captive.rotation.z = Math.PI;
        group.add(captive);
      }
    }

    for (const [id, group] of this.ships) {
      if (alive.has(id)) continue;
      this.scene.remove(group);
      this.ships.delete(id);
    }
  }

  private updatePlayer(engine: GalagaEngine, dt: number): void {
    const group = this.playerGroup;
    if (!group) return;
    const blinking = engine.player.invulnerable > 0 && Math.floor(this.time * 16) % 2 === 0;
    const visible = engine.player.visible && !blinking && engine.phase !== 'attract';

    const twin = engine.ships === 2;

    if (!this.twinGroup && this.scene) {
      const twinGroup = createShip('player');
      twinGroup.name = 'twin';
      twinGroup.scale.setScalar(1.45);
      twinGroup.visible = false;
      this.scene.add(twinGroup);
      this.twinGroup = twinGroup;
    }

    group.visible = visible;
    group.position.x = worldX(engine.player.x) + (twin ? 11 : 0);
    group.position.y = worldY(engine.player.y);
    group.position.z = 10;
    group.rotation.z = Math.sin(this.time * 2.4) * 0.03;
    group.rotation.x = 0.12;

    const twinGroup = this.twinGroup;
    if (twinGroup) {
      twinGroup.visible = visible && twin;
      twinGroup.position.x = worldX(engine.player.x) - 11;
      twinGroup.position.y = worldY(engine.player.y);
      twinGroup.position.z = 10;
      twinGroup.rotation.z = -Math.sin(this.time * 2.4) * 0.03;
      twinGroup.rotation.x = 0.12;
    }

    // Twin engine trails, emitted per frame at the nozzles.
    if (visible && this.particles) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.016;
        const baseY = worldY(engine.player.y) - 9;
        for (const offset of twin ? [-11, 11] : [0]) {
          for (let i = 0; i < 2; i++) {
            const origin = new THREE.Vector3(
              worldX(engine.player.x) + offset + (Math.random() - 0.5) * 2,
              baseY,
              9,
            );
            const velocity = new THREE.Vector3(
              (Math.random() - 0.5) * 8,
              -70 - Math.random() * 40,
              0,
            );
            const color = Math.random() > 0.45 ? this.trailColors[0] : this.trailColors[1];
            this.particles.emit(origin, velocity, color, 4.6, 0.5);
          }
        }
      }
    }
  }

  private updateBullets(engine: GalagaEngine): void {
    for (const pool of [this.playerBulletPool, this.enemyBulletPool]) {
      for (const visual of pool) {
        visual.active = false;
        visual.mesh.visible = false;
      }
    }

    for (const bullet of engine.bullets) {
      const pool = bullet.from === 'player' ? this.playerBulletPool : this.enemyBulletPool;
      const visual = pool.find((entry) => !entry.active);
      if (!visual) continue;
      visual.active = true;
      visual.mesh.visible = true;
      visual.mesh.position.set(worldX(bullet.x), worldY(bullet.y), 2);
    }
  }

  private updateBeam(engine: GalagaEngine, dt: number): void {
    const mesh = this.beamMesh;
    const material = this.beamMaterial;
    if (!mesh || !material) return;
    const beam = engine.tractor;
    const intensity = beam.intensity;
    mesh.visible = intensity > 0.01;
    if (!mesh.visible) {
      if (this.beamLight) this.beamLight.intensity = 0;
      return;
    }

    const length = beam.length * intensity;
    mesh.position.set(worldX(beam.x), worldY(beam.y), 1);
    mesh.scale.set(beam.halfWidth * 0.92, length, beam.halfWidth * 0.92);
    material.uniforms.uTime.value = this.time;
    material.uniforms.uIntensity.value = intensity;

    if (this.beamLight) {
      this.beamLight.position.set(worldX(beam.x), worldY(beam.y) - length * 0.4, 40);
      this.beamLight.intensity = 700 * intensity;
    }
    void dt;
  }

  private updateExplosions(engine: GalagaEngine, step: number): void {
    for (const explosion of engine.explosions) {
      if (this.seenExplosions.has(explosion)) continue;
      this.seenExplosions.add(explosion);
      // While fast-forwarding a single frame can cover seconds of play; skip the
      // light show rather than stacking hundreds of bursts into one smear.
      if (step > 0.12) continue;
      const origin = new THREE.Vector3(worldX(explosion.x), worldY(explosion.y), 4);
      const palette = EXPLOSION_COLORS[explosion.kind].map((c) => new THREE.Color(c));
      const count = explosion.kind === 'boss' ? 46 : explosion.kind === 'player' ? 54 : 26;
      this.particles?.spawnBurst(origin, count, palette, explosion.size * 6.5, 5.5, 0.85);
      // Only the two big moments get a shockwave; ordinary kills would turn the
      // screen into a stack of rings during a challenging stage.
      if (explosion.kind === 'player' || explosion.kind === 'boss') {
        this.spawnShockwave(origin, explosion.size * 1.4, explosion.kind);
        this.shake = Math.min(1, this.shake + (explosion.kind === 'boss' ? 0.5 : 0.9));
      }
    }
  }

  private spawnShockwave(origin: THREE.Vector3, radius: number, kind: Explosion['kind']): void {
    if (!this.scene) return;
    const color = kind === 'player' ? 0x9fd8ff : kind === 'boss' ? 0x9dffb0 : 0xffc26b;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), material);
    mesh.position.copy(origin);
    mesh.scale.setScalar(radius * 0.55);
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, age: 0, duration: 0.4 });
  }

  private updateShockwaves(dt: number): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const wave = this.shockwaves[i];
      wave.age += dt;
      const t = wave.age / wave.duration;
      if (t >= 1) {
        this.scene?.remove(wave.mesh);
        wave.mesh.geometry.dispose();
        (wave.mesh.material as THREE.Material).dispose();
        this.shockwaves.splice(i, 1);
        continue;
      }
      wave.mesh.scale.setScalar(wave.mesh.scale.x + dt * 46);
      (wave.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t);
    }
  }

  private updateCamera(engine: GalagaEngine, dt: number): void {
    if (!this.camera) return;
    const shakeAmount = this.shake * 7;
    // A little parallax toward the fighter: the whole scene leans with you.
    const parallax = (engine.player.x - SCREEN_W / 2) * 0.07;
    const pull =
      this.victoryStarted >= 0 ? Math.min(1, (this.time - this.victoryStarted) / 1.4) : 0;

    this.camera.position.x = parallax + (Math.random() - 0.5) * shakeAmount;
    this.camera.position.y = -130 + (Math.random() - 0.5) * shakeAmount;
    this.camera.position.z = this.cameraDistance * (1 + pull * 0.15);
    this.camera.lookAt(0, -10 + pull * 18 - this.shake * 5, 0);
    void dt;
  }

  private updateHud(engine: GalagaEngine): void {
    const hud = this.hud;
    if (!hud) return;
    hud.score.textContent = String(engine.players[0].score).padStart(5, '0');
    hud.high.textContent = String(engine.highScore).padStart(5, '0');
    hud.stage.textContent = String(engine.stage);

    const lives = engine.phase === 'attract' ? 0 : engine.lives;
    if (hud.lives.childElementCount !== lives) {
      hud.lives.replaceChildren();
      for (let i = 0; i < lives; i++) {
        const pip = document.createElement('span');
        pip.className = 'enh-life';
        hud.lives.appendChild(pip);
      }
    }

    hud.player.textContent = engine.isTwoPlayer
      ? `PLAYER ${engine.activePlayer + 1}`
      : '';

    let title = '';
    let sub = '';
    if (engine.phase === 'attract') {
      title = 'GALAGA';
      sub = 'PRESS 1 OR 2 TO START';
    } else if (engine.phase === 'stageIntro') {
      title = engine.challenge ? 'CHALLENGING STAGE' : `STAGE ${engine.stage}`;
      sub = engine.stageBanner < 0.9 ? 'READY' : '';
    } else if (engine.phase === 'stageClear') {
      title = 'STAGE CLEAR';
      sub = engine.challenge ? 'BONUS AWARDED' : '';
    } else if (engine.phase === 'gameOver') {
      title = 'GAME OVER';
      sub = `SCORE ${engine.score}`;
    } else if (engine.phase === 'victory') {
      title = 'MISSION COMPLETE';
      sub = `STAGE 255 CLEARED · ${engine.score} POINTS`;
    }

    const titleEl = hud.banner.querySelector('.enh-banner__title') as HTMLDivElement;
    if (titleEl.textContent !== title) titleEl.textContent = title;
    if (hud.sub.textContent !== sub) hud.sub.textContent = sub;
    hud.banner.classList.toggle('is-visible', Boolean(title) && engine.phase !== 'playing');
    hud.banner.classList.toggle('is-attract', engine.phase === 'attract');
    hud.banner.classList.toggle('is-gameover', engine.phase === 'gameOver');
    hud.banner.classList.toggle('is-victory', engine.phase === 'victory');

    const badges = hud.root.querySelector('.enh-badges');
    if (badges) {
      badges.classList.toggle('is-demo', document.body.classList.contains('is-demo'));
      badges.classList.toggle('is-jam', engine.noFireBugEnabled);
      badges.classList.toggle('is-visible', engine.phase !== 'attract');
    }
  }

  // ---------------------------------------------------------------- teardown --

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const [, group] of this.ships) this.scene?.remove(group);
    this.ships.clear();
    if (this.playerGroup) this.scene?.remove(this.playerGroup);
    this.playerGroup = null;
    if (this.twinGroup) this.scene?.remove(this.twinGroup);
    this.twinGroup = null;
    this.particles?.dispose();
    this.particles = null;
    for (const wave of this.shockwaves) {
      wave.mesh.geometry.dispose();
      (wave.mesh.material as THREE.Material).dispose();
    }
    this.shockwaves = [];
    this.composer?.dispose();
    this.renderer?.dispose();
    this.host?.remove();
    this.host = null;
    this.hud = null;
  }
}

export { PALETTES };


