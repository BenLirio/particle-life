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
  function initUniverse(newSeed, count, presetKey) {
    seed = newSeed;
    const rng = makeSeedRNG(seed);
    if (presetKey && presetKey !== 'random' && PRESETS[presetKey]) {
      forceMatrix = cloneMatrix(PRESETS[presetKey]);
      currentPreset = presetKey;
    } else {
      forceMatrix = buildForceMatrix(rng);
      currentPreset = 'random';
    }
    particles = spawnParticles(rng, count);
    universeName = (currentPreset === 'random')
      ? universeNameFromSeed(seed)
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
    };
    return map[key] || key;
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
        const v = forceMatrix[r][c];
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'rules-cell';
        cell.style.background = forceColor(v);
        const label = describeForce(v, COLOR_NAMES[r], COLOR_NAMES[c]);
        cell.title = label + ' (' + v.toFixed(2) + ')';
        cell.setAttribute('aria-label', label);
        cell.addEventListener('click', function () {
          if (rulesReadout) rulesReadout.textContent = label + ' (' + v.toFixed(2) + ')';
        });
        cell.addEventListener('mouseenter', function () {
          if (rulesReadout) rulesReadout.textContent = label + ' (' + v.toFixed(2) + ')';
        });
        rulesGrid.appendChild(cell);
      }
    }
  }

  panelToggle.addEventListener('click', function () {
    panelBody.classList.toggle('collapsed');
    panelToggle.classList.toggle('collapsed');
  });

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
    initUniverse(seed, particleCount, selectPreset.value);
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
