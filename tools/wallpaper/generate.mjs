// Generates the desktop wallpapers in assets/wallpapers/.
// Run with:  node tools/wallpaper/generate.mjs
// Everything is vector, so the wallpapers stay sharp at any resolution.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEAD, HORN_FRONT, HORN_BACK } from './dragon-parts.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../assets/wallpapers');
mkdirSync(OUT, { recursive: true });

const W = 1920;
const H = 1080;

/* ---------------------------------------------------------------- helpers */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => (Math.round(n * 10) / 10).toString();
const pt = (p) => `${f(p.x)},${f(p.y)}`;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function catmullRom(points, seg = 32) {
  const P = [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 0; i < P.length - 3; i++) {
    const [p0, p1, p2, p3] = [P[i], P[i + 1], P[i + 2], P[i + 3]];
    for (let j = 0; j < seg; j++) {
      const t = j / seg, t2 = t * t, t3 = t2 * t;
      const c = (k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push({ x: c('x'), y: c('y') });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function resample(points, n) {
  const d = [0];
  for (let i = 1; i < points.length; i++) d.push(d[i - 1] + len(sub(points[i], points[i - 1])));
  const L = d[d.length - 1];
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = (L * i) / (n - 1);
    while (k < d.length - 2 && d[k + 1] < s) k++;
    const t = (s - d[k]) / (d[k + 1] - d[k] || 1);
    out.push(lerp(points[k], points[k + 1], t));
  }
  return { pts: out, length: L };
}

function frames(pts) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const t = norm(sub(b, a));
    return { p, t, n: { x: -t.y, y: t.x } };
  });
}

const poly = (list) => 'M' + list.map(pt).join('L');

/* -------------------------------------------------------------- the dragon */

function dragon({ spine, widthAt, headScale = 1, flip = false }) {
  const N = 700;
  const { pts, length } = resample(catmullRom(spine, 40), N);
  const F = frames(pts).map((fr) => (flip ? { ...fr, n: mul(fr.n, -1) } : fr));
  const s = (i) => i / (N - 1);
  const wAt = (i) => widthAt(s(i));

  const dorsal = F.map((fr, i) => add(fr.p, mul(fr.n, wAt(i) / 2)));
  const ventral = F.map((fr, i) => add(fr.p, mul(fr.n, -wAt(i) / 2)));

  const bodyPath = poly(dorsal) + 'L' + [...ventral].reverse().map(pt).join('L') + 'Z';
  const dorsalEdge = poly(dorsal);
  const ventralEdge = poly(ventral);

  const step = length / (N - 1);
  const every = (px) => Math.max(1, Math.round(px / step));

  // Dorsal spines, swept back toward the tail.
  const spikes = [];
  let alt = 0;
  for (let i = every(70); i < N * 0.93; i += every(30)) {
    const si = s(i);
    if (si < 0.07) continue;
    const { p, t, n } = F[i];
    const w = wAt(i);
    const fade = smooth(clamp((si - 0.07) / 0.12, 0, 1)) * (1 - smooth(clamp((si - 0.84) / 0.09, 0, 1)));
    const h = (8 + w * 0.62) * fade * (alt++ % 2 ? 0.66 : 1);
    if (h < 3) continue;
    const bw = 8 + w * 0.34;
    const base = add(p, mul(n, w / 2 - 3));
    const b1 = add(base, mul(t, bw / 2));
    const b2 = add(base, mul(t, -bw / 2));
    const tip = add(add(p, mul(n, w / 2 + h)), mul(t, -h * 0.85));
    const c1 = add(lerp(b1, tip, 0.5), mul(t, -h * 0.08));
    const c2 = add(lerp(b2, tip, 0.55), mul(n, -h * 0.12));
    spikes.push(`M${pt(b1)}Q${pt(c1)} ${pt(tip)}Q${pt(c2)} ${pt(b2)}Z`);
  }

  // Scale chevrons across the back and plates along the belly.
  const chevrons = [];
  for (let i = every(26); i < N - every(10); i += every(15)) {
    const { p, t, n } = F[i];
    const w = wAt(i);
    if (w < 9) continue;
    const a = add(add(p, mul(n, w * 0.5)), mul(t, -w * 0.18));
    const m = add(add(p, mul(n, w * 0.02)), mul(t, w * 0.06));
    const b = add(add(p, mul(n, -w * 0.18)), mul(t, -w * 0.12));
    chevrons.push(`M${pt(a)}Q${pt(add(lerp(a, m, 0.5), mul(t, w * 0.08)))} ${pt(m)}L${pt(b)}`);
  }
  const plates = [];
  for (let i = every(30); i < N - every(10); i += every(11)) {
    const { p, n } = F[i];
    const w = wAt(i);
    if (w < 12) continue;
    plates.push(`M${pt(add(p, mul(n, -w * 0.5)))}L${pt(add(p, mul(n, -w * 0.2)))}`);
  }
  const bellyLine = poly(F.map((fr, i) => add(fr.p, mul(fr.n, -wAt(i) * 0.2))).slice(every(30), N - every(6)));
  const spineLine = poly(F.map((fr, i) => add(fr.p, mul(fr.n, wAt(i) * 0.22))).slice(every(40), N - every(4)));

  // Head transform: local +x along the final tangent, local -y toward the dorsal side.
  const end = F[N - 1];
  const k = headScale;
  const m = [end.t.x * k, end.t.y * k, -end.n.x * k, -end.n.y * k, end.p.x, end.p.y].map(f).join(' ');

  return { bodyPath, dorsalEdge, ventralEdge, spikes, chevrons, plates, bellyLine, spineLine, headMatrix: m, end };
}

