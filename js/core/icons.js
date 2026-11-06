// Icon library. Colour icons (48×48) follow a flat, Flat-Remix-like style;
// symbolic icons (16×16) use currentColor so they follow the theme.

const svg = (vb, inner, extra = '') =>
  `<svg class="ico" viewBox="0 0 ${vb} ${vb}" aria-hidden="true" focusable="false"${extra}>${inner}</svg>`;
const sym = (inner) =>
  svg(16, inner, ' fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"');

function gearPath(cx, cy, ro, ri, teeth) {
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    const w = step * 0.22;
    pts.push([a - step / 2 + w, ri], [a - w * 1.1, ro], [a + w * 1.1, ro], [a + step / 2 - w, ri]);
  }
  return 'M' + pts.map(([a, r]) => `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`).join('L') + 'Z';
}

/* ------------------------------------------------------------- folders */

const FOLDER_BACK = 'M5 11.5A2.5 2.5 0 0 1 7.5 9H18l3.5 3.5h19A2.5 2.5 0 0 1 43 15v22.5A2.5 2.5 0 0 1 40.5 40h-33A2.5 2.5 0 0 1 5 37.5z';
const FOLDER_FRONT = 'M5 18A2.5 2.5 0 0 1 7.5 15.5h33A2.5 2.5 0 0 1 43 18v19.5A2.5 2.5 0 0 1 40.5 40h-33A2.5 2.5 0 0 1 5 37.5z';
const E = '#174299';

