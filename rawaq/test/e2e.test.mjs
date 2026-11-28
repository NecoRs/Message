import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mod = { exports: {} };
new Function('module', fs.readFileSync(new URL('../e2e.js', import.meta.url), 'utf8'))(mod);
const E = mod.exports;

async function identity() {
  const { jwk, pub } = await E.genIdentity();
  return E.importIdentity(jwk, pub);
}

async function pair(idA = 'AAAAAA', idB = 'ZZZZZZ', connId = 'dc_1') {
  const [ikA, ikB, ekA, ekB] = await Promise.all([identity(), identity(), E.genEphemeral(), E.genEphemeral()]);
  const sa = await E.session({ myId: idA, theirId: idB, ik: ikA, ek: ekA, theirIk: ikB.pub, theirEk: ekB.pub, connId });
  const sb = await E.session({ myId: idB, theirId: idA, ik: ikB, ek: ekB, theirIk: ikA.pub, theirEk: ekA.pub, connId });
  return { sa, sb, ikA, ikB, ekA, ekB };
}

test('both roles derive matching directional keys', async () => {
  for (const [a, b] of [['AAAAAA', 'ZZZZZZ'], ['ZZZZZZ', 'AAAAAA']]) {
    const { sa, sb } = await pair(a, b);
    const c = await E.sealFrame(sa, 0, { t: 'fin', x: 'سلام' });
    assert.deepEqual(await E.openFrame(sb, 0, c), { t: 'fin', x: 'سلام' });
    const d = await E.sealFrame(sb, 0, { t: 'msg', text: 'back' });
    assert.deepEqual(await E.openFrame(sa, 0, d), { t: 'msg', text: 'back' });
  }
});

test('a frame cannot be opened with the wrong counter, direction or tampering', async () => {
  const { sa, sb } = await pair();
  const c = await E.sealFrame(sa, 5, { t: 'msg', text: 'hi' });
  await assert.rejects(E.openFrame(sb, 6, c));
  await assert.rejects(E.openFrame(sa, 5, c));
  const bytes = E.unb64(c);
  bytes[3] ^= 1;
  await assert.rejects(E.openFrame(sb, 5, E.b64(bytes)));
});

test('a different connection id or a substituted identity key gives unrelated keys', async () => {
  const { sa, ikA, ikB, ekA, ekB } = await pair();
  const other = await E.session({ myId: 'ZZZZZZ', theirId: 'AAAAAA', ik: ikB, ek: ekB, theirIk: ikA.pub, theirEk: ekA.pub, connId: 'dc_2' });
  const c = await E.sealFrame(sa, 0, { t: 'fin' });
  await assert.rejects(E.openFrame(other, 0, c));
  const mallory = await identity();
  const evil = await E.session({ myId: 'ZZZZZZ', theirId: 'AAAAAA', ik: mallory, ek: ekB, theirIk: ikA.pub, theirEk: ekA.pub, connId: 'dc_1' });
  await assert.rejects(E.openFrame(evil, 0, c));
});

test('mailbox v2 round trip, bound to sender, recipient and key', async () => {
  const [a, b, m] = await Promise.all([identity(), identity(), identity()]);
  const env = await E.mbSeal({ from: 'AAAAAA', to: 'BBBBBB', ik: a, theirIk: b.pub, obj: { d: { t: 'msg', text: 'offline' } } });
  assert.deepEqual(await E.mbOpen({ from: 'AAAAAA', to: 'BBBBBB', ik: b, theirIk: a.pub, ...env }), { d: { t: 'msg', text: 'offline' } });
  await assert.rejects(E.mbOpen({ from: 'CCCCCC', to: 'BBBBBB', ik: b, theirIk: a.pub, ...env }));
  await assert.rejects(E.mbOpen({ from: 'AAAAAA', to: 'BBBBBB', ik: b, theirIk: m.pub, ...env }));
  const forged = await E.mbSeal({ from: 'AAAAAA', to: 'BBBBBB', ik: m, theirIk: b.pub, obj: { d: { t: 'msg', text: 'forged' } } });
  await assert.rejects(E.mbOpen({ from: 'AAAAAA', to: 'BBBBBB', ik: b, theirIk: a.pub, ...forged }));
});

test('legacy mailbox format still opens', async () => {
  const [a, b] = await Promise.all([identity(), identity()]);
  const env = await E.mbSealLegacy({ from: 'AAAAAA', to: 'BBBBBB', ik: a, theirIk: b.pub, obj: { d: { t: 'msg', text: 'v1' } } });
  assert.deepEqual(await E.mbOpenLegacy({ from: 'AAAAAA', to: 'BBBBBB', ik: b, theirIk: a.pub, ...env }), { d: { t: 'msg', text: 'v1' } });
});

test('file parts decrypt in place and detect reordering or truncation', async () => {
  const data = new Uint8Array(25 * 1024);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const enc = await E.encryptFile(data, 10 * 1024);
  assert.equal(enc.parts.length, 3);
  const out = [];
  for (let i = 0; i < 3; i++) out.push(await E.decryptPart(enc.key, enc.iv, i, 3, enc.parts[i]));
  assert.deepEqual(Buffer.concat(out), Buffer.from(data));
  await assert.rejects(E.decryptPart(enc.key, enc.iv, 0, 3, enc.parts[1]));
  await assert.rejects(E.decryptPart(enc.key, enc.iv, 0, 2, enc.parts[0]));
  const t = await E.encryptSmall(enc.key, enc.iv, new Uint8Array([1, 2, 3]));
  assert.deepEqual([...(await E.decryptSmall(enc.key, enc.iv, t))], [1, 2, 3]);
});

test('safety number is the same on both sides and changes with the key', async () => {
  const [a, b, c] = await Promise.all([identity(), identity(), identity()]);
  const s1 = await E.safetyNumber('AAAAAA', a.pub, 'BBBBBB', b.pub);
  const s2 = await E.safetyNumber('BBBBBB', b.pub, 'AAAAAA', a.pub);
  assert.equal(s1.length, 12);
  assert.ok(s1.every((g) => /^\d{5}$/.test(g)));
  assert.deepEqual(s1, s2);
  const s3 = await E.safetyNumber('AAAAAA', a.pub, 'BBBBBB', c.pub);
  assert.notDeepEqual(s1, s3);
});

test('an old deriveKey-only identity JWK imports for the new handshake', async () => {
  const kp = await globalThis.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const jwk = await globalThis.crypto.subtle.exportKey('jwk', kp.privateKey);
  assert.deepEqual(jwk.key_ops, ['deriveKey']);
  const pub = E.b64(new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', kp.publicKey)));
  const ik = await E.importIdentity(jwk, pub);
  const ek = await E.genEphemeral();
  assert.equal((await E.dh(ik.priv, ek.pub)).length, 32);
});
