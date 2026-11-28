(function (root, factory) {
  const api = factory(root.crypto || (typeof require === 'function' ? require('node:crypto').webcrypto : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HamsE2E = api;
})(typeof self !== 'undefined' ? self : globalThis, function (webcrypto) {
  'use strict';

  const subtle = webcrypto && webcrypto.subtle;
  const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
  const utf8 = new TextEncoder();
  const unutf8 = new TextDecoder();

  const b64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (str) => {
    const bin = atob(str);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  const concat = (...parts) => {
    const len = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const rand = (n) => webcrypto.getRandomValues(new Uint8Array(n));
  const isPub = (s) => typeof s === 'string' && s.length === 88 && /^[A-Za-z0-9+/]+=*$/.test(s);

  async function genIdentity() {
    const kp = await subtle.generateKey(ECDH, true, ['deriveBits', 'deriveKey']);
    const jwk = await subtle.exportKey('jwk', kp.privateKey);
    const pub = b64(new Uint8Array(await subtle.exportKey('raw', kp.publicKey)));
    return { jwk, pub };
  }

  async function importIdentity(jwk, pub) {
    const clean = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d, ext: true };
    const priv = await subtle.importKey('jwk', clean, ECDH, false, ['deriveBits', 'deriveKey']);
    return { priv, pub };
  }

  async function genEphemeral() {
    const kp = await subtle.generateKey(ECDH, true, ['deriveBits']);
    const pub = b64(new Uint8Array(await subtle.exportKey('raw', kp.publicKey)));
    return { priv: kp.privateKey, pub };
  }

  async function dh(priv, pubB64) {
    if (!isPub(pubB64)) throw new Error('bad public key');
    const pub = await subtle.importKey('raw', unb64(pubB64), ECDH, false, []);
    return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
  }

  async function hkdf(ikm, salt, info, bits) {
    const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bits));
  }

  const aesKey = (raw, usages = ['encrypt', 'decrypt']) => subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);
  const sha256 = async (u8) => new Uint8Array(await subtle.digest('SHA-256', u8));

  const TAG_LH = new Uint8Array([0x4c, 0x48, 0x76, 0x31]);
  const TAG_HL = new Uint8Array([0x48, 0x4c, 0x76, 0x31]);

  async function session({ myId, theirId, ik, ek, theirIk, theirEk, connId }) {
    if (myId === theirId) throw new Error('same id');
    const low = myId < theirId;
    const [L, H] = low ? [myId, theirId] : [theirId, myId];
    const [ikL, ekL, ikH, ekH] = low ? [ik.pub, ek.pub, theirIk, theirEk] : [theirIk, theirEk, ik.pub, ek.pub];
    const d1 = low ? await dh(ik.priv, theirEk) : await dh(ek.priv, theirIk);
    const d2 = low ? await dh(ek.priv, theirIk) : await dh(ik.priv, theirEk);
    const d3 = await dh(ek.priv, theirEk);
    const transcript = await sha256(utf8.encode([L, ikL, ekL, H, ikH, ekH, String(connId || '')].join('|')));
    const okm = await hkdf(concat(d1, d2, d3), utf8.encode(L + '|' + H), concat(utf8.encode('hams/s/v1'), transcript), 512);
    const kLH = await aesKey(okm.slice(0, 32));
    const kHL = await aesKey(okm.slice(32, 64));
    return {
      send: low ? kLH : kHL,
      recv: low ? kHL : kLH,
      sendTag: low ? TAG_LH : TAG_HL,
      recvTag: low ? TAG_HL : TAG_LH,
      sendAad: utf8.encode(myId + '>' + theirId),
      recvAad: utf8.encode(theirId + '>' + myId),
    };
  }

  const ivFor = (tag, n) => {
    const iv = new Uint8Array(12);
    iv.set(tag, 0);
    const v = new DataView(iv.buffer);
    v.setUint32(4, Math.floor(n / 0x100000000));
    v.setUint32(8, n >>> 0);
    return iv;
  };

  async function sealFrame(s, n, obj) {
    const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv: ivFor(s.sendTag, n), additionalData: s.sendAad }, s.send, utf8.encode(json));
    return b64(new Uint8Array(ct));
  }

  async function openFrame(s, n, c) {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: ivFor(s.recvTag, n), additionalData: s.recvAad }, s.recv, unb64(c));
    return JSON.parse(unutf8.decode(pt));
  }

  async function mailKey({ salt, ikm, info }) {
    return aesKey(await hkdf(ikm, salt, info, 256));
  }

  async function mbSeal({ from, to, ik, theirIk, obj }) {
    const ek = await genEphemeral();
    const d1 = await dh(ek.priv, theirIk);
    const d2 = await dh(ik.priv, theirIk);
    const key = await mailKey({ salt: utf8.encode(from + '>' + to), ikm: concat(d1, d2), info: utf8.encode(['hams/m/v1', ik.pub, theirIk, ek.pub].join('|')) });
    const iv = rand(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(`v2|${from}>${to}|${ek.pub}`) }, key, utf8.encode(JSON.stringify(obj)));
    return { e: ek.pub, iv: b64(iv), c: b64(new Uint8Array(ct)) };
  }

  async function mbOpen({ from, to, ik, theirIk, e, iv, c }) {
    const d1 = await dh(ik.priv, e);
    const d2 = await dh(ik.priv, theirIk);
    const key = await mailKey({ salt: utf8.encode(from + '>' + to), ikm: concat(d1, d2), info: utf8.encode(['hams/m/v1', theirIk, ik.pub, e].join('|')) });
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: utf8.encode(`v2|${from}>${to}|${e}`) }, key, unb64(c));
    return JSON.parse(unutf8.decode(pt));
  }

  async function legacyKey(ikPriv, theirIk) {
    const pub = await subtle.importKey('raw', unb64(theirIk), ECDH, false, []);
    return subtle.deriveKey({ name: 'ECDH', public: pub }, ikPriv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function mbOpenLegacy({ from, to, ik, theirIk, iv, c }) {
    const key = await legacyKey(ik.priv, theirIk);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: utf8.encode(`${from}>${to}`) }, key, unb64(c));
    return JSON.parse(unutf8.decode(pt));
  }

  async function mbSealLegacy({ from, to, ik, theirIk, obj }) {
    const key = await legacyKey(ik.priv, theirIk);
    const iv = rand(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(`${from}>${to}`) }, key, utf8.encode(JSON.stringify(obj)));
    return { iv: b64(iv), c: b64(new Uint8Array(ct)) };
  }

  const PART = 9 * 1024 * 1024;
  const partIv = (base, i) => {
    const iv = new Uint8Array(12);
    iv.set(base, 0);
    new DataView(iv.buffer).setUint32(8, i);
    return iv;
  };

  async function encryptFile(buf, partSize = PART) {
    const raw = rand(32);
    const base = rand(8);
    const key = await aesKey(raw, ['encrypt']);
    const data = new Uint8Array(buf);
    const n = Math.max(1, Math.ceil(data.length / partSize));
    const parts = [];
    for (let i = 0; i < n; i++) {
      const chunk = data.subarray(i * partSize, Math.min(data.length, (i + 1) * partSize));
      parts.push(new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: partIv(base, i), additionalData: utf8.encode(`${i}/${n}`) }, key, chunk)));
    }
    return { key: b64(raw), iv: b64(base), parts };
  }

  async function decryptPart(keyB64, ivB64, i, n, bytes) {
    const key = await aesKey(unb64(keyB64), ['decrypt']);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: partIv(unb64(ivB64), i), additionalData: utf8.encode(`${i}/${n}`) }, key, bytes));
  }

  async function encryptSmall(keyB64, ivB64, bytes) {
    const key = await aesKey(unb64(keyB64), ['encrypt']);
    return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: partIv(unb64(ivB64), 0xffffffff), additionalData: utf8.encode('thumb') }, key, bytes));
  }

  async function decryptSmall(keyB64, ivB64, bytes) {
    const key = await aesKey(unb64(keyB64), ['decrypt']);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: partIv(unb64(ivB64), 0xffffffff), additionalData: utf8.encode('thumb') }, key, bytes));
  }

  async function fingerprintHalf(id, pub) {
    const key = unb64(pub);
    let h = new Uint8Array(await subtle.digest('SHA-512', concat(new Uint8Array([0, 0]), key, utf8.encode(id))));
    for (let i = 0; i < 5200; i++) h = new Uint8Array(await subtle.digest('SHA-512', concat(h, key)));
    let out = '';
    for (let i = 0; i < 30; i += 5) {
      const v = h[i] * 2 ** 32 + h[i + 1] * 2 ** 24 + h[i + 2] * 2 ** 16 + h[i + 3] * 2 ** 8 + h[i + 4];
      out += String(v % 100000).padStart(5, '0');
    }
    return out;
  }

  async function safetyNumber(idA, pubA, idB, pubB) {
    const [a, b] = idA < idB ? [[idA, pubA], [idB, pubB]] : [[idB, pubB], [idA, pubA]];
    const digits = (await fingerprintHalf(a[0], a[1])) + (await fingerprintHalf(b[0], b[1]));
    return digits.match(/.{5}/g);
  }

  return {
    b64, unb64, utf8, isPub, rand, sha256,
    genIdentity, importIdentity, genEphemeral, dh, hkdf, session, sealFrame, openFrame,
    mbSeal, mbOpen, mbSealLegacy, mbOpenLegacy,
    encryptFile, decryptPart, encryptSmall, decryptSmall, PART,
    safetyNumber,
  };
});
