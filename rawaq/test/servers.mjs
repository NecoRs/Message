import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ExpressPeerServer } from 'peer';
import express from 'express';

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let lastPush = 0;
let lastRand = [];
function pushId() {
  let now = Date.now();
  const dup = now === lastPush;
  lastPush = now;
  const ts = new Array(8);
  for (let i = 7; i >= 0; i--) { ts[i] = PUSH_CHARS.charAt(now % 64); now = Math.floor(now / 64); }
  let id = ts.join('');
  if (!dup) lastRand = Array.from({ length: 12 }, () => Math.floor(Math.random() * 64));
  else {
    let i = 11;
    for (; i >= 0 && lastRand[i] === 63; i--) lastRand[i] = 0;
    lastRand[i]++;
  }
  for (let i = 0; i < 12; i++) id += PUSH_CHARS.charAt(lastRand[i]);
  return id;
}

export function fakeFirebase(port) {
  const tree = { keys: {}, inbox: {}, push: {} };
  const log = [];
  const streams = new Map();
  const emit = (inboxId, evPath, data) => {
    for (const res of streams.get(inboxId) || []) res.write(`event: put\ndata: ${JSON.stringify({ path: evPath, data })}\n\n`);
  };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,PATCH,OPTIONS', 'Access-Control-Allow-Headers': '*' };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const url = new URL(req.url, 'http://x');
    const parts = decodeURIComponent(url.pathname).replace(/\.json$/, '').split('/').filter(Boolean);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const deny = () => send(401, { error: 'Permission denied' });
      let val;
      try { val = body ? JSON.parse(body) : undefined; } catch (_) { send(400, { error: 'bad json' }); return; }
      log.push({ method: req.method, path: parts.join('/'), body });
      const [root, id, key] = parts;
      if (req.method === 'GET' && (req.headers.accept || '').includes('text/event-stream')) {
        if (root !== 'inbox' || !id || key) return deny();
        res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: tree.inbox[id] && Object.keys(tree.inbox[id]).length ? tree.inbox[id] : null })}\n\n`);
        if (!streams.has(id)) streams.set(id, new Set());
        streams.get(id).add(res);
        const ka = setInterval(() => res.write('event: keep-alive\ndata: null\n\n'), 15000);
        req.on('close', () => { clearInterval(ka); streams.get(id).delete(res); });
        return;
      }
      if (root === 'keys') {
        if (!id || key) return deny();
        if (req.method === 'GET') return send(200, tree.keys[id] ?? null);
        if (req.method === 'PUT') {
          if (tree.keys[id] !== undefined) return deny();
          if (typeof val !== 'string' || val.length >= 200) return deny();
          tree.keys[id] = val;
          return send(200, val);
        }
        return deny();
      }
      if (root === 'inbox') {
        if (!id) return deny();
        if (req.method === 'GET') return send(200, key ? (tree.inbox[id] || {})[key] ?? null : tree.inbox[id] ?? null);
        if (req.method === 'POST' && !key) {
          if (!val || typeof val !== 'object' || !['f', 'iv', 'c', 't'].every((k) => k in val) || typeof val.c !== 'string' || val.c.length >= 600000) return deny();
          const k = pushId();
          (tree.inbox[id] ||= {})[k] = val;
          emit(id, '/' + k, val);
          return send(200, { name: k });
        }
        if (req.method === 'DELETE' && key) {
          if (tree.inbox[id]) delete tree.inbox[id][key];
          emit(id, '/' + key, null);
          return send(200, null);
        }
        return deny();
      }
      if (root === 'push') {
        if (!id) return deny();
        if (req.method === 'GET') return send(200, tree.push[id] ?? null);
        if (req.method === 'PUT') { tree.push[id] = val; return send(200, val); }
        if (req.method === 'DELETE') { delete tree.push[id]; return send(200, null); }
      }
      deny();
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, tree, log, close: () => { for (const s of streams.values()) for (const r of s) r.end(); server.close(); } })));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
export function staticServer(dir, port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(dir, p);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, close: () => server.close() })));
}

export function peerServer(port) {
  const app = express();
  const server = http.createServer(app);
  app.use('/', ExpressPeerServer(server, { path: '/' }));
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ close: () => { server.closeAllConnections?.(); server.close(); } })));
}
