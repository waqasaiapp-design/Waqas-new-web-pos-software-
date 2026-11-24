import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { APP_VERSION } from '../src/version.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-vercel-compat-'));
const tempDataDir = path.join(tempRoot, 'data');
fs.mkdirSync(tempDataDir, { recursive: true });

// Copy repository seed data into isolated temp dir BEFORE importing api/index.ts
fs.cpSync(path.join(process.cwd(), 'data'), tempDataDir, { recursive: true });

// Seed deterministic test Super Admin credentials inside isolated test env ONLY
const testSaSalt = crypto.randomBytes(16).toString('hex');
const testSaPassword = `TestSa#${Date.now()}!`;
const testSaHash = `scrypt:${crypto.scryptSync(testSaPassword, testSaSalt, 64).toString('hex')}`;
const testSaEmail = 'muhammedsaad255251@gmail.com';

process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
process.env.WAQAS_DATA_DIR = tempDataDir;
process.env.SESSION_SECRET = 'test-vercel-hmac-secret-key-2026';
process.env.SUPER_ADMIN_EMAIL = testSaEmail;
process.env.SUPER_ADMIN_PASSWORD_SALT = testSaSalt;
process.env.SUPER_ADMIN_PASSWORD_HASH = testSaHash;

async function startVercelSimulatedServer() {
  const { default: vercelHandler } = await import('../api/index');
  const server = http.createServer((req, res) => {
    void vercelHandler(req as any, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function invokePreParsedVercelHandler(
  method: string,
  url: string,
  bodyObj: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.OutgoingHttpHeaders; json: any; text: string }> {
  const { default: vercelHandler } = await import('../api/index');
  const srv = http.createServer((req, res) => {
    // Simulate @vercel/node pre-parsing request body and finishing the stream
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try {
          (req as any).body = JSON.parse(raw);
        } catch {
          (req as any).body = raw;
        }
      } else if (bodyObj !== undefined) {
        (req as any).body = bodyObj;
      }
      void vercelHandler(req as any, res);
    });
  });

  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = (srv.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : JSON.stringify(bodyObj ?? {}),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {}
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json, text };
  } finally {
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
}

async function runTests() {
  let server: http.Server | null = null;
  try {
    console.log('1. Checking vercel.json rewrites & serverless function configuration...');
    const vercelCfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));
    assert.ok(vercelCfg.functions?.['api/index.ts'], 'vercel.json must configure functions["api/index.ts"]');
    assert.equal(vercelCfg.functions['api/index.ts'].includeFiles, 'data/**', 'vercel.json must include data/**');
    const hasApiWildcardRewrite = (vercelCfg.rewrites || []).some(
      (r: any) => r.source === '/api/(.*)' && r.destination === '/api/index?__api_path=$1'
    );
    assert.equal(hasApiWildcardRewrite, true, 'vercel.json must rewrite /api/(.*) to /api/index?__api_path=$1');

    console.log('2. Starting simulated Vercel serverless server...');
    const started = await startVercelSimulatedServer();
    server = started.server;
    const baseUrl = started.baseUrl;

    console.log('3. Testing /api/health via Vercel rewrite query param...');
    const healthRes = await fetch(`${baseUrl}/api/index?__api_path=health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'healthy');
    assert.equal(healthJson.version, APP_VERSION);
    assert.equal(healthJson.runtime.serverless, true);
    assert.equal(healthJson.runtime.storageMode, 'serverless-tmp');

    console.log('4. Testing CORS OPTIONS preflight (Origin echo, no wildcard, x-session-token allowed)...');
    const preflightRes = await fetch(`${baseUrl}/api/index?__api_path=devices/pairing-session`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://waqas-pos.vercel.app' },
    });
    assert.equal(preflightRes.status, 204);
    assert.equal(preflightRes.headers.get('access-control-allow-origin'), 'https://waqas-pos.vercel.app');
    assert.equal(preflightRes.headers.get('access-control-allow-credentials'), 'true');
    const allowHeaders = (preflightRes.headers.get('access-control-allow-headers') || '').toLowerCase();
    assert.ok(allowHeaders.includes('x-session-token'), 'x-session-token header must be allowed in CORS');
    assert.ok(allowHeaders.includes('x-shop-id'), 'x-shop-id header must be allowed in CORS');

    console.log('5. Verifying Super Admin Login works (NOT HTTP 405) with pre-parsed Vercel body...');
    const saLoginPreParsed = await invokePreParsedVercelHandler(
      'POST',
      '/api/index?__api_path=auth/super-admin/login',
      { gmail: testSaEmail, password: testSaPassword },
      { Origin: 'https://waqas-pos.vercel.app' }
    );
    assert.equal(saLoginPreParsed.status, 200, `Expected 200 for Super Admin login, got ${saLoginPreParsed.status}: ${saLoginPreParsed.text}`);
    assert.equal(saLoginPreParsed.json?.success, true);
    assert.ok(saLoginPreParsed.json?.token?.startsWith('SA.'), 'Super Admin token must use HMAC-signed SA.* format');

    console.log('6. Verifying Mart Login works (NOT HTTP 405) via Vercel rewrite...');
    const martRes = await fetch(`${baseUrl}/api/index?__api_path=auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portal: 'shop', identifier: 'waqasmart', password: 'ShopOwner@123' }),
    });
    assert.equal(martRes.status, 200, `Expected 200 for Mart login, got ${martRes.status}`);
    const martJson = await martRes.json();
    assert.equal(martJson.success, true);
    assert.ok(martJson.token?.startsWith('SO.'), 'Mart Owner token must use HMAC-signed SO.* format');
    const shopToken = martJson.token as string;

    console.log('7. Testing Multi Connect QR pairing-session & full approval flow (NO HTTP 403 HTML)...');
    // Unauthenticated call must return JSON 401 (never HTML 403)
    const unauthQrRes = await fetch(`${baseUrl}/api/index?__api_path=devices/pairing-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(unauthQrRes.status, 401);
    const unauthQrJson = await unauthQrRes.json();
    assert.equal(unauthQrJson.error, 'AUTH_REQUIRED');

    // Authenticated call with pre-parsed body (exactly how @vercel/node delivers requests)
    const qrRes = await invokePreParsedVercelHandler(
      'POST',
      '/api/index?__api_path=devices/pairing-session',
      {},
      { Authorization: `Bearer ${shopToken}` }
    );
    assert.equal(qrRes.status, 200, `Expected 200 for /api/devices/pairing-session, got ${qrRes.status}: ${qrRes.text}`);
    assert.equal(qrRes.json?.success, true);
    assert.ok(qrRes.json?.pairingToken && qrRes.json?.manualCode);

    const { pairingToken } = qrRes.json;

    const pairRes = await fetch(`${baseUrl}/api/index?__api_path=devices/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenOrCode: pairingToken,
        device: {
          deviceId: 'DEV-VERCEL-TEST-1',
          deviceName: 'Vercel Cashier Phone',
          deviceType: 'Android Mobile',
          browser: 'Chrome',
          os: 'Android',
        },
      }),
    });
    assert.equal(pairRes.status, 200);
    const pairJson = await pairRes.json();
    assert.equal(pairJson.success, true);

    const approveRes = await fetch(`${baseUrl}/api/index?__api_path=devices/approve-pairing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${shopToken}`,
      },
      body: JSON.stringify({ pairingToken, approve: true }),
    });
    assert.equal(approveRes.status, 200);
    const approveJson = await approveRes.json();
    assert.equal(approveJson.success, true);
    assert.ok(approveJson.device?.deviceId === 'DEV-VERCEL-TEST-1');

    const statusRes = await fetch(`${baseUrl}/api/index?__api_path=devices/pairing-status/${pairingToken}`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.session?.status, 'approved');
    assert.ok(statusJson.auth?.sessionToken, 'Approved pairing status must deliver paired device sessionToken');

    console.log('8. Verifying serverless SSE endpoint emits serverless ping and closes cleanly...');
    const sseRes = await fetch(
      `${baseUrl}/api/index?__api_path=sync/events&deviceId=DEV-VERCEL-TEST-1&token=${encodeURIComponent(shopToken)}`
    );
    assert.equal(sseRes.status, 200);
    const sseText = await sseRes.text();
    assert.ok(sseText.includes('"mode":"serverless"'), 'Serverless SSE must signal mode:"serverless"');

    console.log('9. Verifying unmatched /api/* and malformed JSON return JSON (never HTML)...');
    const notFoundRes = await fetch(`${baseUrl}/api/index?__api_path=nonexistent/endpoint`);
    assert.equal(notFoundRes.status, 404);
    assert.ok((notFoundRes.headers.get('content-type') || '').includes('application/json'));
    const notFoundJson = await notFoundRes.json();
    assert.equal(notFoundJson.error, 'API_ENDPOINT_NOT_FOUND');

    const badJsonRes = await fetch(`${baseUrl}/api/index?__api_path=auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken": ',
    });
    assert.equal(badJsonRes.status, 400);
    const badJson = await badJsonRes.json();
    assert.equal(badJson.error, 'INVALID_JSON_BODY');

    console.log('10. Testing frontend apiClient URL guard & 403/405 HTML protection...');
    const memStorage = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => memStorage.get(k) ?? null,
      setItem: (k: string, v: string) => memStorage.set(k, String(v)),
      removeItem: (k: string) => memStorage.delete(k),
    };
    (globalThis as any).window = {
      location: { protocol: 'https:', hostname: 'waqas-pos.vercel.app', origin: 'https://waqas-pos.vercel.app' },
      dispatchEvent() {},
    };
    (globalThis as any).CustomEvent = class { constructor(public type: string) {} };

    const { getApiBaseUrl, safeFetchJson } = await import('../src/utils/apiClient');
    // Stale localhost saved from local dev must be ignored on HTTPS Vercel domain!
    memStorage.set('waqas_mart_server_url', 'http://localhost:3000');
    assert.equal(getApiBaseUrl(), '', 'HTTPS production page must ignore stale http://localhost:3000 override');

    // Same-origin / valid HTTPS URL is preserved
    memStorage.set('waqas_mart_server_url', 'https://api.waqasmart.com/');
    assert.equal(getApiBaseUrl(), 'https://api.waqasmart.com');
    memStorage.delete('waqas_mart_server_url');

    // Simulate HTML 403 Forbidden from misconfigured proxy
    const origFetch = globalThis.fetch;
    try {
      (globalThis as any).fetch = async () =>
        new Response('<html><title>403 Forbidden</title><body>403 Forbidden</body></html>', {
          status: 403,
          headers: { 'content-type': 'text/html' },
        });
      await assert.rejects(
        () => safeFetchJson('/api/devices/pairing-session', { method: 'POST', body: '{}' }),
        (err: any) => err?.status === 403 && err?.isHtmlResponse === true && String(err?.message).includes('HTTP 403')
      );

      (globalThis as any).fetch = async () =>
        new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain' } });
      await assert.rejects(
        () => safeFetchJson('/api/auth/super-admin/login', { method: 'POST', body: '{}' }),
        (err: any) => err?.status === 405 && String(err?.message).includes('405')
      );
    } finally {
      globalThis.fetch = origFetch;
    }

    console.log('11. Multi-container Vercel Serverless test (Container A login -> Container B Create Mart & Multi Connect QR)...');
    const kvStore = new Map<string, string>();
    const kvServer = http.createServer((req, res) => {
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.headers.authorization !== 'Bearer mock-kv-token') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'Unauthorized' }));
      }
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        if (urlObj.pathname.startsWith('/get/')) {
          const key = decodeURIComponent(urlObj.pathname.slice('/get/'.length));
          const val = kvStore.has(key) ? kvStore.get(key)! : null;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ result: val }));
        }
        if (urlObj.pathname.startsWith('/set/')) {
          const key = decodeURIComponent(urlObj.pathname.slice('/set/'.length));
          const isNx = urlObj.searchParams.get('NX') === 'true';
          if (isNx && kvStore.has(key)) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ result: null }));
          }
          kvStore.set(key, rawBody);
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ result: 'OK' }));
        }
        if (urlObj.pathname.startsWith('/del/')) {
          const key = decodeURIComponent(urlObj.pathname.slice('/del/'.length));
          kvStore.delete(key);
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ result: 1 }));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => kvServer.listen(0, '127.0.0.1', resolve));
    const kvPort = (kvServer.address() as { port: number }).port;
    const kvUrl = `http://127.0.0.1:${kvPort}`;

    const { spawn } = await import('node:child_process');
    const spawnWorkerContainer = async (name: string, extraEnv: Record<string, string>) => {
      const containerDir = path.join(tempRoot, `container-${name}`);
      fs.mkdirSync(containerDir, { recursive: true });
      fs.cpSync(path.join(process.cwd(), 'data'), containerDir, { recursive: true });
      const workerCode = `
        import http from 'node:http';
        import handler from './api/index.ts';
        const srv = http.createServer((req, res) => { void handler(req, res); });
        srv.listen(0, '127.0.0.1', () => {
          const addr = srv.address();
          process.stdout.write('READY:' + addr.port + '\\n');
        });
      `;
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        VERCEL: '1',
        VERCEL_ENV: 'production',
        WAQAS_DATA_DIR: containerDir,
        SUPER_ADMIN_EMAIL: testSaEmail,
        SUPER_ADMIN_PASSWORD_SALT: testSaSalt,
        SUPER_ADMIN_PASSWORD_HASH: testSaHash,
      };
      delete env.SESSION_SECRET;
      delete env.WAQAS_SESSION_SECRET;
      delete env.AUTH_SECRET;
      delete env.KV_REST_API_URL;
      delete env.KV_REST_API_TOKEN;
      Object.assign(env, extraEnv);

      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', workerCode], {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const port = await new Promise<number>((resolve, reject) => {
        let out = '';
        let errOut = '';
        const timer = setTimeout(() => reject(new Error(`Container ${name} timed out: ${errOut}`)), 15000);
        child.stdout.on('data', (d) => {
          out += d.toString();
          const m = out.match(/READY:(\d+)/);
          if (m) {
            clearTimeout(timer);
            resolve(Number(m[1]));
          }
        });
        child.stderr.on('data', (d) => { errOut += d.toString(); });
        child.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`Container ${name} exited (${code}): ${errOut}`));
        });
      });
      return { child, baseUrl: `http://127.0.0.1:${port}` };
    };

    const containers: Array<{ child: any }> = [];
    try {
      // 11a. Two containers with shared KV and NO SESSION_SECRET set
      const cA = await spawnWorkerContainer('kv-a', { KV_REST_API_URL: kvUrl, KV_REST_API_TOKEN: 'mock-kv-token' });
      const cB = await spawnWorkerContainer('kv-b', { KV_REST_API_URL: kvUrl, KV_REST_API_TOKEN: 'mock-kv-token' });
      containers.push(cA, cB);

      // Warm up Container B FIRST so its 1500ms hydration cache is active
      const warmB = await fetch(`${cB.baseUrl}/api/index?__api_path=auth/bootstrap-status`);
      assert.equal(warmB.status, 200);

      // Login as Super Admin on Container A
      const loginA = await fetch(`${cA.baseUrl}/api/index?__api_path=auth/super-admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gmail: testSaEmail, password: testSaPassword }),
      });
      assert.equal(loginA.status, 200);
      const loginAJson = await loginA.json();
      const saTokA = loginAJson.token as string;
      assert.ok(saTokA.startsWith('SA.'));

      // Immediately create a new Mart on Container B (<1500ms after Container B warmed!)
      const createShopB = await fetch(`${cB.baseUrl}/api/index?__api_path=super-admin/shops`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': saTokA,
        },
        body: JSON.stringify({
          shopName: 'VERCEL MULTI MART',
          ownerName: 'Usman Tariq',
          username: 'usmanvercel',
          password: 'MartPass#2026',
          confirmPassword: 'MartPass#2026',
          plan: '12_months',
        }),
      });
      const createShopBJson = await createShopB.json();
      assert.equal(createShopB.status, 200, `Expected Container B Create Mart 200, got ${createShopB.status}: ${JSON.stringify(createShopBJson)}`);
      assert.equal(createShopBJson.success, true);

      // Immediately open Multi Connect QR on Container B using Super Admin token from Container A
      const qrSaB = await fetch(`${cB.baseUrl}/api/index?__api_path=devices/pairing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saTokA}` },
        body: '{}',
      });
      assert.equal(qrSaB.status, 200);

      // Newly created Mart Owner logs in on Container A, opens Multi Connect QR on Container B
      const ownerLoginA = await fetch(`${cA.baseUrl}/api/index?__api_path=auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portal: 'shop', identifier: 'usmanvercel', password: 'MartPass#2026' }),
      });
      assert.equal(ownerLoginA.status, 200);
      const ownerTokA = (await ownerLoginA.json()).token as string;

      // Shop Owner MUST NOT be able to create marts on Super Admin route (403)
      const shopCreateAttempt = await fetch(`${cB.baseUrl}/api/index?__api_path=super-admin/shops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerTokA}` },
        body: JSON.stringify({ shopName: 'Forbidden' }),
      });
      assert.equal(shopCreateAttempt.status, 403);

      // Shop Owner opens Multi Connect QR on Container B -> 200 OK
      const ownerQrB = await fetch(`${cB.baseUrl}/api/index?__api_path=devices/pairing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerTokA}` },
        body: '{}',
      });
      assert.equal(ownerQrB.status, 200);
      const ownerQrBJson = await ownerQrB.json();
      assert.ok(ownerQrBJson.pairingToken);

      // 11b. Two containers WITH SESSION_SECRET and NO KV
      const cSecA = await spawnWorkerContainer('sec-a', { SESSION_SECRET: 'shared-vercel-secret-2026-test' });
      const cSecB = await spawnWorkerContainer('sec-b', { SESSION_SECRET: 'shared-vercel-secret-2026-test' });
      containers.push(cSecA, cSecB);

      const loginSecA = await fetch(`${cSecA.baseUrl}/api/index?__api_path=auth/super-admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gmail: testSaEmail, password: testSaPassword }),
      });
      assert.equal(loginSecA.status, 200);
      const tokSecA = (await loginSecA.json()).token as string;

      const overviewSecB = await fetch(`${cSecB.baseUrl}/api/index?__api_path=super-admin/overview`, {
        headers: { Authorization: `Bearer ${tokSecA}` },
      });
      assert.equal(overviewSecB.status, 200, 'Container B with shared SESSION_SECRET must accept Container A token');

      const qrSecB = await fetch(`${cSecB.baseUrl}/api/index?__api_path=devices/pairing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokSecA}` },
        body: '{}',
      });
      assert.equal(qrSecB.status, 200, 'Container B with shared SESSION_SECRET must issue QR pairing session');

      // 11c. Diagnostic test: Two containers with NEITHER KV NOR SESSION_SECRET reject mismatched tokens cleanly (401 SERVERLESS_SESSION_SECRET_MISSING)
      const cNoCfgA = await spawnWorkerContainer('nocfg-a', {});
      const cNoCfgB = await spawnWorkerContainer('nocfg-b', {});
      containers.push(cNoCfgA, cNoCfgB);
      const loginNoCfgA = await fetch(`${cNoCfgA.baseUrl}/api/index?__api_path=auth/super-admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gmail: testSaEmail, password: testSaPassword }),
      });
      const tokNoCfgA = (await loginNoCfgA.json()).token as string;
      const failNoCfgB = await fetch(`${cNoCfgB.baseUrl}/api/index?__api_path=super-admin/overview`, {
        headers: { Authorization: `Bearer ${tokNoCfgA}` },
      });
      assert.equal(failNoCfgB.status, 401);
      const failNoCfgJson = await failNoCfgB.json();
      assert.equal(failNoCfgJson.error, 'SERVERLESS_SESSION_SECRET_MISSING');
    } finally {
      for (const c of containers) {
        try { c.child.kill('SIGTERM'); } catch {}
      }
      await new Promise<void>((resolve) => kvServer.close(() => resolve()));
    }

    console.log('✅ ALL VERCEL PRODUCTION COMPATIBILITY & MULTI-CONTAINER TESTS PASSED!');
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