function dragonSVG(d, id, opts = {}) {
  const { glow = 0.55 } = opts;
  return `
  <g id="${id}">
    <g filter="url(#${id}-glow)" opacity="${glow}" fill="#2777FF">
      <path d="${d.bodyPath}"/>
      ${d.spikes.map((p) => `<path d="${p}"/>`).join('')}
      <g transform="matrix(${d.headMatrix})"><path d="${HEAD.fill}"/><path d="${HORN_FRONT}"/><path d="${HORN_BACK}"/></g>
    </g>
    <g transform="matrix(${d.headMatrix})">
      <path d="${HORN_BACK}" fill="#0a1631" stroke="url(#${id}-hedge)" stroke-width="1.6" stroke-linejoin="round"/>
    </g>
    <g fill="url(#${id}-spike)" stroke="url(#${id}-edge)" stroke-width="1.5" stroke-linejoin="round">
      ${d.spikes.map((p) => `<path d="${p}"/>`).join('')}
      <path transform="matrix(${d.headMatrix})" d="${HEAD.frills}"/>
    </g>
    <path d="${d.bodyPath}" fill="url(#${id}-body)"/>
    <g clip-path="url(#${id}-clip)" fill="none" stroke-linecap="round">
      <path d="${d.chevrons.join('')}" stroke="#4d9bff" stroke-opacity="0.22" stroke-width="1.1"/>
      <path d="${d.plates.join('')}" stroke="#00A8FF" stroke-opacity="0.2" stroke-width="1"/>
      <path d="${d.bellyLine}" stroke="#00A8FF" stroke-opacity="0.32" stroke-width="1.1"/>
      <path d="${d.spineLine}" stroke="#7cc4ff" stroke-opacity="0.35" stroke-width="1.2"/>
    </g>
    <path d="${d.dorsalEdge}" fill="none" stroke="url(#${id}-edge)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="${d.ventralEdge}" fill="none" stroke="url(#${id}-edge)" stroke-width="1.6" stroke-linecap="round" stroke-opacity="0.85"/>
    <g transform="matrix(${d.headMatrix})">
      <path d="${HEAD.fill}" fill="url(#${id}-head)"/>
      <path d="${HEAD.detail}" fill="none" stroke="#4d9bff" stroke-opacity="0.35" stroke-width="1.1" stroke-linecap="round"/>
      <path d="${HEAD.teeth}" fill="#cfe6ff" fill-opacity="0.85"/>
      <path d="${HEAD.outline}" fill="none" stroke="url(#${id}-hedge)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${HORN_FRONT}" fill="url(#${id}-horn)" stroke="url(#${id}-hedge)" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="${HEAD.whiskers}" fill="none" stroke="#5fb8ff" stroke-opacity="0.55" stroke-width="1.4" stroke-linecap="round"/>
      <g filter="url(#${id}-eyeglow)"><path d="${HEAD.eye}" fill="#7fd6ff"/></g>
      <path d="${HEAD.eye}" fill="#d9f4ff"/>
      <path d="${HEAD.pupil}" fill="#06122a"/>
      <path d="${HEAD.nostril}" fill="#06122a" stroke="#2f7cff" stroke-width="0.8"/>
    </g>
  </g>`;
}

