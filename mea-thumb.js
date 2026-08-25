// Project thumbnails as microelectrode arrays.
//
// Each thumbnail is drawn onto a canvas as a grid of electrode sites rather
// than as a picture. At rest the image is only a sparse field of dots — a
// recording with nothing driving it. The pointer is the stimulus: channels
// near it swell to fill their cell, the picture resolves under the cursor,
// and the array keeps a little spontaneous activity of its own.
//
// The cursor is smoothed with gsap.quickTo (expo) and the stimulation level
// with a slower power2 ramp, so the reveal spreads rather than snaps.

const gsap = window.gsap;

const T = Math.PI * 2;
const MAX_RES = 1600;        // too small = poor image quality, too big = slow
const COLS = 24;             // electrode columns across the thumbnail
const DOT = 0.34;            // resting site size, as a fraction of one cell

const PINK = '214, 124, 155';

// --- sources ---------------------------------------------------------------

// Resolves to something drawImage() accepts. A missing file is expected
// rather than fatal: the gallery falls back to a generated card. Results are
// cached because the same thumbnail feeds both the curve scene and its card.
const cache = new Map();

export function loadThumb(src, title) {
  const key = src || 'placeholder:' + title;
  if (cache.has(key)) return cache.get(key);

  const pending = new Promise((resolve) => {
    if (!src) { resolve(placeholder(title)); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(placeholder(title));
    img.src = src;
  });
  cache.set(key, pending);
  return pending;
}

// Stand-in thumbnail: a pink lattice with the project title set into it.
export function placeholder(title = '') {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');

  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#f7dee7');
  grad.addColorStop(0.55, '#e3a1ba');
  grad.addColorStop(1, '#bf6a88');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  g.strokeStyle = 'rgba(255, 255, 255, 0.32)';
  g.lineWidth = 2;
  const step = size / 16;
  for (let i = 1; i < 16; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke();
  }
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  for (let i = 1; i < 16; i++) {
    for (let j = 1; j < 16; j++) {
      g.beginPath(); g.arc(i * step, j * step, 4, 0, T); g.fill();
    }
  }

  g.fillStyle = 'rgba(255, 255, 255, 0.95)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '56px Georgia, "Times New Roman", serif';
  wrapText(g, title, size / 2, size / 2, size * 0.78, 72);

  return c;
}

function wrapText(g, text, cx, cy, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (g.measureText(next).width > maxWidth && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  const top = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => g.fillText(l, cx, top + i * lineHeight));
}

// --- the array -------------------------------------------------------------

export function createStimThumb(canvas, source, opts = {}) {
  const ctx = canvas.getContext('2d');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let cw = 0, ch = 0, cell = 0, rows = 0, cols = COLS;
  let boxes = [];
  let fit = { scale: 1, ox: 0, oy: 0 };

  // m mirrors the effect's cursor state: x/y is the eased stimulus site,
  // x2/y2 the sharper one that lights the core, s the stimulation level.
  const m = { x: 0, y: 0, s: 0, x2: 0, y2: 0 };
  const xTo = gsap.quickTo(m, 'x', { duration: 1, ease: 'expo' });
  const yTo = gsap.quickTo(m, 'y', { duration: 1, ease: 'expo' });
  const x2To = gsap.quickTo(m, 'x2', { duration: 0.35, ease: 'expo' });
  const y2To = gsap.quickTo(m, 'y2', { duration: 0.35, ease: 'expo' });
  const sTo = gsap.quickTo(m, 's', { duration: 1.2, ease: 'power2' });

  let hovering = false;
  let measured = false;
  let raf = 0;
  let t0 = performance.now();

  function measure() {
    const rect = canvas.getBoundingClientRect();
    // a hidden or not-yet-laid-out card reports a degenerate box; keep the
    // grid we already have rather than rebuilding it at 2px across
    if (rect.width < 8 || rect.height < 8) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = Math.min(MAX_RES, Math.round(rect.width * dpr));
    ch = Math.min(MAX_RES, Math.round(rect.height * dpr));
    canvas.width = cw;
    canvas.height = ch;

    cell = cw / cols;
    rows = Math.ceil(ch / cell);

    boxes = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * cell, y = j * cell;
        boxes.push({ x, y, cx: x + cell / 2, cy: y + cell / 2, seed: (i * 7 + j * 13) % 29 });
      }
    }

    // cover-fit the source into the canvas
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const scale = Math.max(cw / sw, ch / sh);
    fit = { scale, ox: (cw - sw * scale) / 2, oy: (ch - sh * scale) / 2 };

    if (!measured) {
      measured = true;
      m.x = m.x2 = cw / 2;
      m.y = m.y2 = ch * 0.98;
    }
    return true;
  }

  function draw(now) {
    if (!cw) return;
    const time = (now - t0) / 1000;
    ctx.clearRect(0, 0, cw, ch);

    // the stimulus spreads outward, in electrodes, as the level rises
    const reach = cell * (4 + 10 * m.s);
    const core = cell * 2.4;
    const shimmer = reducedMotion ? 0 : m.s * 0.16;

    for (let n = 0; n < boxes.length; n++) {
      const b = boxes[n];
      const d = Math.hypot(b.cx - m.x, b.cy - m.y) / reach;
      const k = d < 1 ? 1 - d : 0;
      let f = k * k * (3 - 2 * k) * (0.35 + 0.65 * m.s);

      // the sharper follower keeps the sites right under the cursor fully open
      if (Math.hypot(b.cx - m.x2, b.cy - m.y2) < core) f = Math.max(f, m.s);

      // spontaneous activity: a few sites fire on their own
      if (shimmer) {
        const s = Math.sin(time * 2.1 + b.seed * 1.7);
        f += shimmer * Math.pow(Math.max(0, s), 10);
      }

      f = Math.max(DOT, Math.min(1, f));
      const w = cell * f;
      const off = (cell - w) / 2;

      ctx.drawImage(
        source,
        (b.x - fit.ox) / fit.scale, (b.y - fit.oy) / fit.scale,
        cell / fit.scale, cell / fit.scale,
        b.x + off, b.y + off, w, w
      );
    }

    // Unstimulated sites read as a pink wash, the live ones keep their colour.
    // source-atop keeps the tint on the electrodes and out of the gaps.
    ctx.globalCompositeOperation = 'source-atop';
    if (m.s > 0.01) {
      const wash = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, reach * 1.15);
      wash.addColorStop(0, `rgba(${PINK}, 0)`);
      wash.addColorStop(1, `rgba(${PINK}, ${0.4 - 0.06 * m.s})`);
      ctx.fillStyle = wash;
    } else {
      ctx.fillStyle = `rgba(${PINK}, 0.34)`;
    }
    ctx.fillRect(0, 0, cw, ch);

    // and the stimulation itself glows, like the array in the hero
    if (m.s > 0.001) {
      const glow = ctx.createRadialGradient(m.x2, m.y2, 0, m.x2, m.y2, cell * 5);
      glow.addColorStop(0, `rgba(255, 170, 205, ${0.1 * m.s})`);
      glow.addColorStop(1, 'rgba(255, 170, 205, 0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function tick(now) {
    draw(now);
    if (hovering || m.s > 0.004) raf = requestAnimationFrame(tick);
    else { raf = 0; draw(now); }        // one settled frame
  }

  function start() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function stimulateAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (cw / rect.width);
    const py = (clientY - rect.top) * (ch / rect.height);
    xTo(px); yTo(py); x2To(px); y2To(py);
  }

  // --- input -------------------------------------------------------------
  canvas.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch') return;
    hovering = true;
    // jump the follower to the entry point so the reveal starts under the cursor
    const rect = canvas.getBoundingClientRect();
    m.x2 = (e.clientX - rect.left) * (cw / rect.width);
    m.y2 = (e.clientY - rect.top) * (ch / rect.height);
    stimulateAt(e.clientX, e.clientY);
    sTo(1);
    start();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !hovering) return;
    stimulateAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerleave', () => {
    hovering = false;
    sTo(0);
  });

  if (!finePointer) {
    // No cursor to follow: sweep the array once as the card comes into view.
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        m.x = m.x2 = cw / 2;
        m.y = m.y2 = ch / 2;
        sTo(1);
        start();
        setTimeout(() => sTo(0), 1600);
        io.unobserve(entry.target);
      }
    }, { threshold: 0.55 });
    io.observe(canvas);
  }

  const onResize = () => { if (measure()) draw(performance.now()); };
  window.addEventListener('resize', onResize);

  // The card is laid out by the grid, so watch the element itself: it settles
  // after fonts and images land, not only when the window changes.
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(onResize);
    ro.observe(canvas);
  }

  if (measure()) draw(performance.now());

  return {
    redraw: onResize,
    destroy() {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
