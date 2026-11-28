import { setup, assert, until, sleep } from './harness.mjs';

const dir = process.argv[2];
const h = await setup(dir ? { dir } : {});
let failed = false;

const tap = () => {
  window.__wire = [];
  const orig = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (d) {
    try { window.__wire.push(typeof d === 'string' ? d : new TextDecoder().decode(d instanceof ArrayBuffer ? d : d.buffer || new Uint8Array())); } catch (_) { window.__wire.push('[binary]'); }
    return orig.call(this, d);
  };
};

try {
  const A = await h.client('A');
  const B = await h.client('B');
  await A.page.addInitScript(tap);
  await B.page.addInitScript(tap);
  await A.page.reload();
  await B.page.reload();
  const idA = await h.signup(A, 'علي');
  const idB = await h.signup(B, 'سارة');

  const SECRET = 'كلمة-سرية-' + Math.random().toString(36).slice(2, 8);
  await h.startChat(A, idB);
  await h.sendText(A, SECRET);
  await until(() => B.page.locator(`#list [data-id="${idA}"]`).count(), 20000, 'B sees A');
  await h.openChat(B, idA);
  await until(async () => (await B.page.locator('#messages .msg.them .text').last().textContent()).includes(SECRET), 15000, 'B gets secret');
  assert(true, 'message delivered over the encrypted link');
  await h.sendText(B, SECRET + '-رد');
  await until(async () => (await A.page.locator('#messages .msg.them .text').last().textContent()).includes(SECRET + '-رد'), 15000, 'A gets reply');

  const wireA = await A.page.evaluate(() => window.__wire.join('\n'));
  const wireB = await B.page.evaluate(() => window.__wire.join('\n'));
  assert(wireA.length > 0 && wireB.length > 0, 'data channel traffic was captured');
  assert(!wireA.includes(SECRET) && !wireB.includes(SECRET) && !wireA.includes('سارة') && !wireB.includes('علي'), 'no message text or names in raw data channel traffic');
  assert(!/"t":"(msg|hello|ack|read)"/.test(wireA + wireB), 'no plaintext protocol frames on the wire');
  assert(/"t":"hs"/.test(wireA) && /"t":"x"/.test(wireA), 'handshake and encrypted frames seen');

  await A.page.click('.chat-who.head-open');
  await A.page.waitForSelector('#profile.open');
  await A.page.click('#pf-safety');
  await until(async () => (await A.page.locator('#sf-grid span').count()) === 12, 15000, 'A safety number');
  await B.page.click('.chat-who.head-open');
  await B.page.waitForSelector('#profile.open');
  await B.page.click('#pf-safety');
  await until(async () => (await B.page.locator('#sf-grid span').count()) === 12, 15000, 'B safety number');
  const snA = await A.page.locator('#sf-grid').textContent();
  const snB = await B.page.locator('#sf-grid').textContent();
  assert(snA === snB && /^\d{60}$/.test(snA), 'safety numbers match on both sides: ' + snA.match(/.{5}/g).join(' '));
  await A.page.click('#sf-verify');
  await until(() => A.page.locator('#c-shield:not([hidden])').count(), 5000, 'shield shown');
  assert(true, 'marking verified shows the shield');
  await A.page.keyboard.press('Escape');
  await B.page.keyboard.press('Escape');
  await A.page.keyboard.press('Escape');
  await B.page.keyboard.press('Escape');

  await B.page.close();
  await sleep(1200);
  const OFF = SECRET + '-offline';
  await h.sendText(A, OFF);
  await until(() => h.servers.fb.log.some((l) => l.method === 'POST' && l.path === 'inbox/' + idB && l.body.includes('"v":2')), 20000, 'v2 mailbox drop');
  const posts = h.servers.fb.log.filter((l) => l.method === 'POST').map((l) => l.body).join('\n');
  assert(!posts.includes(OFF) && !posts.includes('علي'), 'mailbox envelopes contain no plaintext');
  assert(/"e":"[A-Za-z0-9+/=]{88}"/.test(posts), 'mailbox uses a fresh ephemeral key (v2)');
  const B2 = await B.ctx.newPage();
  await B2.addInitScript(tap);
  await B2.goto(h.base);
  await B2.waitForSelector('#v-main.on');
  await B2.locator(`#list [data-id="${idA}"]`).click();
  await until(async () => (await B2.locator('#messages .msg.them .text').last().textContent()).includes(OFF), 20000, 'B gets offline msg');
  assert(true, 'offline message delivered through mailbox v2');

  await B2.evaluate(async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits', 'deriveKey']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    localStorage.setItem('rawaq.keys', JSON.stringify({ priv: jwk, pub: btoa(String.fromCharCode(...raw)) }));
  });
  await B2.reload();
  await B2.waitForSelector('#v-main.on');
  await until(() => A.page.locator('#banner-wrap.show.alert').count(), 30000, 'A sees key-change banner');
  assert(true, 'a changed identity key is refused and flagged');
  const before = await B2.evaluate(() => JSON.parse(localStorage.getItem('rawaq.m.' + Object.keys(JSON.parse(localStorage.getItem('rawaq.contacts')))[0]) || '[]').length);
  await h.sendText(A, 'لا توصل');
  await sleep(6000);
  const after = await B2.evaluate(() => JSON.parse(localStorage.getItem('rawaq.m.' + Object.keys(JSON.parse(localStorage.getItem('rawaq.contacts')))[0]) || '[]').length);
  assert(before === after, 'nothing is sent to the changed key until it is accepted');
  await A.page.click('#banner-act');
  await until(async () => (await A.page.locator('#sf-alert:not([hidden])').count()) === 1, 5000, 'alert in safety sheet');
  await A.page.click('#sf-verify');
  await A.page.keyboard.press('Escape');
  await B2.locator(`#list [data-id="${idA}"]`).click();
  await until(async () => (await B2.locator('#messages .msg.them .text').last().textContent()).includes('لا توصل'), 30000, 'delivered after accepting');
  assert(true, 'after accepting the new code the pending message goes through');

  assert(!A.page.errors.length && !B.page.errors.length, 'no page errors');
} catch (e) {
  failed = true;
  console.error('FAIL', e.message);
} finally {
  await h.close();
  process.exit(failed ? 1 : 0);
}