function dragonDefs(id, d, light) {
  return `
    <filter id="${id}-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="${id}-eyeglow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="4"/></filter>
    <clipPath id="${id}-clip"><path d="${d.bodyPath}"/></clipPath>
    <radialGradient id="${id}-body" gradientUnits="userSpaceOnUse" cx="${light.x}" cy="${light.y}" r="${light.r}">
      <stop offset="0" stop-color="#1f56b8"/>
      <stop offset="0.38" stop-color="#123168"/>
      <stop offset="0.75" stop-color="#0b1a3a"/>
      <stop offset="1" stop-color="#081227"/>
    </radialGradient>
    <radialGradient id="${id}-head" cx="0.18" cy="0.05" r="1.05">
      <stop offset="0" stop-color="#2a63c9"/>
      <stop offset="0.45" stop-color="#163b80"/>
      <stop offset="1" stop-color="#0a1836"/>
    </radialGradient>
    <linearGradient id="${id}-hedge" x1="0" y1="0" x2="1" y2="0.6">
      <stop offset="0" stop-color="#8fd8ff"/>
      <stop offset="0.45" stop-color="#00A8FF"/>
      <stop offset="1" stop-color="#2f80ff"/>
    </linearGradient>
    <linearGradient id="${id}-spike" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16397a"/>
      <stop offset="1" stop-color="#0a1631"/>
    </linearGradient>
    <linearGradient id="${id}-horn" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b6ad6"/>
      <stop offset="1" stop-color="#0c1d42"/>
    </linearGradient>
    <linearGradient id="${id}-edge" gradientUnits="userSpaceOnUse" x1="${light.x + 300}" y1="${light.y - 200}" x2="${light.x - 700}" y2="${light.y + 700}">
      <stop offset="0" stop-color="#8fd8ff"/>
      <stop offset="0.3" stop-color="#00A8FF"/>
      <stop offset="0.7" stop-color="#2777FF"/>
      <stop offset="1" stop-color="#1a4fc0"/>
    </linearGradient>`;
}

function dust(seed, count, box, maxR = 1.6) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = box.x + r() * box.w;
    const y = box.y + r() * box.h;
    const rad = 0.4 + r() * maxR;
    const o = 0.08 + r() * 0.35;
    out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="#9fd4ff" fill-opacity="${o.toFixed(2)}"/>`;
  }
  return out;
}

function svg(defs, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
  <defs>${defs}
  </defs>${body}
</svg>
`;
}

/* --------------------------------------------------------- wallpaper: dragon */

function wallpaperDragon() {
  const spine = [
    { x: 948, y: 742 }, { x: 914, y: 712 }, { x: 921, y: 672 }, { x: 962, y: 660 },
    { x: 1000, y: 690 }, { x: 1030, y: 760 }, { x: 1110, y: 842 }, { x: 1250, y: 878 },
    { x: 1400, y: 840 }, { x: 1510, y: 748 }, { x: 1562, y: 612 }, { x: 1540, y: 470 },
    { x: 1466, y: 362 }, { x: 1356, y: 296 }, { x: 1238, y: 282 }, { x: 1138, y: 314 },
  ];
  const widthAt = (s) => {
    if (s < 0.66) return 2.5 + 67 * Math.pow(Math.sin((s / 0.66) * Math.PI / 2), 1.35);
    if (s < 0.9) return 69.5 - 22 * smooth((s - 0.66) / 0.24);
    return 47.5 + 6.3 * smooth((s - 0.9) / 0.1);
  };
  const d = dragon({ spine, widthAt, headScale: 1.28 });
  const light = { x: 1430, y: 300, r: 900 };
  const C = { x: 1236, y: 588 };

  const defs = `
    <radialGradient id="bg" gradientUnits="userSpaceOnUse" cx="${C.x}" cy="${C.y - 40}" r="1250">
      <stop offset="0" stop-color="#16305f"/>
      <stop offset="0.32" stop-color="#0f1f40"/>
      <stop offset="0.68" stop-color="#0B1020"/>
      <stop offset="1" stop-color="#060912"/>
    </radialGradient>
    <radialGradient id="halo" gradientUnits="userSpaceOnUse" cx="${C.x}" cy="${C.y}" r="460">
      <stop offset="0" stop-color="#2777FF" stop-opacity="0.22"/>
      <stop offset="0.55" stop-color="#2777FF" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#2777FF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="0.55" cy="0.5" r="0.75">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5aa9ff" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#5aa9ff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="ring" gradientUnits="userSpaceOnUse" x1="${C.x + 350}" y1="${C.y - 350}" x2="${C.x - 350}" y2="${C.y + 350}">
      <stop offset="0" stop-color="#00A8FF" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#2777FF" stop-opacity="0.04"/>
    </linearGradient>
    ${dragonDefs('dr', d, light)}`;

  const rings = `
    <circle cx="${C.x}" cy="${C.y}" r="460" fill="url(#halo)"/>
    <circle cx="${C.x}" cy="${C.y}" r="236" fill="none" stroke="url(#ring)" stroke-width="1.2"/>
    <circle cx="${C.x}" cy="${C.y}" r="252" fill="none" stroke="url(#ring)" stroke-width="0.8" stroke-dasharray="2 9" stroke-opacity="0.8"/>
    <circle cx="${C.x}" cy="${C.y}" r="420" fill="none" stroke="url(#ring)" stroke-width="0.8" stroke-opacity="0.45"/>
    <circle cx="${C.x}" cy="${C.y}" r="560" fill="none" stroke="#2777FF" stroke-opacity="0.05" stroke-width="1"/>`;

  const beams = `
    <path d="M1920,0 L1180,0 L1560,1080 L1920,1080Z" fill="url(#beam)"/>
    <path d="M1920,0 L1620,0 L1920,620Z" fill="url(#beam)"/>`;

  const body = `
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${beams}
  ${rings}
  <g>${dust(7, 170, { x: 0, y: 0, w: W, h: H }, 1.3)}</g>
  ${dragonSVG(d, 'dr')}
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>`;
  return svg(defs, body);
}

