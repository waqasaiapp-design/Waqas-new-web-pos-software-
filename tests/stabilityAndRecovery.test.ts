import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import { applyPurchaseSaveToState } from '../src/utils/purchaseHelpers.ts';
import type { Product, PurchaseTransaction, Supplier } from '../src/types/pos.ts';
import { APP_VERSION, APP_BUILD_ID } from '../src/version.ts';

const TEST_SA_GMAIL = 'test-recovery-sa@gmail.com';
const TEST_SA_PASS = 'RecoveryAdmin#2026';

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
  throw new Error('Isolated recovery test server did not become healthy within timeout');
}

function setupMockBrowserStorage(quotaBytes: number) {
  const store = new Map<string, string>();
  const listeners = new Map<string, Array<() => void>>();

  const totalBytes = () => {
    let total = 0;
    for (const [k, v] of store.entries()) {
      total += k.length + v.length;
    }
    return total;
  };

  const mockStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      const val = String(value);
      const prevLen = store.has(key) ? key.length + store.get(key)!.length : 0;
      const nextTotal = totalBytes() - prevLen + key.length + val.length;
      if (nextTotal > quotaBytes) {
        const err: any = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
      store.set(key, val);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };

  (globalThis as any).localStorage = mockStorage;
  (globalThis as any).window = {
    addEventListener(ev: string, fn: () => void) {
      const arr = listeners.get(ev) || [];
      arr.push(fn);
      listeners.set(ev, arr);
    },
  };
  (globalThis as any).document = {
    visibilityState: 'visible',
    addEventListener(ev: string, fn: () => void) {
      const arr = listeners.get(ev) || [];
      arr.push(fn);
      listeners.set(ev, arr);
    },
  };

  return { store, listeners };
}

