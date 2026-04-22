// Particle Life simulation — emergent attraction/repulsion between colour groups
// Terminal/CRT aesthetic, pure Canvas 2D, no external libraries.
// UX goal: show-first. No title gate. No "how it works" wall. The rules grid
// is always directly editable — tap a cell to cycle attract / ignore / repel.

(function () {
  'use strict';

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

  // ── Universe name generator ─────────────────────────────────────────────────
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

  // ── Config ──────────────────────────────────────────────────────────────────
  const COLORS = ['#ff2244', '#00ffee', '#ffdd00', '#39ff14', '#ff00cc'];
  const COLOR_NAMES = ['red', 'cyan', 'yellow', 'green', 'magenta'];
  const NUM_TYPES = COLORS.length;
  const MAX_DIST = 120;
  const MIN_DIST = 20;
  const FORCE_SCALE = 0.5;

  // Discrete force values a tap cycles through. Three obvious states are
  // friendlier than a 16-step slider; hold-drag still gets fine values for
  // power users. Order: full attract → mild attract → ignore → mild repel → full repel → back to attract.
  const TAP_CYCLE = [0.7, 0.3, 0.0, -0.3, -0.7];

  function nextInCycle(v) {
    // Find nearest step, then move to the next.
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < TAP_CYCLE.length; i++) {
      const d = Math.abs(TAP_CYCLE[i] - v);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return TAP_CYCLE[(bestIdx + 1) % TAP_CYCLE.length];
  }

  // ── Presets ─────────────────────────────────────────────────────────────────
  const PRESETS = {
    drifters: [
      [ 0.10,  0.05, -0.05,  0.05,  0.05],
      [ 0.05,  0.10,  0.05, -0.05,  0.05],
      [-0.05,  0.05,  0.10,  0.05, -0.05],
      [ 0.05, -0.05,  0.05,  0.10,  0.05],
      [ 0.05,  0.05, -0.05,  0.05,  0.10],
    ],
    crystallizers: [
      [ 0.80, -0.40, -0.40, -0.40, -0.40],
      [-0.40,  0.80, -0.40, -0.40, -0.40],
      [-0.40, -0.40,  0.80, -0.40, -0.40],
      [-0.40, -0.40, -0.40,  0.80, -0.40],
      [-0.40, -0.40, -0.40, -0.40,  0.80],
    ],
    'predator-prey': [
      [ 0.20,  0.80, -0.50, -0.20,  0.10],
      [-0.80,  0.20,  0.80, -0.50, -0.20],
      [-0.20, -0.80,  0.20,  0.80, -0.50],
      [-0.50, -0.20, -0.80,  0.20,  0.80],
      [ 0.80, -0.50, -0.20, -0.80,  0.20],
    ],
    cells: [
      [ 0.60,  0.40, -0.30,  0.10, -0.10],
      [ 0.40,  0.60, -0.30, -0.10,  0.10],
      [-0.30, -0.30,  0.10, -0.20, -0.20],
      [ 0.10, -0.10, -0.20,  0.60,  0.40],
      [-0.10,  0.10, -0.20,  0.40,  0.60],
    ],
    snakes: [
      [ 0.30,  0.90,  0.00,  0.00,  0.00],
      [ 0.00,  0.30,  0.90,  0.00,  0.00],
      [ 0.00,  0.00,  0.30,  0.90,  0.00],
      [ 0.00,  0.00,  0.00,  0.30,  0.90],
      [ 0.90,  0.00,  0.00,  0.00,  0.30],
    ],
    orbiters: [
      [ 0.10,  0.70,  0.10,  0.10,  0.10],
      [-0.70,  0.10,  0.10,  0.10,  0.10],
      [ 0.10,  0.10,  0.10,  0.70,  0.10],
      [ 0.10,  0.10, -0.70,  0.10,  0.10],
      [ 0.10,  0.10,  0.10,  0.10,  0.10],
    ],
    exploders: [
      [-0.80,  0.60,  0.60,  0.60,  0.60],
      [ 0.60, -0.80,  0.60,  0.60,  0.60],
      [ 0.60,  0.60, -0.80,  0.60,  0.60],
      [ 0.60,  0.60,  0.60, -0.80,  0.60],
      [ 0.60,  0.60,  0.60,  0.60, -0.80],
    ],
    'big-bang': [
      [-0.90,  0.40,  0.40,  0.40,  0.40],
      [ 0.40, -0.90,  0.40,  0.40,  0.40],
      [ 0.40,  0.40, -0.90,  0.40,  0.40],
      [ 0.40,  0.40,  0.40, -0.90,  0.40],
      [ 0.40,  0.40,  0.40,  0.40, -0.90],
    ],
  };

  // Default spawn shape for each preset. Picked so the initial moment of each
  // preset is legible — crystallizers look great from a tight ball, snakes from
  // stripes, cells from a ring, etc.
  const PRESET_SPAWN = {
    'drifters':      'scatter',
    'crystallizers': 'ball',
    'predator-prey': 'scatter',
    'cells':         'ring',
    'snakes':        'stripes',
    'orbiters':      'ring',
    'exploders':     'ball',
    'big-bang':      'ball',
  };

  let seed = hash('' + Date.now());
  let universeName = '';
  let particles = [];
  let forceMatrix = [];
  let currentPreset = 'random';
  let spawnShape = 'scatter'; // scatter | ball | ring | stripes
  let mouseMode = 'repel';    // repel | attract | off
  let particleCount = 200;
  let speedMultiplier = 1;
  let friction = 0.95;
  let running = false;
  let animId = null;
  let touchX = null, touchY = null;

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

  // ── Force matrix ────────────────────────────────────────────────────────────
  function buildForceMatrix(rng) {
    const m = [];
    for (let a = 0; a < NUM_TYPES; a++) {
      m[a] = [];
      for (let b = 0; b < NUM_TYPES; b++) {
        m[a][b] = rng() * 2 - 1;
      }
    }
    return m;
  }

  function cloneMatrix(m) {
    const out = [];
    for (let i = 0; i < m.length; i++) out.push(m[i].slice());
    return out;
  }

  // ── Particles ───────────────────────────────────────────────────────────────
  // Spawn shape controls the initial position layout. Scatter = current uniform
  // random. Ball = tight gaussian cluster at center. Ring = hollow circle.
  // Stripes = vertical color bands so color interactions pop at t=0.
  function spawnParticles(rng, count, shape) {
    const list = [];
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const ballR = Math.min(W, H) * 0.08;
    const ringR = Math.min(W, H) * 0.28;
    const ringThick = Math.min(W, H) * 0.04;
    const stripeW = W / NUM_TYPES;
    const perType = Math.ceil(count / NUM_TYPES);

    // Gaussian-ish sample from two uniforms (Box–Muller).
    function gauss() {
      const u = Math.max(1e-6, rng());
      const v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    for (let t = 0; t < NUM_TYPES; t++) {
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
          // scatter (default)
          x = rng() * W;
          y = rng() * H;
        }
        // Clamp into bounds so edge-of-screen spawns don't immediately wrap.
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
    const maxDistSq = MAX_DIST * MAX_DIST;
    const minDistSq = MIN_DIST * MIN_DIST;
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
          const repForce = (MIN_DIST - dist) / MIN_DIST;
          ax -= (dx / dist) * repForce * 2;
          ay -= (dy / dist) * repForce * 2;
          continue;
        }

        const coeff = forceMatrix[p.type][q.type];
        const norm = (dist - MIN_DIST) / (MAX_DIST - MIN_DIST);
        const strength = coeff * FORCE_SCALE * (1 - norm);
        ax += (dx / dist) * strength;
        ay += (dy / dist) * strength;
      }

      if (touchX !== null && mouseMode !== 'off') {
        let dx = p.x - touchX;
        let dy = p.y - touchY;
        const distSq = dx * dx + dy * dy;
        // Attract uses a wider radius so pulling particles in feels responsive
        // even when the cursor is far from the nearest cluster.
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
      ctx.fillStyle = COLORS[p.type];
      ctx.shadowBlur = 6;
      ctx.shadowColor = COLORS[p.type];
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // ── Game loop ────────────────────────────────────────────────────────────────
  let lastTime = null;
  function loop(ts) {
    if (!running) return;
    if (lastTime === null) lastTime = ts;
    const dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;
    step(dt);
    render();
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

  // ── Universe init ────────────────────────────────────────────────────────────
  // `adoptPresetSpawn` — when the user explicitly picked a preset, auto-switch
  // the spawn shape to the one that shows off that preset best. When they just
  // hit "respawn" on an existing preset we leave their current spawn choice alone.
  function initUniverse(newSeed, count, presetKey, explicitMatrix, adoptPresetSpawn) {
    seed = newSeed;
    const rng = makeSeedRNG(seed);
    if (explicitMatrix) {
      forceMatrix = cloneMatrix(explicitMatrix);
      currentPreset = 'custom';
    } else if (presetKey === 'custom') {
      if (!forceMatrix || forceMatrix.length === 0) {
        forceMatrix = buildForceMatrix(rng);
      }
      currentPreset = 'custom';
    } else if (presetKey && presetKey !== 'random' && PRESETS[presetKey]) {
      forceMatrix = cloneMatrix(PRESETS[presetKey]);
      currentPreset = presetKey;
    } else {
      forceMatrix = buildForceMatrix(rng);
      currentPreset = 'random';
    }
    if (adoptPresetSpawn && PRESET_SPAWN[currentPreset]) {
      spawnShape = PRESET_SPAWN[currentPreset];
      const sel = document.getElementById('select-spawn');
      if (sel) sel.value = spawnShape;
    }
    particles = spawnParticles(rng, count, spawnShape);
    universeName = (currentPreset === 'random')
      ? universeNameFromSeed(seed)
      : (currentPreset === 'custom')
        ? 'Custom Ruleset'
        : presetDisplayName(currentPreset) + ' #' + (seed % 1000);
  }

  function presetDisplayName(key) {
    const map = {
      'drifters': 'Drifters',
      'crystallizers': 'Crystallizers',
      'predator-prey': 'Predator/Prey',
      'cells': 'Cells',
      'snakes': 'Snakes',
      'orbiters': 'Orbiters',
      'exploders': 'Exploders',
      'big-bang': 'Big Bang',
      'custom': 'Custom',
    };
    return map[key] || key;
  }

  // ── Ruleset encoding (URL share) ─────────────────────────────────────────────
  function encodeMatrix(m) {
    let out = '';
    for (let r = 0; r < NUM_TYPES; r++) {
      for (let c = 0; c < NUM_TYPES; c++) {
        const v = Math.max(-1, Math.min(1, m[r][c]));
        const q = Math.round((v + 1) * 7.5);
        out += q.toString(16);
      }
    }
    return out;
  }

  function decodeMatrix(str) {
    if (!str || str.length !== NUM_TYPES * NUM_TYPES) return null;
    const m = [];
    for (let r = 0; r < NUM_TYPES; r++) {
      m[r] = [];
      for (let c = 0; c < NUM_TYPES; c++) {
        const ch = str.charAt(r * NUM_TYPES + c);
        const q = parseInt(ch, 16);
        if (isNaN(q)) return null;
        m[r][c] = (q / 7.5) - 1;
      }
    }
    return m;
  }

  function readRulesetFromHash() {
    const h = (location.hash || '').replace(/^#/, '');
    if (!h) return null;
    const params = new URLSearchParams(h);
    const r = params.get('r');
    if (!r) return null;
    return decodeMatrix(r);
  }

  function writeRulesetToHash() {
    const enc = encodeMatrix(forceMatrix);
    const params = new URLSearchParams();
    params.set('r', enc);
    const url = location.pathname + location.search + '#' + params.toString();
    try { history.replaceState(null, '', url); } catch (e) { location.hash = params.toString(); }
  }

  // ── UI wiring ────────────────────────────────────────────────────────────────
  const loadingScreen = document.getElementById('loading-screen');
  const uiPanel = document.getElementById('ui-panel');
  const universeNameEl = document.getElementById('universe-name');
  const btnReset = document.getElementById('btn-reset');
  const btnScreenshot = document.getElementById('btn-screenshot');
  const sliderSpeed = document.getElementById('slider-speed');
  const sliderFriction = document.getElementById('slider-friction');
  const sliderCount = document.getElementById('slider-count');
  const selectPreset = document.getElementById('select-preset');
  const selectSpawn = document.getElementById('select-spawn');
  const selectMouse = document.getElementById('select-mouse');
  const rulesGrid = document.getElementById('rules-grid');
  const panelToggle = document.getElementById('panel-toggle');
  const panelBody = document.getElementById('panel-body');
  const btnShareRules = document.getElementById('btn-share-rules');
  const btnRandomRules = document.getElementById('btn-random-rules');
  const advancedToggle = document.getElementById('advanced-toggle');
  const advancedBody = document.getElementById('advanced-body');

  function setParticleCountDefault() {
    particleCount = window.innerWidth < 640 ? 150 : 300;
    sliderCount.value = particleCount;
  }

  function updateNameDisplay() {
    if (universeNameEl) universeNameEl.textContent = universeName;
  }

  // ── Rules grid ──────────────────────────────────────────────────────────────
  function forceColor(v) {
    const mag = Math.min(1, Math.abs(v));
    const alpha = 0.15 + mag * 0.7;
    if (v >= 0) return 'rgba(57, 255, 20, ' + alpha.toFixed(3) + ')';
    return 'rgba(255, 34, 68, ' + alpha.toFixed(3) + ')';
  }

  function cellSymbol(v) {
    // Small visual cue inside the cell so it's readable at a glance.
    const mag = Math.abs(v);
    if (mag < 0.08) return '·';
    if (v > 0) return '+';
    return '−';
  }

  function describeForce(v, fromColor, toColor) {
    const mag = Math.abs(v);
    if (mag < 0.08) return fromColor + ' ignores ' + toColor;
    let strength;
    if (mag < 0.3) strength = (v >= 0) ? 'mildly attracts' : 'mildly repels';
    else if (mag < 0.6) strength = (v >= 0) ? 'attracts' : 'repels';
    else strength = (v >= 0) ? 'strongly attracts' : 'strongly repels';
    return fromColor + ' ' + strength + ' ' + toColor;
  }

  function markRulesCustom() {
    currentPreset = 'custom';
    if (selectPreset) selectPreset.value = 'custom';
    universeName = 'Custom Ruleset';
    updateNameDisplay();
    writeRulesetToHash();
  }

  function renderRulesGrid() {
    if (!rulesGrid) return;
    rulesGrid.innerHTML = '';

    const corner = document.createElement('div');
    corner.className = 'rules-cell header';
    rulesGrid.appendChild(corner);

    for (let c = 0; c < NUM_TYPES; c++) {
      const sw = document.createElement('div');
      sw.className = 'rules-cell header header-swatch';
      sw.style.background = COLORS[c];
      sw.style.color = COLORS[c];
      sw.title = COLOR_NAMES[c] + ' (target)';
      rulesGrid.appendChild(sw);
    }

    for (let r = 0; r < NUM_TYPES; r++) {
      const sw = document.createElement('div');
      sw.className = 'rules-cell header header-swatch';
      sw.style.background = COLORS[r];
      sw.style.color = COLORS[r];
      sw.title = COLOR_NAMES[r] + ' (actor)';
      rulesGrid.appendChild(sw);

      for (let c = 0; c < NUM_TYPES; c++) {
        (function (row, col) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'rules-cell';
          refreshCell(cell, row, col);

          // Single tap cycles the value — no mode switch, no popover, no friction.
          cell.addEventListener('click', function () {
            forceMatrix[row][col] = nextInCycle(forceMatrix[row][col]);
            refreshCell(cell, row, col);
            markRulesCustom();
          });

          // Right-click / long-press resets a cell to 0.
          cell.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            forceMatrix[row][col] = 0;
            refreshCell(cell, row, col);
            markRulesCustom();
          });

          // Touch long-press → reset to 0 (mobile equivalent of right-click).
          let pressTimer = null;
          cell.addEventListener('touchstart', function () {
            pressTimer = setTimeout(function () {
              forceMatrix[row][col] = 0;
              refreshCell(cell, row, col);
              markRulesCustom();
              pressTimer = 'fired';
            }, 550);
          }, { passive: true });
          cell.addEventListener('touchend', function (e) {
            if (pressTimer === 'fired') {
              // Long-press already handled the reset — suppress the click.
              e.preventDefault();
              pressTimer = null;
              return;
            }
            if (pressTimer) {
              clearTimeout(pressTimer);
              pressTimer = null;
            }
          });
          cell.addEventListener('touchmove', function () {
            if (pressTimer && pressTimer !== 'fired') {
              clearTimeout(pressTimer);
              pressTimer = null;
            }
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
    const label = describeForce(v, COLOR_NAMES[r], COLOR_NAMES[c]);
    cell.title = label + ' (' + v.toFixed(2) + ')';
    cell.setAttribute('aria-label', label);
  }

  // ── Panel toggle ────────────────────────────────────────────────────────────
  panelToggle.addEventListener('click', function () {
    panelBody.classList.toggle('collapsed');
    panelToggle.classList.toggle('collapsed');
  });

  // ── Advanced collapsible ─────────────────────────────────────────────────────
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

  // ── Preset / respawn / randomize ────────────────────────────────────────────
  btnReset.addEventListener('click', function () {
    stopLoop();
    const newSeed = hash('' + Date.now() + Math.random());
    particleCount = parseInt(sliderCount.value, 10);
    // Respawn honours whatever spawn the user currently has selected; don't
    // override it with the preset's default.
    initUniverse(newSeed, particleCount, selectPreset.value, null, false);
    updateNameDisplay();
    renderRulesGrid();
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    startLoop();
  });

  selectPreset.addEventListener('change', function () {
    stopLoop();
    const newSeed = hash('' + Date.now() + Math.random());
    particleCount = parseInt(sliderCount.value, 10);
    // When the user picks a new preset, adopt the preset's showcase spawn shape.
    initUniverse(newSeed, particleCount, this.value, null, true);
    updateNameDisplay();
    renderRulesGrid();
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    startLoop();
  });

  if (selectSpawn) {
    selectSpawn.addEventListener('change', function () {
      spawnShape = this.value;
      // Spawn-shape change = user wants to see the new arrangement now, so
      // respawn particles in place (keep forces, seed and preset choice).
      const rng = makeSeedRNG(hash('' + Date.now() + Math.random()));
      particles = spawnParticles(rng, particleCount, spawnShape);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    });
  }

  if (selectMouse) {
    selectMouse.addEventListener('change', function () {
      mouseMode = this.value;
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
    if (currentPreset === 'random') {
      forceMatrix = buildForceMatrix(rng);
      renderRulesGrid();
    }
    particles = spawnParticles(rng, particleCount, spawnShape);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });

  if (btnRandomRules) {
    btnRandomRules.addEventListener('click', function () {
      const rng = makeSeedRNG(hash('' + Date.now() + Math.random()));
      forceMatrix = buildForceMatrix(rng);
      markRulesCustom();
      renderRulesGrid();
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

  canvas.addEventListener('touchstart', function (e) {
    if (!running) return;
    e.preventDefault();
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

  // ── Boot: show-first. No title gate, no help wall. ──────────────────────────
  setParticleCountDefault();

  setTimeout(function () {
    const shared = readRulesetFromHash();
    if (shared) {
      selectPreset.value = 'custom';
      initUniverse(seed, particleCount, 'custom', shared, false);
    } else {
      // On first boot, adopt the default preset's showcase spawn shape so
      // the opening visual is striking (e.g. crystallizers start as a ball).
      initUniverse(seed, particleCount, selectPreset.value, null, true);
    }
    updateNameDisplay();
    renderRulesGrid();

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    startLoop();

    loadingScreen.style.display = 'none';
  }, 600);

}());
