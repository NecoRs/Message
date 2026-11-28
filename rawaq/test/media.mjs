import { setup, assert, until, sleep } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const h = await setup(process.argv[2] ? { dir: process.argv[2] } : {});
let failed = false;
try {
  const A = await h.client('A');
  const B = await h.client('B');
  const idA = await h.signup(A, 'علي');
  const idB = await h.signup(B, 'سارة');
  await h.startChat(A, idB);
  await h.sendText(A, 'هلا');
  await until(() => B.page.locator(`#list [data-id="${idA}"]`).count(), 20000, 'B sees A');
  await h.openChat(B, idA);

  const png = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'icons', 'icon-512.png'));
  await A.page.setInputFiles('#in-media', { name: 'photo.png', mimeType: 'image/png', buffer: png });
  await A.page.waitForSelector('#m-media.open');
  await A.page.fill('#in-caption', 'صورة مشفّرة');
  await A.page.click('#f-media button[type=submit]');
  await until(() => h.uploadLog.length >= 1, 15000, 'image uploaded');
  const imgUp = h.uploadLog[0];
  assert(/\/raw\/upload/.test(imgUp.endpoint), 'uploads go to the raw endpoint');
  const head = imgUp.head.toString('hex');
  assert(!head.startsWith('ffd8') && !head.startsWith('89504e47'), 'uploaded bytes are not a readable JPEG/PNG');
  await until(async () => (await B.page.locator('#messages .msg.them .media.image img').last().getAttribute('src') || '').startsWith('blob:'), 20000, 'B decrypts image');
  assert(true, 'receiver decrypts and shows the image');
  const nat = await B.page.locator('#messages .msg.them .media.image img').last().evaluate((i) => i.complete && i.naturalWidth);
  assert(nat > 0, 'decrypted image renders (' + nat + 'px wide)');

  const big = crypto.randomBytes(25 * 1024 * 1024);
  const want = crypto.createHash('sha256').update(big).digest('hex');
  const before = h.uploadLog.length;
  await A.page.setInputFiles('#in-media', { name: 'تقرير.pdf', mimeType: 'application/pdf', buffer: big });
  await A.page.waitForSelector('#m-media.open');
  await A.page.click('#f-media button[type=submit]');
  await until(() => h.uploadLog.length >= before + 3, 60000, 'file parts uploaded');
  assert(h.uploadLog.length - before === 3, 'a 25 MB file goes up in 3 encrypted parts');
  await until(() => B.page.locator('#messages .msg.them .file-card[data-view]').count(), 30000, 'B sees file card');
  const name = await B.page.locator('#messages .msg.them .file-card .file-name').last().textContent();
  assert(name === 'تقرير.pdf', 'file name arrives inside the encrypted message');
  const [dl] = await Promise.all([B.page.waitForEvent('download', { timeout: 60000 }), B.page.locator('#messages .msg.them .file-card').last().click()]);
  const p = await dl.path();
  const got = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  assert(got === want, 'downloaded file decrypts to the exact original 25 MB bytes');
  assert(!A.page.errors.length && !B.page.errors.length, 'no page errors');
} catch (e) {
  failed = true;
  console.error('FAIL', e.message);
} finally {
  await h.close();
  process.exit(failed ? 1 : 0);
}
