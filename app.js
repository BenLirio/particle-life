// Particle Life — an AI-driven universe builder.
// Type a description of a universe; an LLM returns a full physics spec:
// colors (3..7), an NxN force matrix, spawn shape, mouse mode, speed,
// friction, reach and a name. The old "pick a preset from a dropdown"
// flow is gone — the AI prompt IS the preset engine. You can still edit
// the force matrix by hand (single-tap cycles a cell through the same
// attract/ignore/repel states), and still randomize the whole matrix.
//
// Sound: a light Web-Audio layer. One continuous ambient pad tuned to the
// total kinetic energy + particle density of the current world (so chaotic
// universes hum louder/higher), plus short pings on user interactions.
//
// No external libraries. Pure Canvas 2D, pure Web Audio.

(function () {
  'use strict';

  // ── Endpoints / constants ───────────────────────────────────────────────────
  const AI_ENDPOINT = 'https://uy3l6suz07.execute-api.us-east-1.amazonaws.com/ai';
  const SLUG = 'particle-life';
  // The factory AI proxy currently whitelists only OpenAI gpt-5.4 models.
  // The user's feedback asked for "claude-opus-4-7" but the proxy doesn't
  // pass through Anthropic traffic — `gpt-5.4` is the flagship tier
  // available here, so we use it. Element design (NxN matrix + colours +
  // radii + spawn + name, all self-consistent) is exactly the multi-knob
  // reasoning task the flagship is for. See infrastructure/ai/README.md.
  const AI_MODEL = 'gpt-5.4';

  const MIN_COLORS = 3;
  const MAX_COLORS = 7;
  const DEFAULT_MIN_DIST = 20;
  const FORCE_SCALE = 0.5;
  const MIN_COUNT = 50;
  const MAX_COUNT = 800;

  // Force values a tap cycles through on the rules grid — 3 obvious states
  // plus mild variants for finer tuning.
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

  // Default palette used when the AI isn't involved (hand-edited matrix,
  // manual randomize, fallback after AI failure).
  const DEFAULT_COLORS = ['#ff2244', '#00ffee', '#ffdd00', '#39ff14', '#ff00cc'];

  // ── Universe state ──────────────────────────────────────────────────────────
  let seed = hash('' + Date.now());
  let universeName = '';
  let particles = [];
  let forceMatrix = [];           // NxN
  let colors = DEFAULT_COLORS.slice();
  let numTypes = colors.length;
  let spawnShape = 'scatter';     // scatter | ball | ring | stripes
  let mouseMode = 'repel';        // repel | attract | off
  let particleCount = 300;
  let speedMultiplier = 1;
  let friction = 0.95;
  let maxDist = 120;              // interaction radius
  let minDist = DEFAULT_MIN_DIST;
  let running = false;
  let animId = null;
  let touchX = null, touchY = null;
  let soundOn = true;

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
      // Expand #abc → #aabbcc
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return '#ffffff';
  }

  function generateColorPalette(rng, n) {
    // Fallback palette generator — evenly spaced hues at high saturation.
    const out = [];
    const offset = rng() * 360;
    for (let i = 0; i < n; i++) {
      const h = (offset + (i * 360) / n) % 360;
      const s = 78 + rng() * 18;   // 78-96
      const l = 52 + rng() * 10;   // 52-62
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
  // Spawn shape controls the initial layout. Scatter = uniform random. Ball =
  // tight gaussian cluster at centre. Ring = hollow circle. Stripes = vertical
  // colour bands so colour interactions pop at t=0.
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
        } else {
          x = rng() * W;
          y = rng() * H;
        }
        if (x < 0) x += W; else if (x >= W) x -= W;
        if (y < 0) y += H; else if (y >= H) y -= H;
        list.push({ x: x, y: y, vx: 0, vy: 0, type: t });
      }
    }
    return list;
  }

  // ── Physics step ────────────────────────────────────────────────────────────
  function step(dt) {
    const W = canvas.width;
    const H = canvas.height;
    const maxDistSq = maxDist * maxDist;
    const minDistSq = minDist * minDist;
    const speed = speedMultiplier;
    const fr = friction;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      let ax = 0, ay = 0;

      for (let j = 0; j < particles.length; j++) {
        if (i === j) continue;
        const q = particles[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;

        if (dx > W / 2) dx -= W;
        else if (dx < -W / 2) dx += W;
        if (dy > H / 2) dy -= H;
        else if (dy < -H / 2) dy += H;

        const distSq = dx * dx + dy * dy;
        if (distSq === 0 || distSq > maxDistSq) continue;

        const dist = Math.sqrt(distSq);

        if (distSq < minDistSq) {
          const repForce = (minDist - dist) / minDist;
          ax -= (dx / dist) * repForce * 2;
          ay -= (dy / dist) * repForce * 2;
          continue;
        }

        const coeff = forceMatrix[p.type][q.type];
        const norm = (dist - minDist) / (maxDist - minDist);
        const strength = coeff * FORCE_SCALE * (1 - norm);
        ax += (dx / dist) * strength;
        ay += (dy / dist) * strength;
      }

      if (touchX !== null && mouseMode !== 'off') {
        let dx = p.x - touchX;
        let dy = p.y - touchY;
        const distSq = dx * dx + dy * dy;
        const radius = (mouseMode === 'attract') ? 180 : 80;
        if (distSq < radius * radius && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const falloff = (radius - dist) / radius;
          if (mouseMode === 'attract') {
            const attractForce = falloff * 2.2;
            ax -= (dx / dist) * attractForce;
            ay -= (dy / dist) * attractForce;
          } else {
            const repForce = falloff * 3;
            ax += (dx / dist) * repForce;
            ay += (dy / dist) * repForce;
          }
        }
      }

      p.vx = (p.vx + ax * dt * speed) * fr;
      p.vy = (p.vy + ay * dt * speed) * fr;
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx * dt * speed * 60;
      p.y += p.vy * dt * speed * 60;
      if (p.x < 0) p.x += W;
      else if (p.x >= W) p.x -= W;
      if (p.y < 0) p.y += H;
      else if (p.y >= H) p.y -= H;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function render() {
    ctx.fillStyle = 'rgba(10,10,10,0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = colors[p.type] || '#ffffff';
      ctx.shadowBlur = 6;
      ctx.shadowColor = colors[p.type] || '#ffffff';
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // ── Sound layer ─────────────────────────────────────────────────────────────
  // Two pieces:
  //   1. Continuous ambient pad — two oscillators whose gain and pitch are
  //      modulated by the world's kinetic energy + density each frame.
  //      Higher energy = louder + brighter. Calm universes are near-silent.
  //   2. Short pings on user interactions (rule edit, AI success, respawn,
  //      preset etc.), each a tiny oscillator envelope.
  //
  // All sound is opt-out: a toggle button flips `soundOn`. The AudioContext
  // is lazily created on the first user gesture so Chrome/Safari don't
  // block it.
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

  // Measure kinetic energy + density and drive the pad.
  function updatePadFromWorld() {
    if (!audioCtx || !padGain || !padOscA) return;
    if (!soundOn) {
      padGainTarget = 0;
    } else {
      // Average speed across particles (sample to keep it cheap).
      let speedSum = 0;
      const stride = Math.max(1, Math.floor(particles.length / 60));
      let samples = 0;
      for (let i = 0; i < particles.length; i += stride) {
        const p = particles[i];
        speedSum += Math.abs(p.vx) + Math.abs(p.vy);
        samples++;
      }
      const avgSpeed = samples > 0 ? speedSum / samples : 0;
      // Density — more particles = slightly fuller pad.
      const density = Math.min(1, particles.length / 500);

      // Kinetic energy → gain (small ceiling so it never blasts).
      padGainTarget = Math.min(0.08, 0.01 + avgSpeed * 0.06 + density * 0.02);
      // Pitch drifts with chaos, but stays in a calm bass band.
      padPitchTarget = 90 + avgSpeed * 70 + density * 30;
      // Clamp so very chaotic universes don't scream.
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
    // Attract = upward pitch, repel = downward, ignore = mid. Keeps the
    // grid feeling like a tactile instrument.
    const base = 320;
    const freq = base + v * 220;
    playPing(freq, 0.09, 'triangle');
  }

  function playSuccess()   { playPing(520, 0.16, 'sine');     setTimeout(() => playPing(780, 0.18, 'sine'), 90); }
  function playRespawn()   { playPing(180, 0.18, 'sawtooth'); }
  function playError()     { playPing(180, 0.22, 'square');   setTimeout(() => playPing(120, 0.18, 'square'), 80); }

  // ── Universe init / AI spec application ────────────────────────────────────
  function applySpec(spec, srcSeed) {
    // Used for both AI-returned specs and manual randomize. Fills in any
    // missing fields with defaults so we can never end up in a broken state.
    const rng = makeSeedRNG(srcSeed || seed);

    // Number of colors.
    let n = Math.round(spec.numColors || spec.num_colors || 0);
    if (!n || n < MIN_COLORS) n = MIN_COLORS;
    if (n > MAX_COLORS) n = MAX_COLORS;

    // Colors.
    let palette = Array.isArray(spec.colors) ? spec.colors.slice(0, n).map(clampColor) : [];
    while (palette.length < n) palette = palette.concat(generateColorPalette(rng, n - palette.length));
    palette = palette.slice(0, n);

    // Force matrix.
    let matrix;
    if (Array.isArray(spec.matrix) && spec.matrix.length === n
        && spec.matrix.every(row => Array.isArray(row) && row.length === n)) {
      matrix = spec.matrix.map(row =>
        row.map(v => Math.max(-1, Math.min(1, Number(v) || 0)))
      );
    } else {
      matrix = buildForceMatrix(rng, n);
    }

    // Scalar knobs (with clamps).
    const count   = clampInt(spec.particleCount  ?? spec.particle_count,  MIN_COUNT, MAX_COUNT, particleCount);
    const speed   = clampFloat(spec.speed,     0.2,  2.0, 1.0);
    const fric    = clampFloat(spec.friction,  0.8,  0.99, 0.95);
    const reach   = clampFloat(spec.maxDist ?? spec.reach, 60, 220, 120);
    const minD    = clampFloat(spec.minDist, 8, 40, DEFAULT_MIN_DIST);

    // Spawn shape / mouse mode / name.
    const allowedSpawn = ['scatter', 'ball', 'ring', 'stripes'];
    const allowedMouse = ['repel', 'attract', 'off'];
    const shape = allowedSpawn.includes(spec.spawnShape) ? spec.spawnShape
                : allowedSpawn.includes(spec.spawn)      ? spec.spawn
                : 'scatter';
    const mouse = allowedMouse.includes(spec.mouseMode) ? spec.mouseMode
                : allowedMouse.includes(spec.mouse)     ? spec.mouse
                : 'repel';
    const name = (typeof spec.name === 'string' && spec.name.trim())
      ? spec.name.trim().slice(0, 60)
      : universeNameFromSeed(srcSeed || seed);

    // Commit.
    numTypes = n;
    colors = palette;
    forceMatrix = matrix;
    particleCount = count;
    speedMultiplier = speed;
    friction = fric;
    maxDist = reach;
    minDist = minD;
    spawnShape = shape;
    mouseMode = mouse;
    universeName = name;

    // Re-sync UI controls.
    syncControlsFromState();

    // Spawn particles in the chosen shape.
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
  // Share encoding now includes the colours and N (since they're variable).
  // Format: r=<hex matrix>&n=<int>&c=<comma-sep hexes without #>
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
    return { matrix: matrix, numColors: n, colors: palette };
  }

  function writeRulesetToHash() {
    const enc = encodeMatrix(forceMatrix);
    const cEnc = colors.map(c => c.replace(/^#/, '')).join(',');
    const params = new URLSearchParams();
    params.set('r', enc);
    params.set('n', String(numTypes));
    params.set('c', cEnc);
    const url = location.pathname + location.search + '#' + params.toString();
    try { history.replaceState(null, '', url); } catch (e) { location.hash = params.toString(); }
  }

  // ── AI call ────────────────────────────────────────────────────────────────
  async function generateUniverse(prompt) {
    const SYSTEM_PROMPT = [
      'You design universes for a "Particle Life" simulation. The user describes a universe in plain English; you return a strict JSON object describing its full physics.',
      '',
      'Particle Life works like this: there are N types of coloured particles (N = 3..7). Each type exerts a force on every other type given by an NxN matrix of numbers from -1..+1. Positive = that colour is ATTRACTED to the other colour; negative = repelled; near 0 = ignores. The matrix is NOT symmetric — "red attracts blue" is independent from "blue attracts red". Asymmetry is where chase-behaviour and emergent spirals come from.',
      '',
      'Output ONE strict JSON object. No prose, no code fence, no explanation.',
      '',
      'Schema (all fields required):',
      '{',
      '  "name": "short evocative name, 2-5 words, no quotes",',
      '  "numColors": integer 3-7,',
      '  "colors": array of `numColors` hex strings like "#aabbcc" — VIVID, readable on near-black (#0a0a0a), distinct from each other. NEVER pure #000000 or very dark. Avoid low-contrast pastels unless the user explicitly asks for muted.',
      '  "matrix": `numColors` x `numColors` array of numbers in -1..+1. Row acts on column. Asymmetric is good.',
      '  "particleCount": integer 50-800. Default 300. Calm/sparse universes: 150-250. Dense/chaotic: 400-600.',
      '  "speed": number 0.2-2. Default 1. Slow/gentle: 0.4-0.7. Fast/frantic: 1.3-1.8.',
      '  "friction": number 0.8-0.99. Default 0.95. Viscous/calm: 0.90-0.94. Frictionless/energetic: 0.96-0.99.',
      '  "maxDist": number 60-220. Default 120. Interaction reach. Short-range tight clusters: 60-90. Long-range swarms: 160-220.',
      '  "minDist": number 8-40. Default 20. Close-range repulsion floor. Rarely needs to change.',
      '  "spawnShape": "scatter" | "ball" | "ring" | "stripes". Scatter = uniform. Ball = tight cluster. Ring = hollow circle. Stripes = vertical colour bands. Pick whichever shows off this universe at t=0.',
      '  "mouseMode": "repel" | "attract" | "off". Default "repel".',
      '}',
      '',
      'DESIGN GUIDANCE:',
      '- If the user mentions "chase", "predator/prey", "rock-paper-scissors", make a CYCLIC matrix: type i strongly attracts type i+1, type i+1 repels type i. The diagonal should be mildly positive (self-cohesion) or mildly negative.',
      '- If the user mentions "cells", "membrane", "orbs", "blobs": strong self-attract on the diagonal, moderate repulsion to all other types — produces round self-contained clusters.',
      '- If the user mentions "crystal", "lattice", "rigid", "snap": strong self-attract with strong mutual repulsion between different types — particles lock into geometric patterns. Use high friction (0.96+) and slower speed.',
      '- If the user mentions "orbit", "binary", "dance", "galaxy": a few asymmetric pairs (a→b +0.7, b→a -0.7) produces orbital dynamics. Fewer colours (3-4) makes this cleaner.',
      '- If the user mentions "explosion", "fireworks", "chaos": strong negative diagonal (self-repel) + mixed off-diagonal values. Low friction (0.97-0.99), high speed.',
      '- If the user mentions "drift", "dust", "gentle", "calm": all values near 0, slight positive-leaning. Low particle count. High friction.',
      '- If the user mentions "flocking", "schooling", "birds": moderate self-attract, mild attract to other types. Medium speed, medium friction.',
      '- If the user mentions a colour scheme (neon, pastel, fire, ocean, forest): pick colours that match. Otherwise use vivid neon on near-black.',
      '- Always pick a spawnShape that makes the t=0 moment LEGIBLE for this universe: crystal → ball, orbiters → ring, chase loop → stripes, drift → scatter.',
      '',
      'ASYMMETRY TIP: a totally symmetric matrix (m[a][b] == m[b][a]) produces boring equilibria. At minimum, include ONE asymmetric pair so there\'s motion.',
      '',
      'CLAMP VALUES to the ranges above. Do not return values outside them.',
      '',
      'Respond with ONLY the JSON object.',
    ].join('\n');

    const body = {
      slug: SLUG,
      model: AI_MODEL,
      temperature: 0.8,
      max_tokens: 800,
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
    // Update the ambient pad a few times per second — don't do it every frame.
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
  const btnReset = document.getElementById('btn-reset');
  const btnScreenshot = document.getElementById('btn-screenshot');
  const btnSoundToggle = document.getElementById('btn-sound-toggle');
  const sliderSpeed = document.getElementById('slider-speed');
  const sliderFriction = document.getElementById('slider-friction');
  const sliderCount = document.getElementById('slider-count');
  const sliderRadius = document.getElementById('slider-radius');
  const selectSpawn = document.getElementById('select-spawn');
  const selectMouse = document.getElementById('select-mouse');
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
    if (selectSpawn)    selectSpawn.value = spawnShape;
    if (selectMouse)    selectMouse.value = mouseMode;
  }

  function setParticleCountDefault() {
    particleCount = window.innerWidth < 640 ? 200 : 350;
    if (sliderCount) sliderCount.value = particleCount;
  }

  function updateNameDisplay() {
    if (universeNameEl) universeNameEl.textContent = universeName;
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
    // User edits = custom ruleset. Re-sync URL so the share link reflects edits.
    writeRulesetToHash();
  }

  function renderRulesGrid() {
    if (!rulesGrid) return;
    rulesGrid.innerHTML = '';

    // Dynamic grid template: one 20px header track + N equal-fraction tracks.
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
      playPing(260, 0.1, 'triangle');
    });
  }

  if (selectMouse) {
    selectMouse.addEventListener('change', function () {
      mouseMode = this.value;
      playPing(360, 0.09, 'triangle');
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

  if (btnRandomRules) {
    btnRandomRules.addEventListener('click', function () {
      const rng = makeSeedRNG(hash('' + Date.now() + Math.random()));
      forceMatrix = buildForceMatrix(rng, numTypes);
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

  // ── Sound toggle ────────────────────────────────────────────────────────────
  if (btnSoundToggle) {
    btnSoundToggle.addEventListener('click', function () {
      soundOn = !soundOn;
      this.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
      this.textContent = soundOn ? 'sound: on' : 'sound: off';
      if (soundOn) {
        resumeAudioIfNeeded();
        playPing(520, 0.12, 'sine');
      } else {
        // Silence the pad immediately.
        if (audioCtx && padGain) {
          try { padGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1); } catch (e) {}
        }
      }
    });
  }

  // ── AI prompt wiring ────────────────────────────────────────────────────────
  const SURPRISE_PROMPTS = [
    'four colours in a rock-paper-scissors chase, each hunting the next',
    'crystalline lattice that snaps into geometric patterns',
    'gentle dust motes drifting in warm golden sunlight',
    'chaotic fireworks exploding from the centre',
    'binary-star orbits, two colours locked in a gravitational dance',
    'predator-prey ecosystem, fast, asymmetric, feels alive',
    'slime membranes — self-contained orbs that ignore each other',
    'a cold still ocean with faint tidal movements',
    'psychedelic neon swarm, dense, fast, low friction',
    'ant trails — long thin moving chains of colour',
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
      // Graceful fallback: random matrix with a generated palette.
      const newSeed = hash('' + Date.now() + Math.random());
      seed = newSeed;
      const rng = makeSeedRNG(newSeed);
      numTypes = 3 + Math.floor(rng() * 4);
      colors = generateColorPalette(rng, numTypes);
      forceMatrix = buildForceMatrix(rng, numTypes);
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
    // Cmd/Ctrl+Enter submits from the textarea.
    aiPrompt.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        resumeAudioIfNeeded();
        runAi(aiPrompt.value);
      }
    });
  }
  // Example chips fill the prompt AND fire the request (one-click vibe).
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

  canvas.addEventListener('mousemove', function (e) {
    if (!running) return;
    const p = getCanvasPos(e);
    touchX = p.x; touchY = p.y;
  });
  canvas.addEventListener('mouseleave', function () { touchX = null; touchY = null; });

  // Canvas clicks can "kick" audio to life for users who haven't hit a button.
  canvas.addEventListener('click', resumeAudioIfNeeded);

  canvas.addEventListener('touchstart', function (e) {
    if (!running) return;
    e.preventDefault();
    resumeAudioIfNeeded();
    const t = e.touches[0];
    const p = getCanvasPos(t);
    touchX = p.x; touchY = p.y;
  }, { passive: false });

  canvas.addEventListener('touchmove', function (e) {
    if (!running) return;
    e.preventDefault();
    const t = e.touches[0];
    const p = getCanvasPos(t);
    touchX = p.x; touchY = p.y;
  }, { passive: false });

  canvas.addEventListener('touchend', function () { touchX = null; touchY = null; });

  // ── Boot ────────────────────────────────────────────────────────────────────
  setParticleCountDefault();

  setTimeout(function () {
    const shared = readSharedUniverse();
    if (shared) {
      // Rebuild from shared state — matrix, N, and palette (if provided).
      numTypes = shared.numColors;
      forceMatrix = shared.matrix;
      if (shared.colors) colors = shared.colors;
      else {
        const rng = makeSeedRNG(seed);
        colors = generateColorPalette(rng, numTypes);
      }
      universeName = 'Shared Universe';
      const rng = makeSeedRNG(seed);
      particles = spawnParticles(rng, particleCount, spawnShape);
    } else {
      // First boot — build an initial random universe so the screen has
      // motion before the user types anything. Three colours, scatter
      // spawn, mild-to-medium dynamics.
      const rng = makeSeedRNG(seed);
      numTypes = 4;
      colors = generateColorPalette(rng, numTypes);
      forceMatrix = buildForceMatrix(rng, numTypes);
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
