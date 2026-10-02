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
  };
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

  function flushOutbox(id) {
    for (const m of msgsOf(id)) {
      if (m.me && m.st === 'pending' && !sendTo(id, { t: 'msg', id: m.id, text: m.text, ts: m.ts })) break;
    }
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

  function sendMessage(text) {
    const id = S.active;
    if (!id) return;
    const c = ensureContact(id);
    const m = { id: msgId(), me: true, text, ts: Date.now(), st: 'pending' };
    const list = msgsOf(id);
    list.push(m);
    trim(list);
    saveMsgs(id);
    c.last = { text: text.slice(0, 140), me: true, ts: m.ts };
    c.updated = Date.now();
    saveContacts();
    appendMessage(m, true);
    renderList();
    if (isOpen(id)) sendTo(id, { t: 'msg', id: m.id, text, ts: m.ts });
    else dial(id);
    renderBanner();
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
    const items = Object.values(S.contacts).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    $('#list-empty').hidden = items.length > 0;
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
    renderChatHead(true);
    renderMessages();
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

  function renderMessages() {
    box.textContent = '';
    lastShown = null;
    const list = msgsOf(S.active);
    if (!list.length) {
      box.appendChild(introNode());
    } else {
      const frag = document.createDocumentFragment();
      for (const m of list) { nodesFor(m, lastShown).forEach((n) => frag.appendChild(n)); lastShown = m; }
      box.appendChild(frag);
    }
    hideJump();
    stick = true;
    requestAnimationFrame(() => scrollToBottom(false));
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
    row.appendChild(b);
    return row;
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
    sendMessage(text);
  }

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
      try {
        const n = new Notification(nameOf(c), { body: text.slice(0, 160), tag: 'rawaq-' + c.id, lang: 'ar', dir: 'rtl' });
        n.onclick = () => { window.focus(); openChat(c.id); n.close(); };
      } catch (_) { /* some mobile browsers only allow service-worker notifications */ }
    }
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
    if (e.key !== 'Escape') return;
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
  function readIntent() {
    const m = /(?:^|[#&?])to=([A-Za-z0-9-]{4,40})/.exec(location.hash + '&' + location.search);
    if (!m) return;
    intent = normalizeId(m[1]);
    history.replaceState(history.state, '', location.pathname);
  }
  function consumeIntent() {
    if (!intent || !S.me || !owner || currentView() !== 'main') return;
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
    });

    // sidebar
    $('#btn-theme').addEventListener('click', () => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark'));
    $('#btn-me').addEventListener('click', () => {
      $('#in-rename').value = S.me.name;
      renderNotify();
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
