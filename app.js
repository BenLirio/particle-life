// Particle Life simulation — emergent attraction/repulsion between colour groups
// Terminal/CRT aesthetic, pure Canvas 2D, no external libraries

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
  const MAX_DIST = 120;       // interaction radius (px)
  const MIN_DIST = 20;        // repulsion floor
  const FORCE_SCALE = 0.5;    // magnitude multiplier

  // ── Hand-tuned presets (5x5 force matrices, values in -1..+1) ───────────────
  // Row = "this color", Column = "feels toward that color".
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
  };

  let seed = hash('' + Date.now());
  let universeName = '';
  let particles = [];
  let forceMatrix = [];        // [type_a][type_b] → -1..+1
  let currentPreset = 'random';
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
        m[a][b] = rng() * 2 - 1;   // -1 to +1
      }
    }
    return m;
  }

  // ── Particles ───────────────────────────────────────────────────────────────
  function spawnParticles(rng, count) {
    const list = [];
    const perType = Math.ceil(count / NUM_TYPES);
    for (let t = 0; t < NUM_TYPES; t++) {
      for (let i = 0; i < perType && list.length < count; i++) {
        list.push({
          x: rng() * canvas.width,
          y: rng() * canvas.height,
          vx: 0,
          vy: 0,
          type: t,
        });
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

        // Wrap-around shortest path
        if (dx > W / 2) dx -= W;
        else if (dx < -W / 2) dx += W;
        if (dy > H / 2) dy -= H;
        else if (dy < -H / 2) dy += H;

        const distSq = dx * dx + dy * dy;
        if (distSq === 0 || distSq > maxDistSq) continue;

        const dist = Math.sqrt(distSq);

        // Hard repulsion below MIN_DIST
        if (distSq < minDistSq) {
          const repForce = (MIN_DIST - dist) / MIN_DIST;
          ax -= (dx / dist) * repForce * 2;
          ay -= (dy / dist) * repForce * 2;
          continue;
        }

        // Attraction/repulsion from force matrix
        const coeff = forceMatrix[p.type][q.type];
        // Normalise: strength peaks at midpoint between MIN_DIST and MAX_DIST
        const norm = (dist - MIN_DIST) / (MAX_DIST - MIN_DIST);  // 0..1
        const strength = coeff * FORCE_SCALE * (1 - norm);       // fade at edge
        ax += (dx / dist) * strength;
        ay += (dy / dist) * strength;
      }

      // Touch/mouse repulsion
      if (touchX !== null) {
        let dx = p.x - touchX;
        let dy = p.y - touchY;
        const distSq = dx * dx + dy * dy;
        const repRadius = 80;
        if (distSq < repRadius * repRadius && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const repForce = (repRadius - dist) / repRadius * 3;
          ax += (dx / dist) * repForce;
          ay += (dy / dist) * repForce;
        }
      }

      p.vx = (p.vx + ax * dt * speed) * fr;
      p.vy = (p.vy + ay * dt * speed) * fr;
    }

    // Integrate positions with wraparound
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
    // Fade trail
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
    const dt = Math.min((ts - lastTime) / 1000, 0.05); // cap at 50ms
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

  // Deep-copy a 2D matrix (so presets remain pristine)
  function cloneMatrix(m) {
    const out = [];
    for (let i = 0; i < m.length; i++) out.push(m[i].slice());
    return out;
  }

  // ── Universe init ────────────────────────────────────────────────────────────
  function initUniverse(newSeed, count, presetKey, explicitMatrix) {
    seed = newSeed;
    const rng = makeSeedRNG(seed);
    if (explicitMatrix) {
      forceMatrix = cloneMatrix(explicitMatrix);
      currentPreset = 'custom';
    } else if (presetKey === 'custom') {
      // Keep existing matrix if we have one; otherwise start from a random roll
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
    particles = spawnParticles(rng, count);
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
      'custom': 'Custom',
    };
    return map[key] || key;
  }

  // ── Ruleset encoding (URL share) ─────────────────────────────────────────────
  // Encode 25 values (-1..+1) as 25 hex chars (0..f mapping to -1..+1 in 16 steps).
  function encodeMatrix(m) {
    let out = '';
    for (let r = 0; r < NUM_TYPES; r++) {
      for (let c = 0; c < NUM_TYPES; c++) {
        const v = Math.max(-1, Math.min(1, m[r][c]));
        const q = Math.round((v + 1) * 7.5);        // 0..15
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
        m[r][c] = (q / 7.5) - 1;                    // -1..+1
      }
    }
    return m;
  }

  function readRulesetFromHash() {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const r = params.get('r');
    if (!r) return null;
    return decodeMatrix(r);
  }

  function writeRulesetToHash() {
    const enc = encodeMatrix(forceMatrix);
    const params = new URLSearchParams();
    params.set('r', enc);
    // Use replaceState so we don't spam history
    const url = location.pathname + location.search + '#' + params.toString();
    try { history.replaceState(null, '', url); } catch (e) { location.hash = params.toString(); }
  }

  // ── UI wiring ────────────────────────────────────────────────────────────────
  const loadingScreen = document.getElementById('loading-screen');
  const titleOverlay = document.getElementById('title-overlay');
  const uiPanel = document.getElementById('ui-panel');
  const universeNameEl = document.getElementById('universe-name');
  const panelUniverseNameEl = document.getElementById('panel-universe-name');
  const shareUniverseNameEl = document.getElementById('share-universe-name');
  const startBtn = document.getElementById('start-btn');
  const btnReset = document.getElementById('btn-reset');
  const btnScreenshot = document.getElementById('btn-screenshot');
  const sliderSpeed = document.getElementById('slider-speed');
  const sliderFriction = document.getElementById('slider-friction');
  const sliderCount = document.getElementById('slider-count');
  const selectPreset = document.getElementById('select-preset');
  const rulesGrid = document.getElementById('rules-grid');
  const rulesReadout = document.getElementById('rules-readout');
  const panelToggle = document.getElementById('panel-toggle');
  const panelBody = document.getElementById('panel-body');
  const toggleEdit = document.getElementById('toggle-edit');
  const editLegend = document.getElementById('edit-legend');
  const btnShareRules = document.getElementById('btn-share-rules');
  const btnRandomRules = document.getElementById('btn-random-rules');
  const helpOverlay = document.getElementById('help-overlay');
  const helpCloseBtn = document.getElementById('help-close-btn');
  const titleHelpBtn = document.getElementById('title-help-btn');
  const panelHelpBtn = document.getElementById('panel-help-btn');
  const cellEditor = document.getElementById('cell-editor');
  const cellEditorTitle = document.getElementById('cell-editor-title');
  const cellEditorSlider = document.getElementById('cell-editor-slider');
  const cellEditorValue = document.getElementById('cell-editor-value');
  const cellEditorButtons = document.getElementById('cell-editor-buttons');
  const cellEditorClose = document.getElementById('cell-editor-close');

  // Track which cell the editor is operating on + a reference to its DOM node so we
  // can live-refresh the colour as the slider moves.
  let editorTarget = null;   // { row, col, cell }

  function openCellEditor(row, col, cell) {
    editorTarget = { row: row, col: col, cell: cell };
    const v = forceMatrix[row][col];
    cellEditorTitle.textContent =
      COLOR_NAMES[row] + ' → ' + COLOR_NAMES[col] + ' (row acts on column)';
    cellEditorSlider.value = v.toFixed(2);
    cellEditorValue.textContent = v.toFixed(2);
    cellEditor.classList.add('visible');
  }

  function closeCellEditor() {
    editorTarget = null;
    cellEditor.classList.remove('visible');
  }

  function applyEditorValue(v) {
    if (!editorTarget) return;
    v = Math.max(-1, Math.min(1, v));
    const { row, col, cell } = editorTarget;
    forceMatrix[row][col] = v;
    cellEditorValue.textContent = v.toFixed(2);
    refreshCell(cell, row, col);
    markRulesCustom();
    showRuleReadout(row, col);
  }

  if (cellEditorSlider) {
    cellEditorSlider.addEventListener('input', function () {
      applyEditorValue(parseFloat(this.value));
    });
  }

  if (cellEditorButtons) {
    cellEditorButtons.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-value]');
      if (!btn) return;
      const v = parseFloat(btn.getAttribute('data-value'));
      cellEditorSlider.value = v.toFixed(2);
      applyEditorValue(v);
    });
  }

  if (cellEditorClose) {
    cellEditorClose.addEventListener('click', closeCellEditor);
  }

  // Click outside the editor to close
  document.addEventListener('click', function (e) {
    if (!cellEditor.classList.contains('visible')) return;
    if (cellEditor.contains(e.target)) return;
    if (e.target.classList && e.target.classList.contains('rules-cell')) return;
    closeCellEditor();
  }, true);

  // Help overlay wiring
  function openHelp() {
    if (helpOverlay) helpOverlay.classList.add('visible');
  }
  function closeHelp() {
    if (helpOverlay) helpOverlay.classList.remove('visible');
  }
  if (helpCloseBtn) helpCloseBtn.addEventListener('click', closeHelp);
  if (titleHelpBtn) titleHelpBtn.addEventListener('click', openHelp);
  if (panelHelpBtn) panelHelpBtn.addEventListener('click', openHelp);
  if (helpOverlay) {
    helpOverlay.addEventListener('click', function (e) {
      if (e.target === helpOverlay) closeHelp();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (cellEditor.classList.contains('visible')) closeCellEditor();
      else if (helpOverlay && helpOverlay.classList.contains('visible')) closeHelp();
    }
  });

  function setParticleCountDefault() {
    particleCount = window.innerWidth < 640 ? 150 : 300;
    sliderCount.value = particleCount;
  }

  function updateNameDisplay() {
    universeNameEl.textContent = universeName;
    panelUniverseNameEl.textContent = universeName;
    shareUniverseNameEl.textContent = universeName;
  }

  function showTitle() {
    titleOverlay.classList.add('visible');
    stopLoop();
  }

  function hideTitle() {
    titleOverlay.classList.remove('visible');
    uiPanel.classList.add('visible');
    startLoop();
  }

  startBtn.addEventListener('click', hideTitle);

  btnReset.addEventListener('click', function () {
    stopLoop();
    const newSeed = hash('' + Date.now() + Math.random());
    particleCount = parseInt(sliderCount.value, 10);
    initUniverse(newSeed, particleCount, selectPreset.value);
    updateNameDisplay();
    renderRulesGrid();
    // Redraw background clean
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    startLoop();
  });

  selectPreset.addEventListener('change', function () {
    stopLoop();
    const newSeed = hash('' + Date.now() + Math.random());
    particleCount = parseInt(sliderCount.value, 10);
    initUniverse(newSeed, particleCount, this.value);
    updateNameDisplay();
    renderRulesGrid();
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    startLoop();
  });

  sliderSpeed.addEventListener('input', function () {
    speedMultiplier = parseFloat(this.value);
  });

  sliderFriction.addEventListener('input', function () {
    friction = parseFloat(this.value);
  });

  sliderCount.addEventListener('change', function () {
    particleCount = parseInt(this.value, 10);
    const rng = makeSeedRNG(seed);
    // Re-roll the matrix only if we're on the random preset; otherwise keep
    // the chosen preset's rules so changing count doesn't silently change behaviour.
    if (currentPreset === 'random') {
      forceMatrix = buildForceMatrix(rng);
      renderRulesGrid();
    }
    particles = spawnParticles(rng, particleCount);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });

  // ── Rules grid (visualises the force matrix) ─────────────────────────────────
  function forceColor(v) {
    // v in -1..+1.  Negative = red (repel), positive = green (attract), 0 = dark.
    const mag = Math.min(1, Math.abs(v));
    const alpha = 0.15 + mag * 0.7;
    if (v >= 0) return 'rgba(57, 255, 20, ' + alpha.toFixed(3) + ')';   // neon-green
    return 'rgba(255, 34, 68, ' + alpha.toFixed(3) + ')';               // neon-red
  }

  function describeForce(v, fromColor, toColor) {
    const mag = Math.abs(v);
    let strength;
    if (mag < 0.08) strength = 'ignores';
    else if (mag < 0.3) strength = (v >= 0) ? 'mildly attracts' : 'mildly repels';
    else if (mag < 0.6) strength = (v >= 0) ? 'attracts' : 'repels';
    else strength = (v >= 0) ? 'strongly attracts' : 'strongly repels';
    if (mag < 0.08) return fromColor + ' ignores ' + toColor;
    return fromColor + ' ' + strength + ' ' + toColor;
  }

  // Cycle through discrete force values when editing a rule cell.
  // Steps chosen so users can reach full repel / neutral / full attract in a few taps.
  const EDIT_STEPS = [-1.0, -0.7, -0.4, -0.15, 0.0, 0.15, 0.4, 0.7, 1.0];

  function nearestStepIndex(v) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < EDIT_STEPS.length; i++) {
      const d = Math.abs(EDIT_STEPS[i] - v);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  function cycleForce(v, dir) {
    const i = nearestStepIndex(v);
    const next = (i + dir + EDIT_STEPS.length) % EDIT_STEPS.length;
    return EDIT_STEPS[next];
  }

  function markRulesCustom() {
    // Once the user edits a rule, we're on a custom ruleset.
    currentPreset = 'custom';
    if (selectPreset) selectPreset.value = 'custom';
    universeName = 'Custom Ruleset';
    updateNameDisplay();
    writeRulesetToHash();
  }

  function renderRulesGrid() {
    if (!rulesGrid) return;
    rulesGrid.innerHTML = '';

    // Top-left empty corner
    const corner = document.createElement('div');
    corner.className = 'rules-cell header';
    rulesGrid.appendChild(corner);

    // Column headers (target color swatches)
    for (let c = 0; c < NUM_TYPES; c++) {
      const sw = document.createElement('div');
      sw.className = 'rules-cell header header-swatch';
      sw.style.background = COLORS[c];
      sw.style.color = COLORS[c];
      sw.title = COLOR_NAMES[c] + ' (target)';
      rulesGrid.appendChild(sw);
    }

    // Rows
    for (let r = 0; r < NUM_TYPES; r++) {
      // Row header swatch
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

          cell.addEventListener('click', function (e) {
            if (uiPanel && uiPanel.classList.contains('editing')) {
              // Edit mode: open the popover editor (slider + quick-set buttons).
              // This avoids the repetitive-clicking pain of the old cycle-through interaction.
              e.stopPropagation();
              openCellEditor(row, col, cell);
              showRuleReadout(row, col);
            } else {
              showRuleReadout(row, col);
            }
          });
          cell.addEventListener('mouseenter', function () {
            showRuleReadout(row, col);
          });
          rulesGrid.appendChild(cell);
        })(r, c);
      }
    }
  }

  function refreshCell(cell, r, c) {
    const v = forceMatrix[r][c];
    cell.style.background = forceColor(v);
    const label = describeForce(v, COLOR_NAMES[r], COLOR_NAMES[c]);
    cell.title = label + ' (' + v.toFixed(2) + ')';
    cell.setAttribute('aria-label', label);
  }

  function showRuleReadout(r, c) {
    if (!rulesReadout) return;
    const v = forceMatrix[r][c];
    const label = describeForce(v, COLOR_NAMES[r], COLOR_NAMES[c]);
    rulesReadout.textContent = label + ' (' + v.toFixed(2) + ')';
  }

  panelToggle.addEventListener('click', function () {
    panelBody.classList.toggle('collapsed');
    panelToggle.classList.toggle('collapsed');
  });

  if (toggleEdit) {
    toggleEdit.addEventListener('change', function () {
      if (this.checked) {
        uiPanel.classList.add('editing');
        if (editLegend) editLegend.textContent = 'on — click cells';
      } else {
        uiPanel.classList.remove('editing');
        if (editLegend) editLegend.textContent = 'off';
      }
    });
  }

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
      const legend = editLegend || { textContent: '' };
      const prev = legend.textContent;
      function done(msg) {
        if (rulesReadout) {
          const was = rulesReadout.textContent;
          rulesReadout.textContent = msg;
          setTimeout(function () { rulesReadout.textContent = was; }, 1800);
        }
      }
      // Prefer native share, then clipboard, then show URL in readout.
      if (navigator.share) {
        navigator.share({
          title: 'Particle Life — ' + universeName,
          text: 'My ruleset for Particle Life: ' + universeName,
          url: url,
        }).then(function () { done('ruleset link shared'); })
          .catch(function () {
            tryClipboard();
          });
      } else {
        tryClipboard();
      }
      function tryClipboard() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            done('ruleset link copied');
          }).catch(function () {
            done(url);
          });
        } else {
          done(url);
        }
      }
    });
  }

  // ── Screenshot / share ───────────────────────────────────────────────────────
  function share() {
    // Capture current frame
    const dataURL = canvas.toDataURL('image/png');
    const filename = universeName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-]/g, '') + '.png';

    if (navigator.share && navigator.canShare) {
      // Try Web Share API with file (modern mobile)
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
          // Fallback: share URL only
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
  // Expose for inline use if needed
  window.share = share;

  // ── Touch / mouse interaction ────────────────────────────────────────────────
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

  // ── Boot sequence ────────────────────────────────────────────────────────────
  setParticleCountDefault();

  // Show loading for 800ms then show title
  setTimeout(function () {
    // If the URL carries a shared ruleset, load it up first.
    const shared = readRulesetFromHash();
    if (shared) {
      selectPreset.value = 'custom';
      initUniverse(seed, particleCount, 'custom', shared);
    } else {
      initUniverse(seed, particleCount, selectPreset.value);
    }
    updateNameDisplay();
    renderRulesGrid();

    // Start rendering silently behind the title overlay
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    startLoop();

    loadingScreen.style.display = 'none';
    showTitle();
  }, 800);

}());
