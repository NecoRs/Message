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
  }, window.RAWAQ_CONFIG || {});

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
    query: '',
    presence: new Map(), // id -> online | connecting | offline | unreachable
    typing: new Map(),   // id -> timer
  };
  if (S.me && (!isValidId(S.me.id) || !cleanName(S.me.name))) S.me = null;

  function msgsOf(id) {
    if (!S.msgs[id]) {
      const list = store.get('m.' + id, []);
      S.msgs[id] = Array.isArray(list) ? list : [];
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
    }
    return c;
  }
  const heardNames = new Map(); // id -> name announced over an open link
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
      if (!idFromPeer(conn.peer)) { try { conn.close(); } catch (_) { /* ignore */ } return; }
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
    if (id === S.me.id || isOpen(id) || dialing.has(id)) return;
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
      send(conn, { t: 'hello', name: S.me.name, v: 1 });
      setPresence(id, 'online');
      flushOutbox(id);
      flushReceipts(id);
    });
    conn.on('data', (data) => {
      conn._heard = Date.now();
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
    conn.on('error', () => { try { conn.close(); } catch (_) { /* ignore */ } drop(); });
  }

  function send(conn, obj) {
    try { conn.send(obj); return true; } catch (_) { return false; }
  }
  function sendTo(id, obj) {
    const set = conns.get(id);
    if (!set) return false;
    for (const c of set) if (c.open && send(c, obj)) return true;
    return false;
  }

  function probeAll() {
    if (!peer || !peer.open || document.visibilityState === 'hidden') return;
    const ids = Object.keys(S.contacts).filter((id) => !isOpen(id) && !dialing.has(id));
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

  function setPresence(id, p) {
    const prev = S.presence.get(id);
    if (prev === p) return;
    S.presence.set(id, p);
    const c = S.contacts[id];
    if (c && (prev === 'online' || p === 'online')) { c.seen = Date.now(); saveContacts(); }
    renderList();
    if (S.active === id) { renderChatHead(); renderBanner(); }
  }

  // ---------------------------------------------------------------- protocol

  function onData(id, d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'hello': {
        const name = cleanName(d.name);
        if (name) heardNames.set(id, name);
        const c = S.contacts[id];
        if (c && name && name !== c.name) {
          c.name = name;
          saveContacts();
          renderList();
          if (S.active === id) renderChatHead();
        }
        break;
      }
      case 'msg': receive(id, d); break;
      case 'ack': if (typeof d.id === 'string') markMine(id, [d.id], 'delivered'); break;
      case 'read': if (Array.isArray(d.ids)) markMine(id, d.ids.slice(0, 2000), 'read'); break;
      case 'typing': setTyping(id, !!d.on); break;
      case 'react': onReact(id, d); break;
      default: break; // ping / unknown
    }
  }

  function receive(id, d) {
    if (typeof d.id !== 'string' || d.id.length > 40) return;
    const text = cleanText(d.text);
    if (!text.trim()) return;
    sendTo(id, { t: 'ack', id: d.id });

    const list = msgsOf(id);
    if (list.some((m) => m.id === d.id)) return; // duplicate after a retry

    const c = ensureContact(id);
    const ts = Number.isFinite(d.ts) && d.ts > 0 ? Math.min(d.ts, Date.now()) : Date.now();
    const m = { id: d.id, me: false, text, ts, seen: false, rr: false };
    const re = d.re;
    if (re && typeof re === 'object' && typeof re.id === 'string' && re.id.length <= 40 && typeof re.text === 'string') {
      // "by" is from the sender's side: 's' = they quoted themselves, 'r' = they quoted us
      m.re = { id: re.id, text: cleanText(re.text).slice(0, 160), me: re.by === 'r' };
    }
    list.push(m);
    trim(list);
    saveMsgs(id);
    setTyping(id, false);

    c.last = { text: text.slice(0, 140), me: false, ts };
    c.updated = Date.now();
    if (isViewing(id)) {
      m.seen = true;
      flushReceipts(id);
    } else {
      c.unread = (c.unread || 0) + 1;
      notify(c, text);
    }
    chime('in');
    saveContacts();
    if (S.active === id) appendMessage(m);
    renderList();
    updateTitle();
  }

  const RANK = { pending: 0, delivered: 1, read: 2 };
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

  function wireMsg(m) {
    const o = { t: 'msg', id: m.id, text: m.text, ts: m.ts };
    if (m.re) o.re = { id: m.re.id, text: m.re.text, by: m.re.me ? 's' : 'r' };
    return o;
  }

  function flushOutbox(id) {
    let changed = false;
    for (const m of msgsOf(id)) {
      if (m.me && m.st === 'pending' && !sendTo(id, wireMsg(m))) break;
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
    if (sendTo(id, { t: 'react', id: m.id, e: next })) delete m.rxp;
    saveMsgs(id);
    refreshRow(m, true);
  }

  function flushReceipts(id) {
    if (!isOpen(id)) return;
    const list = msgsOf(id);
    const pend = list.filter((m) => !m.me && m.seen && !m.rr);
    if (!pend.length) return;
    if (sendTo(id, { t: 'read', ids: pend.map((m) => m.id) })) {
      pend.forEach((m) => { m.rr = true; });
      saveMsgs(id);
    }
  }

  function trim(list) {
    if (list.length > KEEP) list.splice(0, list.length - KEEP);
  }

  function sendMessage(text, re) {
    const id = S.active;
    if (!id) return;
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
    if (isOpen(id)) sendTo(id, wireMsg(m));
    else dial(id);
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
    const label = c ? (c.name ? firstLetter(c.name) : '#') : '';
    node.dataset.letter = label;
  }

  function renderMe() {
    if (!S.me) return;
    $$('[data-my-id]').forEach((n) => { n.textContent = S.me.id; });
    $('#me-avatar').dataset.letter = firstLetter(S.me.name);
    $('#p-avatar').dataset.letter = firstLetter(S.me.name);
    $('#id-hello').textContent = S.me.name;
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
    top.append(name, time);
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
    av.classList.toggle('online', S.presence.get(c.id) === 'online');
    $('.item-name', b).textContent = nameOf(c);
    $('.item-time', b).textContent = c.last ? listTime(c.last.ts) : '';
    const prev = $('.item-preview', b);
    const typing = S.typing.has(c.id);
    prev.classList.toggle('typing', typing);
    prev.textContent = typing ? 'يكتب…'
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
    const av = $('#c-avatar');
    setAvatar(av, c);
    av.classList.toggle('online', S.presence.get(id) === 'online');

    let text;
    let cls = '';
    const p = S.presence.get(id);
    if (S.typing.has(id)) { text = 'يكتب…'; cls = 'typing'; }
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
    if (!id) { wrap.classList.remove('show'); return; }
    const c = S.contacts[id];
    const pending = msgsOf(id).some((m) => m.me && m.st === 'pending');
    const p = S.presence.get(id);
    let text = '';
    if (S.net === 'offline') text = 'أنت غير متصل بالإنترنت. رسائلك محفوظة وبتنرسل أول ما يرجع الاتصال.';
    else if (pending && p !== 'online') text = `${nameOf(c)} غير متصل الآن. رسالتك محفوظة وبتوصله تلقائياً أول ما تكونون متصلين معاً.`;
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
    wrap.appendChild(el('b', null, c.name ? `ابدأ الحديث مع ${c.name}` : `المعرّف ${c.id}`));
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
    if (isJumbo(m.text)) row.classList.add('jumbo');
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
    const p = el('p', 'text');
    p.dir = 'auto';
    linkify(p, m.text);
    p.appendChild(el('span', 'meta-space'));
    const meta = el('span', 'meta');
    const t = el('time', null, fTime.format(m.ts));
    t.dateTime = new Date(m.ts).toISOString();
    meta.appendChild(t);
    if (m.me) {
      const tk = el('span', 'tick');
      setTick(tk, m.st);
      meta.appendChild(tk);
    }
    b.append(p, meta);
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
    pending: ['clock', 'بانتظار الإرسال'],
    delivered: ['check', 'وصلت'],
    read: ['checks', 'قُرئت'],
  };
  function setTick(tk, st) {
    const [ic, label] = TICK[st] || TICK.pending;
    tk.innerHTML = svg(ic);
    tk.title = label;
    tk.setAttribute('aria-label', label);
    tk.classList.toggle('read', st === 'read');
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
    S.reply = { id: m.id, text: m.text.slice(0, 160), me: m.me };
    $('#reply-name').textContent = m.me ? 'الرد على رسالتك' : `الرد على ${nameOf(S.contacts[S.active])}`;
    $('#reply-text').textContent = m.text.replace(/\s+/g, ' ');
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

  function deleteMsg(m) {
    const id = S.active;
    const list = msgsOf(id);
    const i = list.indexOf(m);
    if (i < 0) return;
    list.splice(i, 1);
    saveMsgs(id);
    const c = S.contacts[id];
    const last = list[list.length - 1];
    if (c) {
      c.last = last ? { text: last.text.slice(0, 140), me: last.me, ts: last.ts } : null;
      saveContacts();
    }
    if (S.reply && S.reply.id === m.id) cancelReply();
    const row = box.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`);
    const rerender = () => renderMessages(null, true);
    if (row) {
      row.classList.add('leave');
      setTimeout(rerender, 280);
    } else rerender();
    renderList();
  }

  // ---------------------------------------------------------------- message menu

  const ctx = $('#ctx');
  const ctxCard = $('#ctx-card');
  let ctxMsg = null;
  let heldRow = null;

  function openCtx(m, row) {
    if (!S.active) return;
    closeCtx(true);
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

  ctx.addEventListener('click', async (e) => {
    if (e.target.closest('[data-ctx-close]')) { closeCtx(); return; }
    const act = e.target.closest('[data-act]');
    if (!act || !ctxMsg) return;
    const m = ctxMsg;
    closeCtx();
    if (act.dataset.act === 'reply') startReply(m);
    else if (act.dataset.act === 'copy') copyText(m.text, 'تم نسخ الرسالة');
    else if (act.dataset.act === 'delete') {
      const ok = await confirmBox('حذف الرسالة؟', 'بتنحذف من جهازك فقط، وتبقى عند الطرف الثاني.', 'حذف');
      if (ok) deleteMsg(m);
    }
  });
  scroller.addEventListener('scroll', () => closeCtx(), { passive: true });

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
      openCtx(m, row);
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

  function renderNotify() {
    const st = $('#notify-state');
    if (!('Notification' in window)) { st.textContent = 'غير مدعومة'; return; }
    st.textContent = Notification.permission === 'granted' ? 'مفعّلة'
      : Notification.permission === 'denied' ? 'محظورة من المتصفح' : 'تفعيل';
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
      for (const id of conns.keys()) sendTo(id, { t: 'hello', name, v: 1 });
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
    $('#btn-notify').addEventListener('click', async () => {
      if (!('Notification' in window)) { toast('متصفحك لا يدعم التنبيهات', { icon: 'alert' }); return; }
      if (Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch (_) { /* ignore */ }
      } else if (Notification.permission === 'denied') {
        toast('فعّل التنبيهات من إعدادات المتصفح', { icon: 'alert' });
      }
      renderNotify();
    });
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
      if (peer) { try { peer.destroy(); } catch (_) { /* ignore */ } }
    });
    window.addEventListener('pageshow', (e) => { if (e.persisted && owner && S.me) netStart(); });
    mqMobile.addEventListener('change', () => {
      if (!mqMobile.matches && history.state && history.state.chat) history.replaceState(null, '');
    });
    // refresh relative times ("today", "last seen") once a minute
    setInterval(() => { renderList(); if (S.active) renderChatHead(); }, 60000);
  }

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
