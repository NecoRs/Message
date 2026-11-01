// ScenarioManager and the scenario library. Every scenario is simulated:
// data comes from local generators and addresses from documentation ranges.
import { TableGenerator, box, bar } from './render.js';
import { rand, int, pick, chance, hex, fmtInt, shuffle, clockTime, docIp, DOC_NODES, snippetsFor, SNIPPETS, processTable } from './data.js';

/* ------------------------------------------------------- context API */

export class ScenarioContext {
  constructor(app, scenario, sl) {
    this.app = app;
    this.sl = sl;
    this.scenario = scenario;
    this.term = app.main;
    this.audio = app.audio;
    this.session = hex(4);
    this.started = app.clock.t;
    this.pace = rand(0.85, 1.2);
    this.tables = new TableGenerator(app.main);
  }

  wait(ms) {
    return this.sl.wait(ms * this.pace);
  }

  gate() {
    return this.app.gate(this.sl);
  }

  async phase(name) {
    await this.gate();
    this.app.setPhase(name);
  }

  async type(cmd) {
    await this.gate();
    await this.app.typeCommand(this.sl, cmd);
  }

  async out(parts, cls) {
    await this.gate();
    this.term.seg(parts, cls);
    await this.wait(rand(25, 90));
  }

  async status(kind, msg) {
    await this.gate();
    const cls = { '*': 'ph-info', '+': 'st-ok', '!': 'st-warn', '-': 'st-err' }[kind];
    this.term.seg([[`[${kind}] `, cls], [msg, kind === '!' ? 'st-warn' : '']]);
    if (kind === '!') {
      this.audio.sfx('warning');
      this.log('WARN', 'analysis', msg);
    } else if (kind === '-') this.audio.sfx('error', { level: 0.7 });
    else this.audio.sfx('tick', { level: 0.5, pitch: kind === '+' ? 1.3 : 1 });
    await this.wait(rand(70, 220));
  }

  async spinner(label, ms) {
    await this.gate();
    const line = this.term.line();
    const icon = this.term.span(line, '[|] ', 'ph-info');
    this.term.span(line, label);
    const tail = this.term.span(line, '', 'ph-dim');
    const frames = '|/-\\';
    const end = this.sl.now() + ms * this.pace;
    let i = 0;
    while (this.sl.now() < end) {
      icon.textContent = `[${frames[i++ % 4]}] `;
      await this.sl.wait(90);
    }
    icon.textContent = '[+] ';
    icon.className = 'st-ok';
    tail.textContent = ' … done';
    this.audio.sfx('tick', { pitch: 1.3 });
  }

  /** Animated progress bar with the processing loop sound. */
  async progress(label, ms, { total = int(2000, 90000), unit = 'records' } = {}) {
    await this.gate();
    const width = this.app.mainCols < 70 ? 12 : this.app.mainCols < 100 ? 16 : 24;
    this.audio.processingStart();
    this.app.bus.emit('processing:start', { label, ms });
    this.app.status.setLoad(rand(0.7, 1));
    this.app.focus('data', ms);
    const line = this.term.line('ph-progress');
    this.term.span(line, `    ${label.padEnd(26)} `);
    const barEl = this.term.span(line, '', 'ph-bar');
    const pct = this.term.span(line, '', 'ph-num');
    const count = this.term.span(line, '', 'ph-dim');
    const start = this.sl.now();
    const dur = ms * this.pace;
    let stall = 0;
    try {
      for (;;) {
        await this.gate();
        const now = this.sl.now();
        let f = Math.min(1, (now - start - stall) / dur);
        if (chance(0.02) && f < 0.9) stall += rand(150, 500);
        f = Math.max(0, f);
        barEl.textContent = `[${bar(f, width)}] `;
        pct.textContent = `${String(Math.floor(f * 100)).padStart(3)}% `;
        count.textContent = ` ${fmtInt(Math.floor(total * f))}/${fmtInt(total)} ${unit}`;
        if (f >= 1) break;
        await this.sl.wait(70);
      }
    } finally {
      this.audio.processingEnd();
      this.app.bus.emit('processing:end', { label });
      this.app.status.setLoad(rand(0.15, 0.35));
    }
    barEl.className = 'ph-bar st-ok';
  }

