// Content for Phantom Console: syntactically valid code samples, log and
// table generators and the status simulator. Everything is simulated and
// local; addresses come from the documentation ranges (RFC 5737).

/* --------------------------------------------------------------- random */

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const int = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const chance = (p) => Math.random() < p;
export const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[int(0, 15)]).join('');
export const fmtInt = (n) => n.toLocaleString('en-US');
export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const RANGES = ['192.0.2', '198.51.100', '203.0.113'];
export const docIp = () => `${pick(RANGES)}.${int(10, 240)}`;
export const DOC_NODES = [
  { node: 'edge-a', ip: '192.0.2.10' },
  { node: 'core-1', ip: '198.51.100.20' },
  { node: 'store-2', ip: '203.0.113.30' },
  { node: 'relay-3', ip: '192.0.2.44' },
  { node: 'cache-4', ip: '198.51.100.73' },
  { node: 'audit-5', ip: '203.0.113.91' },
  { node: 'edge-b', ip: '192.0.2.118' },
  { node: 'queue-6', ip: '198.51.100.142' },
];

export const clockTime = (ms = false) => {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${ms ? '.' + p(d.getMilliseconds(), 3) : ''}`;
};

/* ---------------------------------------------------------- code samples */

export const SNIPPETS = [
  {
    id: 'log_parser',
    lang: 'python',
    file: 'log_summary.py',
    tags: ['logs'],
    code: `#!/usr/bin/env python3
"""Summarise authentication events from a local JSONL sample."""
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

DATASET = Path("datasets/auth_events.jsonl")
THRESHOLD = 25


def load_events(path: Path):
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield json.loads(line)


def summarise(events):
    failures = Counter()
    first_seen = {}
    for event in events:
        source = event.get("source", "unknown")
        if event.get("outcome") == "failure":
            failures[source] += 1
        first_seen.setdefault(source, event["timestamp"])
    return failures, first_seen


def main() -> None:
    failures, first_seen = summarise(load_events(DATASET))
    for source, count in failures.most_common(5):
        flag = "REVIEW" if count > THRESHOLD else "ok"
        stamp = datetime.fromisoformat(first_seen[source]).strftime("%H:%M:%S")
        print(f"{source:<16} {count:>5}  first={stamp}  [{flag}]")


if __name__ == "__main__":
    main()`,
  },
  {
    id: 'latency_stats',
    lang: 'python',
    file: 'latency_report.py',
    tags: ['telemetry', 'network'],
    code: `import csv
import statistics
from pathlib import Path


def read_latency(path: Path) -> dict[str, list[float]]:
    samples: dict[str, list[float]] = {}
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            samples.setdefault(row["node"], []).append(float(row["latency_ms"]))
    return samples


def report(samples: dict[str, list[float]]) -> None:
    for node, values in sorted(samples.items()):
        p95 = statistics.quantiles(values, n=20)[18]
        status = "DEGRADED" if p95 > 120 else "OK"
        print(f"{node:<10} mean={statistics.mean(values):6.1f}ms p95={p95:6.1f}ms {status}")


if __name__ == "__main__":
    report(read_latency(Path("datasets/latency.csv")))`,
  },
  {
    id: 'topology',
    lang: 'python',
    file: 'topology.py',
    tags: ['network'],
    code: `from dataclasses import dataclass, field
from ipaddress import ip_address


@dataclass(order=True)
class Node:
    name: str
    address: str
    latency_ms: float = 0.0
    tags: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        ip_address(self.address)  # documentation-range address only


TOPOLOGY = [
    Node("edge-a", "192.0.2.10", 12.4, ["edge"]),
    Node("core-1", "198.51.100.20", 3.1, ["core"]),
    Node("store-2", "203.0.113.30", 21.7, ["storage"]),
]

for node in sorted(TOPOLOGY, key=lambda n: n.latency_ms):
    print(f"{node.name:<8} {node.address:<15} {node.latency_ms:>6.1f} ms {','.join(node.tags)}")`,
  },
  {
    id: 'telemetry_parser',
    lang: 'javascript',
    file: 'telemetry.js',
    tags: ['telemetry'],
    code: `'use strict';

const fs = require('fs');

const STATES = new Set(['SYNCED', 'SYNCING', 'DEGRADED']);

function parseFrame(raw) {
  const frame = JSON.parse(raw);
  if (!STATES.has(frame.state)) {
    throw new Error(\`unknown state: \${frame.state}\`);
  }
  return {
    node: frame.node,
    latency: Number(frame.metrics.latency_ms),
    checksum: frame.checksum.toLowerCase(),
  };
}

function aggregate(frames) {
  const byNode = new Map();
  for (const f of frames) {
    const entry = byNode.get(f.node) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += f.latency;
    byNode.set(f.node, entry);
  }
  return [...byNode].map(([node, { count, total }]) => ({
    node,
    frames: count,
    avgLatency: +(total / count).toFixed(1),
  }));
}

const lines = fs.readFileSync('./datasets/telemetry.ndjson', 'utf8').trim().split('\\n');
console.table(aggregate(lines.map(parseFrame)));`,
  },
  {
    id: 'log_tally',
    lang: 'javascript',
    file: 'tally.mjs',
    tags: ['logs'],
    code: `import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

export async function tally(file, minLevel = 'INFO') {
  const counts = Object.fromEntries(Object.keys(LEVELS).map((k) => [k, 0]));
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const match = /^\\S+ (DEBUG|INFO|WARN|ERROR) /.exec(line);
    if (match && LEVELS[match[1]] >= LEVELS[minLevel]) {
      counts[match[1]] += 1;
    }
  }
  return counts;
}

tally('./logs/collector.log').then((c) => console.log(JSON.stringify(c, null, 2)));`,
  },
  {
    id: 'health_check',
    lang: 'bash',
    file: 'health.sh',
    tags: ['diag'],
    code: `#!/usr/bin/env bash
# Collect a quick health snapshot of the local lab VM.
set -euo pipefail

LOG_DIR="\${HOME}/diagnostics"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "\${LOG_DIR}"

report() {
  printf '%-18s %s\\n' "$1" "$2" | tee -a "\${LOG_DIR}/health-\${STAMP}.log"
}

report "hostname" "$(hostname)"
report "uptime" "$(uptime -p)"
report "load" "$(cut -d' ' -f1-3 /proc/loadavg)"
report "memory" "$(free -h | awk '/^Mem:/ {print $3 "/" $2}')"
report "disk(/)" "$(df -h / | awk 'NR==2 {print $5}')"

for svc in ssh nginx postgresql; do
  if systemctl is-active --quiet "\${svc}"; then
    report "service:\${svc}" "running"
  else
    report "service:\${svc}" "inactive"
  fi
done`,
  },
  {
    id: 'log_rotate',
    lang: 'bash',
    file: 'rotate.sh',
    tags: ['logs', 'diag'],
    code: `#!/usr/bin/env bash
# Compress simulator logs older than a day and keep the newest 14 archives.
set -euo pipefail
cd /var/log/phantom-sim

find . -maxdepth 1 -name '*.log' -mtime +1 -print0 |
  while IFS= read -r -d '' file; do
    gzip -9 "\${file}"
    echo "archived \${file#./}"
  done

ls -1t ./*.log.gz 2>/dev/null | tail -n +15 | xargs -r rm -f --
echo "retention: $(ls -1 ./*.log.gz 2>/dev/null | wc -l) archives kept"`,
  },
  {
    id: 'crc32',
    lang: 'c',
    file: 'crc32.c',
    tags: ['integrity'],
    code: `#include <stdint.h>
#include <stdio.h>

static uint32_t table[256];

static void crc32_init(void) {
    for (uint32_t i = 0; i < 256; i++) {
        uint32_t c = i;
        for (int k = 0; k < 8; k++) {
            c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
        }
        table[i] = c;
    }
}

static uint32_t crc32_update(uint32_t c, const uint8_t *buf, size_t len) {
    for (size_t i = 0; i < len; i++) {
        c = table[(c ^ buf[i]) & 0xFF] ^ (c >> 8);
    }
    return c;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <file>\\n", argv[0]);
        return 1;
    }
    FILE *fp = fopen(argv[1], "rb");
    if (!fp) {
        perror("fopen");
        return 1;
    }
    crc32_init();
    uint8_t chunk[4096];
    uint32_t crc = 0xFFFFFFFFu;
    size_t n;
    while ((n = fread(chunk, 1, sizeof chunk, fp)) > 0) {
        crc = crc32_update(crc, chunk, n);
    }
    fclose(fp);
    printf("%08x  %s\\n", crc ^ 0xFFFFFFFFu, argv[1]);
    return 0;
}`,
  },
  {
    id: 'hourly_sql',
    lang: 'sql',
    file: 'hourly_volume.sql',
    tags: ['db'],
    code: `-- Hourly event volume per source in the local sample database.
WITH hourly AS (
    SELECT
        source,
        strftime('%Y-%m-%d %H:00', ts) AS hour,
        COUNT(*) AS events,
        SUM(CASE WHEN severity >= 3 THEN 1 ELSE 0 END) AS elevated
    FROM events
    WHERE ts >= datetime('now', '-24 hours')
    GROUP BY source, hour
)
SELECT
    source,
    SUM(events) AS total_events,
    ROUND(AVG(events), 1) AS avg_per_hour,
    SUM(elevated) AS elevated_events
FROM hourly
GROUP BY source
ORDER BY total_events DESC
LIMIT 8;`,
  },
  {
    id: 'baseline',
    lang: 'json',
    file: 'baseline.json',
    tags: ['inventory'],
    code: `{
  "profile": "hardened-v3",
  "asset": "web-01",
  "checks": {
    "tls": { "min_version": "1.2", "hsts": true },
    "ssh": { "permit_root_login": false, "password_auth": false },
    "http": { "server_tokens": false, "max_body_size": "8m" }
  },
  "baseline_versions": {
    "nginx": "1.26.2",
    "openssh": "9.6p1",
    "postgresql": "16.4"
  },
  "report": { "format": "summary", "output": "./reports" }
}`,
  },
  {
    id: 'stream_config',
    lang: 'json',
    file: 'streams.json',
    tags: ['telemetry'],
    code: `{
  "streams": [
    { "name": "telemetry", "interval_ms": 500, "codec": "ndjson" },
    { "name": "events", "interval_ms": 250, "codec": "jsonl" },
    { "name": "metrics", "interval_ms": 1000, "codec": "csv" }
  ],
  "retention_hours": 72,
  "checksum": "crc32",
  "simulation": { "mode": "offline", "live_targets": 0 }
}`,
  },
];

export const snippetsFor = (tag) => SNIPPETS.filter((s) => s.tags.includes(tag));

/* ------------------------------------------------------------ highlighter */

const KEYWORDS = {
  python: 'and as assert break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield async await',
  javascript: 'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
  bash: 'if then else elif fi for in do done while until case esac function return local export set readonly',
  c: 'if else for while do return switch case break continue static const struct typedef sizeof void int char long short unsigned signed float double size_t uint8_t uint32_t FILE',
  sql: 'WITH AS SELECT FROM WHERE GROUP BY ORDER DESC ASC LIMIT SUM COUNT AVG ROUND CASE WHEN THEN ELSE END AND OR NOT IN JOIN ON HAVING',
  json: 'true false null',
};
const BUILTINS = {
  python: 'print len range open sorted dict list set str int float json Path Counter datetime statistics csv field dataclass ip_address',
  javascript: 'console require JSON Number Object Map Set Error Promise Math',
  bash: 'echo printf cd mkdir find gzip ls tail xargs rm wc tee date hostname uptime cut free awk df systemctl',
  c: 'printf fprintf fopen fclose fread perror stderr',
  sql: 'strftime datetime',
};
const kwSets = {};
const biSets = {};
for (const k of Object.keys(KEYWORDS)) kwSets[k] = new Set(KEYWORDS[k].split(' '));
for (const k of Object.keys(BUILTINS)) biSets[k] = new Set(BUILTINS[k].split(' '));

const COMMENT = { python: /^#.*/, bash: /^#.*/, javascript: /^\/\/.*/, c: /^\/\/.*/, sql: /^--.*/, json: null };

/** Splits one line of code into [text, class] segments. */
export function highlight(lang, line) {
  const out = [];
  const kw = kwSets[lang] || new Set();
  const bi = biSets[lang] || new Set();
  const comment = COMMENT[lang];
  let i = 0;
  const push = (text, cls) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last[1] === cls) last[0] += text;
    else out.push([text, cls]);
  };
  while (i < line.length) {
    const rest = line.slice(i);
    let m;
    if (comment && (m = rest.match(comment)) && (lang !== 'bash' || i === 0 || /\s/.test(line[i - 1]))) {
      push(m[0], 'k-com');
      break;
    }
    if (lang === 'c' && (m = rest.match(/^#\s*\w+/))) {
      push(m[0], 'k-pre');
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^(f?"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/))) {
      const isKey = lang === 'json' && /^\s*:/.test(rest.slice(m[0].length));
      push(m[0], isKey ? 'k-key' : 'k-str');
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^\$\{?[A-Za-z_][\w]*\}?|^\$\(|^\$[0-9#?@]/)) && lang === 'bash') {
      push(m[0], 'k-var');
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^(0x[0-9a-fA-F]+u?|\d+(?:\.\d+)?)/))) {
      push(m[0], 'k-num');
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^[A-Za-z_][\w]*/))) {
      const w = m[0];
      const next = rest.slice(w.length);
      let cls = 'k-plain';
      if (kw.has(w) || (lang === 'sql' && kw.has(w.toUpperCase()))) cls = 'k-kw';
      else if (bi.has(w)) cls = 'k-bi';
      else if (/^\s*\(/.test(next)) cls = 'k-fn';
      else if (/^[A-Z][A-Z0-9_]+$/.test(w)) cls = 'k-const';
      push(w, cls);
      i += w.length;
      continue;
    }
    if ((m = rest.match(/^\s+/))) {
      push(m[0], 'k-plain');
      i += m[0].length;
      continue;
    }
    push(line[i], /[{}()[\]]/.test(line[i]) ? 'k-punc' : 'k-op');
    i++;
  }
  return out;
}

/* ------------------------------------------------------------------ logs */

const SOURCES = ['collector', 'scheduler', 'parser', 'sync-agent', 'integrity', 'cache', 'reporter', 'net-sim', 'kernel-sim', 'store'];
const INFO = [
  () => `batch ${int(1000, 9999)} committed (${int(64, 1024)} records)`,
  () => `heartbeat from ${pick(DOC_NODES).node} rtt=${rand(2, 40).toFixed(1)}ms`,
  () => `cache hit ratio ${rand(86, 99.6).toFixed(1)}%`,
  () => `checksum verified for block 0x${hex(4)}`,
  () => `worker-${int(1, 8)} picked task ${hex(6)}`,
  () => `stream ${pick(['telemetry', 'events', 'metrics'])} resynchronised`,
  () => `queue depth ${int(0, 48)}`,
  () => 'config reload requested (no changes)',
  () => `snapshot ${hex(8)} sealed (${int(2, 64)} MiB)`,
  () => `index rebuilt in ${int(40, 900)}ms`,
];
const DEBUG = [
  () => `gc pause ${rand(0.4, 6).toFixed(2)}ms`,
  () => `buffer pool ${int(40, 92)}% utilised`,
  () => `tick ${int(100000, 999999)} processed`,
];
const WARN = [
  () => `latency above threshold on ${pick(DOC_NODES).node} (${int(120, 340)}ms)`,
  () => `retrying frame 0x${hex(4)} (attempt 2/3)`,
  () => `disk usage at ${int(78, 91)}% on /var/sim`,
  () => `slow query (${int(800, 2400)}ms) on events_by_hour`,
];
const ERROR = [
  () => `frame 0x${hex(4)} dropped: checksum mismatch (recovered)`,
  () => `worker-${int(1, 8)} restarted after timeout`,
];

export function logLine(bias = 0) {
  const r = Math.random();
  const warnP = 0.07 + bias * 0.08;
  const errP = 0.015 + bias * 0.02;
  let level = 'INFO';
  let msg;
  if (r < errP) {
    level = 'ERROR';
    msg = pick(ERROR)();
  } else if (r < errP + warnP) {
    level = 'WARN';
    msg = pick(WARN)();
  } else if (r < errP + warnP + 0.16) {
    level = 'DEBUG';
    msg = pick(DEBUG)();
  } else msg = pick(INFO)();
  return { time: clockTime(true), level, source: pick(SOURCES), msg };
}

/* ---------------------------------------------------------------- status */

const STATUS_CLASSES = [
  [/^(OK|SUCCESS|ONLINE|SYNCED|RUNNING|COMPLETE|COMPLETED|VERIFIED|PASS|READY|DONE|open|ACTIVE)$/i, 'st-ok'],
  [/^(PROCESSING|SYNCING|QUEUED|SCANNING|LOADING|PARSING|WORKING|STREAMING|READING|INDEXING)$/i, 'st-proc'],
  [/^(WARNING|WARN|DEGRADED|OUTDATED|MODIFIED|HIGH|REVIEW|SLOW|filtered|ELEVATED)$/i, 'st-warn'],
  [/^(ERROR|FAILED|OFFLINE|MISSING|CRITICAL|DROPPED)$/i, 'st-err'],
  [/^(INACTIVE|IDLE|STOPPED|closed|SLEEPING|—|-|N\/A)$/i, 'st-dim'],
];
export function statusClass(value) {
  const v = String(value).trim();
  for (const [re, cls] of STATUS_CLASSES) if (re.test(v)) return cls;
  return '';
}

/** Smoothly wandering system metrics. */
export class StatusSimulator {
  constructor() {
    this.cpu = 18;
    this.mem = 41;
    this.queue = 3;
    this.rate = 120;
    this.modules = 9;
    this.load = 0; // 0 idle .. 1 heavy processing
    this.started = Date.now();
    this.cpuHistory = Array(60).fill(18);
  }

  setLoad(v) {
    this.load = Math.max(0, Math.min(1, v));
  }

  step() {
    const L = this.load;
    const approach = (cur, target, k) => cur + (target - cur) * k;
    this.cpu = Math.max(2, Math.min(99, approach(this.cpu, 14 + L * 68, 0.18) + rand(-6, 6)));
    this.mem = Math.max(20, Math.min(94, approach(this.mem, 38 + L * 30, 0.06) + rand(-1.2, 1.2)));
    this.queue = Math.max(0, Math.round(approach(this.queue, 2 + L * 36, 0.2) + rand(-3, 3)));
    this.rate = Math.max(0, Math.round(approach(this.rate, 90 + L * 2600, 0.15) + rand(-60, 60)));
    this.modules = Math.max(6, Math.min(42, Math.round(approach(this.modules, 9 + L * 22, 0.2))));
    this.cpuHistory.push(this.cpu);
    if (this.cpuHistory.length > 60) this.cpuHistory.shift();
  }

  get uptime() {
    const s = Math.floor((Date.now() - this.started) / 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }
}

/* ------------------------------------------------------------- processes */

const PROCS = [
  ['phantomd', 'root'], ['collector', 'phantom'], ['sync-agent', 'phantom'], ['parser-w1', 'phantom'],
  ['parser-w2', 'phantom'], ['indexer', 'phantom'], ['reporter', 'phantom'], ['cache-srv', 'cache'],
  ['scheduler', 'root'], ['store-io', 'store'], ['integrityd', 'root'], ['net-sim', 'phantom'],
];

export function processTable(n = 6) {
  return shuffle(PROCS).slice(0, n).map(([name, user]) => ({
    pid: String(int(300, 9800)),
    user,
    name,
    cpu: rand(0.2, 24),
    mem: rand(0.4, 9),
    status: pick(['RUNNING', 'RUNNING', 'RUNNING', 'SLEEPING', 'IDLE']),
  }));
}

export const PHASES = ['BOOT', 'INITIALIZATION', 'PROCESSING', 'ANALYSIS', 'REPORT', 'TRANSITION'];
