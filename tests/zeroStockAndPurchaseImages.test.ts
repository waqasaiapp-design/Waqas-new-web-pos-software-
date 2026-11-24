import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductGraphic } from '../src/components/ProductGraphic.tsx';
import { PurchaseWorkstation } from '../src/components/PurchaseWorkstation.tsx';
import {
  STOCK_ALREADY_ZERO_MESSAGE,
  buildInsufficientStockMessage,
  findLiveProduct,
  reconcileNegativeStockFromHistory,
  resolveProductImageUrl,
  validatePurchaseReturnStock,
  validateSaleItemsStock,
  validateSingleProductStockChange,
} from '../src/utils/stockValidation.ts';
import {
  applyPurchaseDeleteAllToState,
  applyPurchaseDeleteToState,
  applyPurchaseSaveToState,
} from '../src/utils/purchaseHelpers.ts';
import type {
  DeviceInfo,
  Product,
  PurchaseReturn,
  PurchaseTransaction,
  StoreBranding,
  Supplier,
  UserProfile,
} from '../src/types/pos.ts';
import { APP_VERSION } from '../src/version.ts';

const TEST_SA_GMAIL = 'test-zerostock-sa@gmail.com';
const TEST_SA_PASS = 'ZeroStockAdmin#2026';

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
  throw new Error('Isolated zero-stock test server did not become healthy within timeout');
}

function testCarPictureRemovedAndStrictProductImages() {
  console.log('1. Verifying default car illustration is completely removed & images stay strictly isolated...');
  const prodA: Product = {
    id: 'PROD-A',
    name: 'Cake Dawan',
    barcode: '8961001234',
    category: 'BAKERY',
    unit: 'Pcs',
    costPrice: 230,
    price: 300,
    stock: 0,
    lowStockAlert: 5,
    imageUrl: 'data:image/png;base64,AAA_ITEM_A_IMG',
  };
  const prodB: Product = {
    id: 'PROD-B',
    name: 'Cooking Oil 1L',
    barcode: '8961005678',
    category: 'GROCERY',
    unit: 'Pcs',
    costPrice: 450,
    price: 520,
    stock: 10,
    lowStockAlert: 2,
    imageUrl: 'data:image/png;base64,BBB_ITEM_B_IMG',
  };
  const prodC: Product = {
    id: 'PROD-C',
    name: 'Plain Sugar 1Kg',
    barcode: '8961009999',
    category: 'GROCERY',
    unit: 'Kg',
    costPrice: 120,
    price: 150,
    stock: 0,
    lowStockAlert: 5,
    imageUrl: '',
  };

  const products = [prodA, prodB, prodC];

  // ProductGraphic without image renders clean neutral placeholder, never a red car SVG
  const graphicNoImgHtml = renderToStaticMarkup(
    React.createElement(ProductGraphic, { product: prodC })
  );
  assert.ok(!graphicNoImgHtml.includes('#dc2626'), 'Must not contain red car SVG fill');
  assert.ok(!graphicNoImgHtml.includes('M8 34 L15 20'), 'Must not contain red car body SVG path');

  // ProductGraphic with image renders exact own image
  const graphicA = renderToStaticMarkup(React.createElement(ProductGraphic, { product: prodA }));
  assert.ok(graphicA.includes('AAA_ITEM_A_IMG'));
  assert.ok(!graphicA.includes('BBB_ITEM_B_IMG'));

  // Resolve image URL lookup strictly follows ID/barcode
  assert.equal(resolveProductImageUrl(products, { productId: 'PROD-A' }), 'data:image/png;base64,AAA_ITEM_A_IMG');
  assert.equal(resolveProductImageUrl(products, { barcode: '8961005678' }), 'data:image/png;base64,BBB_ITEM_B_IMG');
  assert.equal(resolveProductImageUrl(products, { productId: 'PROD-C' }), '');
  assert.equal(resolveProductImageUrl(products, { productId: 'NON-EXISTENT', barcode: 'NOPE' }), '');

  // PurchaseWorkstation Old Purchase variant SSR check: zero car SVG & zero-stock product selectable in catalog
  const mockBranding: StoreBranding = {
    storeName: 'WAQAS MART TEST',
    primaryName: 'WAQAS',
    accentName: 'MART',
    subtitle: 'Test Mart',
  };
  const mockUser: UserProfile = {
    id: 'U-1',
    displayName: 'Waqas Owner',
    role: 'Master Admin',
    createdAt: new Date().toISOString(),
  };
  const mockDevice: DeviceInfo = {
    deviceId: 'DEV-1',
    deviceName: 'Test PC',
    deviceType: 'Windows PC',
    browser: 'Chrome',
    os: 'Windows',
    firstRegistered: 'Today',
    status: 'active',
    lastActive: 'Now',
  };
  const suppliers: Supplier[] = [
    { id: 'SUP-1', name: 'General Supplier', phone: '03001112223', payableBalance: 0 } as any,
  ];

  const oldPurchaseHtml = renderToStaticMarkup(
    React.createElement(PurchaseWorkstation, {
      variant: 'old',
      products,
      suppliers,
      purchases: [],
      branding: mockBranding,
      currentUser: mockUser,
      currentDevice: mockDevice,
      onSavePurchase: () => ({ ok: true }),
      onAddSupplier: () => {},
      onOpenAddProduct: () => {},
      onOpenScanner: () => {},
      onNavigate: () => {},
    })
  );

  assert.ok(!oldPurchaseHtml.includes('fill="#dc2626"'), 'Old Purchase must never contain car SVG fill="#dc2626"');
  assert.ok(!oldPurchaseHtml.includes('M8 34 L15 20'), 'Old Purchase must never render red car SVG path');
  assert.ok(!oldPurchaseHtml.toLowerCase().includes('viewbox="0 0 64 44"'), 'No hardcoded car illustration allowed');
}