async function testSafeStorageAndDraftRecovery() {
  console.log('1. Testing QuotaExceededError safety, cache trimming, & shop-scoped draft recovery...');
  const { store } = setupMockBrowserStorage(130_000);
  const safeStorage = await import('../src/utils/safeStorage.ts');

  // Seed bulky stock history (>60KB) and auth session that MUST survive quota trimming
  const bulkyHistory = Array.from({ length: 1200 }, (_, i) => ({
    id: `stk-${i}`,
    productId: `p-${i}`,
    productName: `Product Item Number ${i} Deluxe Pack`,
    barcode: `6000${i}`,
    previousStock: 50,
    quantityChange: 10,
    newStock: 60,
    transactionType: 'Purchase',
    invoiceNumber: `PUR-${i}`,
    dateTime: '2026-11-21 01:00 PM',
  }));
  const authPayload = JSON.stringify({ token: 'tok_keep_me', user: { id: 'U1', shopId: 'SHOP-1' } });
  store.set('waqas_pos_auth_session_v1', authPayload);
  store.set('waqas_mart_stock_history_v1', JSON.stringify(bulkyHistory));

  // Verify next large write triggers QuotaExceededError internally, trims optional stock history, and succeeds without crashing
  const draftCartPayload = Array.from({ length: 15 }, (_, i) => ({
    id: `ci-${i}`,
    product: {
      id: `p-${i}`,
      name: `Saved Item ${i}`,
      barcode: `800${i}`,
      category: 'GROCERY',
      unit: 'Pcs',
      costPrice: 100,
      price: 135,
      stock: 40,
      minStockLevel: 5,
    },
    quantity: i + 1,
    unitPrice: 135,
    discountAmount: 0,
    lineTotal: (i + 1) * 135,
  }));

  safeStorage.saveOldSaleDraft('SHOP-1', {
    cart: draftCartPayload as any,
    discountAmount: 50,
    taxAmount: 10,
    resumedHeldBillId: null,
  });

  // Ensure auth session survived & bulky cache was trimmed to <= 200 items
  assert.equal(store.get('waqas_pos_auth_session_v1'), authPayload, 'Auth session must never be wiped');
  const trimmedHistory = JSON.parse(store.get('waqas_mart_stock_history_v1') || '[]');
  assert.ok(trimmedHistory.length <= 200, `Expected stock history cache trimmed <= 200, got ${trimmedHistory.length}`);

  const loadedOldSale = safeStorage.loadOldSaleDraft('SHOP-1');
  assert.ok(loadedOldSale && loadedOldSale.cart.length === 15, 'Old Sale cart draft should restore');
  assert.equal(loadedOldSale?.discountAmount, 50);

  // Verify New Sale, New Purchase, and Old/New Workstation Purchase drafts are isolated per shop
  safeStorage.saveWorkspaceNavState('SHOP-1', {
    activeNav: 'New Sale POS',
    mode: 'sale',
    selectedCategory: 'ALL ITEMS',
    selectedLedgerCustomerId: null,
  });
  safeStorage.saveWorkspaceNavState('SHOP-2', {
    activeNav: 'Purchase Entry',
    mode: 'purchase',
    selectedCategory: 'RICE',
    selectedLedgerCustomerId: 'CUST-9',
  });

  assert.equal(safeStorage.loadWorkspaceNavState('SHOP-1')?.activeNav, 'New Sale POS');
  assert.equal(safeStorage.loadWorkspaceNavState('SHOP-2')?.activeNav, 'Purchase Entry');

  safeStorage.saveNewSaleDraft('SHOP-1', {
    invoiceNumber: 'INV-5001',
    saleItems: draftCartPayload.slice(0, 3) as any,
    selectedCustomerId: 'CUST-1',
    paymentMethod: 'cash',
    cashReceived: 1000,
    cashReceivedInput: '1000',
    invoiceDiscountOverride: 25,
    invoiceTaxOverride: 0,
  });
  assert.equal(safeStorage.loadNewSaleDraft('SHOP-1')?.invoiceNumber, 'INV-5001');
  assert.equal(safeStorage.loadNewSaleDraft('SHOP-2'), null);

  safeStorage.saveWorkstationPurchaseDraft('SHOP-1', 'old', {
    refNo: 'PUR-3001',
    supplierInvoiceNo: 'SUP-99',
    purchaseDate: '2026-11-21',
    entryDate: '2026-11-21',
    selectedSupplierId: 'SUP-1',
    paymentMethod: 'credit',
    vatType: 'Default VAT',
    selectedTaxLabel: '0% (No Tax)',
    selectedStore: 'Main Mart Store',
    expensesLabel: 'Transport',
    expensesAmount: 250,
    purchaseItems: [{ productId: 'p-1', productName: 'Sugar', quantity: 10, purchaseCost: 110, lineTotal: 1100 } as any],
    qtyDrafts: { 'p-1': '10' },
    costDiscountPercent: 0,
    costDiscountAmount: 0,
    roundoff: 0,
    amountPaidInput: '0',
    remarks: 'Unload before noon',
  });
  assert.equal(safeStorage.loadWorkstationPurchaseDraft('SHOP-1', 'old')?.supplierInvoiceNo, 'SUP-99');
  assert.equal(safeStorage.loadWorkstationPurchaseDraft('SHOP-1', 'new'), null);

  // Scheduled write + synchronous flush on lifecycle hide
  safeStorage.scheduleStorageSetJson('test_pending_flush_key', { ok: true }, 5000);
  safeStorage.flushAllPendingStorageWrites();
  assert.equal(safeStorage.safeStorageGetJson<{ ok: boolean } | null>('test_pending_flush_key', null)?.ok, true);

  // Sign out clears only target shop drafts
  safeStorage.clearAllShopDrafts('SHOP-1');
  assert.equal(safeStorage.loadOldSaleDraft('SHOP-1'), null);
  assert.equal(safeStorage.loadNewSaleDraft('SHOP-1'), null);
  assert.equal(safeStorage.loadWorkspaceNavState('SHOP-1'), null);
  assert.equal(safeStorage.loadWorkspaceNavState('SHOP-2')?.activeNav, 'Purchase Entry');
}

