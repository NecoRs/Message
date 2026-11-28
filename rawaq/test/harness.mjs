import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeFirebase, staticServer, peerServer } from './servers.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const here = path.dirname(fileURLToPath(import.meta.url));
export const SHOTS = process.env.SHOTS || path.join(here, 'shots');

export async function setup({ dir = path.join(here, '..'), web = 8765, peer = 9000, fb = 9100 } = {}) {
  const servers = {
    web: await staticServer(path.resolve(dir), web),
    peer: await peerServer(peer),
    fb: await fakeFirebase(fb),
  };
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const uploads = new Map();
  const uploadLog = [];
  const config = {
    peer: { host: '127.0.0.1', port: peer, path: '/', secure: false, config: { iceServers: [] } },
    db: { url: `http://127.0.0.1:${fb}`, instance: '' },
    cloud: { cloudName: 'test', uploadPreset: 'test' },
    push: { publicKey: '', worker: '' },
  };
  const base = `http://127.0.0.1:${web}/`;

  async function client(name, opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 780 }, permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript((c) => { window.RAWAQ_CONFIG = c; }, opts.config || config);
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('https://api.cloudinary.com/**', async (route) => {
      const req = route.request();
      const buf = req.postDataBuffer() || Buffer.alloc(0);
      const ct = req.headers()['content-type'] || '';
      const boundary = (ct.match(/boundary=(.+)$/) || [])[1];
      let file = Buffer.alloc(0);
      let fname = 'f.bin';
      if (boundary) {
        const sep = Buffer.from('--' + boundary);
        let i = buf.indexOf(sep);
        while (i >= 0) {
          const next = buf.indexOf(sep, i + sep.length);
          if (next < 0) break;
          const part = buf.subarray(i + sep.length + 2, next - 2);
          const headEnd = part.indexOf('\r\n\r\n');
          const head = part.subarray(0, headEnd).toString();
          if (/name="file"/.test(head)) {
            file = Buffer.from(part.subarray(headEnd + 4));
            fname = (head.match(/filename="([^"]+)"/) || [])[1] || fname;
          }
          i = next;
        }
      }
      const id = Math.random().toString(36).slice(2, 12);
      const kind = /\/raw\//.test(req.url()) ? 'raw' : /\.(jpe?g|png|gif|webp)$/i.test(fname) ? 'image' : 'video';
      const url = `https://res.cloudinary.com/test/${kind}/upload/v1/${id}${path.extname(fname) || '.bin'}`;
      uploads.set(url, file);
      uploadLog.push({ endpoint: req.url(), url, size: file.length, head: file.subarray(0, 16) });
      await route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ secure_url: url, width: 800, height: 600, duration: 0, bytes: file.length }) });
    });
    await ctx.route('https://res.cloudinary.com/**', async (route) => {
      const u = route.request().url().replace(/\/upload\/[^/]*?(c_|so_|q_|w_)[^/]*\//, '/upload/');
      const body = uploads.get(u) || uploads.get(route.request().url());
      if (!body) return route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'nf' });
      await route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/octet-stream', body });
    });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => { page.errors.push(e.message); console.log(`[${name}] PAGEERROR`, e.message); });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${name}] console.${m.type()}:`, m.text().slice(0, 300)); });
    await page.goto(base + (opts.hash || ''), { waitUntil: 'load' });
    return { name, ctx, page };
  }

  async function signup(c, displayName) {
    const { page } = c;
    await page.waitForSelector('#in-name', { state: 'visible' });
    await page.fill('#in-name', displayName);
    await page.click('#f-welcome button[type=submit]');
    await page.waitForSelector('#v-id.on');
    const id = (await page.textContent('#id-code')).replace(/\s+/g, '');
    await page.click('#btn-enter');
    await page.waitForSelector('#v-main.on');
    c.id = id;
    return id;
  }

  async function startChat(c, peerId) {
    const { page } = c;
    await page.click('#btn-new');
    await page.fill('#in-peer', peerId);
    await page.click('#f-new button[type=submit]');
    await page.waitForSelector('#chat-pane:not([hidden])');
  }

  async function openChat(c, peerId) {
    const { page } = c;
    const item = page.locator(`#list [data-id="${peerId}"]`);
    await item.click();
    await page.waitForSelector('#chat-pane:not([hidden])');
  }

  async function sendText(c, text) {
    await c.page.fill('#input', text);
    await c.page.click('#send');
  }

  async function close() {
    await browser.close();
    servers.web.close();
    servers.peer.close();
    servers.fb.close();
  }

  return { browser, servers, client, signup, startChat, openChat, sendText, close, uploads, uploadLog, config, base };
}

export function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log('  ok -', msg);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, ms = 15000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (_) { }
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what);
    await sleep(150);
  }
}