const FOLDER_EMBLEMS = {
  plain: '',
  home: `<path d="M24 21l-7.5 6.4V35h5v-5h5v5h5v-7.6z" fill="${E}"/>`,
  desktop: `<rect x="16.5" y="21.5" width="15" height="10" rx="1.2" fill="${E}"/><path d="M21 35h6M24 31.5V35" stroke="${E}" stroke-width="2" stroke-linecap="round"/>`,
  documents: `<path d="M19 20.5h6.5l4.5 4.5v10.5H19z" fill="${E}"/><path d="M21.6 28.2h5.8M21.6 31.4h5.8" stroke="#3b82f6" stroke-width="1.3"/>`,
  downloads: `<path d="M24 20.5v10M19.6 26.4l4.4 4.4 4.4-4.4M18 35h12" stroke="${E}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  music: `<path d="M28.5 20.5v10.6a2.9 2.9 0 1 1-1.9-2.7v-5l-5.2 1.3v7.8a2.9 2.9 0 1 1-1.9-2.7v-7.6z" fill="${E}"/>`,
  pictures: `<rect x="16.5" y="21.5" width="15" height="12.5" rx="1.3" fill="${E}"/><path d="M18 32.6l3.7-4.6 2.6 3.1 2.1-2.1 3.3 3.6z" fill="#3b82f6"/><circle cx="27.6" cy="25" r="1.5" fill="#3b82f6"/>`,
  videos: `<rect x="16.5" y="22" width="15" height="11.5" rx="1.3" fill="${E}"/><path d="M22.4 25v5.4l4.6-2.7z" fill="#3b82f6"/>`,
  templates: `<path d="M19 20.8h6.5l4.5 4.5v10.2H19z" fill="none" stroke="${E}" stroke-width="1.7" stroke-dasharray="2.2 1.6"/>`,
  public: `<circle cx="24" cy="24.4" r="2.8" fill="${E}"/><path d="M18.4 34.6c.6-3.8 2.9-5.8 5.6-5.8s5 2 5.6 5.8z" fill="${E}"/>`,
  remote: `<circle cx="24" cy="28" r="6" fill="none" stroke="${E}" stroke-width="1.8"/><path d="M18 28h12M24 22c-2.6 3.6-2.6 8.4 0 12M24 22c2.6 3.6 2.6 8.4 0 12" stroke="${E}" stroke-width="1.4" fill="none"/>`,
};

function folder(emblem = 'plain') {
  return svg(48, `<path d="${FOLDER_BACK}" fill="#1c56c9"/><path d="${FOLDER_FRONT}" fill="#3381f7"/>` +
    `<path d="M5 18A2.5 2.5 0 0 1 7.5 15.5h33A2.5 2.5 0 0 1 43 18v1H5z" fill="#fff" opacity=".14"/>` +
    (FOLDER_EMBLEMS[emblem] || ''));
}

/* --------------------------------------------------------------- files */

const PAGE = '<path d="M12 5h17l9 9v27a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill="#e9edf3"/><path d="M29 5v7a2 2 0 0 0 2 2h7z" fill="#bcc6d4"/>';

const FILES = {
  generic: '',
  text: '<path d="M15 19h15M15 23.5h18M15 28h13M15 32.5h17M15 37h10" stroke="#98a3b6" stroke-width="1.8" stroke-linecap="round"/>',
  markdown: '<rect x="13" y="22" width="22" height="13" rx="2" fill="#4a5468"/><path d="M16 31.5v-6l3 3.4 3-3.4v6M28.5 25.5v6M26 29l2.5 2.6L31 29" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  script: '<rect x="13" y="20" width="22" height="16" rx="2" fill="#262b38"/><path d="M16.5 25l3.2 3-3.2 3M22 31.5h6" stroke="#3d8bff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  image: '<rect x="13" y="19" width="22" height="18" rx="1.6" fill="#2777FF"/><path d="M13 33.5l6-6.5 4.5 4.8 3-3 8.5 7.7v.5H13z" fill="#0f3d8c"/><circle cx="29.5" cy="24" r="2.2" fill="#ffd34d"/>',
  binary: `<path d="${gearPath(24, 28, 8, 5.6, 8)}" fill="#7d889c"/><circle cx="24" cy="28" r="2.6" fill="#e9edf3"/>`,
  archive: '<path d="M22 5h4v4h-4zM22 13h4v4h-4zM22 21h4v4h-4z" fill="#8a95a8"/><path d="M24 9h2v4h-2zM22 17h2v4h-2z" fill="#b4bdcc"/><rect x="20.5" y="26" width="7" height="9" rx="1.5" fill="#6c7891"/><rect x="22.5" y="30" width="3" height="3" rx=".6" fill="#e9edf3"/>',
  disc: '<circle cx="24" cy="28" r="10" fill="#9fb0c8"/><circle cx="24" cy="28" r="10" fill="none" stroke="#7a8aa3" stroke-width="1"/><circle cx="24" cy="28" r="3.2" fill="#e9edf3"/><path d="M17 23a8 8 0 0 1 5-3.6" stroke="#fff" stroke-width="1.4" fill="none" opacity=".8"/>',
  config: '<path d="M15 21h18M15 28h18M15 35h18" stroke="#98a3b6" stroke-width="1.8" stroke-linecap="round"/><circle cx="20" cy="21" r="2.4" fill="#2777FF"/><circle cx="28" cy="28" r="2.4" fill="#2777FF"/><circle cx="22" cy="35" r="2.4" fill="#2777FF"/>',
  html: '<path d="M19 22.5l-4.5 5 4.5 5M29 22.5l4.5 5-4.5 5M26 20.5l-4 14" stroke="#e8743b" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  log: '<path d="M15 19h18M15 23.5h18M15 28h18M15 32.5h18M15 37h12" stroke="#98a3b6" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="3 1.5"/>',
};

function file(kind = 'generic') {
  return svg(48, PAGE + (FILES[kind] ?? ''));
}

/* ---------------------------------------------------------------- apps */

const APPS = {
  terminal: svg(48, '<path d="M8.5 7h31A3.5 3.5 0 0 1 43 10.5v27a3.5 3.5 0 0 1-3.5 3.5h-31A3.5 3.5 0 0 1 5 37.5v-27A3.5 3.5 0 0 1 8.5 7z" fill="#1d212b"/>' +
    '<path d="M8.5 7h31A3.5 3.5 0 0 1 43 10.5V13H5v-2.5A3.5 3.5 0 0 1 8.5 7z" fill="#3a4153"/>' +
    '<circle cx="9.5" cy="10" r="1" fill="#8792a8"/><circle cx="13" cy="10" r="1" fill="#8792a8"/>' +
    '<path d="M12 20.5l6.5 5.5-6.5 5.5" stroke="#3d8bff" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M21.5 32h11" stroke="#e6eaf2" stroke-width="2.8" stroke-linecap="round"/>'),
  browser: svg(48, '<circle cx="24" cy="24" r="18" fill="#2a6cf0"/><path d="M24 6a18 18 0 0 1 0 36z" fill="#1f58cf"/>' +
    '<g fill="none" stroke="#c7e3ff" stroke-width="1.3" opacity=".8"><ellipse cx="24" cy="24" rx="7.5" ry="18"/><path d="M6 24h36M8.6 15h30.8M8.6 33h30.8M24 6v36"/></g>' +
    '<path d="M8.6 33.5A17.5 17.5 0 0 0 41 29.5" stroke="#ff8a1f" stroke-width="4.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M36.5 12.5a17.5 17.5 0 0 1 5 12" stroke="#ffb547" stroke-width="3.2" fill="none" stroke-linecap="round"/>'),
  files: svg(48, `<path d="${FOLDER_BACK}" fill="#1c56c9"/><path d="${FOLDER_FRONT}" fill="#3381f7"/>` +
    '<rect x="15" y="21.5" width="18" height="13" rx="1.6" fill="#e9edf3"/><path d="M18 25.5h12M18 28.5h12M18 31.5h8" stroke="#3381f7" stroke-width="1.5" stroke-linecap="round"/>'),
  editor: svg(48, '<path d="M11 6h18l8 8v26a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="#eef1f6"/><path d="M29 6v6a2 2 0 0 0 2 2h6z" fill="#c2cad8"/>' +
    '<path d="M14 18h12M14 22.5h16M14 27h10M14 31.5h13" stroke="#9aa4b6" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M38.2 21.8l3.3 3.3-12.6 12.6-4.6 1.3 1.3-4.6z" fill="#2777FF"/><path d="M36 24l3.3 3.3" stroke="#0f3d8c" stroke-width="1.2"/><path d="M25.6 34.4l-1.3 4.6 4.6-1.3" fill="#0f3d8c"/>'),
  settings: svg(48, '<rect x="5" y="5" width="38" height="38" rx="9" fill="#323a4b"/>' +
    `<path d="${gearPath(24, 24, 13, 9.6, 9)}" fill="#dfe5ef"/><circle cx="24" cy="24" r="5.4" fill="#2777FF"/><circle cx="24" cy="24" r="2.4" fill="#323a4b"/>`),
  sysinfo: svg(48, '<rect x="5" y="8" width="38" height="26" rx="2.6" fill="#2c3344"/><rect x="8" y="11" width="32" height="20" rx="1.2" fill="#2777FF"/>' +
    '<path d="M18.5 40.5h11M24 34v6.5" stroke="#8994a8" stroke-width="2.6" stroke-linecap="round"/>' +
    '<circle cx="24" cy="15.8" r="1.9" fill="#fff"/><path d="M24 20v7.4" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/>'),
  imageviewer: svg(48, '<rect x="5" y="9" width="38" height="30" rx="3" fill="#e9edf4"/><rect x="8.5" y="12.5" width="31" height="23" rx="1.5" fill="#2777FF"/>' +
    '<path d="M8.5 31l8-9 6 6.5 4-4 13 11v.5a1.5 1.5 0 0 1-1.5 1.5h-28a1.5 1.5 0 0 1-1.5-1.5z" fill="#0f3d8c"/><circle cx="31.5" cy="19" r="3" fill="#ffd34d"/>'),
  calculator: svg(48, '<rect x="10" y="5" width="28" height="38" rx="3.5" fill="#2c3344"/><rect x="13.5" y="9" width="21" height="8.5" rx="1.2" fill="#9fd4ff"/>' +
    [0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => `<rect x="${13.5 + c * 7.5}" y="${21 + r * 5.4}" width="6" height="4" rx="1" fill="${r === 3 && c === 2 ? '#2777FF' : '#4a5468'}"/>`).join('')).join('')),
  home: folder('home'),
  filesystem: svg(48, '<path d="M9.5 12h29l4.5 14v8.5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V26z" fill="#c9d1de"/><path d="M5 26h38v8.5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="#8f9bb0"/>' +
    '<circle cx="37" cy="31.8" r="1.7" fill="#36e07a"/><path d="M10 31.8h16" stroke="#5c687f" stroke-width="1.6" stroke-linecap="round"/><path d="M12 15.5h24" stroke="#fff" stroke-width="1.2" opacity=".6"/>'),
  'trash-empty': svg(48, '<path d="M13 16h22l-2 23.3a2.6 2.6 0 0 1-2.6 2.4H17.6a2.6 2.6 0 0 1-2.6-2.4z" fill="#a9b3c4"/>' +
    '<path d="M10.5 11.5h27A1.5 1.5 0 0 1 39 13v3H9v-3a1.5 1.5 0 0 1 1.5-1.5z" fill="#d6dce6"/><path d="M20 8h8v3.5h-8z" fill="#d6dce6"/>' +
    '<path d="M19.6 21v15.5M24 21v15.5M28.4 21v15.5" stroke="#7b869b" stroke-width="1.7" stroke-linecap="round"/>'),
  'trash-full': svg(48, '<path d="M13 16h22l-2 23.3a2.6 2.6 0 0 1-2.6 2.4H17.6a2.6 2.6 0 0 1-2.6-2.4z" fill="#a9b3c4"/>' +
    '<path d="M14 13.5l5.5-6.5 4.5 3.2 5.2-4 4.8 7.3z" fill="#f4f6fa"/><path d="M19.5 7l1.2 6.5M29.2 6.2l-1 7.3" stroke="#cfd6e1" stroke-width="1"/>' +
    '<path d="M10.5 12.5h27A1.5 1.5 0 0 1 39 14v2H9v-2a1.5 1.5 0 0 1 1.5-1.5z" fill="#d6dce6"/>' +
    '<path d="M19.6 21v15.5M24 21v15.5M28.4 21v15.5" stroke="#7b869b" stroke-width="1.7" stroke-linecap="round"/>'),
  network: svg(48, '<circle cx="24" cy="24" r="17" fill="#2c3344"/><g fill="none" stroke="#5aa9ff" stroke-width="1.6"><circle cx="24" cy="24" r="11"/><path d="M13 24h22M24 13c-4.5 6.5-4.5 15.5 0 22M24 13c4.5 6.5 4.5 15.5 0 22"/></g>'),
  user: svg(48, '<circle cx="24" cy="24" r="20" fill="#2a3142"/><circle cx="24" cy="19" r="7" fill="#9aa6bb"/><path d="M11.5 37.5c2-6.4 6.8-9.5 12.5-9.5s10.5 3.1 12.5 9.5A19.9 19.9 0 0 1 24 44a19.9 19.9 0 0 1-12.5-6.5z" fill="#9aa6bb"/>'),
  screenshot: svg(48, '<rect x="6" y="11" width="36" height="27" rx="3" fill="#2c3344"/><circle cx="24" cy="24.5" r="8" fill="#2777FF"/><circle cx="24" cy="24.5" r="4" fill="#9fd4ff"/><rect x="16" y="7.5" width="9" height="5" rx="1.5" fill="#2c3344"/>'),
  archive: svg(48, '<rect x="7" y="10" width="34" height="30" rx="3" fill="#b88a4a"/><rect x="7" y="10" width="34" height="8" rx="3" fill="#d4a463"/><path d="M22 18h4v4h-4zM22 26h4v4h-4z" fill="#7a5426"/><path d="M24 22h2v4h-2zM22 30h2v4h-2z" fill="#f0d29a"/>'),
  taskmanager: svg(48, '<rect x="5" y="8" width="38" height="32" rx="3" fill="#2c3344"/><path d="M9 30l7-8 6 5 7-11 5 7 5-3" stroke="#36e07a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  about: svg(48, '<circle cx="24" cy="24" r="18" fill="#2777FF"/><circle cx="24" cy="16" r="2.4" fill="#fff"/><path d="M24 21.5v12" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>'),
  display: svg(48, '<rect x="5" y="8" width="38" height="26" rx="2.6" fill="#2c3344"/><rect x="8" y="11" width="32" height="20" rx="1.2" fill="#3d8bff"/><path d="M18.5 40.5h11M24 34v6.5" stroke="#8994a8" stroke-width="2.6" stroke-linecap="round"/>'),
  keyboard: svg(48, '<rect x="4" y="13" width="40" height="23" rx="3" fill="#2c3344"/>' +
    [0, 1, 2].map((r) => Array.from({ length: 8 }, (_, c) => `<rect x="${7.5 + c * 4.3}" y="${16.5 + r * 5}" width="3.2" height="3.2" rx=".6" fill="#8994a8"/>`).join('')).join('') +
    '<rect x="14" y="31" width="20" height="2.6" rx=".8" fill="#8994a8"/>'),
  sound: svg(48, '<rect x="5" y="5" width="38" height="38" rx="9" fill="#323a4b"/><path d="M12 20h6l7-6v20l-7-6h-6z" fill="#dfe5ef"/><path d="M29 18.5a7 7 0 0 1 0 11M32.5 15a12 12 0 0 1 0 18" stroke="#3d8bff" stroke-width="2.4" fill="none" stroke-linecap="round"/>'),
  appearance: svg(48, '<rect x="5" y="5" width="38" height="38" rx="9" fill="#323a4b"/><circle cx="20" cy="21" r="8" fill="#2777FF"/><circle cx="28" cy="21" r="8" fill="#00A8FF" opacity=".85"/><circle cx="24" cy="28" r="8" fill="#8b5cf6" opacity=".8"/>'),
  wallpaper: svg(48, '<rect x="5" y="5" width="38" height="38" rx="9" fill="#323a4b"/><rect x="11" y="13" width="26" height="20" rx="2" fill="#0B1020"/><path d="M11 29l7-6 5 4 4-3 10 7v.5a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2z" fill="#2777FF"/><circle cx="30" cy="19" r="2.4" fill="#00A8FF"/>'),
  panel: svg(48, '<rect x="5" y="5" width="38" height="38" rx="9" fill="#323a4b"/><rect x="10" y="11" width="28" height="5" rx="1.2" fill="#dfe5ef"/><rect x="10" y="20" width="28" height="17" rx="1.5" fill="#46506a"/><rect x="11.5" y="12.2" width="3" height="2.6" rx=".5" fill="#2777FF"/>'),
  windows: svg(48, '<rect x="5" y="5" width="38" height="38" rx="9" fill="#323a4b"/><rect x="10" y="12" width="20" height="15" rx="1.5" fill="#46506a"/><rect x="18" y="20" width="20" height="16" rx="1.5" fill="#dfe5ef"/><rect x="18" y="20" width="20" height="3.5" rx="1.5" fill="#2777FF"/>'),
  notifications: svg(48, '<rect x="5" y="5" width="38" height="38" rx="9" fill="#323a4b"/><path d="M24 12a7.5 7.5 0 0 0-7.5 7.5v5.5l-2.5 4.5h20l-2.5-4.5v-5.5A7.5 7.5 0 0 0 24 12z" fill="#dfe5ef"/><path d="M21 32.5a3 3 0 0 0 6 0" fill="#dfe5ef"/><circle cx="32" cy="15" r="3.4" fill="#2777FF"/>'),
  power: svg(48, '<rect x="5" y="5" width="38" height="38" rx="9" fill="#323a4b"/><path d="M24 13v10M17.5 16.8a10 10 0 1 0 13 0" stroke="#dfe5ef" stroke-width="2.8" fill="none" stroke-linecap="round"/>'),
  printer: svg(48, '<rect x="14" y="7" width="20" height="10" rx="1" fill="#e9edf3"/><rect x="6" y="16" width="36" height="16" rx="3" fill="#2c3344"/><rect x="14" y="27" width="20" height="13" rx="1" fill="#e9edf3"/><circle cx="36" cy="21" r="1.5" fill="#36e07a"/>'),
  session: svg(48, '<rect x="5" y="5" width="38" height="38" rx="9" fill="#323a4b"/><circle cx="24" cy="19" r="5.5" fill="#dfe5ef"/><path d="M14 35c1.5-5.5 5.2-8 10-8s8.5 2.5 10 8z" fill="#dfe5ef"/>'),
  reset: svg(48, '<rect x="5" y="5" width="38" height="38" rx="9" fill="#323a4b"/><path d="M33 24a9 9 0 1 1-2.6-6.4M31 12v6h-6" stroke="#dfe5ef" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  desktop: folder('desktop'),
  // Metasploit Classic: an old monochrome CRT terminal, black & white
  classic: svg(48, '<path d="M9 7h30a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3z" fill="#d9d9d4"/>' +
    '<path d="M9 7h30a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3z" fill="none" stroke="#8c8c86" stroke-width="1"/>' +
    '<rect x="10" y="10.5" width="28" height="19.5" rx="4" fill="#0b0b0b"/>' +
    '<g stroke="#fff" stroke-opacity=".08">' + [13, 15.5, 18, 20.5, 23, 25.5, 28].map((y) => `<path d="M11 ${y}h26"/>`).join('') + '</g>' +
    '<path d="M14 16l4 3.2-4 3.2" stroke="#f4f4f4" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M21 23.5h7" stroke="#f4f4f4" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="36" cy="32.6" r=".9" fill="#5a5a55"/>' +
    '<path d="M17 35h14l2 5H15z" fill="#bfbfb9"/><rect x="12" y="40" width="24" height="2.6" rx="1" fill="#a9a9a3"/>'),
  phantom: svg(48, '<rect x="4" y="4" width="40" height="40" rx="8" fill="#05080b"/>' +
    '<rect x="4.75" y="4.75" width="38.5" height="38.5" rx="7.25" fill="none" stroke="#00ff88" stroke-opacity=".5" stroke-width="1.5"/>' +
    '<path d="M24 11c-7.2 0-12 5-12 11.5V36l3-2.2 3 2.2 3-2.2 3 2.2 3-2.2 3 2.2 3-2.2 3 2.2V22.5C36 16 31.2 11 24 11z" fill="#00ff88" fill-opacity=".12" stroke="#00ff88" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M17.5 22.5h4.5M26 22.5h4.5" stroke="#00c8ff" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path d="M19.5 29h9" stroke="#00ff88" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>'),
};

/* ------------------------------------------------------- security tools */

const TOOL_GLYPHS = {
  recon: '<circle cx="24" cy="24" r="9" fill="none" stroke="#7cc4ff" stroke-width="1.8"/><circle cx="24" cy="24" r="3.6" fill="none" stroke="#7cc4ff" stroke-width="1.8"/><path d="M24 24l7-7" stroke="#e6eaf2" stroke-width="2.2" stroke-linecap="round"/>',
  vuln: '<ellipse cx="24" cy="25.5" rx="5.5" ry="7" fill="#7cc4ff"/><circle cx="24" cy="16.5" r="3" fill="#7cc4ff"/><path d="M18.5 22h-4M33.5 22h-4M18.5 28h-4M33.5 28h-4M19 32.5l-3 3M29 32.5l3 3M24 19v13.5" stroke="#e6eaf2" stroke-width="1.6" stroke-linecap="round"/>',
  web: '<rect x="13" y="15" width="22" height="18" rx="2" fill="none" stroke="#7cc4ff" stroke-width="1.8"/><path d="M13 19.5h22" stroke="#7cc4ff" stroke-width="1.8"/><path d="M20 24.5l-3 2.5 3 2.5M28 24.5l3 2.5-3 2.5" stroke="#e6eaf2" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  database: '<ellipse cx="24" cy="16.5" rx="8.5" ry="3.2" fill="#7cc4ff"/><path d="M15.5 16.5v14c0 1.8 3.8 3.2 8.5 3.2s8.5-1.4 8.5-3.2v-14" fill="none" stroke="#7cc4ff" stroke-width="1.8"/><path d="M15.5 23.5c0 1.8 3.8 3.2 8.5 3.2s8.5-1.4 8.5-3.2" fill="none" stroke="#e6eaf2" stroke-width="1.6"/>',
  password: '<circle cx="19" cy="24" r="5.5" fill="none" stroke="#7cc4ff" stroke-width="2"/><path d="M24.5 24H35M31 24v4M34 24v3" stroke="#e6eaf2" stroke-width="2" stroke-linecap="round"/>',
  wireless: '<path d="M14 21a14 14 0 0 1 20 0M17.5 24.5a9 9 0 0 1 13 0M21 28a4 4 0 0 1 6 0" stroke="#7cc4ff" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="24" cy="31.5" r="1.8" fill="#e6eaf2"/>',
  reverse: `<path d="${gearPath(24, 24, 9, 6.6, 8)}" fill="#7cc4ff"/><circle cx="24" cy="24" r="3" fill="#141b2b"/>`,
  exploit: '<path d="M26 12l-9 14h7l-2 10 9-14h-7z" fill="#7cc4ff"/>',
  sniffing: '<circle cx="15.5" cy="24" r="3" fill="#7cc4ff"/><circle cx="32.5" cy="17" r="3" fill="#7cc4ff"/><circle cx="32.5" cy="31" r="3" fill="#7cc4ff"/><path d="M18 23l12-5M18 25l12 5" stroke="#e6eaf2" stroke-width="1.6"/>',
  post: '<path d="M17 13h11v22H17z" fill="none" stroke="#7cc4ff" stroke-width="1.8"/><path d="M24 24h10M30.5 20.5L34 24l-3.5 3.5" stroke="#e6eaf2" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  forensics: '<circle cx="22" cy="22" r="7" fill="none" stroke="#7cc4ff" stroke-width="2"/><path d="M27 27l6.5 6.5" stroke="#e6eaf2" stroke-width="2.6" stroke-linecap="round"/>',
  reporting: '<path d="M16 13h11l5 5v17H16z" fill="none" stroke="#7cc4ff" stroke-width="1.8"/><path d="M20 30v-4M24 30v-7M28 30v-5" stroke="#e6eaf2" stroke-width="2" stroke-linecap="round"/>',
  social: '<circle cx="24" cy="19" r="4.5" fill="#7cc4ff"/><path d="M15.5 33c1-4.8 4.3-7 8.5-7s7.5 2.2 8.5 7z" fill="#7cc4ff"/><path d="M31 14l3-2M33 18h3" stroke="#e6eaf2" stroke-width="1.6" stroke-linecap="round"/>',
};

function tool(glyph) {
  return svg(48, '<circle cx="24" cy="24" r="19" fill="#141b2b"/><circle cx="24" cy="24" r="19" fill="none" stroke="#2777FF" stroke-width="1.6"/>' + (TOOL_GLYPHS[glyph] || TOOL_GLYPHS.recon));
}

/* ------------------------------------------------------------ symbolic */

const SYMBOLIC = {
  'win-min': '<path d="M4.5 6.5L8 10l3.5-3.5"/>',
  'win-max': '<path d="M4.5 9.5L8 6l3.5 3.5"/>',
  'win-restore': '<path d="M5 6l3-3 3 3M5 10l3 3 3-3"/>',
  'win-close': '<path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4"/>',
  'go-back': '<path d="M13 8H3.5M7.5 4L3.5 8l4 4"/>',
  'go-forward': '<path d="M3 8h9.5M8.5 4l4 4-4 4"/>',
  'go-up': '<path d="M8 13V3.5M4 7.5l4-4 4 4"/>',
  'go-home': '<path d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h3V9.5h2V13h3V6.5"/>',
  reload: '<path d="M13 8a5 5 0 1 1-1.5-3.6M12 2v3h-3"/>',
  stop: '<path d="M4 4l8 8M12 4l-8 8"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/>',
  menu: '<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>',
  'view-grid': '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx=".8"/><rect x="9" y="2.5" width="4.5" height="4.5" rx=".8"/><rect x="2.5" y="9" width="4.5" height="4.5" rx=".8"/><rect x="9" y="9" width="4.5" height="4.5" rx=".8"/>',
  'view-list': '<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.8" cy="4" r=".6" fill="currentColor"/><circle cx="2.8" cy="8" r=".6" fill="currentColor"/><circle cx="2.8" cy="12" r=".6" fill="currentColor"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  check: '<path d="M3 8.5l3.2 3L13 4.5"/>',
  'chevron-right': '<path d="M6 3.5L10.5 8 6 12.5"/>',
  'chevron-left': '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  'chevron-down': '<path d="M3.5 6l4.5 4.5L12.5 6"/>',
  'chevron-up': '<path d="M3.5 10L8 5.5l4.5 4.5"/>',
  star: '<path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4-2.9-2.8 4-.6z"/>',
  'star-filled': '<path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4-2.9-2.8 4-.6z" fill="currentColor"/>',
  folder: '<path d="M2 4.5A1 1 0 0 1 3 3.5h3.3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  'folder-new': '<path d="M2 4.5A1 1 0 0 1 3 3.5h3.3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M8 7v4M6 9h4"/>',
  'document-new': '<path d="M4 2h5l3 3v9H4z"/><path d="M8 7.5v4M6 9.5h4"/>',
  document: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
  edit: '<path d="M10.5 3l2.5 2.5-7.5 7.5H3v-2.5z"/>',
  trash: '<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  cut: '<circle cx="4.5" cy="11.5" r="2"/><circle cx="11.5" cy="11.5" r="2"/><path d="M6 10l6-8M10 10L4 2"/>',
  paste: '<rect x="3.5" y="3" width="9" height="11" rx="1"/><path d="M6 3V2h4v1"/>',
  settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2V11"/><circle cx="8" cy="5" r=".5" fill="currentColor"/>',
  warning: '<path d="M8 2.2L14.2 13H1.8z"/><path d="M8 6.5v3"/><circle cx="8" cy="11.2" r=".5" fill="currentColor"/>',
  error: '<circle cx="8" cy="8" r="6"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>',
  question: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.3a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3v.3"/><circle cx="8" cy="11.3" r=".5" fill="currentColor"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  'lock-open': '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/>',
  globe: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12"/>',
  external: '<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>',
  bell: '<path d="M8 2.2a3.8 3.8 0 0 0-3.8 3.8v2.6L3 11h10l-1.2-2.4V6A3.8 3.8 0 0 0 8 2.2z"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0"/>',
  'bell-off': '<path d="M5.2 3.4A3.8 3.8 0 0 1 11.8 6v2.6L13 11H7M4.2 6v2.6L3 11h2"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0M2.5 2.5l11 11"/>',
  'volume-high': '<path d="M2.5 6h2.5L8 3.5v9L5 10H2.5z"/><path d="M10.3 5.8a3 3 0 0 1 0 4.4M12 4a5.5 5.5 0 0 1 0 8"/>',
  'volume-medium': '<path d="M2.5 6h2.5L8 3.5v9L5 10H2.5z"/><path d="M10.3 5.8a3 3 0 0 1 0 4.4"/>',
  'volume-low': '<path d="M2.5 6h2.5L8 3.5v9L5 10H2.5z"/>',
  'volume-muted': '<path d="M2.5 6h2.5L8 3.5v9L5 10H2.5z"/><path d="M10.5 6l3.5 4M14 6l-3.5 4"/>',
  'network-wired': '<rect x="1.8" y="9.5" width="4.5" height="4" rx=".6"/><rect x="9.7" y="9.5" width="4.5" height="4" rx=".6"/><rect x="5.75" y="2.5" width="4.5" height="4" rx=".6"/><path d="M8 6.5v1.5M4 9.5V8h8v1.5"/>',
  'network-offline': '<rect x="1.8" y="9.5" width="4.5" height="4" rx=".6"/><rect x="9.7" y="9.5" width="4.5" height="4" rx=".6"/><path d="M4 9.5V8h3M10 4l4 4M14 4l-4 4"/>',
  power: '<path d="M8 2v5.5M4.6 4.3a5 5 0 1 0 6.8 0"/>',
  logout: '<path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10.5 5L13.5 8l-3 3M13.5 8H6"/>',
  restart: '<path d="M13 8a5 5 0 1 1-1.5-3.6M12 2v3h-3"/>',
  suspend: '<path d="M12.5 10A5.5 5.5 0 0 1 6 3.5a5.5 5.5 0 1 0 6.5 6.5z"/>',
  'switch-user': '<circle cx="6" cy="5.5" r="2.3"/><path d="M2 13c.4-2.4 1.9-3.8 4-3.8s3.6 1.4 4 3.8"/><path d="M11 4.5h3M12.5 3v3M11 9.5h3"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
  sidebar: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/>',
  terminal: '<rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M4.5 6.5L6.5 8l-2 1.5M8 10h3"/>',
  'zoom-in': '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14M5 7h4M7 5v4"/>',
  'zoom-out': '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14M5 7h4"/>',
  'zoom-fit': '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  'zoom-original': '<rect x="3" y="3" width="10" height="10" rx="1"/><path d="M6.5 6.2L7.8 5.5V10.5"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2.5 11.5l3.5-3.5 2.5 2.5 1.5-1.5 3.5 3"/><circle cx="10.5" cy="6" r="1"/>',
  save: '<path d="M3 2.5h8l2.5 2.5v8.5H2.5V3z"/><path d="M5 2.5V6h5V2.5M5 13.5V9.5h6v4"/>',
  open: '<path d="M2 4.5A1 1 0 0 1 3 3.5h3.3l1.5 1.5H12a1 1 0 0 1 1 1V7"/><path d="M2 12.5L3.8 7h11l-1.8 5.5z"/>',
  undo: '<path d="M5.5 3.5L2.5 6.5l3 3M2.5 6.5h7a4 4 0 0 1 0 8H7"/>',
  redo: '<path d="M10.5 3.5l3 3-3 3M13.5 6.5h-7a4 4 0 0 0 0 8H9"/>',
  'select-all': '<rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke-dasharray="2 1.6"/><path d="M5 8l2 2 4-4"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  'show-desktop': '<rect x="2" y="2.5" width="12" height="9" rx="1"/><path d="M5.5 14h5M8 11.5V14"/>',
  wrench: '<path d="M10.5 2.2a3.3 3.3 0 0 0-3.2 4.3L2.5 11.3l2.2 2.2 4.8-4.8a3.3 3.3 0 0 0 4.3-3.2l-2 2-2.1-.6-.6-2.1z"/>',
  'tab-new': '<rect x="2" y="4" width="12" height="9.5" rx="1"/><path d="M2 7h12M8 8.8v3M6.5 10.3h3"/>',
  sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  moon: '<path d="M12.5 10A5.5 5.5 0 0 1 6 3.5a5.5 5.5 0 1 0 6.5 6.5z"/>',
  battery: '<rect x="1.5" y="4.5" width="11.5" height="7" rx="1.3"/><path d="M14.5 6.8v2.4"/>',
  bookmark: '<path d="M4.5 2.5h7v11L8 10.5l-3.5 3z"/>',
  history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3"/><path d="M8 5.5V8l2 1.5"/>',
  apps: '<circle cx="4" cy="4" r="1.2"/><circle cx="8" cy="4" r="1.2"/><circle cx="12" cy="4" r="1.2"/><circle cx="4" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12" cy="8" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="8" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/>',
  accessories: '<path d="M10.5 2.2a3.3 3.3 0 0 0-3.2 4.3L2.5 11.3l2.2 2.2 4.8-4.8a3.3 3.3 0 0 0 4.3-3.2l-2 2-2.1-.6-.6-2.1z"/>',
  graphics: '<path d="M8 2a6 6 0 1 0 0 12c1 0 1.5-.6 1.5-1.3 0-1-.9-1.2-.9-2s.6-1.2 1.4-1.2H12a2 2 0 0 0 2-2C14 4.4 11.3 2 8 2z"/><circle cx="5" cy="7" r=".6" fill="currentColor"/><circle cx="7.5" cy="4.8" r=".6" fill="currentColor"/><circle cx="10.5" cy="5.5" r=".6" fill="currentColor"/>',
  system: '<rect x="2" y="2.5" width="12" height="8.5" rx="1"/><path d="M5.5 14h5M8 11v3"/>',
  shield: '<path d="M8 1.8l5.2 2v4c0 3.2-2.2 5.4-5.2 6.4-3-1-5.2-3.2-5.2-6.4v-4z"/>',
  favorite: '<path d="M8 13.5S2 10 2 6.2A3.2 3.2 0 0 1 8 4.5a3.2 3.2 0 0 1 6 1.7C14 10 8 13.5 8 13.5z"/>',
  'pan-down': '<path d="M5 6.5l3 3 3-3"/>',
  'radio-on': '<circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/>',
  dot: '<circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>',
  drive: '<rect x="2" y="8" width="12" height="5" rx="1"/><path d="M3.5 8l1.5-5h6l1.5 5"/><circle cx="11.5" cy="10.5" r=".5" fill="currentColor"/>',
  trash2: '<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
  network: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12"/>',
  restore: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3"/>',
  properties: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5 6h6M5 8.5h6M5 11h3.5"/>',
  find: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/>',
  wrap: '<path d="M2.5 4h11M2.5 8h9a2 2 0 0 1 0 4H8M9.5 10.5L8 12l1.5 1.5M2.5 12h3"/>',
  numbers: '<path d="M3 3.5l1.5-1v5M2.8 7.5h3.4M3 10h2.5a1 1 0 0 1 0 2H4a1 1 0 0 1 0 2H2.8M8.5 4h5M8.5 8h5M8.5 12h5"/>',
};

const DISPLAY_EMBLEM = {
  home: 'home', desktop: 'desktop', documents: 'documents', downloads: 'downloads', music: 'music',
  pictures: 'pictures', videos: 'videos', templates: 'templates', public: 'public',
};

/**
 * Returns an icon's SVG markup.
 * Names: app ids (terminal, browser, …), "folder", "folder-<emblem>", "file-<kind>",
 * "tool-<glyph>", "kali-menu", or any symbolic name.
 */
export function icon(name) {
  if (!name) return '';
  if (APPS[name]) return APPS[name];
  if (name === 'folder') return folder();
  if (name.startsWith('folder-') && DISPLAY_EMBLEM[name.slice(7)] !== undefined) return folder(name.slice(7));
  if (name.startsWith('folder-')) return folder(name.slice(7));
  if (name.startsWith('file-')) return file(name.slice(5));
  if (name.startsWith('tool-')) return tool(name.slice(5));
  if (name === 'kali-menu') return KALI_MARK;
  if (SYMBOLIC[name]) return sym(SYMBOLIC[name]);
  return file('generic');
}

export const hasIcon = (name) => !!(APPS[name] || SYMBOLIC[name] || name?.startsWith('folder') || name?.startsWith('file-') || name?.startsWith('tool-'));

/** Battery icon with a fill level (0–1) and optional charging bolt. */
export function batteryIcon(level, charging) {
  const w = Math.max(0.6, 9.5 * level);
  const color = level <= 0.15 && !charging ? '#ff6b6b' : 'currentColor';
  return sym(`<rect x="1.5" y="4.5" width="11.5" height="7" rx="1.3"/><path d="M14.5 6.8v2.4"/>` +
    `<rect x="2.5" y="5.5" width="${w.toFixed(2)}" height="5" rx=".5" fill="${color}" stroke="none"/>` +
    (charging ? '<path d="M7.6 4.8L5.8 8.3h2.4l-1.6 3.1" stroke="#151923" stroke-width="2.2"/><path d="M7.6 4.8L5.8 8.3h2.4l-1.6 3.1" stroke="#fff" stroke-width="1"/>' : ''));
}

// The application-menu emblem (same artwork as assets/kali-mark.svg).
export const KALI_MARK = '<img class="ico kali-mark" src="assets/kali-mark.svg" alt="" draggable="false">';

/** Picks an icon name for a filesystem entry. */
export function iconForEntry(name, node) {
  if (!node) return 'file-generic';
  if (node.type === 'dir') return 'folder';
  if (node.type === 'link') return 'file-generic';
  if (node.image) return 'file-image';
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  if (node.binary && /iso|img/.test(ext)) return 'file-disc';
  if (/^(gz|tgz|zip|xz|bz2|7z|rar|tar|deb)$/.test(ext)) return 'file-archive';
  if (node.binary) return 'file-binary';
  if (/^(png|jpe?g|gif|svg|webp|bmp)$/.test(ext)) return 'file-image';
  if (/^(sh|zsh|bash|py|pl|rb|js|php|c|go|rs)$/.test(ext) || (node.mode & 0o111)) return 'file-script';
  if (ext === 'md') return 'file-markdown';
  if (/^(html?|xml)$/.test(ext)) return 'file-html';
  if (ext === 'log') return 'file-log';
  if (/^(conf|cfg|ini|toml|ya?ml|json)$/.test(ext) || lower.startsWith('.') || /rc$/.test(lower)) return 'file-config';
  return 'file-text';
}