  async table(def) {
    await this.gate();
    return this.tables.render(def, { sleeper: { wait: (ms) => this.wait(ms) }, audio: this.audio });
  }

  /**
   * Shows code in the code stream (Hollywood mode, returns immediately) or
   * types it into the main console (standard mode, returns when typed).
   * Resolves to { done } where `done` settles once the code is on screen.
   */
  async code(snippet) {
    await this.gate();
    return this.app.showCode(this.sl, snippet);
  }

  log(level, source, msg) {
    this.app.bus.emit('log', { time: clockTime(true), level, source, msg });
  }

  net(node, state, latency) {
    this.app.bus.emit('net', { node, state, latency });
  }

  focus(pane, ms) {
    this.app.focus(pane, ms);
  }

  async box(title, rows) {
    await this.gate();
    box(this.term, title, rows, Math.max(36, Math.min(56, this.app.mainCols - 4)));
    this.audio.sfx('row');
    await this.wait(240);
  }

  async success(msg) {
    await this.status('+', msg);
    this.audio.sfx('success');
    this.app.focus('main', 2500);
  }

  think(a = 300, b = 1100) {
    return this.wait(rand(a, b));
  }

  elapsed() {
    const s = Math.max(1, Math.round((this.app.clock.t - this.started) / 1000 / Math.max(0.25, this.app.clock.speed)));
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }

  /** Waits for a promise but never longer than `ms` of simulation time. */
  async within(promise, ms) {
    let done = false;
    promise.then(() => (done = true), () => (done = true));
    const end = this.sl.now() + ms;
    while (!done && this.sl.now() < end) await this.sl.wait(120);
  }
}

/* --------------------------------------------------------- interludes */

const INTERLUDES = [
  async (c) => {
    await c.type('phantom status --brief');
    const s = c.app.status;
    await c.status('*', `scenarios run: ${c.app.manager.count}   uptime ${s.uptime}   cpu ${Math.round(s.cpu)}%   queue ${s.queue}`);
  },
  async (c) => {
    await c.type('uptime');
    const s = c.app.status;
    await c.out(` ${clockTime()} up ${s.uptime.slice(0, 5)},  1 user,  load average: ${(s.cpu / 100).toFixed(2)}, ${(s.cpu / 120).toFixed(2)}, ${(s.cpu / 150).toFixed(2)}`);
  },
  async (c) => {
    await c.type('phantom cache flush --expired');
    await c.spinner('Scanning cache segments', rand(500, 1100));
    await c.status('+', `${int(40, 900)} expired entries removed`);
  },
  async (c) => {
    await c.type('ls ./reports');
    const names = Array.from({ length: int(3, 6) }, () => `${pick(['log-intel', 'telemetry', 'inventory', 'integrity', 'diag', 'query'])}-${hex(4)}.txt`);
    await c.out([[names.join('  '), 'ph-file']]);
  },
  async (c) => {
    await c.type('date -u');
    await c.out(new Date().toUTCString().replace('GMT', 'UTC'));
  },
];

async function interlude(c, p = 0.45) {
  if (!chance(p)) return;
  await c.think(400, 1200);
  await pick(INTERLUDES)(c);
}

async function moduleBoot(c, module, version, extra = []) {
  await c.phase('BOOT');
  c.term.blank();
  await c.out([['─── ', 'ph-dim'], [c.scenario.name, 'ph-title'], [`  session 0x${c.session}`, 'ph-dim']]);
  await c.status('*', `Loading module ${module} (v${version})`);
  for (const line of extra) await c.status('*', line);
  c.log('INFO', 'scheduler', `module ${module} loaded`);
  await c.think(300, 800);
}

/* ---------------------------------------------------------- scenarios */

