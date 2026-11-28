import { setup, assert, until, sleep, SHOTS } from './harness.mjs';
import fs from 'node:fs';

const h = await setup(process.argv[2] ? { dir: process.argv[2] } : {});
let failed = false;
const trackPcs = () => {
  window.__pcs = [];
  const Orig = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...a) { const pc = new Orig(...a); window.__pcs.push(pc); return pc; };
  window.RTCPeerConnection.prototype = Orig.prototype;
  Object.setPrototypeOf(window.RTCPeerConnection, Orig);
};
const inbound = (page, kind) => page.evaluate(async (k) => {
  let total = 0;
  for (const pc of window.__pcs) {
    if (pc.connectionState === 'closed') continue;
    const st = await pc.getStats();
    st.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === k) total += r.bytesReceived || 0; });
  }
  return total;
}, kind);

try {
  fs.mkdirSync(SHOTS, { recursive: true });
  const A = await h.client('A');
  const B = await h.client('B');
  for (const c of [A, B]) { await c.page.addInitScript(trackPcs); await c.page.reload(); }
  const idA = await h.signup(A, 'علي');
  const idB = await h.signup(B, 'سارة');
  await h.startChat(A, idB);
  await h.sendText(A, 'نتصل؟');
  await until(() => B.page.locator(`#list [data-id="${idA}"]`).count(), 20000, 'B sees A');
  await h.openChat(B, idA);
  await until(() => A.page.locator('#c-status.on').count(), 15000, 'A sees B online');

  await A.page.click('#btn-voice');
  await until(() => B.page.locator('#call[data-state="incoming"]').count(), 15000, 'B gets incoming call');
  await B.page.screenshot({ path: SHOTS + '/call-incoming.png' });
  assert(true, 'incoming voice call rings on the other side');
  await B.page.click('#call-accept');
  await until(async () => (await A.page.locator('#call[data-state="active"]').count()) && (await B.page.locator('#call[data-state="active"]').count()), 20000, 'call active');
  assert(true, 'call connects after the encryption fingerprints match');
  const a1 = await inbound(A.page, 'audio');
  await sleep(2500);
  const a2 = await inbound(A.page, 'audio');
  assert(a2 > a1, `audio is flowing (${a1} → ${a2} bytes)`);
  await A.page.click('#call-mute');
  assert((await A.page.getAttribute('#call-mute', 'aria-pressed')) === 'true', 'mute toggles');
  await A.page.screenshot({ path: SHOTS + '/call-active.png' });
  await A.page.click('#call-end');
  await until(async () => (await B.page.locator('#call').getAttribute('hidden')) !== null, 10000, 'B call closed');
  await until(() => B.page.locator('#messages .sys-row').count(), 5000, 'call log row');
  const logB = await B.page.locator('#messages .sys-row').last().textContent();
  assert(/مكالمة صوتية · \d+:\d\d/.test(logB), 'call is logged in the chat: ' + logB.trim());

  await A.page.click('#btn-video');
  await until(() => B.page.locator('#call[data-state="incoming"]').count(), 15000, 'B gets video call');
  await B.page.click('#call-accept');
  await until(async () => (await B.page.locator('#call[data-state="active"]').count()) && (await A.page.locator('#call[data-state="active"]').count()), 20000, 'video active');
  await until(() => B.page.evaluate(() => document.getElementById('call-remote').videoWidth > 0), 10000, 'remote video frames');
  assert(true, 'video call shows the other side\'s camera');
  await B.page.screenshot({ path: SHOTS + '/call-video.png' });
  await B.page.click('#call-end');
  await until(async () => (await A.page.locator('#call').getAttribute('hidden')) !== null, 10000, 'A video closed');

  await A.page.click('#btn-voice');
  await until(() => B.page.locator('#call[data-state="incoming"]').count(), 15000, 'B rings again');
  await A.page.click('#call-end');
  await until(() => B.page.locator('#messages .sys-row.missed').count(), 10000, 'missed call row');
  assert(true, 'a call hung up before answering shows as missed');

  await sleep(1500);
  await A.page.evaluate(() => {
    const d = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'localDescription');
    Object.defineProperty(RTCPeerConnection.prototype, 'localDescription', {
      configurable: true,
      get() {
        const v = d.get.call(this);
        if (!v) return v;
        return { type: v.type, sdp: v.sdp.replace(/a=fingerprint:(\S+) [0-9A-Fa-f:]+/g, 'a=fingerprint:$1 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF') };
      },
    });
  });
  await A.page.click('#btn-voice');
  await until(() => B.page.locator('#call[data-state="incoming"]').count(), 15000, 'B rings (tampered)');
  await B.page.click('#call-accept');
  await until(async () => ((await B.page.locator('#messages .sys-row').last().textContent()) || '').includes('أُوقفت لسبب أمني'), 25000, 'insecure call stopped');
  assert((await B.page.locator('#call[data-state="active"]').count()) === 0, 'a call whose fingerprint does not match is stopped before going live');
  await A.page.reload();
  await A.page.waitForSelector('#v-main.on');
  await A.page.locator(`#list [data-id="${idB}"]`).click();
  await until(() => A.page.locator('#c-status.on').count(), 20000, 'A reconnected');

  await A.page.hover('#btn-mic');
  await A.page.mouse.down();
  await sleep(2200);
  await A.page.mouse.up();
  await until(() => B.page.locator('#messages .msg.them .media.voice').count(), 30000, 'B gets voice message');
  assert(true, 'hold-to-record sends an encrypted voice message');
  const head = h.uploadLog[h.uploadLog.length - 1].head.toString('hex');
  assert(!head.startsWith('1a45dfa3') && !head.includes('66747970'), 'uploaded voice bytes are not a readable WebM/MP4');
  await B.page.locator('#messages .msg.them .media.voice .v-play').last().click();
  await until(() => B.page.locator('#messages .msg.them .media.voice.playing .v-wave i.on').count(), 10000, 'voice playing');
  assert(true, 'receiver decrypts and plays the voice message');
  await B.page.screenshot({ path: SHOTS + '/voice.png' });
  assert(!A.page.errors.length && !B.page.errors.length, 'no page errors');
} catch (e) {
  failed = true;
  console.error('FAIL', e.message);
} finally {
  await h.close();
  process.exit(failed ? 1 : 0);
}
