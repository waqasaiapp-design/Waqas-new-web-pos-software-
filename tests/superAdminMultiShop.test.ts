import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';

let BASE_URL = 'http://127.0.0.1:0';
const TEST_SA_GMAIL = 'test-owner-sa@gmail.com';
const TEST_SA_PASS = 'TestSuperAdmin#2026';

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
  urlPath: string,
  options: RequestInit & { headers?: Record<string, string> } = {}
) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
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

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Isolated test server did not become healthy within timeout');
}

async function runTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-pos-sa-test-'));
  const testPort = await getFreePort();
  BASE_URL = `http://127.0.0.1:${testPort}`;

  const saSalt = crypto.randomBytes(16).toString('hex');
  const saHash =
    'scrypt:' + crypto.scryptSync(TEST_SA_PASS, saSalt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');

  let serverProc: ChildProcess | null = null;
  const startServer = async () => {
    const proc = spawn('node', ['server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(testPort),
        APP_URL: BASE_URL,
        WAQAS_DATA_DIR: tempDir,
        SUPER_ADMIN_EMAIL: TEST_SA_GMAIL,
        SUPER_ADMIN_PASSWORD_SALT: saSalt,
        SUPER_ADMIN_PASSWORD_HASH: saHash,
      },
      stdio: 'pipe',
    });
    serverProc = proc;
    await waitForHealth();
  };
  const stopServer = async () => {
    const proc = serverProc;
    if (!proc || proc.killed || proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
      proc.kill('SIGKILL');
    });
    serverProc = null;
  };

  try {
    await startServer();

    // 1. Unauthenticated rejection & disabled registration / Google OAuth endpoints
    console.log('1. Checking unauthenticated rejection & disabled registration/Google OAuth routes...');
    const unauthStore = await jsonReq('/api/store/state');
    assert.equal(unauthStore.status, 401, 'Unauthenticated /api/store/state must return 401');

    const unauthSA = await jsonReq('/api/super-admin/overview');
    assert.equal(unauthSA.status, 401, 'Unauthenticated /api/super-admin/overview must return 401');

    const boot = await jsonReq('/api/auth/bootstrap-status');
    assert.equal(boot.status, 200);
    assert.equal(boot.data.superAdminConfigured, true);
    assert.equal(boot.data.superAdminSetupLocked, true);
    assert.equal(boot.data.registrationDisabled, true);
    assert.equal(boot.data.googleOAuthEnabled, false);

    const legacySetup = await jsonReq('/api/auth/super-admin/send-setup-otp', {
      method: 'POST',
      body: JSON.stringify({ gmail: 'hack@gmail.com', password: 'Password123!' }),
    });
    assert.equal(legacySetup.status, 403);
    assert.equal(legacySetup.data.error, 'PUBLIC_REGISTRATION_DISABLED');

    const provDisabled = await jsonReq('/api/auth/super-admin/provision', {
      method: 'POST',
      body: JSON.stringify({ password: 'Password123!' }),
    });
    assert.equal(provDisabled.status, 403);
    assert.equal(provDisabled.data.error, 'SUPER_ADMIN_REGISTRATION_DISABLED');

    const googleDisabled = await jsonReq('/api/auth/google/url?purpose=login');
    assert.equal(googleDisabled.status, 403);
    assert.equal(googleDisabled.data.error, 'GOOGLE_OAUTH_DISABLED');

    const googleVerifyDisabled = await jsonReq('/api/auth/google/verify-id-token', {
      method: 'POST',
      body: JSON.stringify({ idToken: 'fake' }),
    });
    assert.equal(googleVerifyDisabled.status, 403);
    assert.equal(googleVerifyDisabled.data.error, 'GOOGLE_OAUTH_DISABLED');

    // 2. Fixed Super Admin Login Verification: Wrong Gmail rejected, Wrong Password rejected, Exact Gmail + Password succeeds
    console.log('2. Testing Super Admin Gmail + Password authentication...');
    const wrongGmailLogin = await jsonReq('/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ gmail: 'stranger@gmail.com', password: TEST_SA_PASS }),
    });
    assert.equal(wrongGmailLogin.status, 403);
    assert.equal(wrongGmailLogin.data.error, 'UNAUTHORIZED_GMAIL');

    const wrongPassLogin = await jsonReq('/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ gmail: TEST_SA_GMAIL, password: 'WrongPassword123' }),
    });
    assert.equal(wrongPassLogin.status, 401);
    assert.equal(wrongPassLogin.data.error, 'INVALID_SUPER_ADMIN_PASSWORD');

    const goodSaLogin = await jsonReq('/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ gmail: `  ${TEST_SA_GMAIL.toUpperCase()} `, password: ` ${TEST_SA_PASS} ` }),
    });
    assert.equal(goodSaLogin.status, 200);
    assert.ok(goodSaLogin.data.token);
    assert.equal(goodSaLogin.data.user.role, 'SUPER_ADMIN');
    const saHeaders = { Authorization: `Bearer ${goodSaLogin.data.token}` };

    const overviewRes = await jsonReq('/api/super-admin/overview', { headers: saHeaders });
    assert.equal(overviewRes.status, 200);
    assert.ok(Array.isArray(overviewRes.data.shops));

    // 3. Create Mart A & Mart B, login by Shop ID & Shop Username, enforce strict cross-shop isolation
    console.log('3. Creating Mart A & Mart B, verifying Shop ID/Username login & strict database isolation...');
    const mismatchMart = await jsonReq('/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'Bad Mart',
        ownerName: 'Test',
        username: 'badmart',
        password: 'MartPass@1',
        confirmPassword: 'MismatchPassword',
      }),
    });
    assert.equal(mismatchMart.status, 400, 'Password confirmation mismatch must return 400');

    const createMartA = await jsonReq('/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'LAHORE SUPER MART',
        ownerName: 'Hamza Tariq',
        username: 'lahoremart',
        password: 'LahorePass@1',
        confirmPassword: 'LahorePass@1',
        mobile: '03001112233',
        plan: '12_months',
        status: 'active',
        initialPayment: 14000,
      }),
    });
    assert.equal(createMartA.status, 200);
    const martAId = createMartA.data.shopId;
    assert.ok(martAId && martAId !== 'SHOP-WM-001');

    const createMartB = await jsonReq('/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'KARACHI BAZAAR',
        ownerName: 'Bilal Sheikh',
        username: 'karachimart',
        password: 'KarachiPass@1',
        confirmPassword: 'KarachiPass@1',
        mobile: '03009998877',
        plan: '6_months',
        status: 'active',
      }),
    });
    assert.equal(createMartB.status, 200);
    const martBId = createMartB.data.shopId;

    // Login Mart A by Shop Username
    const loginByUsername = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'lahoremart', password: 'LahorePass@1' }),
    });
    assert.equal(loginByUsername.status, 200);
    assert.equal(loginByUsername.data.shop.id, martAId);

    // Login Mart B by generated Shop ID
    const loginByShopId = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: martBId, password: 'KarachiPass@1' }),
    });
    assert.equal(loginByShopId.status, 200);
    assert.equal(loginByShopId.data.shop.id, martBId);

    const martAHeaders = { Authorization: `Bearer ${loginByUsername.data.token}` };
    const martBHeaders = { Authorization: `Bearer ${loginByShopId.data.token}` };

    // Shop Owner CANNOT access Super Admin endpoints (403 SUPER_ADMIN_ONLY)
    const ownerHitSuperAdmin = await jsonReq('/api/super-admin/overview', { headers: martAHeaders });
    assert.equal(ownerHitSuperAdmin.status, 403);
    assert.equal(ownerHitSuperAdmin.data.error, 'SUPER_ADMIN_ONLY');

    // Mart A CANNOT read Mart B store via x-shop-id (403 CROSS_SHOP_ACCESS_DENIED)
    const crossShopHit = await jsonReq(`/api/store/state?shopId=${encodeURIComponent(martBId)}`, {
      headers: martAHeaders,
    });
    assert.equal(crossShopHit.status, 403);
    assert.equal(crossShopHit.data.error, 'CROSS_SHOP_ACCESS_DENIED');

    // Sync distinct product into Mart A -> Mart B must NOT see it
    await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: martAHeaders,
      body: JSON.stringify({
        action: 'update_stock',
        sourceDeviceId: 'PC-MART-A',
        payload: [
          {
            id: 'PROD-A-ONLY',
            name: 'Lahore Special Rice 5kg',
            barcode: '888000111',
            category: 'Rice',
            unit: 'Bag',
            costPrice: 1400,
            price: 1650,
            stock: 25,
            minStockLevel: 5,
          },
        ],
      }),
    });
    const martBState = await jsonReq('/api/store/state', { headers: martBHeaders });
    assert.equal(
      martBState.data.store.products.some((p: any) => p.id === 'PROD-A-ONLY'),
      false,
      'Mart B store must remain strictly isolated from Mart A data'
    );

    // 4. Staff RBAC + costPrice privacy + Mart Suspension / Reactivation + Password Reset
    console.log('4. Verifying Staff RBAC privacy, Mart Suspend/Reactivate, and Owner Password Reset...');
    await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: martAHeaders,
      body: JSON.stringify({
        action: 'sync_staff',
        sourceDeviceId: 'PC-MART-A',
        payload: [
          {
            id: 'STF-CASH-A',
            name: 'Cashier Usman',
            employeeId: 'EMP-A1',
            role: 'Cashier',
            department: 'POS',
            shift: 'Morning',
            phone: '03110001122',
            salary: 28000,
            address: 'Lahore',
            joiningDate: '2026-11-01',
            username: 'usman_cashier',
            newPassword: 'CashierPass@1',
            accountStatus: 'active',
            permissions: {
              newSale: true,
              oldSale: false,
              newPurchase: false,
              oldPurchase: false,
              stock: true,
              products: true,
              customers: false,
              suppliers: false,
              dailyHisab: false,
              expenses: false,
              reports: false,
              staff: false,
              settings: false,
              barcode: false,
              canEditPrice: false,
              canGiveDiscount: false,
              canDeleteItems: false,
              canAccessReports: false,
              canAccessSettings: false,
              canAccessLedgers: false,
              canViewCostAndProfit: false,
            },
            createdAt: '2026-11-01',
          },
        ],
      }),
    });

    const staffLogin = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'usman_cashier', password: 'CashierPass@1' }),
    });
    assert.equal(staffLogin.status, 200);
    const staffState = await jsonReq('/api/store/state', {
      headers: { Authorization: `Bearer ${staffLogin.data.token}` },
    });
    assert.equal(
      staffState.data.store.products[0].costPrice,
      0,
      'Server must sanitize product costPrice to 0 when staff lacks canViewCostAndProfit'
    );

    // Suspend Mart A -> active Mart A login blocked with 403 SHOP_ACCOUNT_RESTRICTED
    const susp = await jsonReq(`/api/super-admin/shops/${martAId}/status`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ status: 'suspended' }),
    });
    assert.equal(susp.status, 200);

    const suspendedState = await jsonReq('/api/store/state', { headers: martAHeaders });
    assert.equal(suspendedState.status, 401, 'Session of suspended shop should be invalidated');

    const suspendedLogin = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'lahoremart', password: 'LahorePass@1' }),
    });
    assert.equal(suspendedLogin.status, 403);
    assert.equal(suspendedLogin.data.error, 'SHOP_ACCOUNT_RESTRICTED');

    // Reactivate Mart A & Edit username & Reset password
    await jsonReq(`/api/super-admin/shops/${martAId}/status`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ status: 'active' }),
    });
    await jsonReq(`/api/super-admin/shops/${martAId}`, {
      method: 'PUT',
      headers: saHeaders,
      body: JSON.stringify({ ownerUsername: 'lahoremart_v2' }),
    });
    await jsonReq(`/api/super-admin/shops/${martAId}/reset-password`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ password: 'NewLahorePass@2' }),
    });

    const loginUpdatedOwner = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'lahoremart_v2', password: 'NewLahorePass@2' }),
    });
    assert.equal(loginUpdatedOwner.status, 200);

    // 5. Validation, whitespace/case normalization, disk persistence, restart & orphan repair
    console.log('5. Testing Mart validation, whitespace/case normalization, restart persistence, and orphan repair...');
    const spaceUsernameRes = await jsonReq('/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'Space Mart',
        ownerName: 'Test User',
        username: 'bad user',
        password: 'MartPass@1',
        confirmPassword: 'MartPass@1',
      }),
    });
    assert.equal(spaceUsernameRes.status, 400);
    assert.equal(spaceUsernameRes.data.error, 'INVALID_SHOP_USERNAME');

    const dupUsernameRes = await jsonReq('/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'Dup Mart',
        ownerName: 'Dup Owner',
        username: 'lahoremart_v2',
        password: 'MartPass@1',
        confirmPassword: 'MartPass@1',
      }),
    });
    assert.equal(dupUsernameRes.status, 409);
    assert.equal(dupUsernameRes.data.error, 'DUPLICATE_USERNAME');

    const createMartC = await jsonReq('/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'ISLAMABAD FRESH MART',
        ownerName: 'Zain Abbas',
        username: '  IslamabadMart  ',
        password: '  IsbPass@2026  ',
        confirmPassword: 'IsbPass@2026',
        status: 'active',
      }),
    });
    assert.equal(createMartC.status, 200);
    const martCId = createMartC.data.shopId;
    assert.equal(createMartC.data.ownerUsername, 'islamabadmart');

    const persistedSubs = JSON.parse(fs.readFileSync(path.join(tempDir, 'subscriptions_db.json'), 'utf8'));
    const persistedAuth = JSON.parse(fs.readFileSync(path.join(tempDir, 'auth_db.json'), 'utf8'));
    assert.ok(persistedSubs.shops.some((s: any) => s.id === martCId && s.ownerUsername === 'islamabadmart'));
    assert.ok(persistedAuth.users.some((u: any) => u.shopId === martCId && u.username === 'islamabadmart'));
    assert.ok(fs.existsSync(path.join(tempDir, 'shops', `${martCId}.json`)));

    const loginMartC = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: '  ISLAMABADMART ', password: ' IsbPass@2026 ' }),
    });
    assert.equal(loginMartC.status, 200);
    assert.equal(loginMartC.data.shop.id, martCId);

    const wrongPwdRes = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'islamabadmart', password: 'WrongPassword123' }),
    });
    assert.equal(wrongPwdRes.status, 401);
    assert.equal(wrongPwdRes.data.error, 'INVALID_PASSWORD');

    const missingAccRes = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'nonexistent_mart_xyz', password: 'SomePassword1' }),
    });
    assert.equal(missingAccRes.status, 401);
    assert.equal(missingAccRes.data.error, 'ACCOUNT_NOT_FOUND');

    await jsonReq(`/api/super-admin/shops/${martCId}/status`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ status: 'inactive' }),
    });
    const inactiveLoginRes = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'islamabadmart', password: 'IsbPass@2026' }),
    });
    assert.equal(inactiveLoginRes.status, 403);
    assert.equal(inactiveLoginRes.data.error, 'SHOP_ACCOUNT_RESTRICTED');
    await jsonReq(`/api/super-admin/shops/${martCId}/status`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ status: 'active' }),
    });

    await stopServer();
    await startServer();

    const loginAfterRestart = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: martCId, password: 'IsbPass@2026' }),
    });
    assert.equal(loginAfterRestart.status, 200);
    assert.equal(loginAfterRestart.data.shop.id, martCId);

    await stopServer();
    const orphanAuth = JSON.parse(fs.readFileSync(path.join(tempDir, 'auth_db.json'), 'utf8'));
    orphanAuth.users = orphanAuth.users.filter((u: any) => u.shopId !== martCId);
    fs.writeFileSync(path.join(tempDir, 'auth_db.json'), JSON.stringify(orphanAuth, null, 2));
    await startServer();

    const orphanLoginAttempt = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: martCId, password: 'IsbPass@2026' }),
    });
    assert.equal(orphanLoginAttempt.status, 403);
    assert.equal(orphanLoginAttempt.data.error, 'OWNER_LOGIN_NOT_CONFIGURED');

    const repairRes = await jsonReq(`/api/super-admin/shops/${martCId}/reset-password`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ username: 'islamabadmart', password: 'RepairedPass@99', confirmPassword: 'RepairedPass@99' }),
    });
    assert.equal(repairRes.status, 200);
    const repairedLogin = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'islamabadmart', password: 'RepairedPass@99' }),
    });
    assert.equal(repairedLogin.status, 200);

    console.log('ALL FIXED SUPER ADMIN + MULTI-MART LOGIN & ISOLATION TESTS PASSED 100%!');
  } finally {
    await stopServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Super Admin Multi-Shop test failed:', err);
    process.exit(1);
  });