const LOG_INTEL = {
  id: 'log-intel',
  name: 'LOG INTELLIGENCE',
  async run(c) {
    await moduleBoot(c, 'analysis/log_intel', '2.4.1', ['Mounting dataset store ./datasets (read-only)']);
    await c.phase('INITIALIZATION');
    const events = int(18000, 64000);
    await c.type(`phantom ingest --source ./datasets/auth_events.jsonl --window ${pick(['6h', '12h', '24h'])}`);
    await c.spinner('Reading dataset', rand(900, 1800));
    await c.status('+', `${fmtInt(events)} events loaded from the local sample`);
    await interlude(c, 0.3);

    await c.phase('PROCESSING');
    c.focus('code');
    const code = await c.code(pick(snippetsFor('logs')));
    await c.progress('Parsing events', rand(3500, 6500), { total: events, unit: 'events' });
    const kinds = [['auth.success', 'INFO'], ['auth.failure', 'WARNING'], ['session.open', 'INFO'], ['session.close', 'INFO'], ['policy.reload', 'INFO'], ['token.refresh', 'INFO'], ['auth.failure', 'WARNING']];
    await c.table({
      title: 'EVENT LOGS',
      columns: [{ key: 'time', label: 'TIME' }, { key: 'event', label: 'EVENT', cls: 'ph-strong' }, { key: 'source', label: 'SOURCE' }, { key: 'sev', label: 'SEVERITY', status: true }],
      rows: Array.from({ length: int(5, 7) }, () => {
        const [event, sev] = pick(kinds);
        return { time: clockTime(), event, source: `${pick(['sshd-sim', 'web-sim', 'vpn-sim', 'sso-sim'])}@${docIp()}`, sev };
      }),
    });
    await c.within(code.done,9000);

    await c.phase('ANALYSIS');
    await c.type(`phantom analyze --anomalies --threshold ${pick(['3.0', '3.5', '4.0'])}`);
    const sources = shuffle(['sso-sim', 'vpn-sim', 'web-sim', 'sshd-sim', 'mail-sim', 'api-sim']).slice(0, int(4, 5));
    const rows = sources.map((s) => {
      const baseline = int(40, 400);
      return { source: s, baseline: fmtInt(baseline), observed: '…', score: '…', status: 'PROCESSING', _b: baseline };
    });
    const t = await c.table({
      title: 'ANOMALY SCORES',
      columns: [{ key: 'source', label: 'SOURCE', cls: 'ph-strong' }, { key: 'baseline', label: 'BASELINE', min: 8 }, { key: 'observed', label: 'OBSERVED', min: 8 }, { key: 'score', label: 'SCORE', min: 6 }, { key: 'status', label: 'STATUS', status: true, min: 10 }],
      rows,
    });
    let flagged = 0;
    for (let i = 0; i < rows.length; i++) {
      await c.wait(rand(350, 900));
      const review = chance(0.22) && flagged < 2;
      const score = review ? rand(3.6, 6.2) : rand(0.2, 2.8);
      t.set(i, 'observed', fmtInt(Math.round(rows[i]._b * (1 + score / 4))));
      t.set(i, 'score', score.toFixed(2));
      t.set(i, 'status', review ? 'REVIEW' : 'OK');
      c.audio.sfx('row');
      if (review) flagged++;
    }
    if (flagged) {
      c.app.bus.emit('anomaly', flagged);
      await c.status('!', `${flagged} source${flagged > 1 ? 's' : ''} above baseline — marked for review`);
    } else await c.status('+', 'No sources above the threshold');

    await c.phase('REPORT');
    await c.type('phantom report --format summary');
    await c.box(`REPORT  log-intel-${c.session}`, [
      ['events processed', fmtInt(events)],
      ['sources scored', String(rows.length)],
      ['anomalies', flagged ? `${flagged} (review)` : 'none', flagged ? 'st-warn' : 'st-ok'],
      ['duration', c.elapsed()],
      ['status', 'COMPLETE', 'st-ok'],
    ]);
    await c.success(`Report written to ./reports/log-intel-${c.session}.txt`);
  },
};

