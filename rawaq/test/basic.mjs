import { setup, assert, until, sleep } from './harness.mjs';

const dir = process.argv[2];
const h = await setup(dir ? { dir } : {});
let failed = false;
try {
  const A = await h.client('A');
  const B = await h.client('B');
  const idA = await h.signup(A, 'علي');
  const idB = await h.signup(B, 'سارة');
  console.log('ids', idA, idB);

  await h.startChat(A, idB);
  await h.sendText(A, 'مرحبا سارة');
  await until(() => B.page.locator('#list [data-id="' + idA + '"]').count(), 20000, 'B sees chat from A');
  await h.openChat(B, idA);
  await until(async () => (await B.page.locator('#messages .msg.them .text').last().textContent()).includes('مرحبا سارة'), 10000, 'B gets text');
  assert(true, 'live message delivered');
  await until(() => A.page.locator('#messages .msg.me .tick[data-st="read"], #messages .msg.me .tick.read').count(), 10000, 'read tick').catch(() => {});

  await h.sendText(B, 'أهلين علي');
  await until(async () => (await A.page.locator('#messages .msg.them .text').last().textContent()).includes('أهلين علي'), 10000, 'A gets reply');
  assert(true, 'reply delivered');

  await B.page.close();
  await sleep(1500);
  await h.sendText(A, 'رسالة وأنتِ مسكّرة');
  await until(() => h.servers.fb.log.some((l) => l.method === 'POST' && l.path === 'inbox/' + idB), 20000, 'mailbox drop');
  assert(true, 'offline message dropped in mailbox');
  const B2 = await B.ctx.newPage();
  B2.on('pageerror', (e) => console.log('[B2] PAGEERROR', e.message));
  await B2.goto(h.base);
  await B2.waitForSelector('#v-main.on');
  await B2.locator('#list [data-id="' + idA + '"]').click();
  await until(async () => (await B2.locator('#messages .msg.them .text').last().textContent()).includes('رسالة وأنتِ مسكّرة'), 20000, 'B gets offline msg');
  assert(true, 'offline message delivered after reopening');
  assert(!A.page.errors.length && !B.page.errors.length, 'no page errors');
} catch (e) {
  failed = true;
  console.error('FAIL', e.message);
} finally {
  await h.close();
  process.exit(failed ? 1 : 0);
}
