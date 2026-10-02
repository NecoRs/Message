/*
 * رواق — Rawaq
 * Private, peer-to-peer messaging. Each person gets a short ID; messages travel
 * directly between browsers over an encrypted WebRTC data channel (PeerJS),
 * and are stored only on the two devices.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- config

  const CFG = Object.assign({
    prefix: 'rawaq-',      // namespace on the shared PeerJS signalling server
    peer: {},              // extra PeerJS options (host, port, path, secure, config…)
    dialTimeout: 12000,    // give up on a connection attempt after this long
    probeEvery: 30000,     // how often to check whether contacts came online
    mediaHosts: ['https://res.cloudinary.com/'], // only media links from these are shown
    verified: ['QXYWNW'],  // IDs that get the verified badge
    db: { url: '' },       // Firebase Realtime Database URL: offline delivery mailbox
    push: { publicKey: '', worker: '' }, // Web Push: VAPID public key + Cloudflare Worker URL
  }, window.RAWAQ_CONFIG || {});
  CFG.cloud = Object.assign({ cloudName: '', uploadPreset: '', uploadUrl: '' }, CFG.cloud || {});
  const MAX_VIDEO = 100 * 1024 * 1024; // Cloudinary free plan limit
  const MAX_IMAGE = 10 * 1024 * 1024;

  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
  const ID_LEN = 6;
  const MAX_TEXT = 2000;
  const MAX_NAME = 30;
  const KEEP = 800;          // messages kept per conversation
  const GROUP_GAP = 3 * 60 * 1000;

  // ---------------------------------------------------------------- utils

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function rand(n, abc = 'abcdefghijklmnopqrstuvwxyz0123456789') {
    const a = new Uint32Array(n);
    crypto.getRandomValues(a);
    let s = '';
    for (const x of a) s += abc[x % abc.length];
    return s;
  }
  const TAB = rand(10);
  const genId = () => rand(ID_LEN, ALPHABET);
  const msgId = () => Date.now().toString(36) + rand(8);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const SVG = {
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    checks: '<path d="m1.5 12.5 4.5 4.5 9.5-9.5"/><path d="m11.5 16.5.5.5 9.5-9.5"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 1.5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h2"/>',
    msg: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/>',
    reply: '<path d="M10 8 5 12l5 4"/><path d="M5 12h9a5 5 0 0 1 5 5v1"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5Z"/>',
    play: '<path d="M8 5.5v13l11-6.5Z" fill="currentColor"/>',
    retry: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4.5 17.5 5-5 4 4 2.5-2.5 3.5 3.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  };
  const REACTS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
  const svg = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${SVG[name]}</svg>`;

  // Strip control and bidi-override characters (they can spoof how a name reads).
  const CTRL = /[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g;
  function cleanName(s) {
    return String(s || '').replace(CTRL, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  }
  function cleanText(s) {
    return String(s || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').slice(0, MAX_TEXT);
  }

  function normalizeId(raw) {
    let s = String(raw || '');
    const m = /to=([A-Za-z0-9-]+)/.exec(s);
    if (m) s = m[1];
    s = s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    s = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.startsWith('RAWAQ')) s = s.slice(5);
    return s;
  }
  const isValidId = (s) => s.length === ID_LEN && [...s].every((c) => ALPHABET.includes(c));
  const idFromPeer = (pid) => {
    if (typeof pid !== 'string' || !pid.startsWith(CFG.prefix)) return null;
    const id = pid.slice(CFG.prefix.length);
    return isValidId(id) ? id : null;
  };

  const firstLetter = (s) => (Array.from(String(s || '').trim())[0] || '').toUpperCase();
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const mqMobile = matchMedia('(max-width: 899px)');
  const mqDark = matchMedia('(prefers-color-scheme: dark)');

  // Direction of the first strong character, so the timestamp sits at the line end.
  function isRtl(text) {
    const m = /[֐-ࣿיִ-﷿ﹰ-﻿]|[A-Za-zÀ-ɏͰ-ԯ]/.exec(text);
    return !m || /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(m[0]);
  }
  function isJumbo(text) {
    const t = text.replace(/\s/g, '');
    if (!t || t.length > 16) return false;
    try {
      return /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️)+$/u.test(t) &&
        Array.from(t).filter((c) => /\p{Extended_Pictographic}/u.test(c)).length <= 3;
    } catch (_) { return false; }
  }

  // ---------------------------------------------------------------- time

  const LOCALE = 'ar-u-nu-latn';
  const fTime = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
  const fDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' });
  const fDayY = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
  const fWeekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
  const fShort = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'numeric' });

  const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const daysAgo = (ts) => Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 864e5);

  function dayLabel(ts) {
    const n = daysAgo(ts);
    if (n <= 0) return 'اليوم';
    if (n === 1) return 'أمس';
    if (n < 7) return fWeekday.format(ts);
    return new Date(ts).getFullYear() === new Date().getFullYear() ? fDay.format(ts) : fDayY.format(ts);
  }
  function listTime(ts) {
    const n = daysAgo(ts);
    if (n <= 0) return fTime.format(ts);
    if (n === 1) return 'أمس';
    if (n < 7) return fWeekday.format(ts);
    return fShort.format(ts);
  }
  function lastSeen(ts) {
    const n = daysAgo(ts);
    if (n <= 0) return 'آخر ظهور اليوم ' + fTime.format(ts);
    if (n === 1) return 'آخر ظهور أمس ' + fTime.format(ts);
    return 'آخر ظهور ' + dayLabel(ts);
  }

  // ---------------------------------------------------------------- storage

  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('rawaq.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('rawaq.' + k, JSON.stringify(v)); } catch (e) { console.warn('rawaq: save failed', e); }
    },
    del(k) { try { localStorage.removeItem('rawaq.' + k); } catch (_) { /* ignore */ } },
    clear() {
      try { Object.keys(localStorage).filter((k) => k.startsWith('rawaq.')).forEach((k) => localStorage.removeItem(k)); } catch (_) { /* ignore */ }
    },
  };

  const S = {
    me: store.get('profile', null),
    contacts: store.get('contacts', {}) || {},
    msgs: Object.create(null),
    drafts: Object.create(null),
    active: null,
    net: 'idle',
    theme: store.get('theme', 'auto'),
    sound: store.get('sound', true) !== false,
    reply: null,         // { id, text, me } quoted in the next message
    blocked: store.get('blocked', {}) || {},
    query: '',
    presence: new Map(), // id -> online | connecting | offline | unreachable
    typing: new Map(),   // id -> timer
  };
  if (S.me && (!isValidId(S.me.id) || !cleanName(S.me.name))) S.me = null;

  function msgsOf(id) {
    if (!S.msgs[id]) {
      const list = store.get('m.' + id, []);
      S.msgs[id] = Array.isArray(list) ? list : [];
      // an upload can't survive a reload: the file is gone
      for (const m of S.msgs[id]) if (m.st === 'uploading') m.st = 'failed';
    }
    return S.msgs[id];
  }

  const dirty = new Set();
  let saveTimer = 0;
  function queueSave(key) {
    dirty.add(key);
    if (!saveTimer) saveTimer = setTimeout(flushSave, 250);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    for (const k of dirty) {
      if (k === 'contacts') store.set('contacts', S.contacts);
      else if (S.msgs[k]) store.set('m.' + k, S.msgs[k]);
    }
    dirty.clear();
  }
  const saveContacts = () => queueSave('contacts');
  const saveMsgs = (id) => queueSave(id);

  function ensureContact(id) {
    let c = S.contacts[id];
    if (!c) {
      c = S.contacts[id] = { id, name: heardNames.get(id) || '', unread: 0, last: null, updated: Date.now(), seen: 0 };
      saveContacts();
      renderList();
      if (heardPh.get(id)) post(id, { t: 'avatar?' });
    }
    return c;
  }
  const heardNames = new Map(); // id -> name announced over an open link
  const heardPh = new Map();    // id -> profile photo hash announced over an open link
  const isBlocked = (id) => !!S.blocked[id];
  const nameOf = (c) => (c && c.name) || (c && c.id) || '';

  // ---------------------------------------------------------------- network

  let peer = null;
  let stopped = true;
  let retry = 0;
  let retryTimer = 0;
  const conns = new Map();   // id -> Set<DataConnection> (open)
  const dialing = new Map(); // id -> { conn, timer }

  const NET_TEXT = {
    idle: 'جارٍ التشغيل…',
    connecting: 'جارٍ الاتصال…',
    online: 'متصل',
    offline: 'لا يوجد إنترنت',
    taken: 'مفتوح في مكان آخر — اضغط للمحاولة',
    error: 'تعذّر الاتصال — اضغط للمحاولة',
    unsupported: 'المتصفح لا يدعم الاتصال المباشر',
  };

  function setNet(state) {
    if (S.net === state) return;
    S.net = state;
    $('#net').dataset.state = state;
    $('#net-text').textContent = NET_TEXT[state] || '';
    if (S.active) { renderChatHead(); renderBanner(); }
  }

  function netStart() {
    if (!S.me || !owner) return;
    if (!window.Peer) { setNet('error'); return; }
    netStop();
    stopped = false;
    setNet(navigator.onLine === false ? 'offline' : 'connecting');

    mbStart();
    const p = new window.Peer(CFG.prefix + S.me.id, Object.assign({ debug: 0 }, CFG.peer));
    peer = p;

    p.on('open', () => {
      if (peer !== p) return;
      retry = 0;
      setNet('online');
      probeAll();
    });
    p.on('connection', (conn) => {
      if (peer !== p) return;
      const pid = idFromPeer(conn.peer);
      if (!pid || isBlocked(pid)) { try { conn.close(); } catch (_) { /* ignore */ } return; }
      adopt(conn);
    });
    p.on('disconnected', () => {
      if (peer !== p || stopped) return;
      setNet(navigator.onLine === false ? 'offline' : 'connecting');
      scheduleReconnect();
    });
    p.on('close', () => {
      if (peer !== p || stopped) return;
      scheduleReconnect();
    });
    p.on('error', (err) => onPeerError(p, err));
  }

  function netStop() {
    mbStop();
    stopped = true;
    clearTimeout(retryTimer);
    retryTimer = 0;
    for (const d of dialing.values()) clearTimeout(d.timer);
    dialing.clear();
    const p = peer;
    peer = null;
    conns.clear();
    S.presence.clear();
    if (p) { try { p.destroy(); } catch (_) { /* ignore */ } }
  }

  function halt(state) {
    stopped = true;
    clearTimeout(retryTimer);
    retryTimer = 0;
    setNet(state);
  }

  function scheduleReconnect() {
    if (retryTimer || stopped) return;
    const delay = Math.min(30000, 1000 * 2 ** retry) + Math.random() * 600;
    retry++;
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      if (!stopped) reconnectNow(false);
    }, delay);
  }

  function reconnectNow(resetBackoff) {
    if (!owner || !S.me) return;
    if (resetBackoff) { retry = 0; clearTimeout(retryTimer); retryTimer = 0; }
    if (navigator.onLine === false) { setNet('offline'); return; }
    if (!peer || peer.destroyed) { netStart(); return; }
    if (peer.disconnected) {
      setNet('connecting');
      try { peer.reconnect(); } catch (_) { netStart(); }
      return;
    }
    if (peer.open) probeAll();
  }

  function onPeerError(p, err) {
    if (peer !== p) return;
    const type = err && err.type;
    if (type === 'peer-unavailable') {
      const m = /peer\s+(\S+)/i.exec((err && err.message) || '');
      const id = m && idFromPeer(m[1]);
      if (id) dialFailed(id, 'offline');
      return;
    }
    if (type === 'webrtc') return; // per-connection; dial timeouts cover it
    if (type === 'browser-incompatible') { halt('unsupported'); return; }
    if (type === 'unavailable-id') {
      // Usually the server still holds our previous session for a moment.
      if (retry >= 5) { halt('taken'); return; }
      setNet('connecting');
      scheduleReconnect();
      return;
    }
    if (type === 'invalid-id' || type === 'invalid-key' || type === 'ssl-unavailable') { halt('error'); return; }
    // network, server-error, socket-error, socket-closed, disconnected
    setNet(navigator.onLine === false ? 'offline' : 'connecting');
    scheduleReconnect();
  }

  const isOpen = (id) => !!(conns.get(id) && conns.get(id).size);

  function dial(id) {
    if (!peer || !peer.open || peer.disconnected || !S.me) return;
    if (id === S.me.id || isOpen(id) || dialing.has(id) || isBlocked(id)) return;
    let conn;
    try {
      conn = peer.connect(CFG.prefix + id, { reliable: true, serialization: 'json' });
    } catch (_) { return; }
    if (!conn) return;
    if (!S.presence.has(id)) setPresence(id, 'connecting');
    const timer = setTimeout(() => dialFailed(id, 'unreachable'), CFG.dialTimeout);
    dialing.set(id, { conn, timer });
    adopt(conn);
  }

  function dialFailed(id, why) {
    const d = dialing.get(id);
    if (d) {
      clearTimeout(d.timer);
      dialing.delete(id);
      try { d.conn.close(); } catch (_) { /* ignore */ }
    }
    if (!isOpen(id)) setPresence(id, why);
  }

  function adopt(conn) {
    const id = idFromPeer(conn.peer);
    if (!id) return;
    conn.on('open', () => {
      const d = dialing.get(id);
      if (d && d.conn === conn) { clearTimeout(d.timer); dialing.delete(id); }
      if (!conns.has(id)) conns.set(id, new Set());
      conns.get(id).add(conn);
      conn._heard = Date.now();
      send(conn, helloMsg());
      setPresence(id, 'online');
      flushOutbox(id);
      flushUnsend(id);
      flushReceipts(id);
    });
    conn.on('data', (data) => {
      conn._heard = Date.now();
      // the other side is closing: drop the link now so new messages use the mailbox
      if (data && data.t === 'bye') { try { conn.close(); } catch (_) { /* ignore */ } drop(); return; }
      onData(id, data);
    });
    const drop = () => {
      const set = conns.get(id);
      if (!set || !set.delete(conn)) return;
      if (!set.size) {
        conns.delete(id);
        setTyping(id, false);
        setPresence(id, 'offline');
      }
    };
    conn.on('close', drop);
    conn.on('error', (err) => {
      // an oversized message is rejected by PeerJS but the link itself is fine
      if (err && err.type === 'message-too-big') return;
      try { conn.close(); } catch (_) { /* ignore */ }
      drop();
    });
  }

  // PeerJS's JSON channel refuses frames of ~16KB or more (and would report an error),
  // so anything bigger must be split by the caller, like profile photos are.
  const MAX_FRAME = 15000;
  const utf8 = new TextEncoder();
  function send(conn, obj) {
    try {
      if (utf8.encode(JSON.stringify(obj)).byteLength >= MAX_FRAME) return false;
      conn.send(obj);
      return true;
    } catch (_) { return false; }
  }
  function sendTo(id, obj) {
    const set = conns.get(id);
    if (!set) return false;
    for (const c of set) if (c.open && send(c, obj)) return true;
    return false;
  }

  function probeAll() {
    if (!peer || !peer.open || document.visibilityState === 'hidden') return;
    const ids = Object.keys(S.contacts).filter((id) => !isOpen(id) && !dialing.has(id) && !isBlocked(id));
    ids.forEach((id, i) => setTimeout(() => dial(id), i * 180));
  }

  // keep-alive: notice silently dead links, and look for contacts coming online
  setInterval(() => {
    const now = Date.now();
    for (const set of conns.values()) {
      for (const c of set) {
        if (now - (c._heard || now) > 45000) { try { c.close(); } catch (_) { /* ignore */ } } else send(c, { t: 'ping' });
      }
    }
  }, 15000);
  setInterval(probeAll, CFG.probeEvery);
  setInterval(() => retryMailbox(), CFG.probeEvery);

  function setPresence(id, p) {
    const prev = S.presence.get(id);
    if (prev === p) return;
    S.presence.set(id, p);
    const c = S.contacts[id];
    if (c && (prev === 'online' || p === 'online')) { c.seen = Date.now(); saveContacts(); }
    renderList();
    if (S.active === id) { renderChatHead(); renderBanner(); }
  }

  // ---------------------------------------------------------------- offline mailbox

  // When there is no direct link, messages are end-to-end encrypted (ECDH P-256 +
  // AES-GCM) and dropped into the recipient's inbox on a Firebase Realtime Database.
  // The recipient streams its inbox, decrypts, handles each item exactly like a
  // direct message, then deletes it. The server only ever sees ciphertext.
  // Either an explicit URL, or just the instance name: the URL differs by region, so
  // try each Realtime Database region and remember the one that answers.
  const DB_HOSTS = ['firebaseio.com', 'europe-west1.firebasedatabase.app', 'asia-southeast1.firebasedatabase.app'];
  const dbCandidates = () => {
    const c = CFG.db || {};
    if (typeof c.url === 'string' && c.url.trim()) return [c.url.trim().replace(/\/+$/, '')];
    const inst = typeof c.instance === 'string' ? c.instance.trim() : '';
    if (!/^[a-z0-9-]{3,63}$/.test(inst)) return [];
    return DB_HOSTS.map((h) => `https://${inst}.${h}`);
  };
  let DB = dbCandidates().length === 1 ? dbCandidates()[0] : '';
  let dbResolving = null;
  function resolveDb() {
    if (DB) return Promise.resolve(DB);
    const cands = dbCandidates();
    if (!cands.length) return Promise.resolve('');
    const cached = store.get('dbUrl', '');
    if (cached && cands.includes(cached)) { DB = cached; return Promise.resolve(DB); }
    if (!dbResolving) {
      dbResolving = (async () => {
        for (const u of cands) {
          try {
            const r = await fetch(`${u}/keys.json?shallow=true`, { cache: 'no-store' });
            if (r.ok) { store.set('dbUrl', u); DB = u; break; }
          } catch (_) { /* wrong region or offline: try the next */ }
        }
        dbResolving = null;
        return DB;
      })();
    }
    return dbResolving;
  }
  let myKeys = null;              // { priv: CryptoKey, pub: base64 raw public key }
  let es = null;                  // EventSource on our inbox
  let published = false;
  const pubCache = new Map();     // id -> base64 public key
  const aesCache = new Map();     // id -> AES-GCM CryptoKey shared with that id
  const mbReady = () => !!(DB && myKeys && S.me && owner && window.crypto && crypto.subtle);

  const b64 = (u8) => { let s2 = ''; for (let i = 0; i < u8.length; i += 0x8000) s2 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s2); };
  const unb64 = (str) => Uint8Array.from(atob(str), (ch) => ch.charCodeAt(0));
  const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

  async function loadKeys() {
    if (myKeys || !window.crypto || !crypto.subtle) return myKeys;
    const saved = store.get('keys', null);
    try {
      if (saved && saved.priv && saved.pub) {
        myKeys = { priv: await crypto.subtle.importKey('jwk', saved.priv, ECDH, false, ['deriveKey']), pub: saved.pub };
        return myKeys;
      }
    } catch (_) { /* regenerate below */ }
    const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
    const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const pub = b64(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
    store.set('keys', { priv: privJwk, pub });
    myKeys = { priv: await crypto.subtle.importKey('jwk', privJwk, ECDH, false, ['deriveKey']), pub };
    return myKeys;
  }

  async function db(method, path, body) {
    const res = await fetch(`${DB}/${path}.json`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body), // no JSON header: keeps POST a simple CORS request
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`db ${res.status}`);
    return res.json();
  }

  async function publishKey() {
    if (published || !mbReady()) return;
    try {
      const cur = await db('GET', `keys/${S.me.id}`);
      if (cur == null) await db('PUT', `keys/${S.me.id}`, myKeys.pub);
      else if (cur !== myKeys.pub) console.warn('rawaq: a different key is registered for this ID');
      published = true;
    } catch (_) { /* retried on the next start */ }
  }

  async function sharedKey(id) {
    if (aesCache.has(id)) return aesCache.get(id);
    let pub = pubCache.get(id);
    if (!pub) {
      const v = await db('GET', `keys/${id}`);
      if (typeof v !== 'string' || v.length > 200) return null; // they haven't opened Rawaq since the mailbox existed
      pub = v;
      pubCache.set(id, pub);
    }
    const theirs = await crypto.subtle.importKey('raw', unb64(pub), ECDH, false, []);
    const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: theirs }, myKeys.priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    aesCache.set(id, key);
    return key;
  }

  async function mailboxSend(to, obj) {
    if (!mbReady() || !isValidId(to) || isBlocked(to)) return false;
    try {
      const key = await sharedKey(to);
      if (!key) return false;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const payload = { n: S.me.name, ph: S.me.photo ? hashStr(S.me.photo) : '', d: obj };
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(`${S.me.id}>${to}`) }, key, utf8.encode(JSON.stringify(payload)));
      await db('POST', `inbox/${to}`, { f: S.me.id, iv: b64(iv), c: b64(new Uint8Array(ct)), t: Date.now() });
      return true;
    } catch (_) {
      return false;
    }
  }

  const mbBusy = new Set(); // message ids with a mailbox drop in flight

  // Direct link if there is one, otherwise the mailbox.
  async function post(id, obj) {
    if (isOpen(id) && sendTo(id, obj)) return true;
    return mailboxSend(id, obj);
  }

  // A new or retried message: direct when linked; otherwise mailbox now, link later.
  function dispatch(id, m) {
    if (isOpen(id) && sendTo(id, wireMsg(m))) {
      // a link can look open while the other side has just gone away: if no
      // delivery receipt comes back soon, drop a copy in the mailbox as well
      if (mbReady()) setTimeout(() => { if (m.st === 'pending' && !isBlocked(id) && msgsOf(id).includes(m)) mailboxDrop(id, m); }, 4000);
      return;
    }
    dial(id);
    mailboxDrop(id, m);
  }

  function mailboxDrop(id, m) {
    if (mbBusy.has(m.id)) return;
    mbBusy.add(m.id);
    mailboxSend(id, wireMsg(m)).then((ok) => {
      mbBusy.delete(m.id);
      if (!ok) return;
      pingPush(id);
      if (m.st !== 'pending') return;
      m.st = 'sent';
      saveMsgs(id);
      if (S.active === id) updateTick(m);
    });
  }

  // Wake the recipient's phone (installed app) through the push worker.
  // At most once per 15s per person; the notification carries no message text.
  const pushPinged = new Map();
  function pingPush(to) {
    const url = CFG.push && CFG.push.worker;
    if (!url || !isValidId(to)) return;
    const now = Date.now();
    if (now - (pushPinged.get(to) || 0) < 15000) return;
    pushPinged.set(to, now);
    fetch(url, { method: 'POST', body: JSON.stringify({ to }), keepalive: true }).catch(() => {});
  }

  // pending messages whose mailbox drop failed (offline, recipient had no key yet, …)
  function retryMailbox() {
    if (!mbReady() || document.visibilityState === 'hidden') return;
    for (const id of Object.keys(S.contacts)) {
      if (isOpen(id) || isBlocked(id)) continue;
      for (const m of msgsOf(id)) if (m.me && m.st === 'pending') dispatch(id, m);
    }
  }

  let inboxChain = Promise.resolve();
  const handledKeys = new Set();
  async function handleEnvelope(key, v) {
    if (handledKeys.has(key)) return;
    handledKeys.add(key);
    const drop = () => db('DELETE', `inbox/${S.me.id}/${encodeURIComponent(key)}`).catch(() => {});
    if (!v || typeof v !== 'object' || typeof v.f !== 'string' || typeof v.c !== 'string' || typeof v.iv !== 'string') return drop();
    const from = v.f;
    if (!isValidId(from) || from === S.me.id || isBlocked(from) || v.c.length > 600000) return drop();
    let payload = null;
    for (let attempt = 0; attempt < 2 && !payload; attempt++) {
      try {
        const k = await sharedKey(from);
        if (!k) break;
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv), additionalData: utf8.encode(`${from}>${S.me.id}`) }, k, unb64(v.c));
        payload = JSON.parse(new TextDecoder().decode(pt));
      } catch (_) {
        aesCache.delete(from); // their key may have changed: refetch once
        pubCache.delete(from);
      }
    }
    if (payload && typeof payload === 'object' && payload.d && typeof payload.d === 'object') {
      const name = cleanName(payload.n);
      if (name) heardNames.set(from, name);
      const ph = typeof payload.ph === 'string' ? payload.ph.slice(0, 16) : '';
      heardPh.set(from, ph);
      const c = S.contacts[from];
      if (c) {
        if (name && name !== c.name) { c.name = name; saveContacts(); refreshContact(from); }
        if (ph && c.ph !== ph && payload.d.t !== 'avatar') post(from, { t: 'avatar?' });
      }
      try { onData(from, payload.d); } catch (e) { console.warn('rawaq: inbox item failed', e); }
    }
    return drop();
  }

  function onInboxEvent(ev) {
    let d;
    try { d = JSON.parse(ev.data); } catch (_) { return; }
    if (!d || typeof d.path !== 'string') return;
    const parts = d.path.split('/').filter(Boolean);
    let items = [];
    if (parts.length === 0 && d.data && typeof d.data === 'object') items = Object.entries(d.data);
    else if (parts.length === 1 && d.data) items = [[parts[0], d.data]];
    items.sort((a, b) => (a[0] < b[0] ? -1 : 1)); // push keys are chronological
    for (const [k, v] of items) inboxChain = inboxChain.then(() => handleEnvelope(k, v));
  }

  async function mbStart() {
    if (es || !S.me || !owner) return;
    if (!(await resolveDb())) return;
    try { await loadKeys(); } catch (_) { return; }
    if (!mbReady() || es) return;
    publishKey();
    es = new EventSource(`${DB}/inbox/${S.me.id}.json`);
    es.addEventListener('put', onInboxEvent);
    es.addEventListener('patch', (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch (_) { return; }
      if (!d || !d.data || typeof d.data !== 'object') return;
      for (const [k, v] of Object.entries(d.data).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (v) inboxChain = inboxChain.then(() => handleEnvelope(k, v));
      }
    });
    es.addEventListener('cancel', () => mbStop());
    for (const id of Object.keys(S.contacts)) flushReceipts(id);
    setTimeout(retryMailbox, 1500);
    ensurePush();
    renderNotifCard();
  }

  function mbStop() {
    if (es) { es.close(); es = null; }
  }

  // ---------------------------------------------------------------- protocol

  function helloMsg() {
    return { t: 'hello', name: S.me.name, v: 1, ph: S.me.photo ? hashStr(S.me.photo) : '' };
  }
  function broadcastHello() {
    for (const id of conns.keys()) if (!isBlocked(id)) sendTo(id, helloMsg());
  }

  function onData(id, d) {
    if (!d || typeof d !== 'object' || isBlocked(id)) return;
    switch (d.t) {
      case 'hello': {
        const name = cleanName(d.name);
        if (name) heardNames.set(id, name);
        const ph = typeof d.ph === 'string' ? d.ph.slice(0, 16) : '';
        heardPh.set(id, ph);
        const c = S.contacts[id];
        if (c && name && name !== c.name) {
          c.name = name;
          saveContacts();
          refreshContact(id);
        }
        if (c) {
          if (!ph && c.photo) { delete c.photo; delete c.ph; saveContacts(); refreshContact(id); }
          else if (ph && c.ph !== ph) post(id, { t: 'avatar?' });
        }
        break;
      }
      case 'avatar?':
        sendAvatar(id);
        break;
      case 'avatar':
        receiveAvatarPart(id, d);
        break;
      case 'msg': receive(id, d); break;
      case 'ack': if (typeof d.id === 'string') markMine(id, [d.id], 'delivered'); break;
      case 'read': if (Array.isArray(d.ids)) markMine(id, d.ids.slice(0, 2000), 'read'); break;
      case 'typing': setTyping(id, !!d.on); break;
      case 'react': onReact(id, d); break;
      case 'unsend': onUnsend(id, d); break;
      case 'unsent': case 'unsend-no': onUnsendReply(id, d); break;
      default: break; // ping / unknown
    }
  }

  function receive(id, d) {
    if (typeof d.id !== 'string' || d.id.length > 40) return;
    const text = cleanText(d.text).trim();
    const media = cleanMedia(d.media);
    if (!text && !media) return;
    post(id, { t: 'ack', id: d.id });

    const list = msgsOf(id);
    if (list.some((m) => m.id === d.id)) return; // duplicate after a retry

    const c = ensureContact(id);
    const ts = Number.isFinite(d.ts) && d.ts > 0 ? Math.min(d.ts, Date.now()) : Date.now();
    const m = { id: d.id, me: false, text, ts, seen: false, rr: false };
    if (media) m.media = media;
    const re = d.re;
    if (re && typeof re === 'object' && typeof re.id === 'string' && re.id.length <= 40 && typeof re.text === 'string') {
      // "by" is from the sender's side: 's' = they quoted themselves, 'r' = they quoted us
      m.re = { id: re.id, text: cleanText(re.text).slice(0, 160), me: re.by === 'r' };
    }
    list.push(m);
    trim(list);
    saveMsgs(id);
    setTyping(id, false);

    c.last = { text: mediaLabel(m).slice(0, 140), me: false, ts };
    c.updated = Date.now();
    if (isViewing(id)) {
      m.seen = true;
      flushReceipts(id);
    } else {
      c.unread = (c.unread || 0) + 1;
      notify(c, mediaLabel(m));
    }
    chime('in');
    saveContacts();
    if (S.active === id) appendMessage(m);
    renderList();
    updateTitle();
  }

  const RANK = { pending: 0, sent: 1, delivered: 2, read: 3 };
  function markMine(id, ids, status) {
    const list = msgsOf(id);
    const want = new Set(ids.filter((x) => typeof x === 'string'));
    let changed = false;
    for (const m of list) {
      if (m.me && want.has(m.id) && RANK[status] > RANK[m.st]) {
        m.st = status;
        changed = true;
        if (S.active === id) updateTick(m);
      }
    }
    if (changed) {
      saveMsgs(id);
      if (S.active === id) renderBanner();
    }
  }

  // Profile photos are sent in small parts and put back together on arrival.
  const AVATAR_PART = 8000;
  function sendAvatar(id) {
    const data = S.me && S.me.photo;
    if (!data) return;
    const ph = hashStr(data);
    if (!isOpen(id)) { mailboxSend(id, { t: 'avatar', ph, data }); return; } // the mailbox takes it whole
    const n = Math.ceil(data.length / AVATAR_PART);
    for (let i = 0; i < n; i++) {
      if (!sendTo(id, { t: 'avatar', ph, i, n, part: data.slice(i * AVATAR_PART, (i + 1) * AVATAR_PART) })) return;
    }
  }

  const avatarParts = new Map(); // id -> { ph, n, parts, got }
  function receiveAvatarPart(id, d) {
    const c = S.contacts[id];
    if (!c || typeof d.ph !== 'string' || d.ph.length > 16) return;
    let data = null;
    if (typeof d.data === 'string') {
      data = d.data; // single-frame form
    } else {
      const n = d.n;
      const i = d.i;
      if (!Number.isInteger(n) || n < 1 || n > 40 || !Number.isInteger(i) || i < 0 || i >= n) return;
      if (typeof d.part !== 'string' || d.part.length > AVATAR_PART) return;
      let a = avatarParts.get(id);
      if (!a || a.ph !== d.ph || a.n !== n) { a = { ph: d.ph, n, parts: new Array(n), got: 0 }; avatarParts.set(id, a); }
      if (a.parts[i] == null) { a.parts[i] = d.part; a.got++; }
      if (a.got < n) return;
      avatarParts.delete(id);
      data = a.parts.join('');
    }
    if (data.length > 300000 || !PHOTO_RE.test(data) || hashStr(data) !== d.ph) return;
    c.photo = data;
    c.ph = d.ph;
    saveContacts();
    refreshContact(id);
  }

  function wireMsg(m) {
    const o = { t: 'msg', id: m.id, text: m.text, ts: m.ts };
    if (m.re) o.re = { id: m.re.id, text: m.re.text, by: m.re.me ? 's' : 'r' };
    if (m.media) o.media = { kind: m.media.kind, url: m.media.url, w: m.media.w, h: m.media.h, dur: m.media.dur };
    return o;
  }

  function flushOutbox(id) {
    let changed = false;
    for (const m of msgsOf(id)) {
      if (m.me && (m.st === 'pending' || m.st === 'sent') && !sendTo(id, wireMsg(m))) break;
      if (m.rxp && sendTo(id, { t: 'react', id: m.id, e: (m.rx && m.rx.me) || '' })) { delete m.rxp; changed = true; }
    }
    if (changed) saveMsgs(id);
  }

  function findMsg(id, mid) {
    return msgsOf(id).find((m) => m.id === mid) || null;
  }

  function onReact(id, d) {
    if (typeof d.id !== 'string') return;
    const m = findMsg(id, d.id);
    if (!m) return;
    const e = REACTS.includes(d.e) ? d.e : '';
    m.rx = m.rx || {};
    if (e) m.rx.them = e; else delete m.rx.them;
    saveMsgs(id);
    if (S.active === id) refreshRow(m, true);
    if (e && m.me && !isViewing(id)) {
      const c = S.contacts[id];
      if (c && document.visibilityState === 'visible') toast(`تفاعل ${e} على رسالتك`, { title: nameOf(c), onClick: () => openChat(id) });
    }
  }

  function react(m, e) {
    const id = S.active;
    if (!id) return;
    m.rx = m.rx || {};
    const next = m.rx.me === e ? '' : e;
    if (next) m.rx.me = next; else delete m.rx.me;
    m.rxp = true;
    saveMsgs(id);
    refreshRow(m, true);
    post(id, { t: 'react', id: m.id, e: next }).then((ok) => { if (ok && m.rx && (m.rx.me || '') === next) { delete m.rxp; saveMsgs(id); } });
  }

  const receiptsBusy = new Set();
  async function flushReceipts(id) {
    if ((!isOpen(id) && !mbReady()) || receiptsBusy.has(id) || isBlocked(id)) return;
    const pend = msgsOf(id).filter((m) => !m.me && m.seen && !m.rr);
    if (!pend.length) return;
    receiptsBusy.add(id);
    try {
      for (let k = 0; k < pend.length; k += 200) {
        const batch = pend.slice(k, k + 200);
        if (!(await post(id, { t: 'read', ids: batch.map((m) => m.id) }))) break;
        batch.forEach((m) => { m.rr = true; });
        saveMsgs(id);
      }
    } finally { receiptsBusy.delete(id); }
  }

  function trim(list) {
    if (list.length > KEEP) list.splice(0, list.length - KEEP);
  }

  function sendMessage(text, re) {
    const id = S.active;
    if (!id || isBlocked(id)) return;
    const c = ensureContact(id);
    const m = { id: msgId(), me: true, text, ts: Date.now(), st: 'pending' };
    if (re) m.re = re;
    const list = msgsOf(id);
    list.push(m);
    trim(list);
    saveMsgs(id);
    c.last = { text: text.slice(0, 140), me: true, ts: m.ts };
    c.updated = Date.now();
    saveContacts();
    appendMessage(m, true);
    renderList();
    dispatch(id, m);
    renderBanner();
    chime('out');
  }

  function setTyping(id, on) {
    const prev = S.typing.get(id);
    if (prev) clearTimeout(prev);
    if (on) S.typing.set(id, setTimeout(() => setTyping(id, false), 6000));
    else S.typing.delete(id);
    if (!!prev === on) return; // nothing visible changed
    renderList();
    if (S.active === id) {
      renderChatHead();
      const row = $('#typing');
      const stick = nearBottom();
      row.classList.toggle('show', on);
      if (on && stick) setTimeout(() => scrollToBottom(true), 30);
    }
  }

  // ---------------------------------------------------------------- single tab

  // Only one tab may own the ID on the signalling server at a time.
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('rawaq') : null;
  let owner = !bc;
  function claimTab() {
    if (!bc) return Promise.resolve(true);
    return new Promise((resolve) => {
      let taken = false;
      const onMsg = (e) => { if (e.data && e.data.t === 'here') taken = true; };
      bc.addEventListener('message', onMsg);
      bc.postMessage({ t: 'who', tab: TAB });
      setTimeout(() => {
        bc.removeEventListener('message', onMsg);
        owner = !taken;
        resolve(owner);
      }, 320);
    });
  }
  if (bc) {
    bc.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.t === 'who' && owner) bc.postMessage({ t: 'here' });
      if (d.t === 'takeover' && d.tab !== TAB && owner) {
        owner = false;
        flushSave();
        netStop();
        closeModal(true);
        showView('blocked');
      }
    });
  }

  // ---------------------------------------------------------------- views

  function showView(name) {
    $$('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + name));
    document.body.dataset.view = name;
  }
  const currentView = () => document.body.dataset.view;

  function setAvatar(node, c) {
    const photo = c && c.photo && PHOTO_RE.test(c.photo) ? c.photo : '';
    node.dataset.letter = photo ? '' : c ? (c.name ? firstLetter(c.name) : '#') : '';
    node.style.backgroundImage = photo ? `url("${photo}")` : '';
    node.classList.toggle('has-photo', !!photo);
  }

  function renderMe() {
    if (!S.me) return;
    $$('[data-my-id]').forEach((n) => { n.textContent = S.me.id; });
    setAvatar($('#me-avatar'), S.me);
    setAvatar($('#p-avatar'), S.me);
    $('#p-avatar').classList.toggle('ink', !S.me.photo);
    $('#btn-photo-remove').hidden = !S.me.photo;
    $('#id-hello').textContent = S.me.name;
    setBadge($('#me-badge'), S.me.id);
  }

  function refreshContact(id) {
    renderList();
    if (S.active === id) {
      renderChatHead();
      const intro = $('.chat-intro .avatar', box);
      if (intro) setAvatar(intro, S.contacts[id]);
    }
  }

  function renderIdCode() {
    const box = $('#id-code');
    box.textContent = '';
    box.setAttribute('aria-label', 'معرّفك ' + S.me.id.split('').join(' '));
    [...S.me.id].forEach((ch, k) => {
      const s = el('span', null, ch);
      s.style.setProperty('--k', k);
      s.setAttribute('aria-hidden', 'true');
      box.appendChild(s);
    });
  }

  // ---------------------------------------------------------------- list

  let listQueued = false;
  const listNodes = new Map();
  function renderList() {
    if (listQueued) return;
    listQueued = true;
    requestAnimationFrame(() => { listQueued = false; drawList(); });
  }

  function drawList() {
    const ul = $('#list');
    const all = Object.values(S.contacts);
    const q = S.query;
    renderNotifCard();
    const items = all
      .filter((c) => !q || nameOf(c).toLowerCase().includes(q) || c.id.toLowerCase().includes(q) ||
        (c.last && c.last.text.toLowerCase().includes(q)))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    $('#list-empty').hidden = all.length > 0;
    $('#search-box').hidden = !all.length && !q;
    $('#search-empty').hidden = !(all.length && !items.length);
    ul.hidden = !items.length;

    const keep = new Set();
    let fresh = 0;
    items.forEach((c, idx) => {
      keep.add(c.id);
      let li = listNodes.get(c.id);
      if (!li) {
        li = buildItem(c.id);
        listNodes.set(c.id, li);
        li.classList.add('enter');
        li.style.setProperty('--k', Math.min(fresh++, 10));
        li.addEventListener('animationend', () => li.classList.remove('enter'), { once: true });
      }
      fillItem(li, c);
      if (ul.children[idx] !== li) ul.insertBefore(li, ul.children[idx] || null);
    });
    for (const [id, li] of listNodes) {
      if (!keep.has(id)) { li.remove(); listNodes.delete(id); }
    }
  }

  function buildItem(id) {
    const li = el('li');
    li.dataset.id = id;
    const b = el('button', 'item');
    b.type = 'button';
    const av = el('span', 'avatar');
    av.appendChild(el('i', 'dot'));
    const main = el('span', 'item-main');
    const top = el('span', 'item-top');
    const name = el('b', 'item-name');
    name.dir = 'auto';
    const time = el('span', 'item-time');
    top.append(name, el('span', 'vslot'), time);
    const bottom = el('span', 'item-bottom');
    const prev = el('span', 'item-preview');
    prev.dir = 'auto';
    bottom.append(prev);
    main.append(top, bottom);
    b.append(av, main);
    b.addEventListener('click', () => openChat(id));
    li.appendChild(b);
    return li;
  }

  function fillItem(li, c) {
    const b = li.firstChild;
    const av = $('.avatar', b);
    setAvatar(av, c);
    av.classList.toggle('online', S.presence.get(c.id) === 'online' && !isBlocked(c.id));
    $('.item-name', b).textContent = nameOf(c);
    setBadge($('.vslot', b), c.id);
    $('.item-time', b).textContent = c.last ? listTime(c.last.ts) : '';
    const prev = $('.item-preview', b);
    const typing = S.typing.has(c.id);
    prev.classList.toggle('typing', typing);
    prev.textContent = isBlocked(c.id) ? 'محظور'
      : typing ? 'يكتب…'
      : c.last ? (c.last.me ? 'أنت: ' : '') + c.last.text.replace(/\s+/g, ' ')
      : 'محادثة جديدة';
    b.classList.toggle('unread', c.unread > 0);
    b.classList.toggle('selected', S.active === c.id);
    let badge = $('.badge', b);
    if (c.unread > 0) {
      if (!badge) { badge = el('span', 'badge'); $('.item-bottom', b).appendChild(badge); }
      badge.textContent = c.unread > 99 ? '99+' : String(c.unread);
    } else if (badge) badge.remove();
    b.setAttribute('aria-label', nameOf(c) + (c.unread ? `، ${c.unread} رسائل جديدة` : ''));
  }

  function updateTitle() {
    const n = Object.values(S.contacts).reduce((s, c) => s + (c.unread || 0), 0);
    document.title = n ? `(${n}) رواق` : 'رواق';
    try {
      if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
      else if (!n && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    } catch (_) { /* ignore */ }
  }

  // ---------------------------------------------------------------- chat

  const scroller = $('#scroller');
  const box = $('#messages');
  const input = $('#input');
  let lastShown = null;
  let jumpCount = 0;
  let stick = true;

  const isViewing = (id) => S.active === id && document.visibilityState === 'visible' &&
    currentView() === 'main' && (!mqMobile.matches || $('#v-main').classList.contains('chat-open'));

  function openChat(id) {
    const c = S.contacts[id];
    if (!c) return;
    if (S.active && S.active !== id) leaveChat();
    const was = S.active;
    S.active = id;
    $('#chat-empty').hidden = true;
    $('#chat-pane').hidden = false;
    $('#v-main').classList.add('chat-open');
    if (!was && mqMobile.matches) history.pushState({ chat: id }, '');

    input.value = S.drafts[id] || '';
    autosize();
    updateSend();
    cancelReply();
    renderComposer();
    renderChatHead(true);
    const firstUnread = msgsOf(id).find((m) => !m.me && !m.seen);
    renderMessages(firstUnread && firstUnread.id);
    $('#typing').classList.toggle('show', S.typing.has(id));
    renderBanner();
    markSeen(id);
    renderList();
    if (!isOpen(id)) dial(id);
    if (!isTouch) setTimeout(() => input.focus({ preventScroll: true }), mqMobile.matches ? 420 : 0);
  }

  function leaveChat() {
    const id = S.active;
    if (!id) return;
    closeProfile(true);
    S.drafts[id] = input.value;
    stopTyping(id);
    cancelReply();
    closeCtx();
  }

  function closeChat(fromPop) {
    if (!S.active) return;
    leaveChat();
    S.active = null;
    $('#v-main').classList.remove('chat-open');
    input.blur();
    renderList();
    const done = () => {
      if (S.active) return;
      $('#chat-pane').hidden = true;
      $('#chat-empty').hidden = false;
    };
    if (mqMobile.matches) setTimeout(done, 560); else done();
    if (!fromPop && history.state && history.state.chat) history.back();
  }

  window.addEventListener('popstate', () => {
    if (S.active && mqMobile.matches) closeChat(true);
  });

  function markSeen(id) {
    if (!isViewing(id)) return;
    const c = S.contacts[id];
    let changed = false;
    for (const m of msgsOf(id)) if (!m.me && !m.seen) { m.seen = true; changed = true; }
    if (changed) saveMsgs(id);
    if (c && c.unread) { c.unread = 0; saveContacts(); renderList(); }
    updateTitle();
    flushReceipts(id);
  }

  let lastStatus = '';
  function renderChatHead(force) {
    const id = S.active;
    if (!id) return;
    const c = S.contacts[id];
    $('#c-name').textContent = nameOf(c);
    setBadge($('#c-badge'), id);
    const av = $('#c-avatar');
    setAvatar(av, c);
    av.classList.toggle('online', S.presence.get(id) === 'online' && !isBlocked(id));

    let text;
    let cls = '';
    const p = S.presence.get(id);
    if (isBlocked(id)) text = 'محظور';
    else if (S.typing.has(id)) { text = 'يكتب…'; cls = 'typing'; }
    else if (p === 'online') { text = 'متصل الآن'; cls = 'on'; }
    else if (S.net !== 'online') text = S.net === 'offline' ? 'لا يوجد إنترنت' : 'جارٍ الاتصال…';
    else if (p === 'connecting' || p == null) text = 'جارٍ التحقق…';
    else if (p === 'unreachable') text = 'تعذّر الوصول إليه الآن';
    else if (c && c.seen) text = lastSeen(c.seen);
    else text = 'غير متصل';

    const st = $('#c-status');
    const key = text + cls;
    if (key !== lastStatus || force) {
      st.textContent = text;
      st.className = 'status ' + cls;
      if (!force) { void st.offsetWidth; st.classList.add('swap'); }
      lastStatus = key;
    }
  }

  function renderBanner() {
    const id = S.active;
    const wrap = $('#banner-wrap');
    if (!id || isBlocked(id)) { wrap.classList.remove('show'); return; }
    const c = S.contacts[id];
    const p = S.presence.get(id);
    let text = '';
    if (S.net === 'offline') text = 'أنت غير متصل بالإنترنت. رسائلك محفوظة وبتنرسل أول ما يرجع الاتصال.';
    else if (!c.name && !msgsOf(id).length && p && p !== 'online' && p !== 'connecting') text = 'ما قدرنا نوصل لهذا المعرّف الحين. تأكد منه، أو اطلب من صاحبه يفتح رواق.';
    if (text) $('#banner-text').textContent = text;
    wrap.classList.toggle('show', !!text);
  }

  function renderMessages(unreadId, keepScroll) {
    const top = scroller.scrollTop;
    box.textContent = '';
    lastShown = null;
    const list = msgsOf(S.active);
    let sep = null;
    if (!list.length) {
      box.appendChild(introNode());
    } else {
      const frag = document.createDocumentFragment();
      for (const m of list) {
        const nodes = nodesFor(m, lastShown);
        if (unreadId && m.id === unreadId) {
          sep = el('div', 'unread-sep');
          sep.appendChild(el('span', null, 'رسائل جديدة'));
          nodes.splice(nodes.length - 1, 0, sep); // after the day label, before the message
        }
        nodes.forEach((n) => frag.appendChild(n));
        lastShown = m;
      }
      box.appendChild(frag);
    }
    hideJump();
    if (keepScroll) { scroller.scrollTop = top; return; }
    stick = !sep;
    requestAnimationFrame(() => {
      if (sep) {
        scroller.scrollTop = Math.max(0, sep.offsetTop - scroller.clientHeight * 0.3);
        stick = nearBottom();
      } else scrollToBottom(false);
    });
  }

  function introNode() {
    const c = S.contacts[S.active];
    const wrap = el('div', 'chat-intro');
    const av = el('span', 'avatar');
    setAvatar(av, c);
    wrap.appendChild(av);
    const title = el('b', null, c.name ? `ابدأ الحديث مع ${c.name}` : `المعرّف ${c.id}`);
    const slot = el('span', 'vslot');
    setBadge(slot, c.id);
    title.appendChild(slot);
    wrap.appendChild(title);
    wrap.appendChild(el('p', null, 'الرسائل تنتقل مباشرة ومشفّرة بين جهازيكما، ولا تُحفظ في أي خادم.'));
    return wrap;
  }

  function nodesFor(m, prev) {
    const out = [];
    const newDay = !prev || startOfDay(prev.ts) !== startOfDay(m.ts);
    if (newDay) out.push(el('div', 'day', dayLabel(m.ts)));
    const cont = !newDay && prev && prev.me === m.me && m.ts - prev.ts < GROUP_GAP;
    out.push(bubbleFor(m, cont));
    return out;
  }

  const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
  function linkify(p, text) {
    let at = 0;
    for (const match of text.matchAll(URL_RE)) {
      let url = match[0].replace(/[.,!?؟،؛:)\]}'"]+$/, '');
      if (match.index > at) p.appendChild(document.createTextNode(text.slice(at, match.index)));
      const a = el('a', null, url);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      p.appendChild(a);
      at = match.index + url.length;
    }
    if (at < text.length) p.appendChild(document.createTextNode(text.slice(at)));
  }

  function bubbleFor(m, cont) {
    const row = el('div', 'msg ' + (m.me ? 'me' : 'them') + (cont ? ' cont' : ''));
    row.dataset.id = m.id;
    if (!m.media && isJumbo(m.text)) row.classList.add('jumbo');
    const b = el('div', 'bubble');
    if (!isRtl(m.text)) b.classList.add('ltr');
    if (m.re) {
      const q = el('button', 'quote');
      q.type = 'button';
      q.dataset.ref = m.re.id;
      q.appendChild(el('b', null, m.re.me ? 'أنت' : nameOf(S.contacts[S.active])));
      const qt = el('span', null, m.re.text.replace(/\s+/g, ' '));
      qt.dir = 'auto';
      q.appendChild(qt);
      b.appendChild(q);
      row.classList.remove('jumbo');
    }
    if (m.media) {
      b.classList.add('has-media');
      if (!m.text) b.classList.add('media-only');
      b.appendChild(mediaNode(m));
    }
    if (m.text || !m.media) {
      const p = el('p', 'text');
      p.dir = 'auto';
      linkify(p, m.text);
      p.appendChild(el('span', 'meta-space'));
      b.appendChild(p);
    }
    const meta = el('span', 'meta');
    const t = el('time', null, fTime.format(m.ts));
    t.dateTime = new Date(m.ts).toISOString();
    meta.appendChild(t);
    if (m.me) {
      const tk = el('span', 'tick');
      setTick(tk, m.st);
      meta.appendChild(tk);
    }
    b.append(meta);
    const rx = reactionsOf(m);
    if (rx.length) {
      const pill = el('span', 'rx');
      pill.textContent = rx.join(' ');
      pill.setAttribute('aria-label', 'تفاعلات: ' + rx.join(' '));
      b.appendChild(pill);
      row.classList.add('has-rx');
    }
    const tools = el('div', 'msg-tools');
    tools.innerHTML = `<button type="button" data-tool="reply" aria-label="رد">${svg('reply')}</button>` +
      `<button type="button" data-tool="more" aria-label="خيارات">${svg('more')}</button>`;
    const swipe = el('span', 'swipe-hint');
    swipe.innerHTML = svg('reply');
    row.append(b, tools, swipe);
    return row;
  }

  function reactionsOf(m) {
    if (!m.rx) return [];
    const { me, them } = m.rx;
    if (me && them && me === them) return [me + ' 2'];
    return [them, me].filter(Boolean);
  }

  function refreshRow(m, pop) {
    const row = box.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`);
    if (!row) return;
    const fresh = bubbleFor(m, row.classList.contains('cont'));
    row.replaceWith(fresh);
    const pill = $('.rx', fresh);
    if (pop && pill) pill.classList.add('pop');
  }

  const TICK = {
    uploading: ['cloud', 'جارٍ الرفع'],
    failed: ['alert', 'فشل الرفع'],
    pending: ['clock', 'بانتظار الإرسال'],
    sent: ['check', 'أُرسلت'],
    delivered: ['checks', 'وصلت'],
    read: ['checks', 'قُرئت'],
  };
  function setTick(tk, st) {
    const [ic, label] = TICK[st] || TICK.pending;
    tk.innerHTML = svg(ic);
    tk.title = label;
    tk.setAttribute('aria-label', label);
    tk.classList.toggle('read', st === 'read');
    tk.classList.toggle('failed', st === 'failed');
  }
  function updateTick(m) {
    const row = box.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`);
    const tk = row && $('.tick', row);
    if (!tk) return;
    setTick(tk, m.st);
    tk.classList.remove('pop');
    void tk.offsetWidth;
    tk.classList.add('pop');
  }

  function appendMessage(m, mine) {
    const intro = $('.chat-intro', box);
    if (intro) intro.remove();
    const wasNear = nearBottom();
    nodesFor(m, lastShown).forEach((n) => {
      n.classList.add('enter');
      n.addEventListener('animationend', () => n.classList.remove('enter'), { once: true });
      box.appendChild(n);
    });
    lastShown = m;
    if (mine || wasNear) {
      requestAnimationFrame(() => scrollToBottom(true));
    } else {
      jumpCount++;
      showJump();
    }
  }

  function nearBottom() {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
  }
  function scrollToBottom(smooth) {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }
  function showJump() {
    $('#jump-n').textContent = jumpCount ? String(jumpCount) : '';
    $('#jump').classList.add('show');
  }
  function hideJump() {
    jumpCount = 0;
    $('#jump-n').textContent = '';
    $('#jump').classList.remove('show');
  }
  scroller.addEventListener('scroll', () => {
    stick = nearBottom();
    if (stick) hideJump();
    else if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 500) $('#jump').classList.add('show');
  }, { passive: true });
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => { if (stick && S.active) scrollToBottom(false); }).observe(scroller);
  }
  $('#jump').addEventListener('click', () => { scrollToBottom(true); hideJump(); });

  // ---------------------------------------------------------------- composer

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }
  function updateSend() {
    $('#send').disabled = !input.value.trim();
  }

  let typingAt = 0;
  let typingOff = 0;
  let typingFor = null;
  function typingPing() {
    const id = S.active;
    if (!id || !isOpen(id)) return;
    if (!input.value.trim()) { stopTyping(id); return; }
    const now = Date.now();
    if (now - typingAt > 2500) {
      sendTo(id, { t: 'typing', on: true });
      typingAt = now;
      typingFor = id;
    }
    clearTimeout(typingOff);
    typingOff = setTimeout(() => stopTyping(id), 3500);
  }
  function stopTyping(id) {
    clearTimeout(typingOff);
    if (typingFor && typingFor === id) sendTo(id, { t: 'typing', on: false });
    typingFor = null;
    typingAt = 0;
  }

  function submit() {
    const text = cleanText(input.value).replace(/^\s*\n+|\s+$/g, '');
    if (!text.trim() || !S.active) return;
    stopTyping(S.active);
    input.value = '';
    S.drafts[S.active] = '';
    autosize();
    updateSend();
    const sendBtn = $('#send');
    sendBtn.classList.remove('fly');
    void sendBtn.offsetWidth;
    sendBtn.classList.add('fly');
    const re = S.reply;
    cancelReply();
    sendMessage(text, re);
  }

  // ---------------------------------------------------------------- replies

  function startReply(m) {
    if (!S.active) return;
    S.reply = { id: m.id, text: mediaLabel(m).slice(0, 160), me: m.me };
    $('#reply-name').textContent = m.me ? 'الرد على رسالتك' : `الرد على ${nameOf(S.contacts[S.active])}`;
    $('#reply-text').textContent = mediaLabel(m).replace(/\s+/g, ' ');
    $('#reply-wrap').classList.add('show');
    input.focus({ preventScroll: true });
    if (stick) setTimeout(() => scrollToBottom(true), 60);
  }
  function cancelReply() {
    S.reply = null;
    $('#reply-wrap').classList.remove('show');
  }
  $('#reply-x').addEventListener('click', () => { cancelReply(); input.focus({ preventScroll: true }); });
  $('#reply-x').addEventListener('pointerdown', (e) => { if (document.activeElement === input) e.preventDefault(); });

  function jumpTo(mid) {
    const row = box.querySelector(`.msg[data-id="${CSS.escape(mid)}"]`);
    if (!row) { toast('الرسالة الأصلية غير موجودة', { icon: 'alert' }); return; }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    row.addEventListener('animationend', () => row.classList.remove('flash'), { once: true });
  }

  function deleteMsg(m, cid) {
    const id = cid || S.active;
    const list = msgsOf(id);
    const i = list.indexOf(m);
    if (i < 0) return;
    list.splice(i, 1);
    saveMsgs(id);
    const c = S.contacts[id];
    const last = list[list.length - 1];
    if (c) {
      c.last = last ? { text: mediaLabel(last).slice(0, 140), me: last.me, ts: last.ts } : null;
      if (!m.me && !m.seen && c.unread) c.unread--;
      saveContacts();
      updateTitle();
    }
    if (S.reply && S.reply.id === m.id) cancelReply();
    const up = uploads.get(m.id);
    if (up) {
      if (up.xhr) up.xhr.abort();
      if (up.preview) setTimeout(() => URL.revokeObjectURL(up.preview), 1000);
      uploads.delete(m.id);
    }
    if (S.active !== id) { renderList(); return; }
    const row = box.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`);
    const rerender = () => { if (S.active === id) renderMessages(null, true); };
    if (row) {
      row.classList.add('leave');
      setTimeout(rerender, 280);
    } else rerender();
    renderList();
  }

  // ---------------------------------------------------------------- delete for everyone

  // Allowed only while the other side hasn't read the message. Requests wait in a
  // queue until the other side confirms, and the receiver refuses if it was already read.
  const unsendQ = store.get('unsend', {}) || {}; // chatId -> [{ id, m }]
  const saveUnsendQ = () => store.set('unsend', unsendQ);

  function unsendMsg(m) {
    const cid = S.active;
    if (!cid || !m.me || m.st === 'read') return;
    const delivered = m.st === 'delivered' || m.st === 'sent'; // 'sent' = waiting in their mailbox
    deleteMsg(m, cid); // never-delivered messages just leave the outbox
    if (!delivered) { toast('تم حذف الرسالة لدى الجميع', { icon: 'check' }); return; }
    const copy = Object.assign({}, m);
    delete copy.rxp;
    (unsendQ[cid] = unsendQ[cid] || []).push({ id: m.id, m: copy });
    saveUnsendQ();
    flushUnsend(cid);
    toast('تم حذف الرسالة لدى الجميع', { icon: 'check' });
  }

  function flushUnsend(cid) {
    const q = unsendQ[cid];
    if (!q || !q.length) return;
    for (const item of q) post(cid, { t: 'unsend', id: item.id });
  }

  function onUnsend(cid, d) {
    if (typeof d.id !== 'string') return;
    const m = findMsg(cid, d.id);
    if (!m) { post(cid, { t: 'unsent', id: d.id }); return; } // already gone
    if (m.me) return;                                            // only the sender may unsend
    if (m.seen) { post(cid, { t: 'unsend-no', id: d.id }); return; }
    deleteMsg(m, cid);
    post(cid, { t: 'unsent', id: d.id });
  }

  function onUnsendReply(cid, d) {
    const q = unsendQ[cid];
    if (!q || typeof d.id !== 'string') return;
    const i = q.findIndex((x) => x.id === d.id);
    if (i < 0) return;
    const [item] = q.splice(i, 1);
    if (!q.length) delete unsendQ[cid];
    saveUnsendQ();
    if (d.t !== 'unsend-no' || !item.m) return;
    // it was read before the request arrived: put it back where it was
    const list = msgsOf(cid);
    if (list.some((x) => x.id === item.id)) return;
    item.m.st = 'read';
    const at = list.findIndex((x) => x.ts > item.m.ts);
    if (at < 0) list.push(item.m); else list.splice(at, 0, item.m);
    saveMsgs(cid);
    if (S.active === cid) renderMessages(null, true);
    toast(`ما انحذفت عند ${nameOf(S.contacts[cid])} لأنه قرأها`, { icon: 'alert', ms: 4000 });
  }

  // ---------------------------------------------------------------- message menu

  const ctx = $('#ctx');
  const ctxCard = $('#ctx-card');
  let ctxMsg = null;
  let heldRow = null;

  let ctxHold = false; // true from a long-press until the finger has lifted
  function openCtx(m, row, byTouch) {
    if (!S.active) return;
    closeCtx(true);
    ctxHold = !!byTouch;
    holdUntil = 0;
    ctxScroll = scroller.scrollTop;
    ctxMsg = m;
    heldRow = row;
    const rr = $('#ctx-reacts');
    rr.textContent = '';
    REACTS.forEach((e, k) => {
      const b = el('button', 'react' + (m.rx && m.rx.me === e ? ' on' : ''), e);
      b.type = 'button';
      b.style.setProperty('--k', k);
      b.setAttribute('aria-label', 'تفاعل ' + e);
      b.addEventListener('click', () => { const msg = ctxMsg; closeCtx(); if (msg) react(msg, e); });
      rr.appendChild(b);
    });
    $('[data-act="copy"]', ctxCard).hidden = !m.text;
    $('[data-act="unsend"]', ctxCard).hidden = !(m.me && m.st !== 'read' && !isBlocked(S.active));
    ctx.hidden = false;
    row.classList.add('held');

    const bubble = $('.bubble', row).getBoundingClientRect();
    const cw = ctxCard.offsetWidth;
    const ch = ctxCard.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = $('#app').clientHeight;
    let top = bubble.bottom + 8;
    let originY = 'top';
    if (top + ch > vh - 12) { top = bubble.top - ch - 8; originY = 'bottom'; }
    if (top < 12) { top = Math.min(vh - ch - 12, Math.max(12, bubble.top)); originY = 'center'; }
    let left = m.me ? bubble.left : bubble.right - cw;
    left = Math.max(12, Math.min(vw - cw - 12, left));
    ctxCard.style.top = top + 'px';
    ctxCard.style.left = left + 'px';
    ctxCard.style.transformOrigin = `${m.me ? 'left' : 'right'} ${originY}`;
    void ctx.offsetWidth;
    ctx.classList.add('open');
    if (isTouch && navigator.vibrate) { try { navigator.vibrate(8); } catch (_) { /* ignore */ } }
    if (!isTouch) { const f = $('.react', ctxCard); if (f) f.focus({ preventScroll: true }); }
  }

  function closeCtx(instant) {
    if (ctx.hidden) return;
    ctx.classList.remove('open');
    if (heldRow) heldRow.classList.remove('held');
    heldRow = null;
    ctxMsg = null;
    if (instant) ctx.hidden = true;
    else setTimeout(() => { if (!ctx.classList.contains('open')) ctx.hidden = true; }, 260);
  }

  // the click synthesised from lifting the finger lands on whatever is under it
  // (usually the backdrop); swallow it so the menu stays open
  let holdUntil = 0;
  const releaseHold = () => { if (ctxHold && !holdUntil) holdUntil = Date.now() + 350; };
  window.addEventListener('touchend', releaseHold, true);
  window.addEventListener('pointerup', releaseHold, true);
  window.addEventListener('pointercancel', releaseHold, true);
  ctx.addEventListener('click', async (e) => {
    if (ctxHold) {
      // swallow only the one click that the lift itself produces
      const fromLift = !holdUntil || Date.now() <= holdUntil;
      ctxHold = false;
      holdUntil = 0;
      if (fromLift) { e.preventDefault(); e.stopPropagation(); return; }
    }
    if (e.target.closest('[data-ctx-close]')) { closeCtx(); return; }
    const act = e.target.closest('[data-act]');
    if (!act || !ctxMsg) return;
    const m = ctxMsg;
    closeCtx();
    if (act.dataset.act === 'reply') startReply(m);
    else if (act.dataset.act === 'copy') copyText(m.text, 'تم نسخ الرسالة');
    else if (act.dataset.act === 'unsend') {
      if (m.st === 'read') { toast('ما تقدر تحذفها لدى الجميع — انقرأت', { icon: 'alert' }); return; }
      const ok = await confirmBox('حذف لدى الجميع؟', 'بتنحذف من عندك ومن عنده، لأنه ما قرأها للحين.', 'حذف لدى الجميع');
      if (ok) unsendMsg(m);
    }
    else if (act.dataset.act === 'delete') {
      const ok = await confirmBox('حذف الرسالة؟', 'بتنحذف من جهازك فقط، وتبقى عند الطرف الثاني.', 'حذف');
      if (ok) deleteMsg(m);
    }
  });
  // close on a real scroll only: momentum from an earlier swipe must not snap it shut
  let ctxScroll = 0;
  scroller.addEventListener('scroll', () => {
    if (!ctx.hidden && Math.abs(scroller.scrollTop - ctxScroll) > 24) closeCtx();
  }, { passive: true });

  const msgOfRow = (row) => (row && S.active ? findMsg(S.active, row.dataset.id) : null);

  let suppressClick = false;
  box.addEventListener('click', (e) => {
    if (suppressClick) {
      // the tap that ends a long-press must not also follow a link or quote
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const q = e.target.closest('.quote');
    if (q) { jumpTo(q.dataset.ref); return; }
    const upBtn = e.target.closest('[data-up]');
    if (upBtn) {
      const m = msgOfRow(upBtn.closest('.msg'));
      if (!m) return;
      if (upBtn.dataset.up === 'cancel') deleteMsg(m);
      else retryUpload(m);
      return;
    }
    const view = e.target.closest('.media[data-view]');
    if (view) {
      const m = msgOfRow(view.closest('.msg'));
      if (m) openViewer(m);
      return;
    }
    const tool = e.target.closest('[data-tool]');
    if (!tool) return;
    const row = tool.closest('.msg');
    const m = msgOfRow(row);
    if (!m) return;
    if (tool.dataset.tool === 'reply') startReply(m);
    else openCtx(m, row);
  });

  // touch: long-press opens the menu, horizontal swipe replies
  let gesture = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const row = e.target.closest('.msg');
    if (!row || e.target.closest('[data-tool]')) return;
    suppressClick = false;
    const g = { row, x: e.clientX, y: e.clientY, dx: 0, swiping: false, id: e.pointerId };
    g.timer = setTimeout(() => {
      const m = msgOfRow(row);
      gesture = null;
      if (!m) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 800);
      openCtx(m, row, true);
    }, 430);
    gesture = g;
  });
  box.addEventListener('pointermove', (e) => {
    const g = gesture;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.swiping) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(g.timer);
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        g.swiping = true;
        g.row.classList.add('swiping');
      } else if (Math.abs(dy) > 10) { gesture = null; return; }
    }
    if (g.swiping) {
      const d = Math.sign(dx) * Math.min(84, Math.abs(dx) * 0.7);
      g.dx = d;
      g.row.style.transform = `translateX(${d}px)`;
      g.row.style.setProperty('--sw', Math.min(1, Math.abs(d) / 56).toFixed(2));
      if (!g.armed && Math.abs(d) >= 56) {
        g.armed = true;
        if (navigator.vibrate) { try { navigator.vibrate(6); } catch (_) { /* ignore */ } }
      }
    }
  });
  function endGesture() {
    const g = gesture;
    gesture = null;
    if (!g) return;
    clearTimeout(g.timer);
    if (!g.swiping) return;
    const row = g.row;
    row.classList.remove('swiping');
    row.style.transform = '';
    row.style.removeProperty('--sw');
    if (Math.abs(g.dx) >= 56) {
      const m = msgOfRow(row);
      if (m) startReply(m);
    }
  }
  box.addEventListener('pointerup', endGesture);
  box.addEventListener('pointercancel', endGesture);

  input.addEventListener('input', () => { autosize(); updateSend(); typingPing(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !isTouch) {
      e.preventDefault();
      submit();
    }
  });
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  // keep the keyboard open on phones when tapping send
  $('#send').addEventListener('pointerdown', (e) => { if (document.activeElement === input) e.preventDefault(); });
  $('#send').addEventListener('animationend', (e) => e.currentTarget.classList.remove('fly'));

  // ---------------------------------------------------------------- images

  const PHOTO_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
  function hashStr(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  async function loadBitmap(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 0); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  const sizeOf = (b) => ({ w: b.width || b.naturalWidth || 0, h: b.height || b.naturalHeight || 0 });

  // Square-cropped 256px JPEG: small enough to send over the data channel.
  async function makeAvatar(file) {
    const bmp = await loadBitmap(file);
    const { w, h } = sizeOf(bmp);
    const side = Math.min(w, h);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 256, 256);
    if (bmp.close) bmp.close();
    return cv.toDataURL('image/jpeg', 0.85);
  }

  // Re-encode photos (max 2048px) before upload: smaller, and strips EXIF such as GPS location.
  async function prepareImage(file) {
    const bmp = await loadBitmap(file);
    const { w, h } = sizeOf(bmp);
    if (file.type === 'image/gif') { if (bmp.close) bmp.close(); return { blob: file, w, h }; }
    const k = Math.min(1, 2048 / Math.max(w, h));
    const W = Math.max(1, Math.round(w * k));
    const H = Math.max(1, Math.round(h * k));
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, W, H);
    if (bmp.close) bmp.close();
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.86));
    return { blob: blob || file, w: W, h: H };
  }

  function probeVideo(file) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      const done = (info) => { clearTimeout(t); URL.revokeObjectURL(url); resolve(info); };
      const t = setTimeout(() => done({ w: 0, h: 0, dur: 0 }), 5000);
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight, dur: Number.isFinite(v.duration) ? v.duration : 0 });
      v.onerror = () => done({ w: 0, h: 0, dur: 0 });
      v.src = url;
    });
  }

  const fmtDur = (sec) => {
    const s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' ميجا' : Math.max(1, Math.round(b / 1024)) + ' كيلو');

  // ---------------------------------------------------------------- media messages

  const uploads = new Map(); // message id -> { blob, preview, kind, xhr, pct }
  const cloudReady = () => !!(CFG.cloud.uploadPreset && (CFG.cloud.cloudName || CFG.cloud.uploadUrl));
  const uploadUrl = () => CFG.cloud.uploadUrl ||
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(CFG.cloud.cloudName)}/auto/upload`;

  function cleanMedia(x) {
    if (!x || typeof x !== 'object') return null;
    const kind = x.kind === 'video' ? 'video' : x.kind === 'image' ? 'image' : null;
    if (!kind || typeof x.url !== 'string' || x.url.length > 600 || /[\s"'<>\\]/.test(x.url)) return null;
    if (!CFG.mediaHosts.some((h) => x.url.startsWith(h))) return null;
    const num = (v, max) => (Number.isFinite(v) && v > 0 && v <= max ? Math.round(v) : 0);
    return { kind, url: x.url, w: num(x.w, 20000), h: num(x.h, 20000), dur: num(x.dur, 36000) };
  }

  function mediaLabel(m) {
    if (!m.media) return m.text;
    const label = m.media.kind === 'video' ? '🎥 فيديو' : '📷 صورة';
    return m.text ? `${label} · ${m.text}` : label;
  }

  // Cloudinary can resize on the fly; other hosts are used as-is.
  function cdn(url, t) {
    const i = url.indexOf('/upload/');
    if (i < 0 || !url.startsWith('https://res.cloudinary.com/')) return url;
    return url.slice(0, i + 8) + t + '/' + url.slice(i + 8);
  }
  function thumbUrl(md) {
    if (md.kind === 'image') return cdn(md.url, 'c_limit,w_900,q_auto,f_auto');
    if (!md.url.startsWith('https://res.cloudinary.com/')) return '';
    return cdn(md.url, 'so_0,c_limit,w_900,q_auto').replace(/\.[a-z0-9]+$/i, '.jpg');
  }

  const RING = 2 * Math.PI * 16;
  function mediaNode(m) {
    const md = m.media;
    const up = uploads.get(m.id);
    const fig = el('div', 'media ' + md.kind);
    const ratio = md.w && md.h ? Math.min(1.9, Math.max(0.6, md.w / md.h)) : md.kind === 'video' ? 16 / 9 : 4 / 3;
    fig.style.aspectRatio = String(ratio);
    const local = up && up.preview;
    const src = local || (md.url ? thumbUrl(md) : '');
    if (md.kind === 'image' && src) {
      const img = el('img');
      img.alt = 'صورة';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.draggable = false;
      img.onerror = () => fig.classList.add('broken');
      img.src = src;
      fig.appendChild(img);
    } else if (md.kind === 'video' && local) {
      const v = el('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.src = local + '#t=0.1';
      fig.appendChild(v);
    } else if (md.kind === 'video' && src) {
      const img = el('img');
      img.alt = 'فيديو';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.draggable = false;
      img.onerror = () => img.remove();
      img.src = src;
      fig.appendChild(img);
    } else if (md.kind === 'image') {
      fig.classList.add('broken');
    }
    if (md.kind === 'video') {
      const play = el('span', 'play');
      play.innerHTML = svg('play');
      fig.appendChild(play);
      if (md.dur) fig.appendChild(el('span', 'dur', fmtDur(md.dur)));
    }
    if (m.st === 'uploading') {
      const o = el('div', 'up');
      const pct = up ? up.pct || 0 : 0;
      o.innerHTML = `<svg class="ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="16"/>` +
        `<circle class="bar" cx="20" cy="20" r="16" stroke-dasharray="${RING}" stroke-dashoffset="${RING * (1 - pct)}"/></svg>`;
      const x = el('button', 'up-btn');
      x.type = 'button';
      x.dataset.up = 'cancel';
      x.setAttribute('aria-label', 'إلغاء الرفع');
      x.innerHTML = '<svg class="i" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>';
      o.appendChild(x);
      fig.appendChild(o);
    } else if (m.st === 'failed') {
      const o = el('div', 'up failed');
      const canRetry = !!(up && up.blob);
      const b = el('button', 'up-btn wide');
      b.type = 'button';
      b.dataset.up = canRetry ? 'retry' : 'cancel';
      b.innerHTML = svg(canRetry ? 'retry' : 'trash') + `<span>${canRetry ? 'إعادة الرفع' : 'فشل الرفع'}</span>`;
      o.appendChild(b);
      fig.appendChild(o);
    } else if (md.url) {
      fig.dataset.view = '1';
      fig.setAttribute('role', 'button');
      fig.tabIndex = 0;
      fig.setAttribute('aria-label', md.kind === 'video' ? 'تشغيل الفيديو' : 'عرض الصورة');
    }
    if (md.kind === 'image' && !src) fig.insertAdjacentHTML('beforeend', svg('image'));
    return fig;
  }

  function paintProgress(mid, pct) {
    const bar = box.querySelector(`.msg[data-id="${CSS.escape(mid)}"] .ring .bar`);
    if (bar) bar.setAttribute('stroke-dashoffset', String(RING * (1 - pct)));
  }

  let pendingFile = null;
  async function pickMedia(file) {
    const id = S.active;
    if (!file || !id || isBlocked(id)) return;
    if (!cloudReady()) {
      toast('رفع الصور والفيديو يحتاج تفعيل التخزين السحابي في config.js', { icon: 'alert', ms: 5000 });
      return;
    }
    const kind = /^video\//.test(file.type) ? 'video' : /^image\//.test(file.type) ? 'image' : null;
    if (!kind) { toast('تقدر ترسل صور وفيديوهات فقط', { icon: 'alert' }); return; }
    if (kind === 'video' && file.size > MAX_VIDEO) { toast('الفيديو أكبر من 100 ميجا', { icon: 'alert' }); return; }
    if (kind === 'image' && file.size > 4 * MAX_IMAGE) { toast('الصورة كبيرة جداً', { icon: 'alert' }); return; }
    let prep;
    try {
      prep = kind === 'image' ? await prepareImage(file) : Object.assign({ blob: file }, await probeVideo(file));
    } catch (_) {
      toast('ما قدرنا نقرأ الملف', { icon: 'alert' });
      return;
    }
    if (kind === 'image' && prep.blob.size > MAX_IMAGE) { toast('الصورة أكبر من 10 ميجا', { icon: 'alert' }); return; }
    if (S.active !== id) return;
    pendingFile = Object.assign({ kind, chat: id, preview: URL.createObjectURL(prep.blob) }, prep);

    const pv = $('#media-preview');
    pv.textContent = '';
    if (kind === 'image') {
      const img = el('img');
      img.alt = '';
      img.src = pendingFile.preview;
      pv.appendChild(img);
    } else {
      const v = el('video');
      v.src = pendingFile.preview;
      v.controls = true;
      v.playsInline = true;
      v.muted = true;
      pv.appendChild(v);
    }
    const bits = [kind === 'image' ? 'صورة' : 'فيديو', fmtSize(prep.blob.size)];
    if (prep.w && prep.h) bits.push(`${prep.w}×${prep.h}`);
    if (prep.dur) bits.push(fmtDur(prep.dur));
    $('#media-info').textContent = bits.join(' · ');
    $('#in-caption').value = input.value.trim();
    openModal('m-media', isTouch ? null : '#in-caption');
    openM._onClose = () => {
      if (pendingFile) { URL.revokeObjectURL(pendingFile.preview); pendingFile = null; }
      const vid = $('#media-preview video');
      if (vid) vid.pause();
    };
  }

  function sendMedia(pf, caption) {
    const id = pf.chat;
    if (!S.contacts[id] || isBlocked(id)) return;
    const c = ensureContact(id);
    const m = {
      id: msgId(), me: true, text: cleanText(caption).trim(), ts: Date.now(), st: 'uploading',
      media: { kind: pf.kind, w: pf.w || 0, h: pf.h || 0, dur: Math.round(pf.dur || 0) },
    };
    if (S.reply && S.active === id) { m.re = S.reply; cancelReply(); }
    uploads.set(m.id, { blob: pf.blob, preview: pf.preview, kind: pf.kind, pct: 0 });
    const list = msgsOf(id);
    list.push(m);
    trim(list);
    saveMsgs(id);
    c.last = { text: mediaLabel(m).slice(0, 140), me: true, ts: m.ts };
    c.updated = Date.now();
    saveContacts();
    if (S.active === id) appendMessage(m, true);
    renderList();
    chime('out');
    startUpload(id, m);
  }

  // Every upload gets its own random, unguessable name and public ID. A fixed name
  // ("photo.jpg") let presets that name assets after the file return someone else's
  // earlier photo instead of storing the new one — never let that happen again.
  const randomName = () => rand(24, 'abcdefghijkmnopqrstuvwxyz23456789');
  function startUpload(cid, m, attempt = 0) {
    const up = uploads.get(m.id);
    if (!up || !up.blob) return;
    const fd = new FormData();
    const pid = randomName();
    const ext = up.kind === 'image' ? 'jpg' : ((up.blob.name || '').split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
    fd.append('file', up.blob, `${pid}.${ext}`);
    fd.append('upload_preset', CFG.cloud.uploadPreset);
    if (attempt < 2) fd.append('public_id', pid); // a preset may forbid it; the last try relies on the random file name
    const xhr = new XMLHttpRequest();
    up.xhr = xhr;
    up.pct = 0;
    xhr.open('POST', uploadUrl());
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      up.pct = e.loaded / e.total;
      if (S.active === cid) paintProgress(m.id, up.pct);
    };
    const fail = (why) => {
      up.xhr = null;
      if (!uploads.has(m.id)) return; // cancelled
      m.st = 'failed';
      saveMsgs(cid);
      if (S.active === cid) refreshRow(m);
      toast(why ? `فشل الرفع: ${why}` : 'فشل رفع الملف — جرّب مرة ثانية', { icon: 'alert', ms: 4000 });
    };
    xhr.onerror = () => fail('');
    xhr.onload = () => {
      let res = null;
      try { res = JSON.parse(xhr.responseText); } catch (_) { /* not JSON */ }
      if (xhr.status < 200 || xhr.status >= 300 || !res || !res.secure_url) {
        if (attempt < 2 && xhr.status === 400 && res && res.error && /public.?id/i.test(String(res.error.message))) {
          up.xhr = null;
          startUpload(cid, m, 2); // preset rejects custom public IDs
          return;
        }
        fail(res && res.error && res.error.message ? String(res.error.message).slice(0, 80) : '');
        return;
      }
      // "existing" means the storage handed back an asset that was already there, i.e. NOT
      // this file. Never send that link: retry under a fresh name, then give up.
      if (res.existing === true) {
        up.xhr = null;
        if (attempt < 2) { startUpload(cid, m, attempt + 1); return; }
        fail('التخزين رجّع ملف قديم بدل ملفك — راجع إعدادات الـpreset');
        return;
      }
      const media = cleanMedia({
        kind: m.media.kind, url: res.secure_url,
        w: res.width || m.media.w, h: res.height || m.media.h, dur: res.duration || m.media.dur,
      });
      if (!media) { fail('رابط غير متوقع من التخزين'); return; }
      up.xhr = null;
      up.blob = null; // keep the local preview so the bubble doesn't flicker
      m.media = media;
      m.st = 'pending';
      saveMsgs(cid);
      if (S.active === cid) { refreshRow(m); renderBanner(); }
      dispatch(cid, m);
    };
    xhr.send(fd);
    m.st = 'uploading';
  }

  function retryUpload(m) {
    const up = uploads.get(m.id);
    if (!up || !up.blob) return;
    m.st = 'uploading';
    refreshRow(m);
    startUpload(S.active, m);
  }

  // ---------------------------------------------------------------- viewer

  const viewer = $('#viewer');
  function openViewer(m) {
    const md = m.media;
    if (!md || !md.url) return;
    const stage = $('#viewer-stage');
    stage.textContent = '';
    if (md.kind === 'image') {
      const img = el('img');
      img.alt = m.text || 'صورة';
      img.referrerPolicy = 'no-referrer';
      img.draggable = false;
      img.src = cdn(md.url, 'q_auto,f_auto');
      stage.appendChild(img);
    } else {
      const v = el('video');
      v.controls = true;
      v.autoplay = true;
      v.playsInline = true;
      v.setAttribute('controlsList', 'nodownload');
      v.src = md.url;
      stage.appendChild(v);
    }
    $('#viewer-caption').textContent = m.text || '';
    viewer.hidden = false;
    void viewer.offsetWidth;
    viewer.classList.add('open');
    $('#viewer-close').focus({ preventScroll: true });
  }
  function closeViewer() {
    if (viewer.hidden) return;
    viewer.classList.remove('open');
    const v = $('#viewer-stage video');
    if (v) v.pause();
    setTimeout(() => { if (!viewer.classList.contains('open')) { viewer.hidden = true; $('#viewer-stage').textContent = ''; } }, 320);
  }
  $('#viewer-close').addEventListener('click', closeViewer);
  viewer.addEventListener('click', (e) => { if (e.target === viewer || e.target.id === 'viewer-stage') closeViewer(); });

  // ---------------------------------------------------------------- blocking

  function dropPeer(id) {
    const d = dialing.get(id);
    if (d) { clearTimeout(d.timer); dialing.delete(id); try { d.conn.close(); } catch (_) { /* ignore */ } }
    const set = conns.get(id);
    conns.delete(id);
    if (set) for (const c of set) { try { c.close(); } catch (_) { /* ignore */ } }
    S.presence.delete(id);
  }

  function setBlocked(id, on) {
    if (on) {
      S.blocked[id] = { at: Date.now(), name: nameOf(S.contacts[id]) || heardNames.get(id) || '' };
      setTyping(id, false);
      dropPeer(id);
    } else {
      delete S.blocked[id];
    }
    store.set('blocked', S.blocked);
    renderList();
    if (S.active === id) { renderComposer(); renderChatHead(true); renderBanner(); if (!profileEl.hidden) fillProfile(); }
    if (!on) dial(id);
  }

  function renderComposer() {
    const id = S.active;
    const blocked = !!id && isBlocked(id);
    $('#composer').hidden = blocked;
    $('#blocked-bar').hidden = !blocked;
    if (blocked) {
      $('#blocked-text').textContent = `حظرت ${nameOf(S.contacts[id]) || id}. ما يقدر يراسلك ولا يشوف حالتك.`;
      cancelReply();
    }
  }

  function renderBlocked() {
    const ids = Object.keys(S.blocked);
    $('#blocked-count').textContent = ids.length ? String(ids.length) : '';
    const ul = $('#blocked-list');
    ul.textContent = '';
    $('#blocked-empty').hidden = ids.length > 0;
    for (const id of ids) {
      const c = S.contacts[id] || { id, name: S.blocked[id].name || '' };
      const li = el('li', 'blocked-item');
      const av = el('span', 'avatar sm');
      setAvatar(av, c);
      const who = el('span', 'blocked-who');
      const nm = el('b', null, nameOf(c));
      nm.dir = 'auto';
      who.append(nm, el('small', 'mono', id));
      const btn = el('button', 'btn btn-soft', 'إلغاء الحظر');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        setBlocked(id, false);
        renderBlocked();
        toast(`ألغيت حظر ${nameOf(c)}`, { icon: 'check' });
      });
      li.append(av, who, btn);
      ul.appendChild(li);
    }
  }

  // ---------------------------------------------------------------- verified badge

  const VERIFIED = new Set((CFG.verified || []).map(normalizeId).filter(isValidId));
  const isVerified = (id) => VERIFIED.has(id);

  function setBadge(slot, id) {
    if (!slot) return;
    const on = !!id && isVerified(id);
    if (on && !slot.firstChild) {
      const b = el('span', 'vbadge');
      b.setAttribute('role', 'button');
      b.tabIndex = 0;
      b.dataset.vid = id;
      b.setAttribute('aria-label', 'حساب موثّق');
      b.innerHTML = '<svg class="vbadge-svg" viewBox="0 0 24 24" aria-hidden="true"><use href="#vbadge"/></svg>';
      slot.appendChild(b);
    } else if (on) {
      slot.firstChild.dataset.vid = id;
    } else if (!on && slot.firstChild) {
      slot.textContent = '';
    }
  }

  const EASE = 'cubic-bezier(.22, 1, .36, 1)';
  const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Telegram-style: the card rises up out of the badge you tapped.
  const vpop = $('#vpop');
  const vcard = $('#vpop-card');
  let vAnchor = null;
  function showBadgePop(badge) {
    const id = badge.dataset.vid;
    const mine = S.me && id === S.me.id;
    const c = S.contacts[id];
    $('#vpop-text').textContent = mine
      ? 'حسابك موثّق رسمياً في رواق.'
      : `${nameOf(c) || id} حساب موثّق رسمياً في رواق. تقدر تطمّن إنك تكلّم الشخص الصحيح.`;
    vAnchor = badge;
    vpop.hidden = false;
    const a = badge.getBoundingClientRect();
    const w = vcard.offsetWidth;
    const h = vcard.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = $('#app').clientHeight;
    const ax = a.left + a.width / 2;
    let left = Math.max(12, Math.min(vw - w - 12, ax - w / 2));
    // sit above the badge when there is room, otherwise centred on screen
    let top = a.top - h - 14;
    if (top < 12) top = Math.max(12, (vh - h) / 2);
    vcard.style.left = left + 'px';
    vcard.style.top = top + 'px';
    vcard.style.transformOrigin = `${ax - left}px 100%`;
    vpop.classList.remove('closing');
    void vpop.offsetWidth;
    vpop.classList.add('open');
    if (!reduceMotion()) {
      // always rises upward, easing in with a soft spring
      vcard.animate([
        { opacity: 0, transform: 'translateY(70px) scale(.55)' },
        { opacity: 1, offset: 0.4 },
        { opacity: 1, transform: 'none' },
      ], { duration: 680, easing: SPRING, fill: 'both' });
    }
    if (isTouch && navigator.vibrate) { try { navigator.vibrate(10); } catch (_) { /* ignore */ } }
    setTimeout(() => { const f = $('[data-vpop-close].btn', vcard); if (f && !isTouch) f.focus({ preventScroll: true }); }, 80);
  }
  function closeBadgePop() {
    if (vpop.hidden) return;
    vpop.classList.remove('open');
    vpop.classList.add('closing');
    const done = () => { if (!vpop.classList.contains('open')) vpop.hidden = true; };
    if (reduceMotion()) { done(); return; }
    const anim = vcard.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.9)' }],
      { duration: 200, easing: 'ease-in', fill: 'both' });
    anim.onfinish = done;
    if (vAnchor && !isTouch) vAnchor.focus({ preventScroll: true });
  }
  vpop.addEventListener('click', (e) => { if (e.target.closest('[data-vpop-close]')) closeBadgePop(); });
  // capture phase so a badge inside a chat row doesn't also open the chat
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.vbadge');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    showBadgePop(b);
  }, true);
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('vbadge')) {
      e.preventDefault();
      e.stopPropagation();
      showBadgePop(e.target);
    }
  }, true);

  // ---------------------------------------------------------------- profile panel

  // Telegram-style shared element transition: the header avatar and name
  // grow and glide up into the profile, and back down on close.
  const profileEl = $('#profile');
  const pfAvatar = $('#pf-avatar');
  const pfName = $('#pf-name-line');

  function fillProfile() {
    const id = S.active;
    const c = S.contacts[id];
    if (!c) return;
    setAvatar(pfAvatar, c);
    pfAvatar.classList.toggle('online', S.presence.get(id) === 'online' && !isBlocked(id));
    $('#pf-name').textContent = nameOf(c);
    setBadge($('#pf-badge'), id);
    $('#pf-status').textContent = $('#c-status').textContent;
    $('#pf-id').textContent = id;
    $('#pf-verified').hidden = !isVerified(id);
    $('#pf-block-label').textContent = isBlocked(id) ? 'إلغاء الحظر' : 'حظر';
  }

  function flip(fromEl, toEl, back) {
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    if (!a.width || !b.width) return null;
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const sc = a.height / b.height;
    const start = `translate(${dx}px, ${dy}px) scale(${sc})`;
    const frames = back ? [{ transform: 'none' }, { transform: start }] : [{ transform: start }, { transform: 'none' }];
    return toEl.animate(frames, { duration: back ? 420 : 620, easing: EASE, fill: 'both' });
  }

  let profileAnim = null;
  function openProfile() {
    if (!S.active || !profileEl.hidden) return;
    fillProfile();
    profileEl.hidden = false;
    $('.pf-scroll', profileEl).scrollTop = 0;
    void profileEl.offsetWidth;
    profileEl.classList.add('open');
    if (!reduceMotion()) {
      flip($('#c-avatar'), pfAvatar, false);
      profileAnim = flip($('#c-name'), pfName, false);
    }
    $('.chat-head').classList.add('under-profile');
    setTimeout(() => { if (!isTouch) $('#pf-close').focus({ preventScroll: true }); }, 50);
  }

  function closeProfile(instant) {
    if (profileEl.hidden) return;
    profileEl.classList.remove('open');
    $('.chat-head').classList.remove('under-profile');
    const finish = () => {
      if (profileEl.classList.contains('open')) return;
      profileEl.hidden = true;
      pfAvatar.getAnimations().forEach((a) => a.cancel());
      pfName.getAnimations().forEach((a) => a.cancel());
    };
    if (instant || reduceMotion()) { finish(); return; }
    flip($('#c-avatar'), pfAvatar, true);
    const anim = flip($('#c-name'), pfName, true);
    if (anim) anim.onfinish = finish; else setTimeout(finish, 420);
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.head-open')) openProfile();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('head-open')) openProfile();
  });
  $('#pf-close').addEventListener('click', () => closeProfile());
  $('#pf-msg').addEventListener('click', () => {
    closeProfile();
    if (!isTouch && !isBlocked(S.active)) setTimeout(() => input.focus({ preventScroll: true }), 300);
  });
  $('#pf-copy').addEventListener('click', () => { if (S.active) copyText(S.active, 'تم نسخ المعرّف'); });
  $('#pf-block').addEventListener('click', () => $('#btn-block').click());

  // ---------------------------------------------------------------- feedback

  function toast(text, opts = {}) {
    const wrap = $('#toasts');
    while (wrap.children.length >= 3) wrap.firstChild.remove();
    const t = el('div', 'toast');
    if (opts.icon) t.insertAdjacentHTML('beforeend', svg(opts.icon));
    if (opts.title) t.appendChild(el('b', null, opts.title));
    const s = el('span', null, text);
    s.dir = 'auto';
    t.appendChild(s);
    if (opts.onClick) {
      t.classList.add('clickable');
      t.addEventListener('click', () => { opts.onClick(); hide(); });
    }
    wrap.appendChild(t);
    let gone = false;
    function hide() {
      if (gone) return;
      gone = true;
      t.classList.add('out');
      t.addEventListener('animationend', () => t.remove(), { once: true });
      setTimeout(() => t.remove(), 600);
    }
    setTimeout(hide, opts.ms || 2600);
  }

  function notify(c, text) {
    if (document.visibilityState === 'visible') {
      if (S.active !== c.id || !isViewing(c.id)) {
        toast(text.replace(/\s+/g, ' '), { icon: 'msg', title: nameOf(c) + ':', ms: 3600, onClick: () => openChat(c.id) });
      }
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      const opts = { body: text.slice(0, 160), tag: 'rawaq-' + c.id, lang: 'ar', dir: 'rtl', icon: 'icons/icon-192.png', data: { id: c.id } };
      if (swReg && swReg.showNotification) {
        swReg.showNotification(nameOf(c), Object.assign({ renotify: true }, opts)).catch(() => {});
        return;
      }
      try {
        const n = new Notification(nameOf(c), opts);
        n.onclick = () => { window.focus(); openChat(c.id); n.close(); };
      } catch (_) { /* some mobile browsers only allow service-worker notifications */ }
    }
  }

  // ---------------------------------------------------------------- sound

  let actx = null;
  function unlockAudio() {
    if (!S.sound) return;
    try {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
      }
      if (actx.state === 'suspended') actx.resume();
    } catch (_) { /* ignore */ }
  }
  function chime(kind) {
    if (!S.sound || !actx || actx.state !== 'running') return;
    const t = actx.currentTime;
    const notes = kind === 'in' ? [[880, 0, 0.08], [1318.5, 0.09, 0.07]] : [[740, 0, 0.035]];
    for (const [f, d, v] of notes) {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(v, t + d + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
      o.connect(g).connect(actx.destination);
      o.start(t + d);
      o.stop(t + d + 0.32);
    }
  }
  document.addEventListener('pointerdown', unlockAudio, { capture: true });
  document.addEventListener('keydown', unlockAudio, { capture: true });

  function renderSound() {
    $('#btn-sound').setAttribute('aria-checked', String(S.sound));
  }

  // ---------------------------------------------------------------- QR

  function renderQr() {
    const holder = $('#qr');
    holder.textContent = '';
    if (!window.qrcode || !S.me) return;
    const q = window.qrcode(0, 'M');
    q.addData(inviteLink());
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    holder.innerHTML = `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  // ---------------------------------------------------------------- install (PWA)

  let swReg = null;
  let installEvt = null;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function renderInstall() {
    const b = $('#btn-install');
    if (isStandalone()) { b.hidden = true; return; }
    if (installEvt) { b.hidden = false; $('#install-state').textContent = ''; }
    else if (isIOS) { b.hidden = false; $('#install-state').textContent = 'من زر المشاركة'; }
    else b.hidden = true;
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; renderInstall(); });
  window.addEventListener('appinstalled', () => { installEvt = null; renderInstall(); toast('تم تثبيت رواق', { icon: 'check' }); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.t === 'open' && typeof d.id === 'string' && S.contacts[d.id] && owner) openChat(d.id);
    });
  }

  function shake(inputEl, errEl, msg) {
    errEl.textContent = msg;
    errEl.classList.add('show');
    inputEl.classList.remove('shake');
    void inputEl.offsetWidth;
    inputEl.classList.add('shake');
    inputEl.focus({ preventScroll: true });
  }
  function clearErr(errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }

  async function copyText(text, msg) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      const ta = el('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
      ta.remove();
    }
    toast(ok ? msg : 'ما قدرنا ننسخ — انسخه يدوياً', { icon: ok ? 'check' : 'alert' });
  }

  const inviteLink = () => location.origin + location.pathname + '#to=' + S.me.id;
  async function shareMe() {
    const text = `تعال كلّمني على رواق 🤍\nمعرّفي: ${S.me.id}`;
    const url = inviteLink();
    if (navigator.share) {
      try { await navigator.share({ title: 'رواق', text, url }); return; } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    copyText(`${text}\n${url}`, 'تم نسخ رابط الدعوة');
  }

  // ---------------------------------------------------------------- modals

  let openM = null;
  let lastFocus = null;
  function openModal(id, focusSel) {
    if (openM) closeModal(true);
    const m = $('#' + id);
    lastFocus = document.activeElement;
    m.hidden = false;
    void m.offsetWidth;
    m.classList.add('open');
    openM = m;
    const f = focusSel && $(focusSel, m);
    if (f) f.focus({ preventScroll: true });
    else {
      const first = $('.sheet button, .sheet input', m);
      if (first && !isTouch) first.focus({ preventScroll: true });
    }
  }
  function closeModal(instant) {
    const m = openM;
    if (!m) return;
    openM = null;
    m.classList.remove('open');
    if (m._onClose) { const fn = m._onClose; m._onClose = null; fn(); }
    const done = () => { if (!m.classList.contains('open')) m.hidden = true; };
    if (instant) done(); else setTimeout(done, 420);
    if (lastFocus && lastFocus.focus && !isTouch) lastFocus.focus({ preventScroll: true });
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && currentView() === 'main') {
      e.preventDefault();
      if (S.active && mqMobile.matches) closeChat();
      const qi = $('#q');
      if (!$('#search-box').hidden) qi.focus();
      return;
    }
    if (e.key !== 'Escape') return;
    if (!viewer.hidden) { closeViewer(); return; }
    if (!vpop.hidden) { closeBadgePop(); return; }
    if (!profileEl.hidden) { closeProfile(); return; }
    if (!ctx.hidden) { closeCtx(); return; }
    if (S.reply && document.activeElement === input) { cancelReply(); return; }
    if (openM) closeModal();
    else if (S.active && mqMobile.matches) closeChat();
  });

  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      $('#cf-title').textContent = title;
      $('#cf-text').textContent = text;
      const ok = $('#cf-ok');
      ok.textContent = okLabel;
      let answered = false;
      const onOk = () => { answered = true; closeModal(); };
      ok.addEventListener('click', onOk, { once: true });
      openModal('m-confirm');
      openM._onClose = () => { ok.removeEventListener('click', onOk); resolve(answered); };
    });
  }

  // ---------------------------------------------------------------- theme

  function resolvedTheme() {
    return S.theme === 'auto' ? (mqDark.matches ? 'dark' : 'light') : S.theme;
  }
  function applyTheme() {
    const t = resolvedTheme();
    document.documentElement.dataset.theme = t;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#0a0a0a' : '#ffffff';
    const opts = ['light', 'auto', 'dark'];
    $$('[data-theme-opt]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeOpt === S.theme)));
    $('#seg-theme').style.setProperty('--idx', opts.indexOf(S.theme));
  }
  function setTheme(t) {
    S.theme = t;
    store.set('theme', t);
    applyTheme();
  }
  mqDark.addEventListener('change', () => { if (S.theme === 'auto') applyTheme(); });

  // ---------------------------------------------------------------- notifications setting

  const pushConfigured = () => !!(CFG.push && CFG.push.publicKey && CFG.push.worker && DB);
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // iPhone/iPad only allow web notifications for apps added to the home screen
  const needsInstall = () => isIOS && !isStandalone();

  function renderNotify() {
    const st = $('#notify-state');
    if (needsInstall()) { st.textContent = 'ثبّت التطبيق أولاً'; return; }
    if (!('Notification' in window)) { st.textContent = 'غير مدعومة'; return; }
    st.textContent = Notification.permission === 'granted' ? 'مفعّلة'
      : Notification.permission === 'denied' ? 'محظورة من المتصفح' : 'تفعيل';
  }

  function renderNotifCard() {
    const card = $('#notif-card');
    const show = !!S.me && pushConfigured() && pushSupported() && Notification.permission === 'default' &&
      !needsInstall() && !store.get('notifDismissed', false) && Object.keys(S.contacts).length > 0;
    card.hidden = !show;
  }

  const b64urlToU8 = (s2) => {
    const pad = '='.repeat((4 - (s2.length % 4)) % 4);
    return Uint8Array.from(atob((s2 + pad).replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
  };

  // Subscribe this device to Web Push and register it under our ID.
  async function ensurePush() {
    if (!pushConfigured() || !pushSupported() || !S.me || !owner) return false;
    if (Notification.permission !== 'granted') return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToU8(CFG.push.publicKey) });
      }
      const json = sub.toJSON();
      const sig = hashStr(S.me.id + json.endpoint);
      if (store.get('pushSaved', '') === sig) return true;
      await db('PUT', `push/${S.me.id}`, { endpoint: json.endpoint, keys: json.keys, t: Date.now() });
      store.set('pushSaved', sig);
      return true;
    } catch (e) {
      console.warn('rawaq: push subscription failed', e);
      return false;
    }
  }

  async function enableNotifications() {
    if (needsInstall()) {
      toast('على الآيفون: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»، وافتح رواق من هناك', { icon: 'alert', ms: 6000 });
      return;
    }
    if (!('Notification' in window)) { toast('متصفحك لا يدعم التنبيهات', { icon: 'alert' }); return; }
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) { /* ignore */ }
    } else if (Notification.permission === 'denied') {
      toast('فعّل التنبيهات من إعدادات المتصفح', { icon: 'alert' });
    }
    if (Notification.permission === 'granted') {
      const ok = await ensurePush();
      toast(ok || !pushConfigured() ? 'تم تفعيل التنبيهات' : 'تفعّلت التنبيهات داخل التطبيق فقط', { icon: 'check' });
    }
    renderNotify();
    renderNotifCard();
  }

  // ---------------------------------------------------------------- viewport

  // Keep the app exactly the size of the visible area (mobile keyboards included).
  function fitViewport() {
    const vv = window.visualViewport;
    const set = () => {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
      if (vv && vv.offsetTop > 0) window.scrollTo(0, 0);
    };
    set();
    (vv || window).addEventListener('resize', set);
    if (vv) vv.addEventListener('scroll', set);
  }

  // ---------------------------------------------------------------- invite links

  let intent = null;
  let openIntent = null;
  function readIntent() {
    const all = location.hash + '&' + location.search;
    const m = /(?:^|[#&?])to=([A-Za-z0-9-]{4,40})/.exec(all);
    const o = /(?:^|[#&?])open=([A-Za-z0-9]{4,12})/.exec(all);
    if (!m && !o) return;
    if (m) intent = normalizeId(m[1]);
    if (o) openIntent = normalizeId(o[1]);
    history.replaceState(history.state, '', location.pathname);
  }
  function consumeIntent() {
    if (!S.me || !owner || currentView() !== 'main') return;
    if (openIntent) {
      const oid = openIntent;
      openIntent = null;
      if (S.contacts[oid]) openChat(oid);
    }
    if (!intent) return;
    const id = intent;
    intent = null;
    const err = startChatWith(id);
    if (err) toast(err, { icon: 'alert' });
  }

  function startChatWith(raw) {
    const id = normalizeId(raw);
    if (!id) return 'اكتب معرّف صديقك';
    if (!isValidId(id)) return `المعرّف غير صحيح — يتكوّن من ${ID_LEN} أحرف وأرقام إنجليزية`;
    if (id === S.me.id) return 'هذا معرّفك أنت — اكتب معرّف صديقك';
    ensureContact(id);
    openChat(id);
    return null;
  }

  // ---------------------------------------------------------------- events

  function bind() {
    // welcome
    $('#in-name').addEventListener('input', () => clearErr($('#welcome-err')));
    $('#f-welcome').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = cleanName($('#in-name').value);
      if (!name) { shake($('#in-name'), $('#welcome-err'), 'اكتب اسمك أولاً'); return; }
      S.me = { id: genId(), name, created: Date.now() };
      store.set('profile', S.me);
      $('#in-name').blur();
      renderMe();
      renderIdCode();
      showView('id');
      netStart();
    });
    $('#btn-enter').addEventListener('click', () => {
      renderList();
      showView('main');
      consumeIntent();
    });

    // shared actions
    document.addEventListener('click', (e) => {
      if (!S.me) return;
      if (e.target.closest('[data-copy-id]')) copyText(S.me.id, 'تم نسخ معرّفك');
      else if (e.target.closest('[data-share]')) shareMe();
      else if (e.target.closest('[data-qr]')) { renderQr(); openModal('m-qr'); }
    });

    // sidebar
    $('#btn-theme').addEventListener('click', () => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark'));
    $('#btn-me').addEventListener('click', () => {
      $('#in-rename').value = S.me.name;
      renderBlocked();
      renderNotify();
      renderSound();
      renderInstall();
      openModal('m-me');
    });
    $('#net').addEventListener('click', () => {
      if (S.net === 'online') return;
      stopped = false;
      reconnectNow(true);
    });
    $('#btn-new').addEventListener('click', () => {
      $('#in-peer').value = '';
      clearErr($('#new-err'));
      openModal('m-new', '#in-peer');
    });

    // new chat
    const peerIn = $('#in-peer');
    peerIn.addEventListener('input', () => {
      clearErr($('#new-err'));
      const raw = peerIn.value;
      if (/to=|rawaq/i.test(raw)) peerIn.value = normalizeId(raw);
      else peerIn.value = raw.toUpperCase().replace(/[^A-Z0-9٠-٩]/g, '');
    });
    $('#f-new').addEventListener('submit', (e) => {
      e.preventDefault();
      const err = startChatWith(peerIn.value);
      if (err) { shake(peerIn, $('#new-err'), err); return; }
      closeModal();
    });
    const pasteBtn = $('#btn-paste');
    if (!(navigator.clipboard && navigator.clipboard.readText)) pasteBtn.hidden = true;
    pasteBtn.addEventListener('click', async () => {
      try {
        const t = await navigator.clipboard.readText();
        peerIn.value = normalizeId(t).slice(0, 12);
        clearErr($('#new-err'));
        peerIn.focus({ preventScroll: true });
      } catch (_) {
        toast('اسمح بالوصول للحافظة أو الصق يدوياً', { icon: 'alert' });
      }
    });

    // profile
    $('#f-rename').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = cleanName($('#in-rename').value);
      if (!name) { $('#in-rename').classList.add('shake'); setTimeout(() => $('#in-rename').classList.remove('shake'), 500); return; }
      if (name === S.me.name) { closeModal(); return; }
      S.me.name = name;
      store.set('profile', S.me);
      renderMe();
      broadcastHello();
      toast('تم حفظ اسمك', { icon: 'check' });
      closeModal();
    });
    $$('[data-theme-opt]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeOpt)));
    $('#btn-sound').addEventListener('click', () => {
      S.sound = !S.sound;
      store.set('sound', S.sound);
      renderSound();
      if (S.sound) { unlockAudio(); setTimeout(() => chime('in'), 60); }
    });
    $('#btn-install').addEventListener('click', async () => {
      if (installEvt) {
        const evt = installEvt;
        installEvt = null;
        try { evt.prompt(); await evt.userChoice; } catch (_) { /* ignore */ }
        renderInstall();
      } else if (isIOS) {
        toast('اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»', { icon: 'alert', ms: 5000 });
      }
    });

    // profile photo
    $('#btn-photo').addEventListener('click', () => $('#in-photo').click());
    $('#in-photo').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('اختر صورة', { icon: 'alert' }); return; }
      try {
        const data = await makeAvatar(file);
        if (!PHOTO_RE.test(data) || data.length > 300000) throw new Error('bad');
        S.me.photo = data;
        store.set('profile', S.me);
        renderMe();
        broadcastHello();
        toast('تم تحديث صورتك', { icon: 'check' });
      } catch (_) {
        toast('ما قدرنا نقرأ الصورة', { icon: 'alert' });
      }
    });
    $('#btn-photo-remove').addEventListener('click', () => {
      delete S.me.photo;
      store.set('profile', S.me);
      renderMe();
      broadcastHello();
      toast('تمت إزالة الصورة', { icon: 'check' });
    });

    // blocking
    $('#btn-blocked').addEventListener('click', () => { renderBlocked(); openModal('m-blocked'); });
    $('#btn-block').addEventListener('click', async () => {
      const id = S.active;
      if (!id) return;
      const c = S.contacts[id];
      if (isBlocked(id)) {
        closeModal();
        setBlocked(id, false);
        toast(`ألغيت حظر ${nameOf(c)}`, { icon: 'check' });
        return;
      }
      const ok = await confirmBox(`حظر ${nameOf(c)}؟`, 'ما يقدر يراسلك ولا يشوف إذا كنت متصل. تقدر تلغي الحظر متى ما بغيت.', 'حظر');
      if (!ok) return;
      setBlocked(id, true);
      toast(`تم حظر ${nameOf(c)}`, { icon: 'check' });
    });
    $('#btn-unblock-inline').addEventListener('click', () => {
      const id = S.active;
      if (!id) return;
      setBlocked(id, false);
      toast(`ألغيت حظر ${nameOf(S.contacts[id])}`, { icon: 'check' });
    });

    // media
    $('#btn-attach').addEventListener('click', () => {
      if (!cloudReady()) {
        toast('رفع الصور والفيديو يحتاج تفعيل التخزين السحابي في config.js', { icon: 'alert', ms: 5000 });
        return;
      }
      $('#in-media').click();
    });
    $('#in-media').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      pickMedia(file);
    });
    $('#f-media').addEventListener('submit', (e) => {
      e.preventDefault();
      const pf = pendingFile;
      if (!pf) return;
      pendingFile = null;
      const caption = $('#in-caption').value;
      if (caption.trim() && caption.trim() === input.value.trim()) {
        input.value = '';
        if (S.active) S.drafts[S.active] = '';
        autosize();
        updateSend();
      }
      closeModal();
      sendMedia(pf, caption);
    });
    input.addEventListener('paste', (e) => {
      const items = e.clipboardData ? Array.from(e.clipboardData.items) : [];
      const item = items.find((it) => it.kind === 'file' && /^(image|video)\//.test(it.type));
      if (!item) return;
      e.preventDefault();
      pickMedia(item.getAsFile());
    });
    const pane = $('#chat-pane');
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    let dragDepth = 0;
    pane.addEventListener('dragenter', (e) => {
      if (!hasFiles(e) || !S.active || isBlocked(S.active)) return;
      e.preventDefault();
      dragDepth++;
      $('#drop-zone').classList.add('show');
    });
    pane.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    pane.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $('#drop-zone').classList.remove('show');
    });
    pane.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      $('#drop-zone').classList.remove('show');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) pickMedia(file);
    });
    // a file dropped anywhere else must not navigate away from the app
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });

    // search
    const q = $('#q');
    q.addEventListener('input', () => {
      S.query = q.value.trim().toLowerCase();
      $('#q-x').hidden = !q.value;
      drawList();
    });
    $('#q-x').addEventListener('click', () => {
      q.value = '';
      S.query = '';
      $('#q-x').hidden = true;
      drawList();
      q.focus({ preventScroll: true });
    });

    // no browser context menu: messages get Rawaq's own menu instead
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('input, textarea')) return;
      e.preventDefault();
      if (!ctx.hidden) return; // Android also fires this after our own long-press
      const row = e.target.closest('.msg');
      const m = row && box.contains(row) ? msgOfRow(row) : null;
      if (m) openCtx(m, row);
    });
    document.addEventListener('dragstart', (e) => {
      if (!e.target.closest || !e.target.closest('input, textarea')) e.preventDefault();
    });
    $('#btn-notify').addEventListener('click', enableNotifications);
    $('#notif-on').addEventListener('click', enableNotifications);
    $('#notif-x').addEventListener('click', () => { store.set('notifDismissed', true); renderNotifCard(); });
    $('#btn-reset').addEventListener('click', async () => {
      const ok = await confirmBox('حذف بياناتك؟', 'بينحذف اسمك ومعرّفك وكل محادثاتك من هذا الجهاز. ما تقدر تتراجع.', 'حذف نهائي');
      if (!ok) return;
      netStop();
      clearTimeout(saveTimer);
      dirty.clear();
      store.clear();
      if (bc) bc.close();
      location.replace(location.pathname);
    });

    // chat
    $('#btn-back').addEventListener('click', () => closeChat());
    $('#btn-chat-menu').addEventListener('click', () => {
      const c = S.contacts[S.active];
      if (!c) return;
      $('#m-chat-title').textContent = nameOf(c);
      $('#m-chat-id').textContent = c.id;
      $('#btn-block-label').textContent = isBlocked(c.id) ? 'إلغاء الحظر' : 'حظر المستخدم';
      openModal('m-chat');
    });
    $('#btn-copy-peer').addEventListener('click', () => {
      if (S.active) copyText(S.active, 'تم نسخ المعرّف');
      closeModal();
    });
    $('#btn-delete-chat').addEventListener('click', async () => {
      const id = S.active;
      const c = S.contacts[id];
      if (!c) return;
      const ok = await confirmBox('حذف المحادثة؟', `بتنحذف محادثتك مع ${nameOf(c)} من هذا الجهاز فقط.`, 'حذف');
      if (!ok) return;
      closeChat();
      delete S.contacts[id];
      delete S.msgs[id];
      delete S.drafts[id];
      dirty.delete(id);
      store.del('m.' + id);
      saveContacts();
      renderList();
      updateTitle();
      toast('تم حذف المحادثة', { icon: 'check' });
    });

    // takeover from another tab
    $('#btn-takeover').addEventListener('click', () => {
      if (bc) bc.postMessage({ t: 'takeover', tab: TAB });
      setTimeout(() => location.reload(), 450);
    });

    // lifecycle
    window.addEventListener('hashchange', () => { readIntent(); consumeIntent(); });
    window.addEventListener('online', () => reconnectNow(true));
    window.addEventListener('offline', () => setNet('offline'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reconnectNow(true);
        if (S.active) markSeen(S.active);
      } else {
        flushSave();
      }
    });
    window.addEventListener('pagehide', () => {
      flushSave();
      for (const set of conns.values()) for (const c of set) send(c, { t: 'bye' });
      if (peer) { try { peer.destroy(); } catch (_) { /* ignore */ } }
    });
    window.addEventListener('pageshow', (e) => { if (e.persisted && owner && S.me) netStart(); });
    mqMobile.addEventListener('change', () => {
      if (!mqMobile.matches && history.state && history.state.chat) history.replaceState(null, '');
    });
    // refresh relative times ("today", "last seen") once a minute
    setInterval(() => { renderList(); if (S.active) renderChatHead(); }, 60000);
  }

  // ---------------------------------------------------------------- no zoom on phones

  // iOS Safari ignores user-scalable=no, so block its pinch gestures directly.
  // Double-tap zoom is turned off with touch-action: manipulation in CSS.
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // ---------------------------------------------------------------- boot

  async function init() {
    $('#net-text').textContent = NET_TEXT.idle;
    applyTheme();
    fitViewport();
    bind();
    readIntent();

    if (S.me) {
      renderMe();
      renderList();
      updateTitle();
      showView('main');
    } else {
      showView('welcome');
      if (!isTouch) setTimeout(() => $('#in-name').focus({ preventScroll: true }), 700);
    }

    const ok = await claimTab();
    if (!ok) { showView('blocked'); return; }
    if (S.me) {
      netStart();
      consumeIntent();
    }
  }

  init();
})();
