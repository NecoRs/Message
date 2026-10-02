/*
 * رواق — خادم التنبيهات (Cloudflare Worker)
 *
 * يستقبل { to: "ID" } من رواق، يقرأ اشتراك التنبيهات لهذا المعرّف من Firebase،
 * ويرسل له تنبيه Web Push فاضي (بدون محتوى) موقّع بمفتاح VAPID.
 * التطبيق نفسه يعرض «وصلتك رسالة جديدة»، فما يمر أي نص رسالة من هنا.
 *
 * متغيرات البيئة (Settings ← Variables):
 *   DB_URL             اسم قاعدة Firebase (مثل rawaq-b78a7-default-rtdb) أو رابطها الكامل
 *   VAPID_PUBLIC       المفتاح العام (من tools/vapid.html)
 *   VAPID_PRIVATE_JWK  المفتاح الخاص — كـ Secret (مشفّر)، لا تحطه في أي مكان ثاني
 *   VAPID_SUBJECT      اختياري: رابط موقعك أو mailto:بريدك
 *   ALLOW_ORIGIN       اختياري: رابط موقعك فقط بدل * (مثل https://necors.github.io)
 */

const ID_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    const reply = (status, body) => new Response(body == null ? null : JSON.stringify(body), {
      status, headers: { ...cors, 'Content-Type': 'application/json' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(200, { service: 'rawaq-push' });
    if (!env.DB_URL || !env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) return reply(500, { error: 'not configured' });

    let to;
    try { ({ to } = JSON.parse(await request.text())); } catch (_) { return reply(400, { error: 'bad json' }); }
    if (typeof to !== 'string' || !ID_RE.test(to)) return reply(400, { error: 'bad id' });

    const db = await resolveDb(env.DB_URL.trim());
    if (!db) return reply(500, { error: 'database not reachable' });
    const sub = await (await fetch(`${db}/push/${to}.json`)).json().catch(() => null);
    if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) return reply(200, { sent: false });

    const endpoint = new URL(sub.endpoint);
    const jwt = await vapidJwt(`${endpoint.protocol}//${endpoint.host}`, env);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: '86400',
        Urgency: 'high',
        Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
        'Content-Length': '0',
      },
    });
    // the subscription is gone (app uninstalled / permission revoked): forget it
    if (res.status === 404 || res.status === 410) await fetch(`${db}/push/${to}.json`, { method: 'DELETE' });
    return reply(200, { sent: res.ok, status: res.status });
  },
};

// DB_URL may be just the instance name: the REST host depends on the region,
// so try each Realtime Database region once and keep the one that answers.
const HOSTS = ['firebaseio.com', 'europe-west1.firebasedatabase.app', 'asia-southeast1.firebasedatabase.app'];
let dbCache = '';
async function resolveDb(v) {
  if (/^https:\/\//.test(v)) return v.replace(/\/+$/, '');
  if (dbCache) return dbCache;
  if (!/^[a-z0-9-]{3,63}$/.test(v)) return '';
  for (const h of HOSTS) {
    const u = `https://${v}.${h}`;
    try {
      const r = await fetch(`${u}/keys/PROBE.json`); // readable under the rules; 401 still proves the host
      if (r.ok || r.status === 401) { dbCache = u; return u; }
    } catch (_) { /* next region */ }
  }
  return '';
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function vapidJwt(aud, env) {
  const head = enc({ typ: 'JWT', alg: 'ES256' });
  const body = enc({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'https://necors.github.io/Message/',
  });
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key,
    new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