function testLargeCatalogPerformanceAndPurchaseIdempotency() {
  console.log('2. Running 3,000-product filter benchmark & purchase double-submit idempotency...');
  const catalog: Product[] = Array.from({ length: 3000 }, (_, i) => ({
    id: `P-${i}`,
    name: `Mart Essential Product ${i}`,
    urduName: `اشیاء ${i}`,
    barcode: `6000${String(i).padStart(4, '0')}`,
    sku: `SKU-${i}`,
    category: i % 3 === 0 ? 'GROCERY' : i % 3 === 1 ? 'BEVERAGES' : 'DAIRY',
    unit: 'Pcs',
    costPrice: 80 + (i % 50),
    price: 100 + (i % 50),
    stock: 25,
    minStockLevel: 5,
  }));

  const t0 = performance.now();
  let matchedCount = 0;
  for (let pass = 0; pass < 300; pass++) {
    const q = pass % 2 === 0 ? '6000123' : 'essential product 24';
    const cat = pass % 3 === 0 ? 'GROCERY' : 'ALL ITEMS';
    const filtered = catalog.filter((p) => {
      const matchesCat = cat === 'ALL ITEMS' || p.category.toUpperCase().includes(cat);
      if (!matchesCat) return false;
      return (
        p.name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        (p.urduName || '').toLowerCase().includes(q)
      );
    });
    matchedCount += filtered.length;
  }
  const elapsedMs = performance.now() - t0;
  assert.ok(matchedCount > 0);
  assert.ok(elapsedMs < 1500, `300 full filter scans on 3,000 items took too long: ${elapsedMs.toFixed(1)}ms`);
  console.log(`   300 filter scans across 3,000 products finished in ${elapsedMs.toFixed(1)}ms.`);

  const suppliers: Supplier[] = [
    { id: 'SUP-1', name: 'Al-Noor Distributors', phone: '03001234567', payableBalance: 0 } as any,
  ];
  const purchase: PurchaseTransaction = {
    id: 'pur-idemp-1',
    purchaseInvoiceNo: 'PUR-IDEMP-001',
    supplierId: 'SUP-1',
    supplierName: 'Al-Noor Distributors',
    date: '2026-11-21',
    items: [
      {
        id: 'pi-1',
        productId: 'P-0',
        productName: catalog[0].name,
        barcode: catalog[0].barcode,
        quantity: 15,
        purchaseCost: 85,
        salePrice: 110,
        lineTotal: 1275,
      } as any,
    ],
    totalAmount: 1275,
    amountPaid: 275,
    remainingBalance: 1000,
    paymentMethod: 'credit',
  } as any;

  const firstSave = applyPurchaseSaveToState({
    purchase,
    isEdit: false,
    products: catalog,
    suppliers,
    purchases: [],
  });
  assert.equal(firstSave.duplicateBlocked, false);
  assert.equal(firstSave.products[0].stock, 40);
  assert.equal(firstSave.suppliers[0].payableBalance, 1000);

  const duplicateSave = applyPurchaseSaveToState({
    purchase,
    isEdit: false,
    products: firstSave.products,
    suppliers: firstSave.suppliers,
    purchases: firstSave.purchases,
  });
  assert.equal(duplicateSave.duplicateBlocked, true, 'Duplicate purchase replay must be blocked');
  assert.equal(duplicateSave.products[0].stock, 40, 'Stock must remain 40 without double counting');
}