function testZeroStockBoundaryRulesAndPurchases() {
  console.log('2. Testing Zero-Stock protection boundaries (0 allowed, < 0 never allowed) & Purchase Edit/Delete...');

  // 10 - 10 = 0 (Allowed)
  const rExactZero = validateSingleProductStockChange({
    productId: 'P1',
    productName: 'Item 1',
    availableStock: 10,
    delta: -10,
  });
  assert.equal(rExactZero.ok, true);
  assert.equal(rExactZero.projectedStock, 0);

  // 1 - 1 = 0 (Allowed)
  const rOneToZero = validateSingleProductStockChange({
    productId: 'P1',
    productName: 'Item 1',
    availableStock: 1,
    delta: -1,
  });
  assert.equal(rOneToZero.ok, true);
  assert.equal(rOneToZero.projectedStock, 0);

  // 0 - 0 = 0 (Allowed)
  const rZeroDelta = validateSingleProductStockChange({
    productId: 'P1',
    productName: 'Item 1',
    availableStock: 0,
    delta: 0,
  });
  assert.equal(rZeroDelta.ok, true);
  assert.equal(rZeroDelta.projectedStock, 0);

  // 0 + 10 = 10 (Restock from zero Allowed)
  const rRestock = validateSingleProductStockChange({
    productId: 'P1',
    productName: 'Item 1',
    availableStock: 0,
    delta: 10,
  });
  assert.equal(rRestock.ok, true);
  assert.equal(rRestock.projectedStock, 10);

  // 0 - 1 = -1 (Blocked with verbatim message)
  const rAlreadyZero = validateSingleProductStockChange({
    productId: 'P1',
    productName: 'Item 1',
    availableStock: 0,
    delta: -1,
  });
  assert.equal(rAlreadyZero.ok, false);
  if (!rAlreadyZero.ok) {
    assert.equal(rAlreadyZero.code, 'STOCK_ALREADY_ZERO');
    assert.equal(rAlreadyZero.message, STOCK_ALREADY_ZERO_MESSAGE);
  }

  // 10 - 11 = -1 (Blocked with verbatim message showing Available Stock: 10)
  const rInsufficient = validateSingleProductStockChange({
    productId: 'P1',
    productName: 'Item 1',
    availableStock: 10,
    delta: -11,
  });
  assert.equal(rInsufficient.ok, false);
  if (!rInsufficient.ok) {
    assert.equal(rInsufficient.code, 'INSUFFICIENT_STOCK');
    assert.equal(rInsufficient.message, buildInsufficientStockMessage(10));
    assert.equal(
      rInsufficient.message,
      'INSUFFICIENT STOCK! Available Stock: 10. Zero se kam stock allowed nahi hai.'
    );
  }

  // Duplicate cart rows aggregating beyond available stock (6 + 6 = 12 > 10) must be blocked
  const cakeProd: Product = {
    id: 'CAKE-1',
    name: 'Cake Dawan',
    barcode: '8961001234',
    category: 'BAKERY',
    unit: 'Pcs',
    costPrice: 230,
    price: 300,
    stock: 10,
    lowStockAlert: 2,
  };
  const multiRowSaleCheck = validateSaleItemsStock(
    [cakeProd],
    [
      { product: cakeProd, quantity: 6 },
      { product: cakeProd, quantity: 6 },
    ]
  );
  assert.equal(multiRowSaleCheck.ok, false);
  if (!multiRowSaleCheck.ok) {
    assert.equal(multiRowSaleCheck.message, buildInsufficientStockMessage(10));
  }

  // Restock zero-stock item via purchase save (0 + 10 = 10), then simulate selling 6 (leaving 4),
  // then test editing purchase (+10 -> +4 leaves stock at -2 => MUST BE BLOCKED!)
  const zeroCake: Product = { ...cakeProd, stock: 0 };
  const suppliers: Supplier[] = [
    { id: 'SUP-1', name: 'Dawn Foods', phone: '0300123', payableBalance: 0 } as any,
  ];
  const initialPur: PurchaseTransaction = {
    id: 'PUR-100',
    purchaseInvoiceNo: 'PUR-3001',
    supplierId: 'SUP-1',
    supplierName: 'Dawn Foods',
    supplierInvoiceNo: 'SUP-INV-1',
    purchaseDate: '2026-11-22',
    items: [
      {
        id: 'PI-1',
        productId: 'CAKE-1',
        productName: 'Cake Dawan',
        barcode: '8961001234',
        currentStock: 0,
        quantity: 10,
        purchaseCost: 230,
        salePrice: 300,
        discount: 0,
        tax: 0,
        lineTotal: 2300,
      },
    ],
    subtotal: 2300,
    totalDiscount: 0,
    totalTax: 0,
    grandTotal: 2300,
    amountPaid: 2300,
    remainingBalance: 0,
    paymentMethod: 'cash',
    status: 'saved',
    createdAt: new Date().toISOString(),
  };

  const afterAdd = applyPurchaseSaveToState({
    purchase: initialPur,
    isEdit: false,
    products: [zeroCake],
    suppliers,
    purchases: [],
  });
  assert.equal(afterAdd.stockError, undefined);
  assert.equal(afterAdd.products[0].stock, 10);

  // Now simulate 6 sold so current stock = 4
  const afterSaleProducts = [{ ...afterAdd.products[0], stock: 4 }];

  // Edit purchase from +10 to +4 -> delta = -6 -> 4 - 6 = -2 => BLOCKED!
  const blockedEditPur: PurchaseTransaction = {
    ...initialPur,
    items: [{ ...initialPur.items[0], quantity: 4 }],
    subtotal: 920,
    grandTotal: 920,
    amountPaid: 920,
  };
  const editBlocked = applyPurchaseSaveToState({
    purchase: blockedEditPur,
    isEdit: true,
    products: afterSaleProducts,
    suppliers: afterAdd.suppliers,
    purchases: afterAdd.purchases,
  });
  assert.ok(editBlocked.stockError, 'Purchase edit that reduces stock below zero must be blocked');
  assert.equal(editBlocked.products[0].stock, 4, 'Original stock must remain untouched on blocked edit');

  // Edit purchase from +10 to +6 -> delta = -4 -> 4 - 4 = 0 => ALLOWED (0 is valid)!
  const zeroEditPur: PurchaseTransaction = {
    ...initialPur,
    items: [{ ...initialPur.items[0], quantity: 6 }],
    subtotal: 1380,
    grandTotal: 1380,
    amountPaid: 1380,
  };
  const editAllowedToZero = applyPurchaseSaveToState({
    purchase: zeroEditPur,
    isEdit: true,
    products: afterSaleProducts,
    suppliers: afterAdd.suppliers,
    purchases: afterAdd.purchases,
  });
  assert.equal(editAllowedToZero.stockError, undefined);
  assert.equal(editAllowedToZero.products[0].stock, 0, 'Editing down to exact 0 remaining stock must succeed');

  // Deleting a purchase when stock is 0 and purchase added +6 must be BLOCKED (0 - 6 = -6)
  const delBlocked = applyPurchaseDeleteToState({
    purchaseId: 'PUR-100',
    products: editAllowedToZero.products,
    suppliers: editAllowedToZero.suppliers,
    purchases: editAllowedToZero.purchases,
  });
  assert.ok(delBlocked.stockError, 'Deleting purchase when stock already sold must be blocked');
  assert.equal(delBlocked.stockError?.code, 'STOCK_ALREADY_ZERO');

  const delAllBlocked = applyPurchaseDeleteAllToState({
    products: editAllowedToZero.products,
    suppliers: editAllowedToZero.suppliers,
    purchases: editAllowedToZero.purchases,
  });
  assert.equal(delAllBlocked.ok, false);
  assert.ok(delAllBlocked.stockError);

  // Purchase Return check on 0 stock -> Blocked
  const purRetCheck = validatePurchaseReturnStock(editAllowedToZero.products, [
    { productId: 'CAKE-1', productName: 'Cake Dawan', quantity: 1 },
  ]);
  assert.equal(purRetCheck.ok, false);
  if (!purRetCheck.ok) {
    assert.equal(purRetCheck.message, STOCK_ALREADY_ZERO_MESSAGE);
  }
}

