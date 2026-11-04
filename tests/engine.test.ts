/**
 * Engine behaviour tests.
 *
 * These run against the compiled output (dist/) using Node's built-in test
 * runner. The most important one is determinism: the side-by-side view is only
 * honest if the simulation is reproducible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { GalagaEngine } from '../src/engine/engine.js';
import { buildStage, scoreFor, slotPosition } from '../src/engine/stages.js';
import { FIXED_DT, SCREEN_W } from '../src/engine/constants.js';
import { AutoPilot } from '../src/app/autopilot.js';

function run(engine: GalagaEngine, seconds: number): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) engine.update(FIXED_DT);
}

test('a stage fields 36 ships: 4 bosses, 16 butterflies, 16 bees', () => {
  const spec = buildStage(1);
  const slots = new Set<number>();
  const kinds: Record<string, number> = {};
  for (const wave of spec.waves) {
    for (const slot of wave.slots) {
      assert.equal(slots.has(slot), false, `slot ${slot} used twice`);
      slots.add(slot);
      kinds[wave.kind] = (kinds[wave.kind] ?? 0) + 1;
    }
  }
  assert.equal(spec.challenge, false);
  assert.equal(slots.size, 36);
  assert.deepEqual(kinds, { bee: 16, butterfly: 16, boss: 4 });
});

test('every fourth stage from 3 is a challenging stage', () => {
  assert.equal(buildStage(1).challenge, false);
  assert.equal(buildStage(2).challenge, false);
  assert.equal(buildStage(3).challenge, true);
  assert.equal(buildStage(4).challenge, false);
  assert.equal(buildStage(7).challenge, true);
  assert.equal(buildStage(11).challenge, true);
});

test('challenging stages send 40 ships through in flights of eight', () => {
  const spec = buildStage(3);
  assert.equal(spec.waves.length, 5);
  const total = spec.waves.reduce((sum, wave) => sum + wave.slots.length, 0);
  assert.equal(total, 40);
});

test('formation slots stay inside the playfield', () => {
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 8; col++) {
      const slot = slotPosition(col, row);
      assert.ok(slot.x > 20 && slot.x < SCREEN_W - 20, `x ${slot.x} out of bounds`);
      assert.ok(slot.y > 40 && slot.y < 200, `y ${slot.y} out of bounds`);
    }
  }
});

test('scoring matches the arcade table', () => {
  assert.equal(scoreFor('bee', false), 50);
  assert.equal(scoreFor('bee', true), 100);
  assert.equal(scoreFor('butterfly', false), 80);
  assert.equal(scoreFor('butterfly', true), 160);
  assert.equal(scoreFor('boss', false), 150);
  assert.equal(scoreFor('boss', true, 0), 400);
  assert.equal(scoreFor('boss', true, 1), 800);
  assert.equal(scoreFor('boss', true, 2), 1600);
});

test('the simulation is deterministic for identical seeds and inputs', () => {
  const a = new GalagaEngine({ seed: 12345 });
  const b = new GalagaEngine({ seed: 12345 });

  const inputs: Array<[number, () => void]> = [
    [0.0, () => {
      a.setInput('start1', true);
      b.setInput('start1', true);
    }],
    [0.2, () => {
      a.setInput('fire', true);
      b.setInput('fire', true);
      a.setInput('right', true);
      b.setInput('right', true);
    }],
    [1.4, () => {
      a.setInput('left', true);
      b.setInput('left', true);
    }],
    [2.0, () => {
      a.setInput('right', false);
      b.setInput('right', false);
    }],
  ];

  const hashesA: string[] = [];
  const hashesB: string[] = [];
  const steps = 60 * 45;
  for (let i = 0; i < steps; i++) {
    const t = i * FIXED_DT;
    for (const [at, action] of inputs) {
      if (Math.abs(t - at) < FIXED_DT / 2) action();
    }
    a.update(FIXED_DT);
    b.update(FIXED_DT);
    if (i % 60 === 0) {
      hashesA.push(a.snapshotHash());
      hashesB.push(b.snapshotHash());
    }
  }
  assert.deepEqual(hashesA, hashesB, 'identical seeds must produce identical runs');
  assert.ok(new Set(hashesA).size > 30, 'the run should actually evolve');
});

test('different seeds diverge', () => {
  const a = new GalagaEngine({ seed: 1 });
  const b = new GalagaEngine({ seed: 2 });
  a.startGame(1);
  b.startGame(1);
  run(a, 6);
  run(b, 6);
  assert.notEqual(a.snapshotHash(), b.snapshotHash());
});

test('starting a game enters the stage intro, then play', () => {
  const engine = new GalagaEngine({ seed: 7 });
  engine.setInput('start1', true);
  assert.equal(engine.phase, 'stageIntro');
  assert.equal(engine.stage, 1);
  assert.equal(engine.lives, 3);
  run(engine, 2.5);
  assert.equal(engine.phase, 'playing');
});

test('the fleet arrives and settles into a full formation', () => {
  const engine = new GalagaEngine({ seed: 99 });
  engine.startGame(1);
  // Long enough for every flight to arrive; the player stays put and does not shoot.
  run(engine, 22);
  const parked = engine.enemies.filter((e) => e.state === 'formation');
  const diving = engine.enemies.filter((e) => e.state === 'dive' || e.state === 'return');
  assert.equal(engine.enemies.length, 36, 'no ships should be lost without shooting');
  assert.ok(parked.length + diving.length === 36);
  assert.ok(parked.length >= 26, `expected most ships parked, got ${parked.length}`);
});

test('destroying every ship clears the stage and advances', () => {
  const engine = new GalagaEngine({ seed: 5 });
  engine.startGame(1);
  run(engine, 6); // let the whole fleet spawn
  assert.equal(engine.wavesRemaining, 0);

  let guard = 0;
  while (engine.enemies.length > 0 && guard++ < 2000) {
    for (const enemy of [...engine.enemies]) engine.debugKill(enemy.id);
    engine.update(FIXED_DT);
  }
  assert.equal(engine.enemies.length, 0);
  assert.equal(engine.phase, 'stageClear');
  run(engine, 2.2);
  assert.equal(engine.stage, 2);
});

test('extra lives are awarded at 20,000 and then every 70,000', () => {
  const engine = new GalagaEngine({ seed: 3 });
  engine.startGame(1);
  engine.phase = 'playing';
  engine.populateFleet();
  const startLives = engine.lives;
  let awarded = 0;
  for (let i = 0; i < 400 && awarded < 1; i++) {
    const boss = engine.enemies.find((e) => e.kind === 'boss' && e.alive);
    if (!boss) {
      engine.populateFleet();
      continue;
    }
    engine.debugKill(boss.id);
    engine.update(FIXED_DT);
    const events = engine.drainEvents();
    awarded += events.filter((e) => e.type === 'extraLife').length;
  }
  assert.ok(awarded >= 1, 'expected at least one extra life');
  assert.ok(engine.lives > startLives);
  assert.ok(engine.score >= 20000);
});

test('a boss tractor beam captures the fighter and costs a life', () => {
  const engine = new GalagaEngine({ seed: 11 });
  engine.startGame(1);
  engine.populateFleet();
  engine.phase = 'playing';
  engine.player.x = SCREEN_W / 2;

  const livesBefore = engine.lives;
  assert.equal(engine.forceCapture(), true);

  let captured = false;
  for (let i = 0; i < 60 * 8; i++) {
    engine.update(FIXED_DT);
    if (engine.drainEvents().some((e) => e.type === 'capture')) {
      captured = true;
      break;
    }
  }
  assert.equal(captured, true, 'the fighter should be caught in the beam');
  assert.equal(engine.lives, livesBefore - 1);
  const holder = engine.enemies.find((e) => e.capturedShip);
  assert.ok(holder, 'the boss should carry the captured fighter');
});

test('shooting the boss that holds the fighter rescues it', () => {
  const engine = new GalagaEngine({ seed: 13 });
  engine.startGame(1);
  engine.populateFleet();
  engine.phase = 'playing';
  engine.player.x = SCREEN_W / 2;
  engine.forceCapture();
  for (let i = 0; i < 60 * 8; i++) {
    engine.update(FIXED_DT);
    if (engine.drainEvents().some((e) => e.type === 'capture')) break;
  }
  const holder = engine.enemies.find((e) => e.capturedShip);
  assert.ok(holder);
  engine.debugKill(holder.id);
  const events = engine.drainEvents();
  assert.ok(events.some((e) => e.type === 'rescue'));
  assert.equal(engine.ships, 2);
});

test('the fighter cannot be hit during respawn invulnerability', () => {
  const engine = new GalagaEngine({ seed: 17 });
  engine.startGame(1);
  engine.populateFleet();
  engine.phase = 'playing';
  engine.player.x = SCREEN_W / 2;
  engine.player.invulnerable = 5;
  const lives = engine.lives;
  engine.bullets.push({
    x: engine.player.x,
    y: engine.player.y - 2,
    vx: 0,
    vy: 0,
    alive: true,
    from: 'enemy',
    variant: 0,
    slot: 0,
  });
  engine.update(FIXED_DT);
  assert.equal(engine.lives, lives);
});

test('an enemy bullet does kill an unprotected fighter', () => {
  const engine = new GalagaEngine({ seed: 19 });
  engine.startGame(1);
  engine.populateFleet();
  engine.phase = 'playing';
  engine.player.x = SCREEN_W / 2;
  engine.player.invulnerable = 0;
  const lives = engine.lives;
  engine.bullets.push({
    x: engine.player.x,
    y: engine.player.y - 2,
    vx: 0,
    vy: 0,
    alive: true,
    from: 'enemy',
    variant: 0,
    slot: 0,
  });
  engine.update(FIXED_DT);
  assert.equal(engine.lives, lives - 1);
});

test('attract mode keeps a decorative fleet on screen', () => {
  const engine = new GalagaEngine({ seed: 21 });
  assert.equal(engine.phase, 'attract');
  assert.equal(engine.enemies.length, 36);
  assert.equal(engine.player.visible, false);
  run(engine, 5);
  assert.equal(engine.phase, 'attract');
});

// ------------------------------------------------------- the no-fire bug --

test('enemy fire is limited to the eight shared shot slots', () => {
  const engine = new GalagaEngine({ seed: 31 });
  engine.startGame(1);
  engine.populateFleet();
  engine.phase = 'playing';
  engine.player.invulnerable = 999; // survive long enough to observe fire
  let live = 0;
  for (let i = 0; i < 60 * 12; i++) {
    engine.update(FIXED_DT);
    live = Math.max(live, engine.bullets.filter((b) => b.from === 'enemy').length);
  }
  assert.ok(live > 0, 'the fleet should be shooting');
  assert.ok(live <= 8, `at most eight rounds in flight, saw ${live}`);
});

test('forcing the no-fire bug stops the fleet shooting entirely', () => {
  const engine = new GalagaEngine({ seed: 33 });
  engine.startGame(1);
  engine.populateFleet();
  engine.phase = 'playing';
  engine.player.invulnerable = 999;

  engine.setNoFireBug(true);
  engine.drainEvents();
  assert.equal(engine.shotSlotsHung, 8);
  assert.equal(engine.noFireActive, true);

  let enemyShots = 0;
  for (let i = 0; i < 60 * 20; i++) {
    engine.update(FIXED_DT);
    for (const event of engine.drainEvents()) {
      if (event.type === 'enemyShoot') enemyShots++;
    }
  }
  assert.equal(enemyShots, 0, 'no ship may fire while every slot is jammed');
});

test('the bug survives a stage change but not a new credit', () => {
  const engine = new GalagaEngine({ seed: 35 });
  engine.startGame(1);
  engine.setNoFireBug(true);
  assert.equal(engine.noFireActive, true);

  engine.debugStage(2);
  run(engine, 3);
  assert.equal(engine.noFireActive, true, 'the slot table is per credit');

  engine.startGame(1);
  assert.equal(engine.noFireActive, false, 'a new game gets clean slots');
  assert.equal(engine.shotSlotsHung, 0);
});

test('turning the bug off restores fire', () => {
  const engine = new GalagaEngine({ seed: 37 });
  engine.startGame(1);
  engine.setNoFireBug(true);
  engine.setNoFireBug(false);
  assert.equal(engine.shotSlotsHung, 0);

  engine.populateFleet();
  engine.phase = 'playing';
  engine.player.invulnerable = 999;
  let enemyShots = 0;
  for (let i = 0; i < 60 * 12; i++) {
    engine.update(FIXED_DT);
    for (const event of engine.drainEvents()) {
      if (event.type === 'enemyShoot') enemyShots++;
    }
  }
  assert.ok(enemyShots > 0, 'the fleet should shoot again');
});

test('jammed slots accumulate the way edge divers do', () => {
  const engine = new GalagaEngine({ seed: 39 });
  engine.startGame(1);
  engine.debugJamShots(3);
  assert.equal(engine.shotSlotsHung, 3);
  assert.equal(engine.noFireActive, false);
  engine.debugJamShots(5);
  assert.equal(engine.shotSlotsHung, 8);
  assert.equal(engine.noFireActive, true);
});

// ------------------------------------------------------------ expert pilot --

test('the expert pilot plays a real game and scores', () => {
  const engine = new GalagaEngine({ seed: 101 });
  engine.startGame(1);
  const pilot = new AutoPilot();
  const steps = Math.round(90 / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    pilot.step(engine);
    engine.update(FIXED_DT);
    engine.drainEvents();
    if (engine.phase === 'gameOver') break;
  }
  assert.ok(engine.score > 5000, `expected a real score, got ${engine.score}`);
  assert.ok(engine.stage >= 3, `expected progress, reached stage ${engine.stage}`);
});

test('the expert pilot run is reproducible', () => {
  const play = () => {
    const engine = new GalagaEngine({ seed: 77 });
    engine.startGame(1);
    const pilot = new AutoPilot();
    const hashes: string[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      pilot.step(engine);
      engine.update(FIXED_DT);
      engine.drainEvents();
      if (i % 120 === 0) hashes.push(engine.snapshotHash());
    }
    return hashes;
  };
  assert.deepEqual(play(), play(), 'the pilot and the engine are both deterministic');
});

test('the expert pilot keeps moving under fire', () => {
  const engine = new GalagaEngine({ seed: 55 });
  engine.startGame(1);
  const pilot = new AutoPilot();
  const positions = new Set<number>();
  for (let i = 0; i < 60 * 25; i++) {
    pilot.step(engine);
    engine.update(FIXED_DT);
    engine.drainEvents();
    if (engine.phase === 'playing') positions.add(Math.round(engine.player.x));
  }
  assert.ok(positions.size > 40, `pilot should sweep the screen, visited ${positions.size} lanes`);
});

// ------------------------------------------------------------- victory --

test('clearing stage 255 wins the game instead of wrapping', () => {
  const engine = new GalagaEngine({ seed: 91 });
  engine.startGame(1);
  engine.debugStage(255);
  assert.equal(engine.stage, 255);

  // Let the whole challenging-stage flight spawn, then clear it.
  run(engine, 9);
  let guard = 0;
  while (engine.enemies.length > 0 && guard++ < 4000) {
    for (const enemy of [...engine.enemies]) engine.debugKill(enemy.id);
    engine.update(FIXED_DT);
  }
  engine.update(FIXED_DT);
  assert.equal(engine.phase, 'victory');
  assert.ok(engine.highScore >= engine.score);
});

test('the victory screen returns to attract mode', () => {
  const engine = new GalagaEngine({ seed: 93 });
  engine.startGame(1);
  engine.debugStage(255);
  run(engine, 9);
  let guard = 0;
  while (engine.enemies.length > 0 && guard++ < 4000) {
    for (const enemy of [...engine.enemies]) engine.debugKill(enemy.id);
    engine.update(FIXED_DT);
  }
  engine.update(FIXED_DT);
  assert.equal(engine.phase, 'victory');
  run(engine, 10);
  assert.equal(engine.phase, 'attract');
});