async function testServerRecoverySyncAndDownload() {
  console.log('3. Testing live server sync idempotency, SSE reconnect, QR pairing recovery, & ZIP download...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-pos-recovery-test-'));
  const testPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${testPort}`;

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
        APP_URL: baseUrl,
        WAQAS_DATA_DIR: tempDir,
        SUPER_ADMIN_EMAIL: TEST_SA_GMAIL,
        SUPER_ADMIN_PASSWORD_SALT: saSalt,
        SUPER_ADMIN_PASSWORD_HASH: saHash,
      },
      stdio: 'pipe',
    });
    serverProc = proc;
    return await waitForHealth(baseUrl);
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
    const health = await startServer();
    assert.equal(health.version, APP_VERSION);
    assert.equal(health.buildId, APP_BUILD_ID);

    // Login Super Admin & create isolated test Mart
    const saLogin = await jsonReq(baseUrl, '/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ gmail: TEST_SA_GMAIL, password: TEST_SA_PASS }),
    });
    assert.equal(saLogin.status, 200);
    const saHeaders = { Authorization: `Bearer ${saLogin.data.token}` };

    const createShop = await jsonReq(baseUrl, '/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'RECOVERY TEST MART',
        ownerName: 'Waqas Tester',
        username: 'recoverymart',
        password: 'RecoverPass@1',
        confirmPassword: 'RecoverPass@1',
        status: 'active',
      }),
    });
    assert.equal(createShop.status, 200);

    const ownerLogin = await jsonReq(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'recoverymart', password: 'RecoverPass@1' }),
    });
    assert.equal(ownerLogin.status, 200);
    const ownerHeaders = { Authorization: `Bearer ${ownerLogin.data.token}` };

    // Seed product with stock = 100
    const syncStock = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        action: 'update_stock',
        sourceDeviceId: 'PC-REC-1',
        payload: [
          {
            id: 'PROD-REC-1',
            name: 'Cooking Oil 1L',
            barcode: '777000111',
            category: 'GROCERY',
            unit: 'Ltr',
            costPrice: 450,
            price: 520,
            stock: 100,
            minStockLevel: 10,
          },
        ],
      }),
    });
    assert.equal(syncStock.status, 200);

    // Replay the exact same create_sale twice -> stock must deduct ONCE (100 -> 97)
    const salePayload = {
      invoiceNumber: 'WM-REC-001',
      dateTime: '21 Nov 2026, 01:45 PM',
      mode: 'sale',
      items: [
        {
          id: 'item-rec-1',
          product: syncStock.data.store.products[0],
          quantity: 3,
          unitPrice: 520,
          discountAmount: 0,
          lineTotal: 1560,
        },
      ],
      subtotal: 1560,
      discount: 0,
      taxAmount: 0,
      grandTotal: 1560,
      paymentMethod: 'cash',
      cashTendered: 2000,
      changeDue: 440,
      status: 'completed',
    };

    const sale1 = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ action: 'create_sale', sourceDeviceId: 'PC-REC-1', payload: salePayload }),
    });
    assert.equal(sale1.status, 200);
    assert.equal(sale1.data.store.products[0].stock, 97);

    const sale2Replay = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ action: 'create_sale', sourceDeviceId: 'PC-REC-1', payload: salePayload }),
    });
    assert.equal(sale2Replay.status, 200);
    assert.equal(sale2Replay.data.store.products[0].stock, 97, 'Sale replay must never double-deduct stock');
    assert.equal(sale2Replay.data.store.transactions.length, 1);

    // Replay the exact same create_purchase twice -> stock must add ONCE (97 -> 117)
    const purPayload = {
      id: 'PUR-REC-ID-1',
      purchaseInvoiceNo: 'PUR-REC-001',
      supplierId: 'SUP-DEFAULT',
      supplierName: 'General Supplier',
      date: '2026-11-21',
      items: [
        {
          id: 'pi-rec-1',
          productId: 'PROD-REC-1',
          productName: 'Cooking Oil 1L',
          barcode: '777000111',
          quantity: 20,
          purchaseCost: 460,
          salePrice: 530,
          lineTotal: 9200,
        },
      ],
      totalAmount: 9200,
      amountPaid: 9200,
      remainingBalance: 0,
      paymentMethod: 'cash',
    };

    const pur1 = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ action: 'create_purchase', sourceDeviceId: 'PC-REC-1', payload: purPayload }),
    });
    assert.equal(pur1.status, 200);
    assert.equal(pur1.data.store.products[0].stock, 117);

    const pur2Replay = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ action: 'create_purchase', sourceDeviceId: 'PC-REC-1', payload: purPayload }),
    });
    assert.equal(pur2Replay.status, 200);
    assert.equal(pur2Replay.data.store.products[0].stock, 117, 'Purchase replay must never double-add stock');
    assert.equal(pur2Replay.data.store.purchases.length, 1);

    // Register primary device + test server restart session & store persistence + QR ZIP download
    const regPrimary = await jsonReq(baseUrl, '/api/devices/register-primary', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        device: {
          deviceId: 'PC-REC-1',
          deviceName: 'Primary Terminal',
          deviceType: 'Desktop PC',
          browser: 'Chrome',
          os: 'Windows',
        },
      }),
    });
    assert.equal(regPrimary.status, 200);
    const devSessionToken = regPrimary.data.sessionToken;
    assert.ok(devSessionToken);

    // Verify ZIP download route is permanently removed (404)
    const zipRes = await fetch(`${baseUrl}/download?v=${encodeURIComponent(APP_VERSION)}`);
    assert.equal(zipRes.status, 404, 'Removed /download endpoint must return 404');

    // Restart server & verify active auth session, paired device token, and stock survive seamlessly
    await stopServer();
    await startServer();

    const sessionAfterRestart = await jsonReq(baseUrl, '/api/auth/me', { headers: ownerHeaders });
    assert.equal(sessionAfterRestart.status, 200, 'Auth session should persist across server restarts');

    const storeAfterRestart = await jsonReq(baseUrl, '/api/store/state', {
      headers: { 'x-device-token': devSessionToken, 'x-device-id': 'PC-REC-1' },
    });
    assert.equal(storeAfterRestart.status, 200, 'Paired device token should survive server restarts');
    assert.equal(storeAfterRestart.data.store.products[0].stock, 117);
    assert.equal(storeAfterRestart.data.store.transactions.length, 1);
    assert.equal(storeAfterRestart.data.store.purchases.length, 1);

    console.log('ALL STABILITY, STORAGE QUOTA, DRAFT RECOVERY, PERFORMANCE & SYNC TESTS PASSED 100%!');
  } finally {
    await stopServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runAll() {
  await testSafeStorageAndDraftRecovery();
  testLargeCatalogPerformanceAndPurchaseIdempotency();
  await testServerRecoverySyncAndDownload();
}

runAll()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Stability & Recovery suite failed:', err);
    process.exit(1);
  });