const TELEMETRY = {
  id: 'telemetry',
  name: 'TELEMETRY SYNC',
  async run(c) {
    await moduleBoot(c, 'telemetry/sync_agent', '1.9.0', ['Streams: telemetry, events, metrics (simulated)']);
    await c.phase('INITIALIZATION');
    await c.type(`phantom sync --streams all --mode passive --interval ${pick(['250ms', '500ms', '1s'])}`);
    c.focus('net', 5000);
    const nodes = shuffle(DOC_NODES).slice(0, int(4, 6));
    const t = await c.table({
      title: 'NETWORK STATUS',
      columns: [{ key: 'node', label: 'NODE', cls: 'ph-strong' }, { key: 'ip', label: 'ADDRESS' }, { key: 'state', label: 'STATE', status: true, min: 10 }, { key: 'lat', label: 'LATENCY', min: 9 }],
      rows: nodes.map((n) => ({ node: n.node, ip: n.ip, state: 'SYNCING', lat: '…' })),
    });
    let degraded = null;
    for (let i = 0; i < nodes.length; i++) {
      await c.wait(rand(300, 800));
      const bad = !degraded && chance(0.3);
      const lat = bad ? rand(130, 220) : rand(2, 40);
      t.set(i, 'state', bad ? 'DEGRADED' : 'SYNCED');
      t.set(i, 'lat', `${lat.toFixed(1)} ms`, bad ? 'st-warn' : '');
      c.net(nodes[i].node, bad ? 'DEGRADED' : 'SYNCED', lat);
      if (bad) degraded = { ...nodes[i], lat };
      c.audio.sfx('row');
    }
    await interlude(c, 0.35);

    await c.phase('PROCESSING');
    c.focus('code');
    const code = await c.code(pick(snippetsFor('telemetry')));
    const frames = int(4000, 26000);
    await c.progress('Aggregating telemetry frames', rand(3000, 6000), { total: frames, unit: 'frames' });
    await c.within(code.done,8000);

    await c.phase('ANALYSIS');
    await c.type('phantom verify --checksums --last 6');
    c.focus('bin', 4000);
    let retried = 0;
    for (let i = 0; i < 6; i++) {
      const retry = chance(0.15);
      await c.out([['    frame ', 'ph-dim'], [`0x${hex(4)}  `, ''], ['crc32 ', 'ph-dim'], [`${hex(8)}  `, ''], [retry ? 'RETRY → OK' : 'OK', retry ? 'st-warn' : 'st-ok']]);
      c.audio.sfx('row');
      if (retry) retried++;
      await c.wait(rand(120, 300));
    }
    if (degraded) await c.status('!', `${degraded.node} (${degraded.ip}) latency p95 ${degraded.lat.toFixed(0)} ms — above the 120 ms target`);
    else await c.status('+', 'All nodes within latency targets');

    await c.phase('REPORT');
    await c.type('phantom report --format summary');
    await c.box(`REPORT  telemetry-${c.session}`, [
      ['frames aggregated', fmtInt(frames)],
      ['nodes synced', `${nodes.length - (degraded ? 1 : 0)} / ${nodes.length}`],
      ['degraded', degraded ? degraded.node : 'none', degraded ? 'st-warn' : 'st-ok'],
      ['checksum retries', String(retried)],
      ['status', 'COMPLETE', 'st-ok'],
    ]);
    await c.success(`Telemetry snapshot sealed (0x${hex(8)})`);
  },
};

const ASSETS = [
  { asset: 'web-01', ip: '198.51.100.20', services: [['22/tcp', 'open', 'ssh', 'OpenSSH 9.6p1'], ['80/tcp', 'open', 'http', 'nginx 1.24.0'], ['443/tcp', 'open', 'https', 'nginx 1.24.0'], ['8080/tcp', 'closed', 'http-alt', '—'], ['9100/tcp', 'open', 'metrics', 'node-exporter 1.8.2']], outdated: 'nginx 1.24.0 → 1.26.2' },
  { asset: 'app-02', ip: '192.0.2.44', services: [['22/tcp', 'open', 'ssh', 'OpenSSH 9.6p1'], ['3000/tcp', 'open', 'http', 'node 20.17.0'], ['6379/tcp', 'filtered', 'redis', 'redis 7.2.5'], ['9100/tcp', 'open', 'metrics', 'node-exporter 1.8.2']], outdated: 'node 20.17.0 → 22.11.0' },
  { asset: 'db-03', ip: '203.0.113.30', services: [['22/tcp', 'open', 'ssh', 'OpenSSH 9.2p1'], ['5432/tcp', 'filtered', 'postgresql', 'PostgreSQL 16.2'], ['9187/tcp', 'open', 'metrics', 'postgres-exporter 0.15'], ['8443/tcp', 'closed', 'https-alt', '—']], outdated: 'OpenSSH 9.2p1 → 9.6p1' },
];

