import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_VERSION } from '../src/version.ts';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        return reject(new Error('Failed to get free port'));
      }
      const p = addr.port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

async function waitForHealth(baseUrl: string) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server health timeout');
}

async function jsonReq(baseUrl: string, p: string, options?: RequestInit) {
  const res = await fetch(`${baseUrl}${p}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, data, text };
}

function assertUiComponentsAndBundleClean() {
  console.log('1. Auditing UI source & compiled bundle for MY POS APP, MART ACCOUNTS DETAILS, SIGN OUT, zero ZIP, & zero Open Online App...');
  const saSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/SuperAdminDashboard.tsx'), 'utf8');
  assert.ok(saSrc.includes('MART ACCOUNTS DETAILS'), 'SuperAdminDashboard must show MART ACCOUNTS DETAILS');
  assert.ok(saSrc.includes('MY POS APP'), 'SuperAdminDashboard must show MY POS APP');
  assert.ok(saSrc.includes('SIGN OUT'), 'SuperAdminDashboard must show SIGN OUT');
  assert.ok(saSrc.includes('onOpenMyPosApp'), 'SuperAdminDashboard must wire MY POS APP launcher');

  const homeSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/HomePage.tsx'), 'utf8');
  assert.ok(!homeSrc.includes('/download'), 'HomePage must not link to /download');
  assert.ok(!homeSrc.includes('.zip'), 'HomePage must not reference .zip');
  assert.ok(!/download\s+app/i.test(homeSrc), 'HomePage must not show Download App button');
  assert.ok(!/open\s+online\s+app/i.test(homeSrc), 'HomePage must NEVER include OPEN ONLINE APP');
  assert.ok(homeSrc.includes('homepage-header-signout'), 'HomePage header must render visible Sign Out button');

  const pwaSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/PWAInstallButton.tsx'), 'utf8');
  assert.ok(!pwaSrc.includes('/download'), 'PWAInstallButton must not link to /download');
  assert.ok(!pwaSrc.includes('.zip'), 'PWAInstallButton must not reference .zip');
  assert.ok(!/open\s+online\s+app/i.test(pwaSrc), 'PWAInstallButton must NEVER include OPEN ONLINE APP');

  const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes('SHOP-SA-POS'), 'App.tsx must isolate Super Admin POS under SHOP-SA-POS');
  assert.ok(appSrc.includes('Return to Super Admin Dashboard'), 'App.tsx must allow returning from MY POS APP to Super Admin Dashboard');
  assert.ok(appSrc.includes('sa-pos-bar-signout'), 'App.tsx must show Sign Out inside MY POS APP bar');

  const distAssetsDir = path.join(process.cwd(), 'dist/assets');
  assert.ok(fs.existsSync(distAssetsDir), 'dist/assets must exist after build');
  let combined = '';
  for (const file of fs.readdirSync(distAssetsDir).filter((f) => f.endsWith('.js'))) {
    combined += fs.readFileSync(path.join(distAssetsDir, file), 'utf8');
  }
  assert.ok(combined.includes('MART ACCOUNTS DETAILS'), 'Bundle must contain MART ACCOUNTS DETAILS');
  assert.ok(combined.includes('MY POS APP'), 'Bundle must contain MY POS APP');
  assert.ok(combined.includes('Return to Super Admin Dashboard'), 'Bundle must contain Return to Super Admin Dashboard');
  assert.ok(!combined.includes('Download Full Offline Package'), 'Bundle must NOT contain offline ZIP download copy');
  assert.ok(!combined.includes('WAQAS-POS-SOFTWARE-v'), 'Bundle must NOT contain ZIP filename download attribute');
  assert.ok(!/open online app/i.test(combined), 'Bundle must NEVER contain Open Online App option');
}

async function runBackendIsolationAndLogoutTests() {
  console.log('2. Testing Super Admin MY POS APP isolation vs Mart Accounts Details, Sign Out & Data Preservation...');
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-sa-pos-test-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const SA_GMAIL = 'muhammedsaad255251@gmail.com';
  const SA_PASS = 'Waqas@097245';
  const saSalt = crypto.randomBytes(16).toString('hex');
  const saHash =
    'scrypt:' + crypto.scryptSync(SA_PASS, saSalt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');

  const srvProcess = spawn('node', ['server.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      WAQAS_DATA_DIR: tempDataDir,
      SUPER_ADMIN_EMAIL: SA_GMAIL,
      SUPER_ADMIN_PASSWORD_SALT: saSalt,
      SUPER_ADMIN_PASSWORD_HASH: saHash,
    },
    stdio: 'pipe',
  });

  try {
    await waitForHealth(baseUrl);

    // Confirm all ZIP download endpoints return 404
    for (const route of ['/download', '/download-app', '/api/download', '/waqas-mart-pos.zip']) {
      const z = await fetch(`${baseUrl}${route}?v=${encodeURIComponent(APP_VERSION)}`);
      assert.equal(z.status, 404, `ZIP route ${route} must return 404`);
    }

    // 1. Super Admin Login
    const saLogin = await jsonReq(baseUrl, '/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ gmail: SA_GMAIL, password: SA_PASS }),
    });
    assert.equal(saLogin.status, 200);
    assert.equal(saLogin.data?.user?.role, 'SUPER_ADMIN');
    const saHeaders = { Authorization: `Bearer ${saLogin.data.token}` };

    // 2. Super Admin creates a Mart Account (Mart Alpha)
    const createMart = await jsonReq(baseUrl, '/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'Alpha Supermart',
        ownerName: 'Usman Khan',
        username: 'alphamart',
        password: 'Alpha@User123',
        mobile: '03009998877',
        plan: '12_months',
      }),
    });
    assert.equal(createMart.status, 200);
    const martShopId = createMart.data.shopId;
    assert.ok(martShopId);

    // 3. Super Admin opens MY POS APP (no x-shop-id -> defaults strictly to SHOP-SA-POS, NEVER SHOP-WM-001 or Mart Alpha)
    const saInitialState = await jsonReq(baseUrl, '/api/store/state', { headers: saHeaders });
    assert.equal(saInitialState.status, 200);
    assert.equal(saInitialState.data.shopId, 'SHOP-SA-POS', 'Super Admin POS must bind strictly to SHOP-SA-POS');
    assert.equal(saInitialState.data.store.branding.storeName, 'MY POS APP');

    // Add product & purchase & sale inside Super Admin MY POS APP
    const saProduct = {
      id: 'SA-PROD-1',
      name: 'SA Executive Tea Pack',
      category: 'Beverages',
      price: 550,
      costPrice: 400,
      stock: 0,
      barcode: '991100220011',
      unit: 'Pcs',
      tax: 0,
    };
    const saStockRes = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ action: 'update_stock', payload: [saProduct], sourceDeviceId: 'SA-TERM-1' }),
    });
    assert.equal(saStockRes.status, 200);

    const saPurRes = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        action: 'create_purchase',
        sourceDeviceId: 'SA-TERM-1',
        payload: {
          id: 'SA-PUR-1',
          purchaseInvoiceNo: 'SA-PINV-101',
          dateTime: '2026-11-22 10:00 AM',
          supplierId: 'SUP-01',
          supplierName: 'SA Direct Wholesale',
          items: [
            {
              productId: 'SA-PROD-1',
              productName: 'SA Executive Tea Pack',
              barcode: '991100220011',
              quantity: 20,
              costPrice: 400,
              salePrice: 550,
              subtotal: 8000,
            },
          ],
          subtotal: 8000,
          discount: 0,
          tax: 0,
          grandTotal: 8000,
          paidAmount: 8000,
          dueAmount: 0,
          paymentMethod: 'Cash',
        },
      }),
    });
    assert.equal(saPurRes.status, 200);
    assert.equal(saPurRes.data.store.products[0].stock, 20);

    const saSaleRes = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        action: 'create_sale',
        sourceDeviceId: 'SA-TERM-1',
        payload: {
          invoiceNumber: 'SA-INV-001',
          mode: 'sale',
          dateTime: '2026-11-22 10:05 AM',
          items: [{ product: { ...saProduct, stock: 20 }, quantity: 3, customPrice: 550 }],
          subtotal: 1650,
          discount: 0,
          tax: 0,
          grandTotal: 1650,
          paymentMethod: 'cash',
          cashTendered: 2000,
          changeDue: 350,
        },
      }),
    });
    assert.equal(saSaleRes.status, 200);
    assert.equal(saSaleRes.data.store.products[0].stock, 17);
    assert.equal(saSaleRes.data.store.transactions.length, 1);

    // 4. Verify SHOP-WM-001 & Alpha Mart are completely untouched & SHOP-SA-POS never appears in Mart Accounts Details!
    const saOverview = await jsonReq(baseUrl, '/api/super-admin/overview', { headers: saHeaders });
    assert.equal(saOverview.status, 200);
    const listedShopIds = saOverview.data.shops.map((s: any) => s.id);
    assert.ok(!listedShopIds.includes('SHOP-SA-POS'), 'SHOP-SA-POS must NEVER appear in Mart Accounts Details');
    assert.ok(listedShopIds.includes(martShopId), 'Alpha Mart must appear in Mart Accounts Details');
    assert.ok(listedShopIds.includes('SHOP-WM-001'), 'Primary default Mart must remain intact');

    // Verify Mart Owner Profile endpoint for SHOP-SA-POS stays scoped
    const saOwnerMeta = await jsonReq(baseUrl, '/api/settings/mart-owner', { headers: saHeaders });
    assert.equal(saOwnerMeta.status, 200);
    assert.equal(saOwnerMeta.data.martOwner.martName, 'MY POS APP');

    // Verify primary branch SHOP-WM-001 does NOT contain SA product or SA transactions
    const wm001State = await jsonReq(baseUrl, `/api/store/state?shopId=SHOP-WM-001`, { headers: saHeaders });
    assert.equal(wm001State.status, 200);
    assert.ok(
      !wm001State.data.store.products.some((p: any) => p.id === 'SA-PROD-1'),
      'SHOP-WM-001 must NOT contain Super Admin MY POS APP products'
    );

    // 5. Super Admin Sign Out invalidates session and rejects follow-up requests
    const saLogout = await jsonReq(baseUrl, '/api/auth/logout', { method: 'POST', headers: saHeaders });
    assert.equal(saLogout.status, 200);
    const saAfterLogout = await jsonReq(baseUrl, '/api/store/state', { headers: saHeaders });
    assert.equal(saAfterLogout.status, 401, 'Super Admin token must return 401 after Sign Out');
    const saOverviewAfterLogout = await jsonReq(baseUrl, '/api/super-admin/overview', { headers: saHeaders });
    assert.equal(saOverviewAfterLogout.status, 401);

    // 6. Mart Login for Alpha Mart
    const martLogin = await jsonReq(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'alphamart', password: 'Alpha@User123' }),
    });
    assert.equal(martLogin.status, 200);
    const martHeaders = { Authorization: `Bearer ${martLogin.data.token}` };

    const martInitialState = await jsonReq(baseUrl, '/api/store/state', { headers: martHeaders });
    assert.equal(martInitialState.status, 200);
    assert.equal(martInitialState.data.shopId, martShopId);
    assert.equal(martInitialState.data.store.products.length, 0, 'Alpha Mart starts completely separate from Super Admin MY POS APP');
    assert.equal(martInitialState.data.store.transactions.length, 0);

    // Add Mart product & sale
    const martProd = {
      id: 'MART-PROD-1',
      name: 'Alpha Olive Oil 1L',
      category: 'Oil & Ghee',
      price: 1800,
      costPrice: 1500,
      stock: 10,
      barcode: '770011223344',
      unit: 'Bottle',
      tax: 0,
    };
    await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: martHeaders,
      body: JSON.stringify({ action: 'update_stock', payload: [martProd], sourceDeviceId: 'MART-DEV-1' }),
    });
    await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: martHeaders,
      body: JSON.stringify({
        action: 'create_sale',
        sourceDeviceId: 'MART-DEV-1',
        payload: {
          invoiceNumber: 'ALPHA-INV-01',
          mode: 'sale',
          dateTime: '2026-11-22 10:15 AM',
          items: [{ product: martProd, quantity: 2, customPrice: 1800 }],
          subtotal: 3600,
          discount: 0,
          tax: 0,
          grandTotal: 3600,
          paymentMethod: 'cash',
          cashTendered: 4000,
          changeDue: 400,
        },
      }),
    });

    // Cross-shop access attempt by Mart to SHOP-SA-POS must fail 403
    const martCrossAccess = await jsonReq(baseUrl, '/api/store/state?shopId=SHOP-SA-POS', { headers: martHeaders });
    assert.equal(martCrossAccess.status, 403, 'Mart account must NEVER read Super Admin MY POS APP');

    // 7. Mart Sign Out revokes token & preserves all Mart data
    const martLogout = await jsonReq(baseUrl, '/api/auth/logout', { method: 'POST', headers: martHeaders });
    assert.equal(martLogout.status, 200);
    const martAfterLogout = await jsonReq(baseUrl, '/api/store/state', { headers: martHeaders });
    assert.equal(martAfterLogout.status, 401, 'Mart token must return 401 after Sign Out');

    // 8. Re-login as Super Admin & as Mart to prove 100% data preservation in both DBs
    const saRelogin = await jsonReq(baseUrl, '/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ gmail: SA_GMAIL, password: SA_PASS }),
    });
    const saStatePersisted = await jsonReq(baseUrl, '/api/store/state', {
      headers: { Authorization: `Bearer ${saRelogin.data.token}` },
    });
    assert.equal(saStatePersisted.status, 200);
    assert.equal(saStatePersisted.data.store.products.length, 1);
    assert.equal(saStatePersisted.data.store.products[0].stock, 17);
    assert.equal(saStatePersisted.data.store.purchases.length, 1);
    assert.equal(saStatePersisted.data.store.transactions.length, 1);
    assert.ok(!saStatePersisted.data.store.products.some((p: any) => p.id === 'MART-PROD-1'));

    const martRelogin = await jsonReq(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'alphamart', password: 'Alpha@User123' }),
    });
    const martStatePersisted = await jsonReq(baseUrl, '/api/store/state', {
      headers: { Authorization: `Bearer ${martRelogin.data.token}` },
    });
    assert.equal(martStatePersisted.status, 200);
    assert.equal(martStatePersisted.data.store.products.length, 1);
    assert.equal(martStatePersisted.data.store.products[0].stock, 8);
    assert.equal(martStatePersisted.data.store.transactions.length, 1);
    assert.ok(!martStatePersisted.data.store.products.some((p: any) => p.id === 'SA-PROD-1'));

    console.log('   All Super Admin MY POS APP isolation, Mart Accounts Details, Sign Out & preservation checks PASSED.');
  } finally {
    srvProcess.kill('SIGKILL');
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

async function main() {
  assertUiComponentsAndBundleClean();
  await runBackendIsolationAndLogoutTests();
  console.log('\nALL SUPER ADMIN MY POS APP, MART MODE, ZERO-ZIP & SIGN OUT CHECKS PASSED FOR v' + APP_VERSION + '!');
  process.exit(0);
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
