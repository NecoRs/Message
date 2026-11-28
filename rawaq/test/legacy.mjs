import { setup, assert, until, sleep } from './harness.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { staticServer } from './servers.mjs';

const h = await setup(process.argv[2] ? { dir: process.argv[2] } : {});
let failed = false;
let oldSrv = null;
try {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'hams-old-'));
  execSync(`git -C ${path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')} archive --format=tar a34105c rawaq | tar -x -C ${old} --strip-components=1`);
  oldSrv = await staticServer(old, 8766);
  const A = await h.client('A');
  const idA = await h.signup(A, 'علي');
  const O = await h.client('OLD');
  await O.page.goto('http://127.0.0.1:8766/');
  const idO = await h.signup(O, 'قديم');
  await sleep(1500);
  await h.startChat(O, idA);
  await h.sendText(O, 'من النسخة القديمة');
  try {
    await until(() => A.page.locator(`#list [data-id="${idO}"]`).count(), 40000, 'A sees old client');
  } catch (e) {
    console.log(h.servers.fb.log.map((l) => `${l.method} ${l.path} ${l.body.slice(0, 80)}`).join('\n'));
    throw e;
  }
  await h.openChat(A, idO);
  await until(async () => (await A.page.locator('#messages .msg.them .text').last().textContent()).includes('من النسخة القديمة'), 30000, 'A gets old client msg');
  assert(true, 'old client to new client works');
  await h.sendText(A, 'من الجديدة للقديمة');
  await until(async () => (await O.page.locator('#messages .msg.them .text').last().textContent().catch(() => '')).includes('من الجديدة للقديمة'), 40000, 'old client gets new msg');
  assert(true, 'new client to old client works');
} catch (e) {
  failed = true;
  console.error('FAIL', e.message);
} finally {
  if (oldSrv) oldSrv.close();
  await h.close();
  process.exit(failed ? 1 : 0);
}