const INVENTORY = {
  id: 'inventory',
  name: 'SERVICE INVENTORY AUDIT',
  async run(c) {
    await moduleBoot(c, 'inventory/cmdb_reader', '0.9.4', ['Source: local CMDB snapshot — no network access']);
    await c.phase('INITIALIZATION');
    const a = pick(ASSETS);
    await c.type(`phantom inventory show --asset ${a.asset} --source ./cmdb/assets.db`);
    await c.spinner('Reading asset record', rand(600, 1200));
    await c.out([['Service inventory for ', ''], [a.asset, 'ph-strong'], [` (${a.ip})`, 'ph-info'], ['  · snapshot ', 'ph-dim'], [new Date().toISOString().slice(0, 10), 'ph-dim']]);
    await c.table({
      columns: [{ key: 'port', label: 'PORT', cls: 'ph-strong' }, { key: 'state', label: 'STATE', status: true }, { key: 'service', label: 'SERVICE' }, { key: 'version', label: 'VERSION' }],
      rows: a.services.map(([port, state, service, version]) => ({ port, state, service, version })),
      indent: 0,
    });
    await c.out([['', ''], [`${a.services.length} services recorded · ${a.services.filter((s) => s[1] === 'open').length} open`, 'ph-dim']]);
    await interlude(c, 0.3);

    await c.phase('PROCESSING');
    c.focus('code');
    const code = await c.code(SNIPPETS.find((s) => s.id === 'baseline'));
    await c.type('phantom baseline compare --profile hardened-v3');
    await c.progress('Comparing against baseline', rand(2800, 5200), { total: int(40, 90), unit: 'checks' });
    await c.within(code.done,7000);

    await c.phase('ANALYSIS');
    const checks = [
      ['tls.min_version', 'TLS 1.2+ enforced'],
      ['ssh.permit_root_login', 'disabled'],
      ['ssh.password_auth', 'disabled'],
      ['http.server_tokens', 'hidden'],
      ['versions.baseline', a.outdated],
      ['ports.unexpected', 'none'],
    ];
    const t = await c.table({
      title: 'COMPLIANCE CHECKS',
      columns: [{ key: 'check', label: 'CHECK', cls: 'ph-strong' }, { key: 'result', label: 'RESULT', status: true, min: 10 }, { key: 'detail', label: 'DETAIL' }],
      rows: checks.map(([check]) => ({ check, result: 'PROCESSING', detail: '…' })),
    });
    let findings = 0;
    for (let i = 0; i < checks.length; i++) {
      await c.wait(rand(250, 700));
      const outdated = checks[i][0] === 'versions.baseline';
      t.set(i, 'result', outdated ? 'OUTDATED' : 'PASS');
      t.set(i, 'detail', checks[i][1], outdated ? 'st-warn' : 'ph-dim2');
      c.audio.sfx('row');
      if (outdated) findings++;
    }
    await c.status('!', `${findings} finding: update available (${a.outdated})`);

    await c.phase('REPORT');
    await c.type('phantom report --format summary');
    await c.box(`REPORT  inventory-${c.session}`, [
      ['asset', `${a.asset} (${a.ip})`],
      ['checks passed', `${checks.length - findings} / ${checks.length}`],
      ['findings', String(findings), findings ? 'st-warn' : 'st-ok'],
      ['recommendation', 'apply pending update'],
      ['status', 'COMPLETE', 'st-ok'],
    ]);
    await c.success(`Audit stored as ./reports/inventory-${c.session}.txt`);
  },
};

