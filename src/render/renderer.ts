import type { GalagaEngine } from '../engine/engine.js';

/**
 * Both views implement this. The app owns one engine and hands the same
 * instance to whichever renderers are visible.
 */
export interface GameRenderer {
  readonly kind: 'classic' | 'enhanced';
  mount(container: HTMLElement): void;
  resize(): void;
  render(engine: GalagaEngine, dt: number): void;
  dispose(): void;
}