/* ----------------------------------------------------------- wallpaper: flow */

function wallpaperFlow() {
  const r = rng(42);
  let lines = '';
  for (let i = 0; i < 46; i++) {
    const y0 = 380 + i * 9 + r() * 6;
    const amp = 60 + r() * 90;
    const ph = r() * Math.PI * 2;
    const freq = 0.0021 + r() * 0.0012;
    const pts = [];
    for (let x = -40; x <= W + 40; x += 24) {
      const y = y0 + Math.sin(x * freq + ph) * amp * (0.4 + x / W) + Math.sin(x * 0.006 + i * 0.3) * 14 - x * 0.18;
      pts.push({ x, y });
    }
    const o = 0.05 + (Math.sin((i / 46) * Math.PI) ** 2) * 0.5;
    lines += `<path d="${poly(pts)}" fill="none" stroke="url(#flowStroke)" stroke-opacity="${o.toFixed(2)}" stroke-width="${(0.6 + r() * 1.1).toFixed(2)}"/>`;
  }
  const defs = `
    <radialGradient id="bg" cx="0.7" cy="0.35" r="0.95">
      <stop offset="0" stop-color="#132a55"/>
      <stop offset="0.5" stop-color="#0B1020"/>
      <stop offset="1" stop-color="#05070e"/>
    </radialGradient>
    <linearGradient id="flowStroke" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2777FF" stop-opacity="0"/>
      <stop offset="0.35" stop-color="#2777FF"/>
      <stop offset="0.75" stop-color="#00A8FF"/>
      <stop offset="1" stop-color="#8fd8ff" stop-opacity="0.2"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>`;
  const body = `
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g filter="url(#soft)" opacity="0.6">${lines}</g>
  <g>${lines}</g>
  <g>${dust(11, 120, { x: 0, y: 0, w: W, h: H }, 1.1)}</g>`;
  return svg(defs, body);
}

/* ----------------------------------------------------------- wallpaper: emblem */

function wallpaperEmblem() {
  const spine = [
    { x: 1010, y: 690 }, { x: 980, y: 668 }, { x: 990, y: 640 }, { x: 1024, y: 640 },
    { x: 1046, y: 668 }, { x: 1040, y: 712 }, { x: 990, y: 744 }, { x: 910, y: 742 },
    { x: 846, y: 690 }, { x: 836, y: 600 }, { x: 880, y: 520 }, { x: 960, y: 478 },
    { x: 1040, y: 470 },
  ];
  const K = 1.5, O = { x: 950, y: 610 };
  const scaled = spine.map((p) => add(O, mul(sub(p, O), K)));
  const widthAt = (s) => K * (s < 0.7 ? 2 + 34 * Math.pow(Math.sin((s / 0.7) * Math.PI / 2), 1.3) : 36 - 8 * smooth((s - 0.7) / 0.3));
  const d = dragon({ spine: scaled, widthAt, headScale: 0.62 * K, flip: true });
  const light = { x: 1100, y: 380, r: 640 };
  const defs = `
    <radialGradient id="bg" cx="0.5" cy="0.52" r="0.8">
      <stop offset="0" stop-color="#14284f"/>
      <stop offset="0.45" stop-color="#0B1020"/>
      <stop offset="1" stop-color="#04060c"/>
    </radialGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#2777FF" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#2777FF" stop-opacity="0"/>
    </radialGradient>
    ${dragonDefs('em', d, light)}`;
  const body = `
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="950" cy="600" r="480" fill="url(#halo)"/>
  <circle cx="950" cy="605" r="290" fill="none" stroke="#2777FF" stroke-opacity="0.16"/>
  <g>${dust(5, 90, { x: 0, y: 0, w: W, h: H }, 1)}</g>
  ${dragonSVG(d, 'em', { glow: 0.6 })}`;
  return svg(defs, body);
}