const INTEGRITY = {
  id: 'integrity',
  name: 'INTEGRITY VERIFICATION',
  async run(c) {
    await moduleBoot(c, 'integrity/manifest', '3.0.2');
    await c.phase('INITIALIZATION');
    const entries = int(96, 220);
    await c.type('phantom integrity scan --path /opt/lab/app --algo sha256');
    await c.spinner(`Loading manifest (${entries} entries)`, rand(700, 1400));
    await interlude(c, 0.25);

    await c.phase('PROCESSING');
    c.focus('code');
    const code = await c.code(SNIPPETS.find((s) => s.id === 'crc32'));
    await c.progress('Hashing files', rand(3200, 6000), { total: entries, unit: 'files' });
    c.focus('bin', 3500);
    const files = shuffle(['bin/app-server', 'lib/libcore.so.3', 'config/app.yaml', 'static/index.html', 'scripts/start.sh', 'etc/logging.json', 'lib/libnet.so.1', 'config/routes.toml']).slice(0, int(5, 7));
    const modified = chance(0.6) ? int(0, files.length - 1) : -1;
    const missing = chance(0.1) ? (modified + 1) % files.length : -1;
    await c.table({
      title: 'MANIFEST VERIFICATION',
      columns: [{ key: 'file', label: 'FILE', cls: 'ph-strong' }, { key: 'hash', label: 'SHA256', cls: 'ph-dim2' }, { key: 'status', label: 'STATUS', status: true }],
      rows: files.map((file, i) => ({ file, hash: i === missing ? '—' : `${hex(10)}…${hex(4)}`, status: i === missing ? 'MISSING' : i === modified ? 'MODIFIED' : 'VERIFIED' })),
    });
    await c.within(code.done,8000);

    await c.phase('ANALYSIS');
    if (modified >= 0) {
      await c.status('!', `${files[modified]} differs from the manifest`);
      await c.out([['    expected ', 'ph-dim'], [hex(32), 'ph-dim2']]);
      await c.out([['    actual   ', 'ph-dim'], [hex(32), 'st-warn']]);
      await c.status('*', `Change matches pending ticket CHG-${int(1000, 9999)} (simulated)`);
    }
    if (missing >= 0) await c.status('-', `${files[missing]} not found — restore from the last snapshot`);
    if (modified < 0 && missing < 0) await c.status('+', 'All files match the manifest');
    c.app.bus.emit('anomaly', (modified >= 0 ? 1 : 0) + (missing >= 0 ? 1 : 0));

    await c.phase('REPORT');
    await c.type('phantom report --format summary');
    await c.box(`REPORT  integrity-${c.session}`, [
      ['files hashed', String(entries)],
      ['modified', modified >= 0 ? '1' : '0', modified >= 0 ? 'st-warn' : 'st-ok'],
      ['missing', missing >= 0 ? '1' : '0', missing >= 0 ? 'st-err' : 'st-ok'],
      ['duration', c.elapsed()],
      ['status', 'COMPLETE', 'st-ok'],
    ]);
    await c.success('Manifest verification finished');
  },
};