async function testLiveServerProtectionConcurrencyImagesAndReconcile() {
  console.log('3. Testing live server zero-stock enforcement, concurrency race, image persistence & reconciliation...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-pos-zerostock-test-'));
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
        shopName: 'ZERO STOCK MART',
        ownerName: 'Waqas Owner',
        username: 'zerostockmart',
        password: 'ZeroPass@1',
        confirmPassword: 'ZeroPass@1',
        status: 'active',
      }),
    });
    assert.equal(createShop.status, 200);

    const ownerLogin = await jsonReq(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'zerostockmart', password: 'ZeroPass@1' }),
    });
    assert.equal(ownerLogin.status, 200);
    const ownerHeaders = { Authorization: `Bearer ${ownerLogin.data.token}` };

    const catalogSeed: Product[] = [
      {
        id: 'PROD-CAKE',
        name: 'CAKE DAWAN',
        barcode: '8961001234',
        category: 'BAKERY',
        unit: 'Pcs',
        costPrice: 230,
        price: 300,
        stock: 0,
        lowStockAlert: 2,
        imageUrl: '',
      },
      {
        id: 'PROD-IMG-A',
        name: 'Item A Milk',
        barcode: '111000111',
        category: 'DAIRY',
        unit: 'Pcs',
        costPrice: 180,
        price: 220,
        stock: 10,
        lowStockAlert: 2,
        imageUrl: 'data:image/png;base64,ITEM_A_REAL_PIC',
      },
      {
        id: 'PROD-IMG-B',
        name: 'Item B Tea',
        barcode: '222000222',
        category: 'GROCERY',
        unit: 'Pcs',
        costPrice: 500,
        price: 600,
        stock: 1,
        lowStockAlert: 1,
        imageUrl: 'data:image/png;base64,ITEM_B_REAL_PIC',
      },
    ];

    const seedRes = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        action: 'update_stock',
        sourceDeviceId: 'PC-1',
        payload: catalogSeed,
      }),
    });
    assert.equal(seedRes.status, 200);

    // Confirm product images persist cleanly on server per product ID
    const exportRes = await jsonReq(baseUrl, '/api/shop/backup/export', { headers: ownerHeaders });
    assert.equal(exportRes.status, 200);
    const srvProds: Product[] = exportRes.data.backup.storeDb.products;
    assert.equal(findLiveProduct(srvProds, { productId: 'PROD-IMG-A' })?.imageUrl, 'data:image/png;base64,ITEM_A_REAL_PIC');
    assert.equal(findLiveProduct(srvProds, { productId: 'PROD-IMG-B' })?.imageUrl, 'data:image/png;base64,ITEM_B_REAL_PIC');
    assert.equal(findLiveProduct(srvProds, { productId: 'PROD-CAKE' })?.imageUrl || '', '');

    // Reject negative stock inside update_stock
    const badUpdateRes = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        action: 'update_stock',
        sourceDeviceId: 'PC-1',
        payload: srvProds.map((p) => (p.id === 'PROD-CAKE' ? { ...p, stock: -2 } : p)),
      }),
    });
    assert.equal(badUpdateRes.status, 400);
    assert.equal(badUpdateRes.data.message, STOCK_ALREADY_ZERO_MESSAGE);

    // Attempt selling Item A quantity 11 on stock 10 -> Blocked with exact verbatim message
    const failExceedSale = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        action: 'create_sale',
        sourceDeviceId: 'PC-1',
        payload: {
          invoiceNumber: 'INV-EXCEED-1',
          dateTime: '22 Nov 2026',
          mode: 'sale',
          items: [{ id: 'ci-1', product: catalogSeed[1], quantity: 11, unitPrice: 220, discountAmount: 0, lineTotal: 2420 }],
          subtotal: 2420,
          discount: 0,
          taxAmount: 0,
          grandTotal: 2420,
          paymentMethod: 'cash',
          status: 'completed',
        },
      }),
    });
    assert.equal(failExceedSale.status, 400);
    assert.equal(failExceedSale.data.error, 'INSUFFICIENT_STOCK');
    assert.equal(failExceedSale.data.message, buildInsufficientStockMessage(10));

    // Sell Item A exact 10 -> 0 Allowed!
    const exactZeroSale = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        action: 'create_sale',
        sourceDeviceId: 'PC-1',
        payload: {
          invoiceNumber: 'INV-EXACT-ZERO',
          dateTime: '22 Nov 2026',
          mode: 'sale',
          items: [{ id: 'ci-2', product: catalogSeed[1], quantity: 10, unitPrice: 220, discountAmount: 0, lineTotal: 2200 }],
          subtotal: 2200,
          discount: 0,
          taxAmount: 0,
          grandTotal: 2200,
          paymentMethod: 'cash',
          status: 'completed',
        },
      }),
    });
    assert.equal(exactZeroSale.status, 200);
    const prodAAfter = exactZeroSale.data.store.products.find((p: Product) => p.id === 'PROD-IMG-A');
    assert.equal(prodAAfter.stock, 0);

    // Attempt selling Item A when stock is 0 -> Blocked with STOCK_ALREADY_ZERO!
    const zeroBlockedSale = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        action: 'create_sale',
        sourceDeviceId: 'PC-1',
        payload: {
          invoiceNumber: 'INV-ZERO-FAIL',
          dateTime: '22 Nov 2026',
          mode: 'sale',
          items: [{ id: 'ci-3', product: prodAAfter, quantity: 1, unitPrice: 220, discountAmount: 0, lineTotal: 220 }],
          subtotal: 220,
          discount: 0,
          taxAmount: 0,
          grandTotal: 220,
          paymentMethod: 'cash',
          status: 'completed',
        },
      }),
    });
    assert.equal(zeroBlockedSale.status, 400);
    assert.equal(zeroBlockedSale.data.error, 'STOCK_ALREADY_ZERO');
    assert.equal(zeroBlockedSale.data.message, STOCK_ALREADY_ZERO_MESSAGE);

    // Restock CAKE DAWAN (0 + 10 = 10) via create_purchase
    const restockRes = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        action: 'create_purchase',
        sourceDeviceId: 'PC-1',
        payload: {
          id: 'PUR-RESTOCK-1',
          purchaseInvoiceNo: 'PUR-3011',
          supplierId: 'SUP-1',
          supplierName: 'Default Supplier',
          date: '2026-11-22',
          items: [
            {
              id: 'pi-cake',
              productId: 'PROD-CAKE',
              productName: 'CAKE DAWAN',
              barcode: '8961001234',
              quantity: 10,
              purchaseCost: 230,
              salePrice: 300,
              lineTotal: 2300,
            },
          ],
          totalAmount: 2300,
          amountPaid: 2300,
          remainingBalance: 0,
          paymentMethod: 'cash',
        },
      }),
    });
    assert.equal(restockRes.status, 200);
    assert.equal(restockRes.data.store.products.find((p: Product) => p.id === 'PROD-CAKE').stock, 10);

    // Purchase Return exceeding stock (11 > 10) -> HTTP 400
    const badPurReturn = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        action: 'create_purchase_return',
        sourceDeviceId: 'PC-1',
        payload: {
          id: 'PRET-BAD-1',
          returnNumber: 'PRET-100',
          originalPurchaseId: 'PUR-RESTOCK-1',
          originalInvoiceNumber: 'PUR-3011',
          supplierId: 'SUP-1',
          supplierName: 'Default Supplier',
          date: '2026-11-22',
          items: [
            {
              productId: 'PROD-CAKE',
              productName: 'CAKE DAWAN',
              barcode: '8961001234',
              quantity: 11,
              purchasePrice: 230,
              lineTotal: 2530,
            },
          ],
          totalRefund: 2530,
          refundType: 'cash_refund',
          createdAt: new Date().toISOString(),
        } as PurchaseReturn,
      }),
    });
    assert.equal(badPurReturn.status, 400);
    assert.equal(badPurReturn.data.message, buildInsufficientStockMessage(10));

    // Concurrent multi-device sale race on Item B (stock = 1): only ONE can succeed (leaving 0), second MUST be blocked!
    const saleB = (inv: string, dev: string) =>
      jsonReq(baseUrl, '/api/store/sync', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          action: 'create_sale',
          sourceDeviceId: dev,
          payload: {
            invoiceNumber: inv,
            dateTime: '22 Nov 2026',
            mode: 'sale',
            items: [{ id: `ci-${inv}`, product: catalogSeed[2], quantity: 1, unitPrice: 600, discountAmount: 0, lineTotal: 600 }],
            subtotal: 600,
            discount: 0,
            taxAmount: 0,
            grandTotal: 600,
            paymentMethod: 'cash',
            status: 'completed',
          },
        }),
      });
    const [race1, race2] = await Promise.all([saleB('INV-RACE-1', 'PC-1'), saleB('INV-RACE-2', 'MOB-2')]);
    const statuses = [race1.status, race2.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 400], 'Concurrent race on last 1 unit must allow 1 and reject 1');
    const failedRace = race1.status === 400 ? race1 : race2;
    assert.equal(failedRace.data.error, 'STOCK_ALREADY_ZERO');

    // Legacy negative stock reconciliation: import a legacy snapshot with stock = -3 & verify reconcile_negative_stock
    const currentBackup = await jsonReq(baseUrl, '/api/shop/backup/export', { headers: ownerHeaders });
    const legacyStore = currentBackup.data.backup.storeDb;
    const txCountBefore = legacyStore.transactions.length;
    const legacyProducts = legacyStore.products.map((p: Product) =>
      p.id === 'PROD-IMG-A' ? { ...p, stock: -3 } : p
    );

    const importRes = await jsonReq(baseUrl, '/api/shop/backup/import', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ storeDb: { ...legacyStore, products: legacyProducts } }),
    });
    assert.equal(importRes.status, 200);
    assert.equal(importRes.data.store.products.find((p: Product) => p.id === 'PROD-IMG-A').stock, -3);

    const reconcileRes = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ action: 'reconcile_negative_stock', sourceDeviceId: 'PC-1' }),
    });
    assert.equal(reconcileRes.status, 200);
    assert.equal(reconcileRes.data.reconciledCount, 1);
    const reconciledProdA = reconcileRes.data.store.products.find((p: Product) => p.id === 'PROD-IMG-A');
    assert.equal(reconciledProdA.stock, 0, 'Negative stock item must be cleanly reconciled to 0');
    assert.equal(reconcileRes.data.store.transactions.length, txCountBefore, 'Invoices must not be deleted during reconciliation');
    const recAudit = reconcileRes.data.store.stockHistory.find(
      (h: any) => h.productId === 'PROD-IMG-A' && String(h.invoiceNumber || '') === 'RECONCILE-ZERO'
    );
    assert.ok(recAudit, 'Reconciliation must write an explicit audit record to stockHistory');
    assert.equal(recAudit.previousStock, -3);
    assert.equal(recAudit.quantityChange, 3);
    assert.equal(recAudit.newStock, 0);
  } finally {
    await stopServer();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

async function run() {
  testCarPictureRemovedAndStrictProductImages();
  testZeroStockBoundaryRulesAndPurchases();
  await testLiveServerProtectionConcurrencyImagesAndReconcile();
  console.log('\nALL ZERO-STOCK PROTECTION & PRODUCT IMAGE TESTS PASSED SUCCESSFULLY!');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('TEST FAILED:', err);
    process.exit(1);
  });
