'use strict';
// Test harness: boots an isolated agent + web gateway on random free ports with a temp
// storage folder, so tests never touch your real drive or real secrets.
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const rand = (n) => crypto.randomBytes(n).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, ms = 8000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    try { if (await fn()) return; } catch { /* keep polling */ }
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label);
    await sleep(40);
  }
}

function launch(script, env, logs) {
  const p = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => logs.push(String(d)));
  p.stderr.on('data', (d) => logs.push(String(d)));
  return p;
}

// opts.seed(storageDir): runs BEFORE the agent starts (e.g. to fake a v1 layout)
// opts.agentEnv: extra environment for the agent (e.g. { ALLOW_OVERBOOK: 'true' })
async function startStack(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ait-drive-test-'));
  const storage = path.join(tmp, 'storage');
  const dataDir = path.join(tmp, 'data'); // gateway account store (a volume on Coolify)
  fs.mkdirSync(storage);
  if (opts.seed) opts.seed(storage);
  const logs = [];
  const procs = [];
  const token = rand(24);
  const secret = rand(32);
  const creds = { user: 'tester', pass: rand(8) };

  const agentPort = await freePort();
  const agentUrl = `http://127.0.0.1:${agentPort}`;
  procs.push(launch(path.join(ROOT, 'agent', 'server.js'), {
    AGENT_TOKEN: token, STORAGE_ROOT: storage, AGENT_HOST: '127.0.0.1', AGENT_PORT: String(agentPort), ...(opts.agentEnv || {}),
  }, logs));
  await waitFor(async () => (await fetch(agentUrl + '/health')).ok, 8000, 'agent');

  // start another web gateway (optionally with different env, e.g. a wrong AGENT_TOKEN)
  async function startWeb(overrides = {}) {
    const port = await freePort();
    procs.push(launch(path.join(ROOT, 'web', 'server.js'), {
      PORT: String(port), ADMIN_USER: creds.user, ADMIN_PASSWORD: creds.pass, SESSION_SECRET: secret,
      AGENT_URL: agentUrl, AGENT_TOKEN: token, COOKIE_SECURE: 'false', DATA_DIR: dataDir, ...(opts.webEnv || {}), ...overrides,
    }, logs));
    const url = `http://127.0.0.1:${port}`;
    await waitFor(async () => (await fetch(url + '/auth/me')).ok, 8000, 'web gateway');
    return url;
  }
  const webUrl = await startWeb();

  async function stop() {
    for (const p of procs) { try { p.kill(); } catch {} }
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch {}
  }
  return { tmp, storage, dataDir, token, secret, agentUrl, webUrl, creds, startWeb, stop, logs };
}

function reporter(title) {
  let pass = 0, fail = 0;
  console.log(`\n== ${title} ==`);
  return {
    check(name, ok, detail = '') {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  -> ' + detail : ''}`);
      ok ? pass++ : fail++;
    },
    done() {
      console.log(`\n${pass} passed, ${fail} failed`);
      return fail === 0;
    },
  };
}

module.exports = { startStack, waitFor, sleep, reporter, ROOT };