const DIAG = {
  id: 'diag',
  name: 'PROCESS DIAGNOSTICS',
  async run(c) {
    await moduleBoot(c, 'diag/process_sampler', '1.4.0');
    await c.phase('INITIALIZATION');
    await c.type('phantom diag processes --top 6 --live');
    c.focus('act', 5000);
    const procs = processTable(6).map((p) => ({ ...p, memv: p.mem }));
    const t = await c.table({
      title: 'PROCESS MONITOR',
      columns: [{ key: 'pid', label: 'PID', cls: 'ph-dim2' }, { key: 'user', label: 'USER' }, { key: 'name', label: 'PROCESS', cls: 'ph-strong', min: 11 }, { key: 'cpu', label: 'CPU', min: 7 }, { key: 'mem', label: 'MEMORY', min: 7 }, { key: 'status', label: 'STATUS', status: true, min: 9 }],
      rows: procs.map((p) => ({ pid: p.pid, user: p.user, name: p.name, cpu: `${p.cpu.toFixed(1)}%`, mem: `${p.mem.toFixed(1)}%`, status: p.status })),
    });
    const hot = int(0, procs.length - 1);
    for (let cycle = 0; cycle < int(3, 5); cycle++) {
      await c.wait(rand(700, 1100));
      procs.forEach((p, i) => {
        p.cpu = Math.max(0.1, p.cpu + rand(-4, 6));
        if (i === hot) p.memv = Math.min(82, p.memv + rand(6, 14));
        t.set(i, 'cpu', `${p.cpu.toFixed(1)}%`, p.cpu > 60 ? 'st-warn' : '');
        t.set(i, 'mem', `${p.memv.toFixed(1)}%`, p.memv > 70 ? 'st-warn' : '');
      });
      c.audio.sfx('row', { level: 0.6 });
    }
    await interlude(c, 0.3);

    await c.phase('PROCESSING');
    c.focus('code');
    const code = await c.code(pick(snippetsFor('diag')));
    await c.progress('Sampling resource usage', rand(3000, 5500), { total: int(300, 1200), unit: 'samples' });
    await c.within(code.done,8000);

    await c.phase('ANALYSIS');
    const p = procs[hot];
    const over = p.memv > 70;
    if (over) await c.status('!', `${p.name} (pid ${p.pid}) memory at ${p.memv.toFixed(0)}% — above the 70% soft limit`);
    else await c.status('+', 'All processes inside their resource limits');
    await c.type('phantom diag recommend');
    const recs = over
      ? [`restart ${p.name} during the next maintenance window`, `raise ${p.name} memory limit to ${pick(['512M', '768M', '1G'])}`, 'enable heap snapshots for the next run']
      : ['no action required', 'keep the current sampling interval'];
    for (const r of recs) await c.out([['    → ', 'ph-info'], [r, '']]);

    await c.phase('REPORT');
    await c.type('phantom report --format summary');
    await c.box(`REPORT  diag-${c.session}`, [
      ['processes sampled', String(procs.length)],
      ['peak cpu', `${Math.max(...procs.map((x) => x.cpu)).toFixed(1)}%`],
      ['memory warnings', over ? '1' : '0', over ? 'st-warn' : 'st-ok'],
      ['duration', c.elapsed()],
      ['status', 'COMPLETE', 'st-ok'],
    ]);
    await c.success('Diagnostics snapshot saved');
  },
};

