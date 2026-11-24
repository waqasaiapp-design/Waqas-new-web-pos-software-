import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { APP_VERSION, APP_BUILD_ID } from '../src/version.ts';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      srv.close((err) => (err ? reject(err) : resolve(addr.port)));
    });
  });
}

async function jsonReq(
  baseUrl: string,
  urlPath: string,
  options: RequestInit & { headers?: Record<string, string> } = {}
) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}
  return { status: res.status, ok: res.ok, data, text };
}

async function waitForHealth(baseUrl: string, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return await res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${baseUrl} did not become healthy within timeout`);
}

function setupBrowserEnv(baseUrl: string) {
  const store = new Map<string, string>();
  const listeners = new Map<string, Array<() => void>>();

  const storage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };

  (globalThis as any).localStorage = storage;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      onLine: true,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    },
  });
  (globalThis as any).window = {
    location: { origin: baseUrl, search: '' },
    matchMedia: () => ({ matches: false }),
    dispatchEvent() {},
    addEventListener(ev: string, fn: () => void) {
      const arr = listeners.get(ev) || [];
      arr.push(fn);
      listeners.set(ev, arr);
    },
  };
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, opts?: any) {
      this.type = type;
      this.detail = opts?.detail;
    }
  };
  (globalThis as any).EventSource = class MockEventSource {
    readyState = 1;
    onopen: any = null;
    onmessage: any = null;
    onerror: any = null;
    close() {
      this.readyState = 2;
    }
  };
  (globalThis as any).document = {
    visibilityState: 'visible',
    addEventListener(ev: string, fn: () => void) {
      const arr = listeners.get(ev) || [];
      arr.push(fn);
      listeners.set(ev, arr);
    },
  };
  return { store };
}

function assertLoginGatewaySourceClean() {
  console.log('1. Verifying LoginGateway UI shows ONLY SUPER ADMIN LOGIN & MART LOGIN...');
  const gatewaySrc = fs.readFileSync(path.join(process.cwd(), 'src/components/Auth/LoginGateway.tsx'), 'utf8');
  assert.ok(gatewaySrc.includes('SUPER ADMIN LOGIN'), 'Must include SUPER ADMIN LOGIN option');
  assert.ok(gatewaySrc.includes('MART LOGIN'), 'Must include MART LOGIN option');
  assert.ok(!gatewaySrc.includes('PWAInstallButton'), 'Startup LoginGateway must not show install button');
  assert.ok(!gatewaySrc.includes('/download'), 'Startup LoginGateway must not show download ZIP link');
  assert.ok(!/create\s*new\s*mart|register\s*super\s*admin|google\s*oauth|sign\s*in\s*with\s*google/i.test(gatewaySrc),
    'Startup LoginGateway must not expose registration or Google OAuth controls');
  assert.ok(!gatewaySrc.includes('Waqas@097245'), 'Must never hardcode Super Admin password in LoginGateway');
  assert.ok(!gatewaySrc.includes('muhammedsaad255251@gmail.com'), 'Must never hardcode Super Admin Gmail in LoginGateway');

  // Verify responsive classes exist for Android Chrome & Desktop
  assert.ok(gatewaySrc.includes('grid-cols-1 sm:grid-cols-2'), 'Portal cards must stack on mobile and sit side-by-side on desktop');
  assert.ok(gatewaySrc.includes('min-h-[48px]'), 'Touch targets on mobile Chrome must be >= 48px');
}

function assertDistBundleSecureAndLatest() {
  console.log('2. Auditing compiled dist bundle for zero exposed credentials & v' + APP_VERSION + '...');
  const distAssetsDir = path.join(process.cwd(), 'dist/assets');
  assert.ok(fs.existsSync(distAssetsDir), 'dist/assets directory must exist after build');
  const jsFiles = fs.readdirSync(distAssetsDir).filter((f) => f.endsWith('.js'));
  assert.ok(jsFiles.length > 0, 'dist/assets must contain compiled JS chunks');

  let combined = '';
  for (const file of jsFiles) {
    combined += fs.readFileSync(path.join(distAssetsDir, file), 'utf8');
  }
  assert.ok(!combined.includes('Waqas@097245'), 'Built frontend JS must NEVER contain Super Admin password');
  assert.ok(!combined.includes('muhammedsaad255251@gmail.com'), 'Built frontend JS must NEVER contain Super Admin Gmail');
  assert.ok(combined.includes(APP_VERSION), 'Built bundle must embed current APP_VERSION ' + APP_VERSION);
  assert.ok(combined.includes(APP_BUILD_ID), 'Built bundle must embed current APP_BUILD_ID ' + APP_BUILD_ID);
  assert.ok(combined.includes('SUPER ADMIN LOGIN') && combined.includes('MART LOGIN'), 'Built bundle must render both startup buttons');
}

async function runIsolatedFlowTests() {
  console.log('3. Testing isolated auth flow: Super Admin Login, Mart Login, Refresh Persistence, & Zero Post-Logout Bypass...');
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-auth-flow-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const SA_GMAIL = 'muhammedsaad255251@gmail.com';
  const SA_PASS = 'Waqas@097245';

  const srvProcess: ChildProcess = spawn('npx', ['tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      WAQAS_DATA_DIR: tempDataDir,
      SUPER_ADMIN_GMAIL: SA_GMAIL,
      SUPER_ADMIN_PASSWORD: SA_PASS,
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const health = await waitForHealth(baseUrl);
    assert.equal(health.version, APP_VERSION);

    // Check HTML served at root contains zero pre-auth dashboard/signup text
    const rootHtml = await (await fetch(`${baseUrl}/`)).text();
    assert.ok(rootHtml.includes('<div id="root"></div>'), 'Root serves SPA index.html');

    // Verify bootstrap-status locks registration and disables Google OAuth
    const boot = await jsonReq(baseUrl, '/api/auth/bootstrap-status');
    assert.equal(boot.status, 200);
    assert.equal(boot.data.superAdminConfigured, true);
    assert.equal(boot.data.superAdminSetupLocked, true);
    assert.equal(boot.data.registrationDisabled, true);
    assert.equal(boot.data.googleOAuthEnabled, false);

    // Wrong Gmail blocked cleanly (403)
    const wrongGmail = await jsonReq(baseUrl, '/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ gmail: 'other@gmail.com', password: SA_PASS }),
    });
    assert.equal(wrongGmail.status, 403);

    // Wrong Password blocked cleanly (401)
    const wrongPass = await jsonReq(baseUrl, '/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ gmail: SA_GMAIL, password: 'WrongPassword!' }),
    });
    assert.equal(wrongPass.status, 401);

    // Valid Super Admin Login
    setupBrowserEnv(baseUrl);
    const { syncService, setCustomApiBaseUrl } = await import('../src/utils/syncService.ts');
    setCustomApiBaseUrl(baseUrl);
    const authClient = await import('../src/utils/authClient.ts');

    const saSession = await authClient.loginSuperAdmin({ gmail: SA_GMAIL, password: SA_PASS });
    assert.equal(saSession.user.role, 'SUPER_ADMIN');
    assert.ok(saSession.token, 'Super Admin token returned & stored');

    // Simulating page refresh: fetchCurrentSession returns active Super Admin session
    const refreshedSa = await authClient.fetchCurrentSession();
    assert.equal(refreshedSa?.user.role, 'SUPER_ADMIN');
    assert.equal(refreshedSa?.user.email, SA_GMAIL);

    // Create a Mart account cleanly via Super Admin (mimics SuperAdminDashboard workflow)
    const createdMart = await jsonReq(baseUrl, '/api/super-admin/shops', {
      method: 'POST',
      headers: { Authorization: `Bearer ${saSession.token}` },
      body: JSON.stringify({
        shopName: 'QA Test Mart',
        ownerName: 'QA Owner',
        username: 'qatestmart',
        password: 'MartLogin@99',
        phone: '03001112233',
        planType: 'MONTHLY',
        subscriptionDays: 30,
      }),
    });
    assert.equal(createdMart.status, 200);
    assert.ok(createdMart.data?.shop?.id, 'Shop ID created cleanly');
    const createdShopId = createdMart.data.shop.id;

    // Seed isolated store product for this shop
    const seedRes = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${saSession.token}`,
        'x-shop-id': createdShopId,
      },
      body: JSON.stringify({
        action: 'update_stock',
        payload: [
          {
            id: 'qa-prod-1',
            name: 'QA Rice Bag',
            category: 'Grocery',
            price: 1200,
            costPrice: 1000,
            stock: 25,
            barcode: '8901234567890',
          },
        ],
      }),
    });
    assert.equal(seedRes.status, 200);

    // Super Admin Logout: session cleared and server rejects old token
    await authClient.logoutSession();
    syncService.clearDeviceSessionAccess();
    assert.equal(authClient.getStoredAuthSession(), null);
    const afterLogoutMe = await jsonReq(baseUrl, '/api/auth/me', {
      headers: { Authorization: `Bearer ${saSession.token}` },
    });
    assert.equal(afterLogoutMe.status, 401);

    // Now test MART LOGIN using Shop Username + Password (and verify registerPrimaryDevice sets pairedViaQr = false)
    const martSession = await authClient.loginAccount({
      portal: 'shop',
      identifier: 'qatestmart',
      password: 'MartLogin@99',
    });
    assert.equal(martSession.user.shopId, createdShopId);

    const registeredPrimary = await syncService.registerPrimaryDevice();
    assert.ok(registeredPrimary?.sessionToken, 'Primary login still registers device telemetry cleanly');
    assert.equal(registeredPrimary?.pairedViaQr, false, 'CRITICAL: Primary login must NEVER set pairedViaQr = true');

    // Verify store isolation returns QA Rice Bag
    const fetchedStore = await syncService.fetchServerStore();
    assert.equal(fetchedStore?.products?.[0]?.name, 'QA Rice Bag');

    // Simulating Mart page refresh: fetchCurrentSession restores Mart session
    const refreshedMart = await authClient.fetchCurrentSession();
    assert.equal(refreshedMart?.user.shopId, createdShopId);

    // Now simulate MART LOGOUT — App must NOT bypass login on reload even if anything remained in device storage
    await authClient.logoutSession();
    syncService.clearDeviceSessionAccess();
    assert.equal(authClient.getStoredAuthSession(), null);
    assert.equal(syncService.getDevice().sessionToken, undefined, 'Device sessionToken must be cleared on logout');
    assert.equal(syncService.getDevice().pairedViaQr, false, 'Device pairedViaQr must be false after logout');
    assert.equal(await authClient.fetchCurrentSession(), null);

    // Verify legitimate QR Pairing DOES still work and passes verifyPairedTerminalAccess()
    // Log back in as Mart Owner to generate QR pairing token
    const ownerSession = await authClient.loginAccount({
      portal: 'shop',
      identifier: createdShopId,
      password: 'MartLogin@99',
    });
    const qrInit = await jsonReq(baseUrl, '/api/devices/pairing-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerSession.token}` },
      body: JSON.stringify({}),
    });
    assert.equal(qrInit.status, 200);
    const pairingToken = qrInit.data.pairingToken;

    const qrPair = await jsonReq(baseUrl, '/api/devices/pair', {
      method: 'POST',
      body: JSON.stringify({
        tokenOrCode: pairingToken,
        device: {
          deviceId: syncService.getDevice().deviceId,
          deviceName: 'Android Counter Cashier',
          deviceType: 'Android Mobile',
          browser: 'Chrome Mobile',
          os: 'Android',
        },
      }),
    });
    assert.equal(qrPair.status, 200);

    const qrApprove = await jsonReq(baseUrl, '/api/devices/approve-pairing', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerSession.token}` },
      body: JSON.stringify({
        pairingToken,
        approve: true,
      }),
    });
    assert.equal(qrApprove.status, 200);

    const qrPoll = await jsonReq(baseUrl, `/api/devices/pairing-status/${pairingToken}`);
    assert.equal(qrPoll.status, 200);
    assert.ok(qrPoll.data?.auth?.sessionToken, 'Approved pairing poll must yield device sessionToken');

    // Complete pairing and log out user account — QR terminal retains verified access
    await authClient.logoutSession();
    syncService.completePairing(qrPoll.data.auth.device, qrPoll.data.auth.sessionToken);
    assert.equal(syncService.getDevice().pairedViaQr, true);

    const pairedCheck = await syncService.verifyPairedTerminalAccess();
    assert.equal(pairedCheck.ok, true, 'Explicit QR-paired terminal must remain authorized across reload');

    // When owner revokes or deletes paired device, verifyPairedTerminalAccess rejects & blocks bypass
    const ownerSession2 = await authClient.loginAccount({
      portal: 'shop',
      identifier: createdShopId,
      password: 'MartLogin@99',
    });
    const delRes = await jsonReq(baseUrl, `/api/devices/${encodeURIComponent(syncService.getDevice().deviceId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerSession2.token}` },
    });
    assert.equal(delRes.status, 200);
    await authClient.logoutSession();

    const afterDeleteCheck = await syncService.verifyPairedTerminalAccess();
    assert.equal(afterDeleteCheck.ok, false, 'Removed QR device must fail startup verification & return to Login');
    assert.equal(syncService.getDevice().sessionToken, undefined);
    assert.equal(syncService.getDevice().pairedViaQr, false);

    // 4. Test existing installed device with pre-policy (old) session + preserved business data
    const sampleInventory = JSON.stringify([{ id: 'p-1', name: 'Sugar 1kg', price: 150, stock: 40 }]);
    const sampleHisab = JSON.stringify({ '2026-11-22': { morning: { openingCash: 5000 } } });
    (globalThis as any).localStorage.setItem('waqas_mart_inventory_v6', sampleInventory);
    (globalThis as any).localStorage.setItem('waqas_mart_daily_hisab_v2', sampleHisab);
    (globalThis as any).localStorage.setItem(
      'waqas_pos_session_v1',
      JSON.stringify({ token: 'old-pre-policy-token', user: { id: 'USR-OLD', role: 'SHOP_OWNER', shopId: createdShopId } })
    );
    (globalThis as any).localStorage.setItem('waqas_pos_auth_policy_version', '3.0.0-old');

    const migratedOld = authClient.enforceAuthPolicyMigration();
    assert.equal(migratedOld, true, 'Old session from previous version policy MUST trigger forced login');
    assert.equal(authClient.getStoredAuthSession(), null, 'Old session token MUST be cleared cleanly');
    assert.equal(
      (globalThis as any).localStorage.getItem('waqas_mart_inventory_v6'),
      sampleInventory,
      'Business inventory MUST NOT be wiped when clearing old auth tokens'
    );
    assert.equal(
      (globalThis as any).localStorage.getItem('waqas_mart_daily_hisab_v2'),
      sampleHisab,
      'Business Daily Hisab MUST NOT be wiped when clearing old auth tokens'
    );

    // 5. Test freshly installed PWA launch (?source=pwa / standalone) inheriting browser Chrome session
    const validBrowserSession = await authClient.loginAccount({
      portal: 'shop',
      identifier: createdShopId,
      password: 'MartLogin@99',
    });
    assert.ok(validBrowserSession.token);
    assert.ok(authClient.getStoredAuthSession()?.token, 'Normal browser tab holds valid session');

    // Now launch freshly installed PWA sharing the same localStorage!
    (globalThis as any).window.location.search = '?source=pwa';
    (globalThis as any).window.matchMedia = (q: string) => ({ matches: q.includes('standalone') });
    assert.equal(
      authClient.getStoredAuthSession(),
      null,
      'Freshly installed PWA MUST NOT auto-login using browser Chrome localStorage session'
    );
    const pwaFirstLaunchReset = authClient.enforceAuthPolicyMigration();
    assert.equal(pwaFirstLaunchReset, true, 'Fresh standalone PWA launch must reset shared auth token cleanly');

    // Now user explicitly logs in inside the installed PWA -> subsequent standalone reloads stay logged in until logout
    const pwaSession = await authClient.loginAccount({
      portal: 'shop',
      identifier: createdShopId,
      password: 'MartLogin@99',
    });
    assert.ok(pwaSession.token);
    assert.equal(
      (await authClient.fetchCurrentSession())?.token,
      pwaSession.token,
      'Reloading installed PWA after explicit login inside PWA keeps session active until logout'
    );

    // Logout inside PWA clears PWA auth flag too
    await authClient.logoutSession();
    assert.equal(authClient.getStoredAuthSession(), null, 'PWA reload after logout must show Login Selection screen');

    // Reset search/matchMedia state
    (globalThis as any).window.location.search = '';
    (globalThis as any).window.matchMedia = () => ({ matches: false });

    // 6. Verify all ZIP download routes are permanently removed (404)
    for (const route of ['/download', '/download-app', '/api/download', '/waqas-mart-pos.zip']) {
      const zipRes = await fetch(`${baseUrl}${route}?v=${encodeURIComponent(APP_VERSION)}`);
      assert.equal(zipRes.status, 404, `ZIP route ${route} must be removed and return 404`);
    }

    console.log('   Isolated auth startup, policy migration, PWA fresh-install, login, refresh, logout, & ZIP removal checks PASSED.');
    syncService.closeSse();
  } finally {
    srvProcess.kill('SIGKILL');
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

async function main() {
  assertLoginGatewaySourceClean();
  assertDistBundleSecureAndLatest();
  await runIsolatedFlowTests();
  console.log('\nALL STARTUP & AUTHENTICATION SECURITY CHECKS PASSED FOR v' + APP_VERSION + '!');
  process.exit(0);
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
