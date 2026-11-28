import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify as minifyHtml } from 'html-minifier-terser';
import { transform as transformCss } from 'lightningcss';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true }); fs.writeFileSync(path.join(out, f), s); };
const fail = (msg) => { console.error('build failed:', msg); process.exit(1); };
const sha = (s, enc = 'hex') => crypto.createHash('sha256').update(s).digest(enc);

const SEED = 0x4a17;
const OBF = {
  compact: true,
  target: 'browser',
  seed: SEED,
  simplify: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.25,
  deadCodeInjection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  renameProperties: false,
  transformObjectKeys: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  numbersToExpressions: false,
  splitStrings: false,
  unicodeEscapeSequence: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 1,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'function',
  stringArrayWrappersChainedCalls: true,
  sourceMap: false,
};
const LIGHT = { ...OBF, controlFlowFlattening: false, stringArrayWrappersCount: 1 };
const obfuscate = (code, opts = OBF) => JavaScriptObfuscator.obfuscate(code, opts).getObfuscatedCode();

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of ['manifest.webmanifest']) write(f, JSON.stringify(JSON.parse(read(f))));
for (const dir of ['icons', 'vendor']) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    if (dir === 'icons' && !f.endsWith('.png')) continue;
    fs.mkdirSync(path.join(out, dir), { recursive: true });
    fs.copyFileSync(path.join(root, dir, f), path.join(out, dir, f));
  }
}

const css = transformCss({ filename: 'style.css', code: Buffer.from(read('style.css')), minify: true, targets: { chrome: 90 << 16, safari: 14 << 16, firefox: 90 << 16 } });
write('style.css', css.code.toString());

const html = read('index.html');
const bodyOpen = html.indexOf('<body>');
const bodyClose = html.lastIndexOf('</body>');
if (bodyOpen < 0 || bodyClose < 0) fail('index.html has no <body>');
const head = html.slice(0, bodyOpen);
const body = html.slice(bodyOpen + 6, bodyClose);
const splashEnd = body.indexOf('</script>');
const noscriptAt = body.indexOf('<noscript>');
if (!body.trimStart().startsWith('<div class="splash"') || splashEnd < 0 || noscriptAt < splashEnd) fail('unexpected body layout (splash, splash script, app markup, noscript, scripts)');
const splash = body.slice(0, splashEnd + 9);
const appMarkup = body.slice(splashEnd + 9, noscriptAt);
const tail = body.slice(noscriptAt);
const noscript = tail.slice(0, tail.indexOf('</noscript>') + 11);
const scripts = [...tail.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const vendor = scripts.filter((s) => s.startsWith('vendor/'));
const own = scripts.filter((s) => !s.startsWith('vendor/'));
const known = ['config.js', 'e2e.js', 'emoji.js', 'app.js'];
for (const s of own) if (!known.includes(s)) fail('unknown script ' + s);
if (!own.includes('app.js')) fail('app.js is not loaded by index.html');

const htmlOpts = { collapseWhitespace: true, conservativeCollapse: true, removeComments: true, minifyCSS: true, minifyJS: true, decodeEntities: true, removeRedundantAttributes: true, sortAttributes: true, sortClassName: false };
const markup = await minifyHtml(appMarkup, htmlOpts);
const inject = `(function(){var s=document.currentScript;s.insertAdjacentHTML('beforebegin',${JSON.stringify(markup)});})();`;
const bundle = [inject, ...known.filter((k) => own.includes(k)).map((k) => read(k))].join('\n;\n');
const appJs = obfuscate(bundle);
write('app.js', appJs);

const splashMin = await minifyHtml(splash, htmlOpts);
const inlineJs = [...splashMin.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const scriptHashes = inlineJs.map((s) => `'sha256-${sha(s, 'base64')}'`);
const dev = (process.env.HAMS_DEV_ORIGINS || '').split(/\s+/).filter(Boolean).join(' ');
const csp = [
  "default-src 'self'",
  `script-src 'self' ${scriptHashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' blob: data: https://res.cloudinary.com",
  "media-src 'self' blob: https://res.cloudinary.com",
  `connect-src 'self' blob: data: https: wss: ${dev}`.trim(),
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const headMin = await minifyHtml(head.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`) + '<body>', { ...htmlOpts, minifyJS: false });
const page = `${headMin.replace(/<body>$/, '')}<body>${splashMin}${await minifyHtml(noscript, htmlOpts)}${vendor.map((v) => `<script src="${v}"></script>`).join('')}<script src="app.js"></script></body></html>`;
write('index.html', page);

const files = [];
const walk = (d) => { for (const f of fs.readdirSync(path.join(out, d))) { const p = path.posix.join(d, f); if (fs.statSync(path.join(out, p)).isDirectory()) walk(p); else files.push(p); } };
walk('');
const hash = sha(files.sort().map((f) => f + sha(fs.readFileSync(path.join(out, f)))).join('')).slice(0, 10);
let sw = read('sw.js');
if (!/const CACHE = '[^']*';/.test(sw) || !/const SHELL = \[[\s\S]*?\];/.test(sw)) fail('sw.js must define CACHE and SHELL');
sw = sw.replace(/const CACHE = '[^']*';/, `const CACHE = 'rawaq-${hash}';`).replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = ${JSON.stringify(['./', ...files])};`);
write('sw.js', obfuscate(sw, LIGHT));

const allowed = /^(index\.html|app\.js|sw\.js|style\.css|manifest\.webmanifest|icons\/[\w-]+\.png|vendor\/[\w.-]+\.js)$/;
const final = [];
const walk2 = (d) => { for (const f of fs.readdirSync(path.join(out, d))) { const p = path.posix.join(d, f); if (fs.statSync(path.join(out, p)).isDirectory()) walk2(p); else final.push(p); } };
walk2('');
for (const f of final) if (!allowed.test(f)) fail('unexpected file in dist: ' + f);
for (const f of ['app.js', 'sw.js']) {
  const s = fs.readFileSync(path.join(out, f), 'utf8');
  if (/\/\/ |\/\*(?!!)/.test(s.replace(/https?:\/\/[^'"\s]*/g, ''))) console.warn('warning: comment-like text in', f);
}
const size = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(1) + ' KB';
console.log(`built dist (${final.length} files, cache rawaq-${hash}): app.js ${size('app.js')}, style.css ${size('style.css')}, index.html ${size('index.html')}`);
