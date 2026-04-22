// Particle Life — an AI-driven universe builder.
//
// A universe here is more than a force matrix. It's a *world*:
//   - N coloured species (3..7), each with its own mass and trail length.
//   - An NxN force matrix (row acts on column, -1..+1).
//   - A topology: torus (wrap), walls (hard reflect), void (drift off),
//     arena (circular bounce).
//   - An environmental field: none, gravity well, anti-gravity, vortex,
//     waves, dipole.
//   - A time mode: static, pulse (matrix amplitude breathes), drift (matrix
//     slowly morphs), or day/night (slow force inversion cycle).
//   - A mutation rate: close contact can convert one particle's type into
//     another, so species can spread through the world.
//   - A spawn shape controlling the t=0 layout.
//
// The AI prompt IS the preset engine: type a description, the LLM returns
// a full spec for every dimension above. You can still edit everything by
// hand — tap a force cell, change topology, field, time mode, mutation.
//
// Sound: a light Web-Audio ambient pad tuned to kinetic energy, plus short
// pings on user interactions. No external libraries. Pure Canvas 2D + Web
// Audio.

(function () {
  'use strict';

  // ── Endpoints / constants ───────────────────────────────────────────────────
  const AI_ENDPOINT = 'https://uy3l6suz07.execute-api.us-east-1.amazonaws.com/ai';
  const SLUG = 'particle-life';
  const AI_MODEL = 'gpt-5.4';

  const MIN_COLORS = 3;
  const MAX_COLORS = 7;
  const DEFAULT_MIN_DIST = 20;
  const FORCE_SCALE = 0.5;
  const MIN_COUNT = 50;
  const MAX_COUNT = 800;

  const ALLOWED_SPAWN    = ['scatter', 'ball', 'ring', 'stripes', 'sectors', 'clusters'];
  const ALLOWED_MOUSE    = ['repel', 'attract', 'spawn', 'infect', 'off'];
  const ALLOWED_TOPOLOGY = ['torus', 'walls', 'void', 'arena'];
  const ALLOWED_FIELD    = ['none', 'gravity', 'antigravity', 'vortex', 'waves', 'pole'];
  const ALLOWED_TIME     = ['static', 'pulse', 'drift', 'daynight'];

  const TAP_CYCLE = [0.7, 0.3, 0.0, -0.3, -0.7];

  function nextInCycle(v) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < TAP_CYCLE.length; i++) {
      const d = Math.abs(TAP_CYCLE[i] - v);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return TAP_CYCLE[(bestIdx + 1) % TAP_CYCLE.length];
  }

  // ── Seeded RNG ──────────────────────────────────────────────────────────────
  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  function makeSeedRNG(seed) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // ── Universe name generator (fallback) ──────────────────────────────────────
  const ADJECTIVES = [
    'Crimson', 'Amber', 'Cobalt', 'Viridian', 'Obsidian', 'Spectral',
    'Hollow', 'Fractal', 'Volatile', 'Silent', 'Liminal', 'Charged',
    'Frozen', 'Molten', 'Tangled', 'Drifting', 'Collapsed', 'Radiant',
    'Ashen', 'Electric', 'Pallid', 'Scattered', 'Restless', 'Dense',
  ];
  const NOUNS = [
    'Spiral', 'Cluster', 'Tide', 'Lattice', 'Vortex', 'Membrane',
    'Archive', 'Bloom', 'Circuit', 'Drift', 'Nexus', 'Filament',
    'Current', 'Orbit', 'Shell', 'Pulse', 'Cascade', 'Echo',
    'Remnant', 'Signal', 'Field', 'Rift', 'Halo', 'Matrix',
  ];
  function universeNameFromSeed(seed) {
    const rng = makeSeedRNG(seed);
    const adj = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(rng() * NOUNS.length)];
    return 'The ' + adj + ' ' + noun;
  }

  const DEFAULT_COLORS = ['#ff2244', '#00ffee', '#ffdd00', '#39ff14', '#ff00cc'];

  // ── Universe state ──────────────────────────────────────────────────────────
  let seed = hash('' + Date.now());
  let universeName = '';
  let particles = [];
  let forceMatrix = [];           // NxN base matrix (the "rest" state)
  let liveMatrix = [];            // NxN currently-in-effect (time-varying)
  let colors = DEFAULT_COLORS.slice();
  let masses = [];                // per-type mass (affects inertia)
  let trailTypes = [];            // per-type visual trail hint (0..1)
  let numTypes = colors.length;
  let spawnShape = 'scatter';
  let mouseMode = 'repel';
  let topology = 'torus';
  let field = 'none';
  let timeMode = 'static';
  let fieldStrength = 0.35;       // 0..1 multiplier on environmental field
  let mutationRate = 0;           // 0..0.02 per close-contact per step
  let trailFade = 0.25;           // background fade alpha (higher = shorter trails)
  let particleCount = 300;
  let speedMultiplier = 1;
  let friction = 0.95;
  let maxDist = 120;
  let minDist = DEFAULT_MIN_DIST;
  let running = false;
  let animId = null;
  let mouseX = null, mouseY = null;
  let mouseDown = false;
  let soundOn = true;
  let worldClock = 0;             // seconds of simulated time since load

  // ── Canvas init ─────────────────────────────────────────────────────────────
  const canvas = document.getElementById('canvas');
  let ctx = null;
  try {
    ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no ctx');
  } catch (e) {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('error-screen').style.display = 'flex';
    return;
  }
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ── Matrix / color helpers ──────────────────────────────────────────────────
  function buildForceMatrix(rng, n) {
    const m = [];
    for (let a = 0; a < n; a++) {
      m[a] = [];
      for (let b = 0; b < n; b++) m[a][b] = rng() * 2 - 1;
    }
    return m;
  }
  function cloneMatrix(m) {
    const out = [];
    for (let i = 0; i < m.length; i++) out.push(m[i].slice());
    return out;
  }
  function clampColor(c) {
    if (typeof c !== 'string') return '#ffffff';
    const s = c.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return '#ffffff';
  }
  function generateColorPalette(rng, n) {
    const out = [];
    const offset = rng() * 360;
    for (let i = 0; i < n; i++) {
      const h = (offset + (i * 360) / n) % 360;
      const s = 78 + rng() * 18;
      const l = 52 + rng() * 10;
      out.push(hslToHex(h, s, l));
    }
    return out;
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  // ── Particle spawn ──────────────────────────────────────────────────────────
  // Spawn shape controls t=0 layout.
  //   scatter  = uniform random
  //   ball     = gaussian cluster at centre
  //   ring     = hollow ring
  //   stripes  = vertical colour bands
  //   sectors  = pie slices (each colour in its own angular wedge)
  //   clusters = each colour in its own small blob somewhere on screen
  function spawnParticles(rng, count, shape) {
    const list = [];
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const ballR = Math.min(W, H) * 0.08;
    const ringR = Math.min(W, H) * 0.28;
    const ringThick = Math.min(W, H) * 0.04;
    const stripeW = W / numTypes;
    const perType = Math.ceil(count / numTypes);

    // Pre-pick cluster centres if needed.
    const clusterCentres = [];
    if (shape === 'clusters') {
      const padX = W * 0.15, padY = H * 0.15;
      for (let t = 0; t < numTypes; t++) {
        clusterCentres.push({
          x: padX + rng() * (W - 2 * padX),
          y: padY + rng() * (H - 2 * padY),
        });
      }
    }

    function gauss() {
      const u = Math.max(1e-6, rng());
      const v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    for (let t = 0; t < numTypes; t++) {
      for (let i = 0; i < perType && list.length < count; i++) {
        let x, y;
        if (shape === 'ball') {
          x = cx + gauss() * ballR;
          y = cy + gauss() * ballR;
        } else if (shape === 'ring') {
          const ang = rng() * Math.PI * 2;
          const r = ringR + (rng() - 0.5) * ringThick * 2;
          x = cx + Math.cos(ang) * r;
          y = cy + Math.sin(ang) * r;
        } else if (shape === 'stripes') {
          x = stripeW * t + rng() * stripeW;
          y = rng() * H;
        } else if (shape === 'sectors') {
          // Angular wedge per type, radius uniform within arena.
          const a0 = (t / numTypes) * Math.PI * 2;
          const a1 = ((t + 1) / numTypes) * Math.PI * 2;
          const ang = a0 + rng() * (a1 - a0);
          const maxR = Math.min(W, H) * 0.42;
          const r = Math.sqrt(rng()) * maxR;
          x = cx + Math.cos(ang) * r;
          y = cy + Math.sin(ang) * r;
        } else if (shape === 'clusters') {
          const c = clusterCentres[t];
          x = c.x + gauss() * ballR * 0.8;
          y = c.y + gauss() * ballR * 0.8;
        } else {
          x = rng() * W;
          y = rng() * H;
        }
        // Clamp into world before we start.
        if (x < 0) x += W; else if (x >= W) x -= W;
        if (y < 0) y += H; else if (y >= H) y -= H;
        list.push({ x: x, y: y, vx: 0, vy: 0, type: t });
      }
    }
    return list;
  }

  // ── Time-variance: recompute liveMatrix from base + worldClock ─────────────
  function updateLiveMatrix() {
    if (timeMode === 'static') {
      liveMatrix = forceMatrix;
      return;
    }
    if (timeMode === 'pulse') {
      // Amplitude of every cell swings between 0.4x and 1.4x on a ~6s period.
      const a = 0.9 + 0.5 * Math.sin(worldClock * (Math.PI * 2 / 6));
      liveMatrix = [];
      for (let r = 0; r < numTypes; r++) {
        liveMatrix[r] = [];
        for (let c = 0; c < numTypes; c++) {
          liveMatrix[r][c] = Math.max(-1, Math.min(1, forceMatrix[r][c] * a));
        }
      }
      return;
    }
    if (timeMode === 'daynight') {
      // Sign flips on a very slow cycle (~30s) crossing through 0 — so the
      // universe inhales (rules go to zero), then exhales with inverted
      // rules, over and over.
      const a = Math.cos(worldClock * (Math.PI * 2 / 30));
      liveMatrix = [];
      for (let r = 0; r < numTypes; r++) {
        liveMatrix[r] = [];
        for (let c = 0; c < numTypes; c++) {
          liveMatrix[r][c] = Math.max(-1, Math.min(1, forceMatrix[r][c] * a));
        }
      }
      return;
    }
    if (timeMode === 'drift') {
      // Each cell is perturbed by its own slow sinusoid seeded by (r,c).
      // Period ~20s per cell with slightly different phases so the whole
      // matrix slowly morphs without anything staying fixed for long.
      liveMatrix = [];
      for (let r = 0; r < numTypes; r++) {
        liveMatrix[r] = [];
        for (let c = 0; c < numTypes; c++) {
          const ph = (r * 1.7 + c * 2.3);
          const delta = 0.35 * Math.sin(worldClock * (Math.PI * 2 / 20) + ph);
          liveMatrix[r][c] = Math.max(-1, Math.min(1, forceMatrix[r][c] + delta));
        }
      }
      return;
    }
    liveMatrix = forceMatrix;
  }

  // ── Environmental field ─────────────────────────────────────────────────────
  // Returns an (ax, ay) acceleration due to the chosen ambient field at (x,y).
  // fieldStrength scales the whole thing.
  function fieldForce(x, y, ax, ay) {
    if (field === 'none' || fieldStrength === 0) return { ax: ax, ay: ay };
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const dx = x - cx;
    const dy = y - cy;
    const r  = Math.sqrt(dx * dx + dy * dy) + 0.001;
    const nx = dx / r;
    const ny = dy / r;
    const diag = Math.sqrt(W * W + H * H);
    const norm = r / (diag * 0.5); // 0 at centre, ~1 at corners

    if (field === 'gravity') {
      // Pulls toward centre, slightly stronger closer to it (1/(norm+0.2)).
      const s = fieldStrength * 1.4 / (norm + 0.2);
      ax -= nx * s;
      ay -= ny * s;
    } else if (field === 'antigravity') {
      const s = fieldStrength * 1.0 / (norm + 0.25);
      ax += nx * s;
      ay += ny * s;
    } else if (field === 'vortex') {
      // Tangential swirl — perpendicular to the radial direction. Strength
      // eases out with distance so it looks like a spiral not a shear.
      const s = fieldStrength * 1.2 * Math.exp(-norm * 1.5);
      ax += -ny * s;
      ay +=  nx * s;
    } else if (field === 'waves') {
      // Two-axis standing wave, gentle.
      const k = 0.02;
      const s = fieldStrength * 0.6;
      ax += Math.sin(y * k + worldClock * 1.3) * s;
      ay += Math.sin(x * k + worldClock * 0.9) * s;
    } else if (field === 'pole') {
      // Dipole: top half pulls up, bottom half pushes down.
      const s = fieldStrength * 0.7;
      ay += (y - cy > 0) ? s : -s;
    }
    return { ax: ax, ay: ay };
  }

  // ── Physics step ────────────────────────────────────────────────────────────
  function step(dt) {
    worldClock += dt;
    // Time-variance: only recompute a few times per second rather than every
    // frame — the matrix changes slowly.
    if (timeMode !== 'static') updateLiveMatrix();

    const W = canvas.width;
    const H = canvas.height;
    const maxDistSq = maxDist * maxDist;
    const minDistSq = minDist * minDist;
    const speed = speedMultiplier;
    const fr = friction;
    const doWrap = topology === 'torus';

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      let ax = 0, ay = 0;

      for (let j = 0; j < particles.length; j++) {
        if (i === j) continue;
        const q = particles[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;

        if (doWrap) {
          if (dx > W / 2) dx -= W;
          else if (dx < -W / 2) dx += W;
          if (dy > H / 2) dy -= H;
          else if (dy < -H / 2) dy += H;
        }

        const distSq = dx * dx + dy * dy;
        if (distSq === 0 || distSq > maxDistSq) continue;

        const dist = Math.sqrt(distSq);

        if (distSq < minDistSq) {
          const repForce = (minDist - dist) / minDist;
          ax -= (dx / dist) * repForce * 2;
          ay -= (dy / dist) * repForce * 2;

          // Mutation on close contact — pick up a tiny chance per step.
          // Using dt so high-FPS and low-FPS behave similarly.
          if (mutationRate > 0 && p.type !== q.type) {
            if (Math.random() < mutationRate * dt * 60) {
              p.type = q.type;
            }
          }
          continue;
        }

        const coeff = liveMatrix[p.type][q.type];
        const norm = (dist - minDist) / (maxDist - minDist);
        const strength = coeff * FORCE_SCALE * (1 - norm);
        ax += (dx / dist) * strength;
        ay += (dy / dist) * strength;
      }

      // Ambient field.
      const fr_ = fieldForce(p.x, p.y, ax, ay);
      ax = fr_.ax; ay = fr_.ay;

      // Mouse interaction — repel / attract / infect (spawn mode is handled
      // on click events, not here).
      if (mouseX !== null && mouseMode !== 'off' && mouseMode !== 'spawn') {
        let dx = p.x - mouseX;
        let dy = p.y - mouseY;
        const distSq = dx * dx + dy * dy;
        const radius = (mouseMode === 'attract') ? 180
                     : (mouseMode === 'infect')  ? 90
                     : 80;
        if (distSq < radius * radius && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const falloff = (radius - dist) / radius;
          if (mouseMode === 'attract') {
            const s = falloff * 2.2;
            ax -= (dx / dist) * s;
            ay -= (dy / dist) * s;
          } else if (mouseMode === 'infect') {
            // Gently pulls in and morphs type toward the "infection colour"
            // (arbitrary: type 0).
            const s = falloff * 0.9;
            ax -= (dx / dist) * s;
            ay -= (dy / dist) * s;
            if (Math.random() < 0.01 * falloff) p.type = 0;
          } else {
            const s = falloff * 3;
            ax += (dx / dist) * s;
            ay += (dy / dist) * s;
          }
        }
      }

      // Apply acceleration scaled by mass (mass divides acceleration so
      // heavier particles feel the same force less).
      const m = masses[p.type] || 1;
      p.vx = (p.vx + (ax * dt * speed) / m) * fr;
      p.vy = (p.vy + (ay * dt * speed) / m) * fr;
    }

    // Position integration + topology boundary handling.
    const cx = W / 2, cy = H / 2;
    const arenaR = Math.min(W, H) * 0.48;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx * dt * speed * 60;
      p.y += p.vy * dt * speed * 60;

      if (topology === 'torus') {
        if (p.x < 0) p.x += W;
        else if (p.x >= W) p.x -= W;
        if (p.y < 0) p.y += H;
        else if (p.y >= H) p.y -= H;
      } else if (topology === 'walls') {
        // Hard reflect — flip velocity on boundary crossing.
        if (p.x < 0) { p.x = 0; p.vx = -p.vx * 0.85; }
        else if (p.x >= W) { p.x = W - 1; p.vx = -p.vx * 0.85; }
        if (p.y < 0) { p.y = 0; p.vy = -p.vy * 0.85; }
        else if (p.y >= H) { p.y = H - 1; p.vy = -p.vy * 0.85; }
      } else if (topology === 'arena') {
        // Circular hard wall centred in the canvas.
        const dx = p.x - cx;
        const dy = p.y - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r > arenaR) {
          const nx = dx / r;
          const ny = dy / r;
          // Snap back onto the wall.
          p.x = cx + nx * arenaR;
          p.y = cy + ny * arenaR;
          // Reflect velocity over the inward normal.
          const dot = p.vx * nx + p.vy * ny;
          p.vx = (p.vx - 2 * dot * nx) * 0.85;
          p.vy = (p.vy - 2 * dot * ny) * 0.85;
        }
      }
      // 'void' topology: no clamping — particles can drift off screen.
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function render() {
    // Background fade drives motion trails: lower alpha = longer trails.
    ctx.fillStyle = 'rgba(10,10,10,' + trailFade.toFixed(3) + ')';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Arena ring visual hint.
    if (topology === 'arena') {
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const r = Math.min(canvas.width, canvas.height) * 0.48;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 221, 0, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      // Size is a soft function of mass: heavier = bigger.
      const m = masses[p.type] || 1;
      const radius = 2 + Math.min(2.5, (m - 1) * 1.2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = colors[p.type] || '#ffffff';
      ctx.shadowBlur = 6;
      ctx.shadowColor = colors[p.type] || '#ffffff';
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // ── Sound layer ─────────────────────────────────────────────────────────────
  let audioCtx = null;
  let padOscA = null, padOscB = null, padGain = null, padFilter = null;
  let padPitchTarget = 140;
  let padGainTarget = 0;

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { audioCtx = null; return null; }
    try {
      padFilter = audioCtx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = 900;
      padFilter.Q.value = 3;
      padGain = audioCtx.createGain();
      padGain.gain.value = 0;
      padOscA = audioCtx.createOscillator();
      padOscA.type = 'sawtooth';
      padOscA.frequency.value = 140;
      padOscB = audioCtx.createOscillator();
      padOscB.type = 'sine';
      padOscB.frequency.value = 140 * 1.5;
      const mixA = audioCtx.createGain();
      mixA.gain.value = 0.6;
      const mixB = audioCtx.createGain();
      mixB.gain.value = 0.4;
      padOscA.connect(mixA).connect(padFilter);
      padOscB.connect(mixB).connect(padFilter);
      padFilter.connect(padGain).connect(audioCtx.destination);
      padOscA.start();
      padOscB.start();
    } catch (e) { /* ignore */ }
    return audioCtx;
  }
  function resumeAudioIfNeeded() {
    const c = ensureAudio();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }

  function updatePadFromWorld() {
    if (!audioCtx || !padGain || !padOscA) return;
    if (!soundOn) {
      padGainTarget = 0;
    } else {
      let speedSum = 0;
      const stride = Math.max(1, Math.floor(particles.length / 60));
      let samples = 0;
      for (let i = 0; i < particles.length; i += stride) {
        const p = particles[i];
        speedSum += Math.abs(p.vx) + Math.abs(p.vy);
        samples++;
      }
      const avgSpeed = samples > 0 ? speedSum / samples : 0;
      const density = Math.min(1, particles.length / 500);
      padGainTarget = Math.min(0.08, 0.01 + avgSpeed * 0.06 + density * 0.02);
      padPitchTarget = 90 + avgSpeed * 70 + density * 30;
      if (padPitchTarget > 260) padPitchTarget = 260;
    }
    try {
      const now = audioCtx.currentTime;
      padGain.gain.linearRampToValueAtTime(padGainTarget, now + 0.25);
      padOscA.frequency.linearRampToValueAtTime(padPitchTarget, now + 0.4);
      padOscB.frequency.linearRampToValueAtTime(padPitchTarget * 1.5, now + 0.4);
      padFilter.frequency.linearRampToValueAtTime(600 + padPitchTarget * 3, now + 0.35);
    } catch (e) { /* ignore */ }
  }

  function playPing(freq, dur, type) {
    if (!soundOn) return;
    const c = ensureAudio();
    if (!c) return;
    try {
      const t = c.currentTime;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'triangle';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.5), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  function playRuleTap(v) {
    const base = 320;
    const freq = base + v * 220;
    playPing(freq, 0.09, 'triangle');
  }
  function playSuccess()   { playPing(520, 0.16, 'sine');     setTimeout(() => playPing(780, 0.18, 'sine'), 90); }
  function playRespawn()   { playPing(180, 0.18, 'sawtooth'); }
  function playError()     { playPing(180, 0.22, 'square');   setTimeout(() => playPing(120, 0.18, 'square'), 80); }

  // ── Apply an AI spec (or a manual randomize) ───────────────────────────────
  function applySpec(spec, srcSeed) {
    const rng = makeSeedRNG(srcSeed || seed);

    let n = Math.round(spec.numColors || spec.num_colors || 0);
    if (!n || n < MIN_COLORS) n = MIN_COLORS;
    if (n > MAX_COLORS) n = MAX_COLORS;

    let palette = Array.isArray(spec.colors) ? spec.colors.slice(0, n).map(clampColor) : [];
    while (palette.length < n) palette = palette.concat(generateColorPalette(rng, n - palette.length));
    palette = palette.slice(0, n);

    let matrix;
    if (Array.isArray(spec.matrix) && spec.matrix.length === n
        && spec.matrix.every(row => Array.isArray(row) && row.length === n)) {
      matrix = spec.matrix.map(row =>
        row.map(v => Math.max(-1, Math.min(1, Number(v) || 0)))
      );
    } else {
      matrix = buildForceMatrix(rng, n);
    }

    // Per-type traits (optional). Default to 1.0 if absent.
    let massArr;
    if (Array.isArray(spec.masses) && spec.masses.length === n) {
      massArr = spec.masses.map(v => clampFloat(v, 0.3, 3.0, 1));
    } else {
      massArr = new Array(n).fill(1);
    }
    let trailArr;
    if (Array.isArray(spec.trails) && spec.trails.length === n) {
      trailArr = spec.trails.map(v => clampFloat(v, 0, 1, 0.5));
    } else {
      trailArr = new Array(n).fill(0.5);
    }

    const count   = clampInt(spec.particleCount  ?? spec.particle_count,  MIN_COUNT, MAX_COUNT, particleCount);
    const speed   = clampFloat(spec.speed,     0.2,  2.0, 1.0);
    const fric    = clampFloat(spec.friction,  0.8,  0.99, 0.95);
    const reach   = clampFloat(spec.maxDist ?? spec.reach, 60, 220, 120);
    const minD    = clampFloat(spec.minDist, 8, 40, DEFAULT_MIN_DIST);
    const fs      = clampFloat(spec.fieldStrength ?? spec.field_strength, 0, 1, 0.35);
    const mut     = clampFloat(spec.mutationRate ?? spec.mutation_rate, 0, 0.02, 0);
    const tf      = clampFloat(spec.trailFade ?? spec.trail_fade, 0.05, 0.6, 0.25);

    const shape = ALLOWED_SPAWN.includes(spec.spawnShape) ? spec.spawnShape
                : ALLOWED_SPAWN.includes(spec.spawn)      ? spec.spawn
                : 'scatter';
    const mouse = ALLOWED_MOUSE.includes(spec.mouseMode) ? spec.mouseMode
                : ALLOWED_MOUSE.includes(spec.mouse)     ? spec.mouse
                : 'repel';
    const topo  = ALLOWED_TOPOLOGY.includes(spec.topology) ? spec.topology : 'torus';
    const fld   = ALLOWED_FIELD.includes(spec.field) ? spec.field : 'none';
    const tm    = ALLOWED_TIME.includes(spec.timeMode) ? spec.timeMode
                : ALLOWED_TIME.includes(spec.time)     ? spec.time
                : 'static';
    const name = (typeof spec.name === 'string' && spec.name.trim())
      ? spec.name.trim().slice(0, 60)
      : universeNameFromSeed(srcSeed || seed);

    numTypes = n;
    colors = palette;
    masses = massArr;
    trailTypes = trailArr;
    forceMatrix = matrix;
    liveMatrix = cloneMatrix(matrix);
    particleCount = count;
    speedMultiplier = speed;
    friction = fric;
    maxDist = reach;
    minDist = minD;
    fieldStrength = fs;
    mutationRate = mut;
    trailFade = tf;
    spawnShape = shape;
    mouseMode = mouse;
    topology = topo;
    field = fld;
    timeMode = tm;
    universeName = name;

    syncControlsFromState();
    particles = spawnParticles(rng, particleCount, spawnShape);
  }

  function clampInt(v, lo, hi, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }
  function clampFloat(v, lo, hi, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  // ── Ruleset encoding (URL share) ────────────────────────────────────────────
  // Share encoding includes matrix + N + palette + the new world knobs so a
  // shared link restores the full universe, not just the force matrix.
  function encodeMatrix(m) {
    let out = '';
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m.length; c++) {
        const v = Math.max(-1, Math.min(1, m[r][c]));
        const q = Math.round((v + 1) * 7.5);
        out += q.toString(16);
      }
    }
    return out;
  }
  function decodeMatrix(str, n) {
    if (!str || str.length !== n * n) return null;
    const m = [];
    for (let r = 0; r < n; r++) {
      m[r] = [];
      for (let c = 0; c < n; c++) {
        const ch = str.charAt(r * n + c);
        const q = parseInt(ch, 16);
        if (isNaN(q)) return null;
        m[r][c] = (q / 7.5) - 1;
      }
    }
    return m;
  }

  function readSharedUniverse() {
    const h = (location.hash || '').replace(/^#/, '');
    if (!h) return null;
    const params = new URLSearchParams(h);
    const r = params.get('r');
    const nRaw = params.get('n');
    const cRaw = params.get('c');
    if (!r) return null;
    const n = nRaw ? clampInt(nRaw, MIN_COLORS, MAX_COLORS, 5) : 5;
    const matrix = decodeMatrix(r, n);
    if (!matrix) return null;
    let palette = null;
    if (cRaw) {
      const parts = cRaw.split(',').map(p => clampColor('#' + p.replace(/^#/, '')));
      if (parts.length === n) palette = parts;
    }
    return {
      matrix: matrix,
      numColors: n,
      colors: palette,
      topology:  ALLOWED_TOPOLOGY.includes(params.get('t')) ? params.get('t') : null,
      field:     ALLOWED_FIELD.includes(params.get('f'))    ? params.get('f') : null,
      timeMode:  ALLOWED_TIME.includes(params.get('tm'))    ? params.get('tm') : null,
      spawnShape: ALLOWED_SPAWN.includes(params.get('s'))   ? params.get('s') : null,
    };
  }

  function writeRulesetToHash() {
    const enc = encodeMatrix(forceMatrix);
    const cEnc = colors.map(c => c.replace(/^#/, '')).join(',');
    const params = new URLSearchParams();
    params.set('r', enc);
    params.set('n', String(numTypes));
    params.set('c', cEnc);
    params.set('t', topology);
    params.set('f', field);
    params.set('tm', timeMode);
    params.set('s', spawnShape);
    const url = location.pathname + location.search + '#' + params.toString();
    try { history.replaceState(null, '', url); } catch (e) { location.hash = params.toString(); }
  }

  // ── AI call ────────────────────────────────────────────────────────────────
  async function generateUniverse(prompt) {
    const SYSTEM_PROMPT = [
      'You design universes for a "Particle Life" simulation. The user describes one in plain English; you return a strict JSON object describing the full world.',
      '',
      'A universe has N types of coloured particles (N = 3..7). Each type exerts a force on every other type given by an NxN matrix of numbers from -1..+1. Positive = attracted, negative = repelled, near 0 = ignores. The matrix is NOT symmetric — asymmetry is where chase behaviour and spirals come from.',
      '',
      'But a universe is MORE than a force matrix. You also design:',
      '- its spatial TOPOLOGY (how space wraps/bounds),',
      '- an ambient environmental FIELD (e.g. gravity, vortex, waves),',
      '- a TIME mode (is the matrix static, breathing, drifting, or cycling?),',
      '- per-type MASSES and TRAILS (some species are heavier/lighter, some leave long trails),',
      '- a MUTATION rate (on close contact, one particle may convert to the other\'s type — lets species spread).',
      '',
      'Output ONE strict JSON object. No prose, no code fence, no explanation.',
      '',
      'Schema (all fields required unless marked optional):',
      '{',
      '  "name": "short evocative name, 2-5 words, no quotes",',
      '  "numColors": integer 3-7,',
      '  "colors": array of `numColors` hex strings like "#aabbcc" — VIVID, readable on near-black (#0a0a0a). Avoid #000 or very dark. Avoid low-contrast pastels unless asked.',
      '  "matrix": `numColors` x `numColors` numbers in -1..+1. Row acts on column. Asymmetric is good.',
      '  "masses": array of `numColors` numbers in 0.3..3.0. Default 1 for each. Heavier = slower, looks bigger. Use varied masses for predator/prey, planets/moons, heavy cores, etc.',
      '  "trails": array of `numColors` numbers in 0..1. Advisory — the renderer uses trailFade globally.',
      '  "particleCount": integer 50-800. Default 300. Calm: 150-250. Dense/chaotic: 400-600.',
      '  "speed": number 0.2-2. Default 1.',
      '  "friction": number 0.8-0.99. Default 0.95. Calm/viscous: 0.90-0.94. Frictionless/energetic: 0.96-0.99.',
      '  "maxDist": number 60-220. Default 120. Interaction reach.',
      '  "minDist": number 8-40. Default 20. Close-range repulsion floor.',
      '  "spawnShape": one of "scatter" | "ball" | "ring" | "stripes" | "sectors" | "clusters". Pick whichever frames this universe best at t=0.',
      '  "mouseMode": one of "repel" | "attract" | "spawn" | "infect" | "off". Default "repel".',
      '  "topology": one of "torus" | "walls" | "void" | "arena".',
      '     - torus: edges wrap (classic).',
      '     - walls: hard rectangular walls, particles bounce.',
      '     - void: no walls, no wrap — particles drift off forever (use for isolated blooms, breathing cells).',
      '     - arena: circular hard wall centered on screen, particles bounce off.',
      '  "field": one of "none" | "gravity" | "antigravity" | "vortex" | "waves" | "pole".',
      '     - none: pure particle rules.',
      '     - gravity: centre pulls — good for planets, solar systems, tight swirls.',
      '     - antigravity: centre pushes — good for explosions, fireworks, blooms.',
      '     - vortex: tangential swirl — good for spirals, whirlpools, galaxies.',
      '     - waves: gentle standing ripples — good for tidepools, oceans, breathing dust.',
      '     - pole: dipole: top drifts down, bottom drifts up (or vice versa) — good for layered tides.',
      '  "fieldStrength": number 0..1 — how strongly the field affects particles. Default 0.35.',
      '  "timeMode": one of "static" | "pulse" | "drift" | "daynight".',
      '     - static: rules don\'t change.',
      '     - pulse: the whole matrix amplitude breathes (stronger, weaker, stronger...) on ~6s period. Good for organisms that feel alive, heartbeats.',
      '     - drift: each cell slowly morphs on its own phase — behaviour keeps evolving. Good for "universe that never settles".',
      '     - daynight: the whole matrix slowly inverts sign across ~30s — attractions become repulsions and back. Good for ecosystems with day/night rhythms.',
      '  "mutationRate": number 0..0.02. 0 = no mutation (stable species). Higher = species can convert on contact, so populations spread like infections. Use 0.003-0.008 for "viral" feels, 0.01-0.02 for rapid takeover.',
      '  "trailFade": number 0.05..0.6. Lower = longer visible motion trails. 0.1 = streaky comet trails; 0.25 = balanced; 0.5 = clean dots.',
      '}',
      '',
      'DESIGN GUIDANCE:',
      '- Think about what KIND of world the user is asking for, then pick topology/field/timeMode that frames it.',
      '  - "galaxy/solar system/orbits" → topology arena or torus; field vortex or gravity; trailFade low (0.10-0.15); heavy central-species mass.',
      '  - "crystal/lattice" → topology walls; field none; timeMode static; friction 0.96+; spawnShape ball.',
      '  - "cells/membranes/blobs" → strong diagonal self-attract; maybe mutationRate 0 to keep species stable.',
      '  - "predator/prey/chase" → cyclic matrix (i attracts i+1, i+1 repels i); often mutationRate 0.005-0.01 so populations shift.',
      '  - "viral/outbreak/infection" → high mutationRate (0.01+), cyclic matrix, fast speed.',
      '  - "tidepool/ocean/calm" → field waves; low speed; high friction; scatter spawn; pulse or drift timeMode.',
      '  - "fireworks/explosion" → field antigravity; low friction; spawnShape ball; trailFade 0.10.',
      '  - "dust/drift/gentle" → field none or waves low strength; high friction; low particle count; scatter.',
      '  - "flocks/swarms/schools" → moderate positive diagonal + mild positive off-diag; drift timeMode keeps them flowing.',
      '  - "evolving/alive/changing" → timeMode drift or daynight + low mutationRate; keeps the eye returning.',
      '- If the user mentions a colour scheme, use it; otherwise vivid neon on near-black.',
      '- ASYMMETRY TIP: symmetric matrices settle to boring equilibria. Always include at least one asymmetric pair.',
      '',
      'CLAMP all values to the ranges above. Respond with ONLY the JSON object.',
    ].join('\n');

    const body = {
      slug: SLUG,
      model: AI_MODEL,
      temperature: 0.85,
      max_tokens: 1200,
      response_format: 'json_object',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
    };

    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('http_' + res.status);
    const data = await res.json();
    if (!data || typeof data.content !== 'string') throw new Error('bad_shape');
    let parsed;
    try { parsed = JSON.parse(data.content); } catch (e) { throw new Error('bad_json'); }
    if (!parsed || typeof parsed !== 'object') throw new Error('bad_obj');
    return parsed;
  }

  // ── Game loop ────────────────────────────────────────────────────────────────
  let lastTime = null;
  let soundFrameCounter = 0;
  function loop(ts) {
    if (!running) return;
    if (lastTime === null) lastTime = ts;
    const dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;
    step(dt);
    render();
    soundFrameCounter++;
    if (soundFrameCounter % 10 === 0) updatePadFromWorld();
    animId = requestAnimationFrame(loop);
  }
  function startLoop() {
    if (animId) cancelAnimationFrame(animId);
    lastTime = null;
    running = true;
    animId = requestAnimationFrame(loop);
  }
  function stopLoop() {
    running = false;
    if (animId) { cancelAnimationFrame(animId); animId = null; }
  }

  // ── UI handles ───────────────────────────────────────────────────────────────
  const loadingScreen = document.getElementById('loading-screen');
  const universeNameEl = document.getElementById('universe-name');
  const universeTagsEl = document.getElementById('universe-tags');
  const btnReset = document.getElementById('btn-reset');
  const btnScreenshot = document.getElementById('btn-screenshot');
  const btnSoundToggle = document.getElementById('btn-sound-toggle');
  const sliderSpeed = document.getElementById('slider-speed');
  const sliderFriction = document.getElementById('slider-friction');
  const sliderCount = document.getElementById('slider-count');
  const sliderRadius = document.getElementById('slider-radius');
  const sliderField = document.getElementById('slider-field');
  const sliderMutation = document.getElementById('slider-mutation');
  const sliderTrail = document.getElementById('slider-trail');
  const selectSpawn = document.getElementById('select-spawn');
  const selectMouse = document.getElementById('select-mouse');
  const selectTopology = document.getElementById('select-topology');
  const selectField = document.getElementById('select-field');
  const selectTime = document.getElementById('select-time');
  const rulesGrid = document.getElementById('rules-grid');
  const panelToggle = document.getElementById('panel-toggle');
  const panelBody = document.getElementById('panel-body');
  const btnShareRules = document.getElementById('btn-share-rules');
  const btnRandomRules = document.getElementById('btn-random-rules');
  const advancedToggle = document.getElementById('advanced-toggle');
  const advancedBody = document.getElementById('advanced-body');
  const aiPrompt = document.getElementById('ai-prompt');
  const btnAiRun = document.getElementById('btn-ai-run');
  const btnAiSurprise = document.getElementById('btn-ai-surprise');
  const aiStatus = document.getElementById('ai-status');

  function syncControlsFromState() {
    if (sliderSpeed)    sliderSpeed.value = speedMultiplier;
    if (sliderFriction) sliderFriction.value = friction;
    if (sliderCount)    sliderCount.value = particleCount;
    if (sliderRadius)   sliderRadius.value = maxDist;
    if (sliderField)    sliderField.value = fieldStrength;
    if (sliderMutation) sliderMutation.value = mutationRate;
    if (sliderTrail)    sliderTrail.value = trailFade;
    if (selectSpawn)    selectSpawn.value = spawnShape;
    if (selectMouse)    selectMouse.value = mouseMode;
    if (selectTopology) selectTopology.value = topology;
    if (selectField)    selectField.value = field;
    if (selectTime)     selectTime.value = timeMode;
  }

  function setParticleCountDefault() {
    particleCount = window.innerWidth < 640 ? 200 : 350;
    if (sliderCount) sliderCount.value = particleCount;
  }

  function updateNameDisplay() {
    if (universeNameEl) universeNameEl.textContent = universeName;
    if (universeTagsEl) {
      // Build a short tag line describing the non-default world settings.
      const tags = [];
      if (topology !== 'torus') tags.push(topology);
      if (field !== 'none')     tags.push(field);
      if (timeMode !== 'static') tags.push(timeMode);
      if (mutationRate > 0)     tags.push('mutating');
      universeTagsEl.textContent = tags.length ? ' · ' + tags.join(' · ') : '';
    }
  }

  // ── Rules grid ───────────────────────────────────────────────────────────────
  function forceColor(v) {
    const mag = Math.min(1, Math.abs(v));
    const alpha = 0.15 + mag * 0.7;
    if (v >= 0) return 'rgba(57, 255, 20, ' + alpha.toFixed(3) + ')';
    return 'rgba(255, 34, 68, ' + alpha.toFixed(3) + ')';
  }
  function cellSymbol(v) {
    const mag = Math.abs(v);
    if (mag < 0.08) return '·';
    if (v > 0) return '+';
    return '−';
  }
  function describeForce(v, fromHex, toHex) {
    const mag = Math.abs(v);
    if (mag < 0.08) return fromHex + ' ignores ' + toHex;
    let strength;
    if (mag < 0.3) strength = (v >= 0) ? 'mildly attracts' : 'mildly repels';
    else if (mag < 0.6) strength = (v >= 0) ? 'attracts' : 'repels';
    else strength = (v >= 0) ? 'strongly attracts' : 'strongly repels';
    return fromHex + ' ' + strength + ' ' + toHex;
  }
  function markRulesCustom() {
    // When the user tweaks a rule, also propagate into liveMatrix so the
    // change is immediately felt even in time-varying modes.
    liveMatrix = cloneMatrix(forceMatrix);
    writeRulesetToHash();
  }

  function renderRulesGrid() {
    if (!rulesGrid) return;
    rulesGrid.innerHTML = '';
    const tmpl = '20px repeat(' + numTypes + ', 1fr)';
    rulesGrid.style.gridTemplateColumns = tmpl;
    rulesGrid.style.gridTemplateRows = tmpl;

    const corner = document.createElement('div');
    corner.className = 'rules-cell header';
    rulesGrid.appendChild(corner);

    for (let c = 0; c < numTypes; c++) {
      const sw = document.createElement('div');
      sw.className = 'rules-cell header header-swatch';
      sw.style.background = colors[c];
      sw.style.color = colors[c];
      sw.title = colors[c] + ' (target)';
      rulesGrid.appendChild(sw);
    }

    for (let r = 0; r < numTypes; r++) {
      const sw = document.createElement('div');
      sw.className = 'rules-cell header header-swatch';
      sw.style.background = colors[r];
      sw.style.color = colors[r];
      sw.title = colors[r] + ' (actor)';
      rulesGrid.appendChild(sw);

      for (let c = 0; c < numTypes; c++) {
        (function (row, col) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'rules-cell';
          refreshCell(cell, row, col);

          cell.addEventListener('click', function () {
            forceMatrix[row][col] = nextInCycle(forceMatrix[row][col]);
            refreshCell(cell, row, col);
            markRulesCustom();
            playRuleTap(forceMatrix[row][col]);
          });

          cell.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            forceMatrix[row][col] = 0;
            refreshCell(cell, row, col);
            markRulesCustom();
            playRuleTap(0);
          });

          let pressTimer = null;
          cell.addEventListener('touchstart', function () {
            pressTimer = setTimeout(function () {
              forceMatrix[row][col] = 0;
              refreshCell(cell, row, col);
              markRulesCustom();
              playRuleTap(0);
              pressTimer = 'fired';
            }, 550);
          }, { passive: true });
          cell.addEventListener('touchend', function (e) {
            if (pressTimer === 'fired') {
              e.preventDefault();
              pressTimer = null;
              return;
            }
            if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
          });
          cell.addEventListener('touchmove', function () {
            if (pressTimer && pressTimer !== 'fired') { clearTimeout(pressTimer); pressTimer = null; }
          });

          rulesGrid.appendChild(cell);
        })(r, c);
      }
    }
  }

  function refreshCell(cell, r, c) {
    const v = forceMatrix[r][c];
    cell.style.background = forceColor(v);
    cell.textContent = cellSymbol(v);
    const label = describeForce(v, colors[r], colors[c]);
    cell.title = label + ' (' + v.toFixed(2) + ')';
    cell.setAttribute('aria-label', label);
  }

  // ── Panel toggle ─────────────────────────────────────────────────────────────
  panelToggle.addEventListener('click', function () {
    panelBody.classList.toggle('collapsed');
    panelToggle.classList.toggle('collapsed');
  });

  if (advancedToggle && advancedBody) {
    advancedToggle.addEventListener('click', function () {
      const open = advancedBody.hasAttribute('hidden') ? true : false;
      if (open) {
        advancedBody.removeAttribute('hidden');
        advancedToggle.setAttribute('aria-expanded', 'true');
      } else {
        advancedBody.setAttribute('hidden', '');
        advancedToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ── Respawn / randomize ──────────────────────────────────────────────────────
  btnReset.addEventListener('click', function () {
    stopLoop();
    const newSeed = hash('' + Date.now() + Math.random());
    const rng = makeSeedRNG(newSeed);
    particleCount = parseInt(sliderCount.value, 10);
    particles = spawnParticles(rng, particleCount, spawnShape);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    startLoop();
    playRespawn();
  });

  if (selectSpawn) {
    selectSpawn.addEventListener('change', function () {
      spawnShape = this.value;
      const rng = makeSeedRNG(hash('' + Date.now() + Math.random()));
      particles = spawnParticles(rng, particleCount, spawnShape);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      writeRulesetToHash();
      playPing(260, 0.1, 'triangle');
    });
  }

  if (selectMouse) {
    selectMouse.addEventListener('change', function () {
      mouseMode = this.value;
      playPing(360, 0.09, 'triangle');
    });
  }

  if (selectTopology) {
    selectTopology.addEventListener('change', function () {
      topology = this.value;
      updateNameDisplay();
      writeRulesetToHash();
      playPing(420, 0.1, 'triangle');
    });
  }

  if (selectField) {
    selectField.addEventListener('change', function () {
      field = this.value;
      updateNameDisplay();
      writeRulesetToHash();
      playPing(300, 0.1, 'triangle');
    });
  }

  if (selectTime) {
    selectTime.addEventListener('change', function () {
      timeMode = this.value;
      worldClock = 0;
      updateLiveMatrix();
      updateNameDisplay();
      writeRulesetToHash();
      playPing(480, 0.1, 'triangle');
    });
  }

  sliderSpeed.addEventListener('input', function () {
    speedMultiplier = parseFloat(this.value);
  });
  sliderFriction.addEventListener('input', function () {
    friction = parseFloat(this.value);
  });
  sliderCount.addEventListener('change', function () {
    particleCount = parseInt(this.value, 10);
    const rng = makeSeedRNG(seed);
    particles = spawnParticles(rng, particleCount, spawnShape);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });
  if (sliderRadius) {
    sliderRadius.addEventListener('input', function () {
      maxDist = parseFloat(this.value);
    });
  }
  if (sliderField) {
    sliderField.addEventListener('input', function () {
      fieldStrength = parseFloat(this.value);
    });
  }
  if (sliderMutation) {
    sliderMutation.addEventListener('input', function () {
      mutationRate = parseFloat(this.value);
      updateNameDisplay();
    });
  }
  if (sliderTrail) {
    sliderTrail.addEventListener('input', function () {
      trailFade = parseFloat(this.value);
    });
  }

  if (btnRandomRules) {
    btnRandomRules.addEventListener('click', function () {
      const rng = makeSeedRNG(hash('' + Date.now() + Math.random()));
      forceMatrix = buildForceMatrix(rng, numTypes);
      liveMatrix = cloneMatrix(forceMatrix);
      renderRulesGrid();
      markRulesCustom();
      updateNameDisplay();
      playPing(440, 0.12, 'triangle');
    });
  }

  if (btnShareRules) {
    btnShareRules.addEventListener('click', function () {
      writeRulesetToHash();
      const url = location.href;
      const label = btnShareRules.textContent;
      function done(msg) {
        btnShareRules.textContent = msg;
        setTimeout(function () { btnShareRules.textContent = label; }, 1800);
      }
      if (navigator.share) {
        navigator.share({
          title: 'Particle Life — ' + universeName,
          text: 'My ruleset for Particle Life: ' + universeName,
          url: url,
        }).then(function () { done('shared'); })
          .catch(function () { tryClipboard(); });
      } else {
        tryClipboard();
      }
      function tryClipboard() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            done('link copied');
          }).catch(function () { done('copy failed'); });
        } else {
          done('copy failed');
        }
      }
    });
  }

  if (btnSoundToggle) {
    btnSoundToggle.addEventListener('click', function () {
      soundOn = !soundOn;
      this.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
      this.textContent = soundOn ? 'sound: on' : 'sound: off';
      if (soundOn) {
        resumeAudioIfNeeded();
        playPing(520, 0.12, 'sine');
      } else {
        if (audioCtx && padGain) {
          try { padGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1); } catch (e) {}
        }
      }
    });
  }

  // ── AI prompt wiring ────────────────────────────────────────────────────────
  const SURPRISE_PROMPTS = [
    'four colours in a rock-paper-scissors chase, each hunting the next, with mutation on contact so species slowly take each other over',
    'crystalline lattice trapped inside hard walls — snaps into geometric patterns',
    'gentle dust motes drifting in warm golden sunlight over a standing wave field',
    'chaotic fireworks exploding from an anti-gravity centre',
    'binary-star orbits inside a circular arena, two heavy colours locked in a gravitational dance with long comet trails',
    'predator-prey ecosystem with a day/night cycle, rules slowly flip and species stalk through the dark',
    'slime membranes drifting in the void — self-contained orbs that ignore each other',
    'a cold still ocean with faint tidal movements, drifting rules, mostly empty space',
    'psychedelic neon swarm in a vortex, dense, fast, breathing between attraction and repulsion',
    'ant trails — long thin moving chains of colour migrating across a toroidal plane',
    'galactic swirl: three pastel colours orbiting a central gravity well, slow, graceful, heavy cores with long trails',
    'viral outbreak where one colour slowly converts all others through contact',
  ];

  function setAiStatus(msg, isErr) {
    aiStatus.textContent = msg || '';
    aiStatus.classList.toggle('err', !!isErr);
  }
  function setAiBusy(busy) {
    btnAiRun.disabled = busy;
    btnAiSurprise.disabled = busy;
    btnAiRun.textContent = busy ? 'building…' : 'build universe';
  }

  async function runAi(promptText) {
    if (!promptText || !promptText.trim()) {
      setAiStatus('describe a universe first.', true);
      playError();
      return;
    }
    setAiBusy(true);
    setAiStatus('asking the AI for physics…', false);
    try {
      stopLoop();
      worldClock = 0;
      const newSeed = hash('' + Date.now() + promptText);
      seed = newSeed;
      const spec = await generateUniverse(promptText.trim());
      applySpec(spec, newSeed);
      renderRulesGrid();
      updateNameDisplay();
      writeRulesetToHash();
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      startLoop();
      setAiStatus('universe built: ' + universeName, false);
      playSuccess();
    } catch (e) {
      console.log('ai_err', e.message);
      setAiStatus('AI failed — randomised for you instead.', true);
      // Graceful fallback: random matrix, palette, leave world knobs alone
      // so the user's current setup stays.
      const newSeed = hash('' + Date.now() + Math.random());
      seed = newSeed;
      const rng = makeSeedRNG(newSeed);
      numTypes = 3 + Math.floor(rng() * 4);
      colors = generateColorPalette(rng, numTypes);
      masses = new Array(numTypes).fill(1);
      trailTypes = new Array(numTypes).fill(0.5);
      forceMatrix = buildForceMatrix(rng, numTypes);
      liveMatrix = cloneMatrix(forceMatrix);
      universeName = universeNameFromSeed(newSeed);
      particles = spawnParticles(rng, particleCount, spawnShape);
      renderRulesGrid();
      updateNameDisplay();
      writeRulesetToHash();
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      startLoop();
      playError();
    } finally {
      setAiBusy(false);
    }
  }

  if (btnAiRun) {
    btnAiRun.addEventListener('click', function () {
      resumeAudioIfNeeded();
      runAi(aiPrompt.value);
    });
  }
  if (btnAiSurprise) {
    btnAiSurprise.addEventListener('click', function () {
      resumeAudioIfNeeded();
      const rnd = SURPRISE_PROMPTS[Math.floor(Math.random() * SURPRISE_PROMPTS.length)];
      aiPrompt.value = rnd;
      runAi(rnd);
    });
  }
  if (aiPrompt) {
    aiPrompt.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        resumeAudioIfNeeded();
        runAi(aiPrompt.value);
      }
    });
  }
  document.querySelectorAll('.ai-example').forEach(btn => {
    btn.addEventListener('click', function () {
      const prompt = this.getAttribute('data-prompt') || this.textContent || '';
      aiPrompt.value = prompt;
      resumeAudioIfNeeded();
      runAi(prompt);
    });
  });

  // ── Screenshot / share ───────────────────────────────────────────────────────
  function share() {
    const dataURL = canvas.toDataURL('image/png');
    const filename = universeName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-]/g, '') + '.png';
    if (navigator.share && navigator.canShare) {
      fetch(dataURL)
        .then(r => r.blob())
        .then(blob => {
          const file = new File([blob], filename, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            return navigator.share({
              title: 'Particle Life — ' + universeName,
              text: 'I grew ' + universeName + ' in Particle Life',
              files: [file],
            });
          }
          throw new Error('file share not supported');
        })
        .catch(() => {
          navigator.share({
            title: 'Particle Life — ' + universeName,
            url: location.href,
          }).catch(downloadFallback);
        });
    } else {
      downloadFallback();
    }
    function downloadFallback() {
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = filename;
      a.click();
    }
  }
  btnScreenshot.addEventListener('click', share);
  window.share = share;

  // ── Touch / mouse interaction on canvas ─────────────────────────────────────
  function getCanvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function spawnAt(x, y) {
    // Drop a small burst of random-type particles at (x,y), respecting
    // the current particle cap.
    const burst = 18;
    for (let i = 0; i < burst; i++) {
      if (particles.length >= MAX_COUNT) break;
      const t = Math.floor(Math.random() * numTypes);
      particles.push({
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        type: t,
      });
    }
    playPing(600, 0.08, 'triangle');
  }

  canvas.addEventListener('mousemove', function (e) {
    if (!running) return;
    const p = getCanvasPos(e);
    mouseX = p.x; mouseY = p.y;
    // Continuous spawn while holding.
    if (mouseMode === 'spawn' && mouseDown) {
      if (Math.random() < 0.3) spawnAt(p.x, p.y);
    }
  });
  canvas.addEventListener('mouseleave', function () { mouseX = null; mouseY = null; mouseDown = false; });
  canvas.addEventListener('mousedown', function (e) {
    mouseDown = true;
    resumeAudioIfNeeded();
    const p = getCanvasPos(e);
    if (mouseMode === 'spawn') spawnAt(p.x, p.y);
  });
  canvas.addEventListener('mouseup', function () { mouseDown = false; });
  canvas.addEventListener('click', resumeAudioIfNeeded);

  canvas.addEventListener('touchstart', function (e) {
    if (!running) return;
    e.preventDefault();
    resumeAudioIfNeeded();
    mouseDown = true;
    const t = e.touches[0];
    const p = getCanvasPos(t);
    mouseX = p.x; mouseY = p.y;
    if (mouseMode === 'spawn') spawnAt(p.x, p.y);
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    if (!running) return;
    e.preventDefault();
    const t = e.touches[0];
    const p = getCanvasPos(t);
    mouseX = p.x; mouseY = p.y;
    if (mouseMode === 'spawn' && mouseDown) {
      if (Math.random() < 0.25) spawnAt(p.x, p.y);
    }
  }, { passive: false });
  canvas.addEventListener('touchend', function () { mouseX = null; mouseY = null; mouseDown = false; });

  // ── Boot ────────────────────────────────────────────────────────────────────
  setParticleCountDefault();

  setTimeout(function () {
    const shared = readSharedUniverse();
    if (shared) {
      numTypes = shared.numColors;
      forceMatrix = shared.matrix;
      liveMatrix = cloneMatrix(forceMatrix);
      masses = new Array(numTypes).fill(1);
      trailTypes = new Array(numTypes).fill(0.5);
      if (shared.colors) colors = shared.colors;
      else {
        const rng = makeSeedRNG(seed);
        colors = generateColorPalette(rng, numTypes);
      }
      if (shared.topology)   topology = shared.topology;
      if (shared.field)      field = shared.field;
      if (shared.timeMode)   timeMode = shared.timeMode;
      if (shared.spawnShape) spawnShape = shared.spawnShape;
      universeName = 'Shared Universe';
      const rng = makeSeedRNG(seed);
      particles = spawnParticles(rng, particleCount, spawnShape);
    } else {
      // First boot — build an initial random universe with mild default
      // world knobs so the screen has motion before the user types anything.
      const rng = makeSeedRNG(seed);
      numTypes = 4;
      colors = generateColorPalette(rng, numTypes);
      masses = new Array(numTypes).fill(1);
      trailTypes = new Array(numTypes).fill(0.5);
      forceMatrix = buildForceMatrix(rng, numTypes);
      liveMatrix = cloneMatrix(forceMatrix);
      universeName = universeNameFromSeed(seed);
      particles = spawnParticles(rng, particleCount, spawnShape);
    }

    syncControlsFromState();
    updateNameDisplay();
    renderRulesGrid();

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    startLoop();

    loadingScreen.style.display = 'none';
  }, 400);

}());
