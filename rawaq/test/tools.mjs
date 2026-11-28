import { setup, assert, until, sleep, SHOTS } from './harness.mjs';
import fs from 'node:fs';

const h = await setup(process.argv[2] ? { dir: process.argv[2] } : {});
let failed = false;
const lastThem = (c) => c.page.locator('#messages .msg.them').last();
const lastMe = (c) => c.page.locator('#messages .msg.me').last();
async function ctxAct(c, row, act) {
  await row.locator('.bubble').click({ button: 'right' });
  await c.page.waitForSelector('#ctx.open');
  await c.page.click(`#ctx [data-act="${act}"]`);
}

try {
  fs.mkdirSync(SHOTS, { recursive: true });
  const A = await h.client('A');
  const B = await h.client('B');
  const C = await h.client('C');
  const idA = await h.signup(A, 'علي');
  const idB = await h.signup(B, 'سارة');
  const idC = await h.signup(C, 'خالد');
  await h.startChat(A, idB);
  await h.sendText(A, 'موعدنا الساعة خمسة');
  await until(() => B.page.locator(`#list [data-id="${idA}"]`).count(), 20000, 'B sees A');
  await h.openChat(B, idA);
  await until(async () => (await lastThem(B).locator('.text').textContent()).includes('خمسة'), 15000, 'B gets msg');

  await ctxAct(A, lastMe(A), 'edit');
  assert((await A.page.inputValue('#input')) === 'موعدنا الساعة خمسة', 'edit puts the text in the composer');
  await A.page.fill('#input', 'موعدنا الساعة ستة');
  await A.page.click('#send');
  await until(async () => (await lastThem(B).locator('.text').textContent()).includes('ستة'), 15000, 'B sees edit');
  assert((await lastThem(B).locator('.m-ed').count()) === 1, 'edited message is labelled on the other side');

  await ctxAct(A, lastMe(A), 'pin');
  await until(() => B.page.locator('#pin-bar:not([hidden])').count(), 15000, 'B pin bar');
  assert((await B.page.textContent('#pin-text')).includes('ستة'), 'pinned message shows for both sides');

  await ctxAct(B, lastThem(B), 'star');
  await until(() => lastThem(B).locator('.m-star').count(), 5000, 'star icon');
  await B.page.click('#btn-back');
  await sleep(700);
  await B.page.click('#btn-me');
  await B.page.waitForSelector('#m-me.open');
  assert((await B.page.textContent('#starred-count')) === '1', 'starred counter shows 1');
  await B.page.click('#btn-starred');
  await B.page.waitForSelector('#m-starred.open');
  assert((await B.page.locator('#star-list .star-item').count()) === 1, 'starred list has the message');
  await B.page.click('#star-list .star-item');
  await until(() => B.page.locator('#chat-pane:not([hidden])').count(), 5000, 'starred opens chat');
  assert(true, 'tapping a starred message opens its chat');

  await A.page.click('#btn-back');
  await sleep(700);
  await h.startChat(A, idC);
  await h.sendText(A, 'هلا خالد');
  await until(() => C.page.locator(`#list [data-id="${idA}"]`).count(), 20000, 'C sees A');
  await A.page.click('#btn-back');
  await sleep(700);
  await h.openChat(A, idB);
  await ctxAct(A, lastMe(A), 'forward');
  await A.page.waitForSelector('#m-forward.open');
  await A.page.locator('#fw-list label.pick', { has: A.page.locator(`input[value="${idC}"]`) }).click();
  await A.page.click('#fw-send');
  await sleep(300);
  await h.openChat(C, idA);
  await until(async () => (await lastThem(C).textContent()).includes('ستة'), 20000, 'C gets forward');
  assert((await lastThem(C).locator('.fw-label').count()) === 1, 'forwarded message is labelled');

  await A.page.click('#btn-chat-menu');
  await A.page.waitForSelector('#m-chat.open');
  await A.page.click('#btn-find');
  await A.page.fill('#find-q', 'ستة');
  await until(async () => (await A.page.textContent('#find-n')) === '1/1', 5000, 'find count');
  assert(true, 'in-chat search finds the message');
  const hl = await A.page.evaluate(() => (window.CSS && CSS.highlights && CSS.highlights.get('hams-find') ? CSS.highlights.get('hams-find').size : -1));
  assert(hl === 1, 'search term is highlighted');
  await A.page.click('#find-x');

  await A.page.click('#btn-emoji');
  await A.page.waitForSelector('#emoji-panel:not([hidden])');
  await A.page.locator('#emoji-grid .emoji').nth(3).click();
  const val = await A.page.inputValue('#input');
  assert(val.length > 0, 'emoji picker inserts into the composer: ' + val);
  await A.page.screenshot({ path: SHOTS + '/emoji.png' });
  await A.page.click('#btn-emoji');
  await A.page.fill('#input', '');

  await h.sendText(B, 'تمام');
  await until(async () => (await lastThem(A).locator('.text').textContent()).includes('تمام'), 15000, 'A gets تمام');
  await lastThem(A).locator('.bubble').click({ button: 'right' });
  await A.page.waitForSelector('#ctx.open');
  await A.page.click('#ctx .react.more');
  await A.page.waitForSelector('#emoji-panel:not([hidden])');
  await A.page.locator('#emoji-grid .emoji', { hasText: '🔥' }).first().click().catch(async () => {
    await A.page.click('#emoji-tabs .emoji-tab:nth-child(4)');
    await A.page.locator('#emoji-grid .emoji', { hasText: '🔥' }).first().click();
  });
  await until(async () => ((await lastMe(B).locator('.rx').textContent().catch(() => '')) || '').includes('🔥'), 15000, 'B sees 🔥 reaction');
  assert(true, 'reaction picked from the full emoji picker reaches the other side');
  await B.page.screenshot({ path: SHOTS + '/tools-B.png' });
  assert(!A.page.errors.length && !B.page.errors.length && !C.page.errors.length, 'no page errors');
} catch (e) {
  failed = true;
  console.error('FAIL', e.message);
} finally {
  await h.close();
  process.exit(failed ? 1 : 0);
}