const QUERY = {
  id: 'query',
  name: 'QUERY ANALYTICS',
  async run(c) {
    await c.phase('BOOT');
    c.term.blank();
    await c.out([['─── ', 'ph-dim'], [c.scenario.name, 'ph-title'], [`  session 0x${c.session}`, 'ph-dim']]);
    await c.type('phantom modules list');
    const mods = [
      ['analysis/log_intel', '2.4.1'], ['telemetry/sync_agent', '1.9.0'], ['inventory/cmdb_reader', '0.9.4'],
      ['integrity/manifest', '3.0.2'], ['diag/process_sampler', '1.4.0'], ['query/sql_engine', '5.2.0'], ['report/summary', '1.2.7'],
    ];
    await c.table({
      title: 'SYSTEM MODULES',
      columns: [{ key: 'm', label: 'MODULE', cls: 'ph-strong' }, { key: 'v', label: 'VERSION' }, { key: 's', label: 'STATUS', status: true }, { key: 'a', label: 'ACTIVITY', cls: 'ph-dim2' }],
      rows: shuffle(mods).slice(0, 6).map(([m, v]) => {
        const s = m.startsWith('query') ? 'ACTIVE' : pick(['READY', 'IDLE', 'READY', 'ACTIVE']);
        return { m, v, s, a: s === 'ACTIVE' ? pick(['reading', 'streaming', 'indexing']) : '—' };
      }),
    });

    await c.phase('INITIALIZATION');
    await c.type('phantom db open ./datasets/events.sqlite --readonly');
    const rows = int(120000, 900000);
    await c.status('+', `events.sqlite opened read-only · ${fmtInt(rows)} rows · 4 tables`);
    await interlude(c, 0.3);

    await c.phase('PROCESSING');
    c.focus('code');
    const code = await c.code(SNIPPETS.find((s) => s.id === 'hourly_sql'));
    const tasks = ['scan events', 'group by hour', 'aggregate sources', 'sort results'];
    c.audio.processingStart();
    c.app.bus.emit('processing:start', { label: 'sql: hourly volume', ms: 6000 });
    c.app.status.setLoad(0.9);
    const t = await c.table({
      title: 'DATA PROCESSING',
      columns: [{ key: 'task', label: 'TASK', cls: 'ph-strong' }, { key: 'progress', label: 'PROGRESS', min: 16 }, { key: 'result', label: 'RESULT', status: true, min: 10 }, { key: 'dur', label: 'DURATION', min: 8 }],
      rows: tasks.map((task) => ({ task, progress: `${bar(0, 10)}   0%`, result: 'QUEUED', dur: '—' })),
    });
    const speeds = tasks.map(() => rand(0.06, 0.16));
    const prog = tasks.map(() => 0);
    const startT = c.sl.now();
    try {
      while (prog.some((p) => p < 1)) {
        await c.gate();
        await c.wait(160);
        prog.forEach((p, i) => {
          if (p >= 1 || (i > 0 && prog[i - 1] < 0.35)) return;
          prog[i] = Math.min(1, p + speeds[i] * rand(0.6, 1.4));
          t.set(i, 'progress', `${bar(prog[i], 10)} ${String(Math.floor(prog[i] * 100)).padStart(3)}%`, 'ph-bar');
          t.set(i, 'result', prog[i] >= 1 ? 'DONE' : 'PROCESSING');
          t.set(i, 'dur', `${((c.sl.now() - startT) / 1000).toFixed(1)}s`, 'ph-dim2');
        });
      }
    } finally {
      c.audio.processingEnd();
      c.app.bus.emit('processing:end', {});
      c.app.status.setLoad(0.25);
    }
    await c.within(code.done,6000);

    await c.phase('ANALYSIS');
    const sources = shuffle(['collector', 'sync-agent', 'parser', 'scheduler', 'store', 'cache']).slice(0, 5);
    let total = 0;
    const res = sources.map((s) => {
      const ev = int(4000, 60000);
      total += ev;
      const elevated = int(0, Math.round(ev * 0.004));
      return { s, ev: fmtInt(ev), avg: (ev / 24).toFixed(1), el: String(elevated), elCls: elevated > 150 ? 'st-warn' : '' };
    });
    await c.table({
      title: 'QUERY RESULT',
      columns: [{ key: 's', label: 'SOURCE', cls: 'ph-strong' }, { key: 'ev', label: 'TOTAL_EVENTS' }, { key: 'avg', label: 'AVG_PER_HOUR' }, { key: 'el', label: 'ELEVATED' }],
      rows: res,
    });
    const hotSrc = res.find((r) => r.elCls);
    if (hotSrc) await c.status('!', `${hotSrc.s}: ${hotSrc.el} elevated events in 24h`);
    await c.status('*', `${res.length} rows returned in ${rand(0.2, 1.4).toFixed(2)}s`);

    await c.phase('REPORT');
    await c.type('phantom report --format summary');
    await c.box(`REPORT  query-${c.session}`, [
      ['rows scanned', fmtInt(rows)],
      ['events summarised', fmtInt(total)],
      ['elevated sources', hotSrc ? '1' : '0', hotSrc ? 'st-warn' : 'st-ok'],
      ['duration', c.elapsed()],
      ['status', 'COMPLETE', 'st-ok'],
    ]);
    await c.success(`Query results exported to ./reports/query-${c.session}.csv`);
  },
};

export const SCENARIOS = [LOG_INTEL, TELEMETRY, INVENTORY, INTEGRITY, DIAG, QUERY];

/** Picks the next scenario, avoiding the two most recent ones. */
export class ScenarioManager {
  constructor(list = SCENARIOS) {
    this.list = list;
    this.history = [];
    this.count = 0;
  }

  next() {
    const pool = this.list.filter((s) => !this.history.includes(s.id));
    const s = pick(pool.length ? pool : this.list);
    this.history.push(s.id);
    if (this.history.length > 2) this.history.shift();
    this.count++;
    return s;
  }

  reset() {
    this.history = [];
    this.count = 0;
  }
}

/** Shared TRANSITION phase: soft separator, sweep and a short breather. */
export async function transition(c) {
  await c.phase('TRANSITION');
  c.app.audio.sfx('sweep', { level: 0.8 });
  c.term.blank();
  await c.out([['─── ', 'ph-dim'], [`session 0x${c.session} closed`, 'ph-dim'], [' · next scenario queued', 'ph-dim']]);
  c.log('INFO', 'scheduler', `scenario ${c.scenario.id} finished (${c.elapsed()})`);
  await c.wait(rand(1200, 2400));
}