/* --------------------------------------------------------- wallpaper: horizon */

function wallpaperHorizon() {
  const r = rng(99);
  let stars = '';
  for (let i = 0; i < 260; i++) {
    const x = r() * W;
    const y = Math.pow(r(), 1.6) * 760;
    stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.3 + r() * 1.2)}" fill="#cfe6ff" fill-opacity="${(0.15 + r() * 0.6).toFixed(2)}"/>`;
  }
  let ridge = 'M0,1080 L0,820';
  for (let x = 0; x <= W; x += 30) {
    const y = 820 - Math.sin(x * 0.004) * 40 - Math.sin(x * 0.011 + 1) * 22 - r() * 10;
    ridge += ` L${x},${f(y)}`;
  }
  ridge += ` L${W},1080Z`;
  let ridge2 = 'M0,1080 L0,900';
  for (let x = 0; x <= W; x += 24) {
    const y = 900 - Math.sin(x * 0.006 + 2) * 30 - Math.sin(x * 0.017) * 14 - r() * 8;
    ridge2 += ` L${x},${f(y)}`;
  }
  ridge2 += ` L${W},1080Z`;
  const defs = `
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070e"/>
      <stop offset="0.55" stop-color="#0B1020"/>
      <stop offset="0.8" stop-color="#14305e"/>
      <stop offset="1" stop-color="#1f56b8"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="1" r="0.6">
      <stop offset="0" stop-color="#00A8FF" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#00A8FF" stop-opacity="0"/>
    </radialGradient>`;
  const body = `
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <g>${stars}</g>
  <ellipse cx="960" cy="860" rx="1100" ry="260" fill="url(#glow)"/>
  <path d="${ridge}" fill="#0a1328"/>
  <path d="${ridge}" fill="none" stroke="#2777FF" stroke-opacity="0.35" stroke-width="1.2"/>
  <path d="${ridge2}" fill="#070c1a"/>`;
  return svg(defs, body);
}

/* ------------------------------------------------------------ the menu mark */

function mark() {
  // Small emblem used for the application menu button and the favicon.
  const spine = [
    { x: 30, y: 47 }, { x: 25.5, y: 44 }, { x: 27, y: 38.5 }, { x: 33, y: 38.5 },
    { x: 37, y: 45 }, { x: 33, y: 54 }, { x: 20, y: 56 }, { x: 9.5, y: 46 },
    { x: 10, y: 30 }, { x: 21, y: 19.5 }, { x: 33, y: 17 },
  ];
  const widthAt = (s) => (s < 0.7 ? 1 + 9 * Math.pow(Math.sin((s / 0.7) * Math.PI / 2), 1.1) : 10 - 2.4 * smooth((s - 0.7) / 0.3));
  const d = dragon({ spine, widthAt, headScale: 0.18, flip: true });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2.5 -3 67 67">
  <path d="${d.bodyPath}" fill="#2777FF"/>
  <g transform="matrix(${d.headMatrix})"><path d="${HORN_FRONT}" fill="#2777FF"/><path d="${HEAD.fill}" fill="#2777FF"/><path d="${HEAD.eye}" fill="#0B1020"/></g>
</svg>
`;
}

writeFileSync(join(OUT, 'kali-dragon.svg'), wallpaperDragon());
writeFileSync(join(OUT, 'kali-flow.svg'), wallpaperFlow());
writeFileSync(join(OUT, 'kali-emblem.svg'), wallpaperEmblem());
writeFileSync(join(OUT, 'kali-horizon.svg'), wallpaperHorizon());
writeFileSync(join(OUT, '../kali-mark.svg'), mark());
console.log('wallpapers written to', OUT);
