import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AllStaffPage } from '../src/components/AllStaffPage.tsx';
import { printStaffProfileReport } from '../src/utils/printerService.ts';
import { DEFAULT_STAFF_PERMISSIONS, StaffMember } from '../src/types/pos.ts';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      srv.close((err) => (err ? reject(err) : resolve(addr.port)));
    });
  });
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
  throw new Error(`Server at ${baseUrl} did not become healthy`);
}

const sampleStaff: StaffMember[] = [
  {
    id: 'stf-1',
    employeeId: 'WM-EMP-001',
    name: 'Asad Ali',
    phone: '0300-1112233',
    address: 'Block B, Model Town',
    role: 'Cashier',
    department: 'Sales',
    joiningDate: '01/10/2026',
    salary: 28000,
    username: 'asadc',
    accountStatus: 'active',
    shift: 'Morning',
    permissions: { ...DEFAULT_STAFF_PERMISSIONS },
    salaryPayments: [
      {
        id: 'sal-1',
        date: '01/11/2026',
        month: 'October 2026',
        amount: 28000,
        paymentMethod: 'Cash',
      },
    ],
    attendance: [
      {
        id: 'att-1',
        date: '23/11/2026',
        status: 'present',
        checkIn: '09:00 AM',
      },
    ],
    createdAt: '2026-10-01T08:00:00.000Z',
  },
  {
    id: 'stf-2',
    employeeId: 'WM-EMP-002',
    name: 'Kamran Khan',
    phone: '0321-9998877',
    address: 'Gulberg III',
    role: 'Manager',
    department: 'General Operations',
    joiningDate: '15/09/2026',
    salary: 45000,
    username: 'kamranm',
    accountStatus: 'suspended',
    shift: 'Full Day',
    permissions: { ...DEFAULT_STAFF_PERMISSIONS, reports: true, canAccessReports: true },
    salaryPayments: [],
    attendance: [],
    createdAt: '2026-09-15T08:00:00.000Z',
  },
];

async function runTests() {
  console.log('1. Testing redesigned AllStaffPage SSR layout (overview compactness + empty state)...');
  const populatedHtml = renderToStaticMarkup(
    React.createElement(AllStaffPage, {
      staffList: sampleStaff,
      onSaveStaff: () => {},
      onDeleteStaff: () => {},
      onDeleteAllStaff: () => {},
      onBackToHome: () => {},
    })
  );

  // Overview must contain 4 clickable metric cards + Total Staff action, and must NOT dump full employee table on overview
  assert.ok(populatedHtml.includes('Total Staff'), 'Overview must render Total Staff card');
  assert.ok(populatedHtml.includes('Open Staff List'), 'Total Staff card must invite click to open list');
  assert.ok(populatedHtml.includes('Active Staff'), 'Overview must render Active Staff card');
  assert.ok(populatedHtml.includes('Cashiers &amp; Sales'), 'Overview must render Cashiers & Sales card');
  assert.ok(populatedHtml.includes('Monthly Payroll'), 'Overview must render Monthly Payroll card');
  assert.ok(populatedHtml.includes('Team by Role'), 'Overview must show compact role breakdown');
  assert.equal(
    populatedHtml.includes('<table'),
    false,
    'Main Staff Overview must NOT render a bloated full employee table directly on overview'
  );
  assert.equal(
    populatedHtml.includes('Asad Ali'),
    false,
    'Individual staff rows stay in separate Total Staff directory view, not dumped on overview'
  );

  const emptyHtml = renderToStaticMarkup(
    React.createElement(AllStaffPage, {
      staffList: [],
      onSaveStaff: () => {},
      onDeleteStaff: () => {},
    })
  );
  assert.ok(emptyHtml.includes('No employees added yet'), 'Empty state must render cleanly');
  assert.ok(emptyHtml.includes('Add First Staff Member'), 'Empty state CTA must render cleanly');

  console.log('2. Testing printStaffProfileReport safe fallback outside browser...');
  const printRes = await printStaffProfileReport(sampleStaff[0], {
    storeName: 'WAQAS MART TEST',
    primaryName: 'WAQAS',
    accentName: 'MART',
    subtitle: 'POS',
  });
  assert.equal(printRes.ok, false);
  assert.equal(printRes.method, 'system');

  console.log('3. Testing backend staff sync, profile updates, attendance/salary persistence & staff login...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-staff-test-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const saEmail = 'waqas-test@pos.pk';
  const saPass = 'WaqasPos@2026';
  const saSalt = crypto.randomBytes(16).toString('hex');
  const saHash =
    'scrypt:' + crypto.scryptSync(saPass, saSalt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');

  const child: ChildProcess = spawn('node', ['server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      APP_URL: baseUrl,
      WAQAS_DATA_DIR: tempDir,
      SUPER_ADMIN_EMAIL: saEmail,
      SUPER_ADMIN_PASSWORD_SALT: saSalt,
      SUPER_ADMIN_PASSWORD_HASH: saHash,
    },
    stdio: 'pipe',
  });

  try {
    await waitForHealth(baseUrl);

    const saRes = await fetch(`${baseUrl}/api/auth/super-admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gmail: saEmail, password: saPass }),
    });
    const saData = await saRes.json();
    assert.equal(saRes.status, 200);
    const saHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${saData.token}`,
    };

    const createRes = await fetch(`${baseUrl}/api/super-admin/shops`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'Staff Test Mart',
        ownerName: 'Tester',
        username: 'stafftestowner',
        password: 'OwnerPass@1',
        confirmPassword: 'OwnerPass@1',
        mobile: '0300-0000001',
        plan: '1_month',
        status: 'active',
      }),
    });
    const createdShop = await createRes.json();
    assert.equal(createRes.status, 200);
    const shopId = createdShop.shopId;
    assert.ok(shopId);

    const ownerLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portal: 'shop',
        identifier: 'stafftestowner',
        password: 'OwnerPass@1',
      }),
    });
    const ownerLogin = await ownerLoginRes.json();
    assert.equal(ownerLoginRes.status, 200);
    const ownerHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerLogin.token}`,
      'x-shop-id': shopId,
    };

    // Sync new staff with photo, permissions, attendance, and salary history
    const sync1 = await fetch(`${baseUrl}/api/store/sync`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        action: 'sync_staff',
        sourceDeviceId: 'TEST-PC',
        payload: [
          {
            ...sampleStaff[0],
            newPassword: 'StaffPass@1',
          },
        ],
      }),
    });
    assert.equal(sync1.status, 200);

    // Verify staff login succeeds with exact permissions
    const staffLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portal: 'shop',
        identifier: 'asadc',
        password: 'StaffPass@1',
      }),
    });
    const staffLoginData = await staffLoginRes.json();
    assert.equal(staffLoginRes.status, 200);
    assert.equal(staffLoginData.user.role, 'STAFF');
    assert.equal(staffLoginData.user.permissions.newSale, true);
    assert.equal(staffLoginData.user.permissions.canViewCostAndProfit, false);

    // Edit staff without newPassword + add new attendance record
    const sync2 = await fetch(`${baseUrl}/api/store/sync`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        action: 'sync_staff',
        sourceDeviceId: 'TEST-PC',
        payload: [
          {
            ...sampleStaff[0],
            salary: 32000,
            attendance: [
              { id: 'att-2', date: '24/11/2026', status: 'present', checkIn: '09:05 AM' },
              ...sampleStaff[0].attendance!,
            ],
          },
        ],
      }),
    });
    assert.equal(sync2.status, 200);

    // Password must remain intact & attendance/salary updates persisted
    const staffLoginAfterEdit = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portal: 'shop',
        identifier: 'asadc',
        password: 'StaffPass@1',
      }),
    });
    assert.equal(staffLoginAfterEdit.status, 200, 'Editing staff without newPassword must preserve password');

    const stateRes = await fetch(`${baseUrl}/api/store/state`, { headers: ownerHeaders });
    const stateData = await stateRes.json();
    assert.equal(stateData.store.staffList.length, 1);
    assert.equal(stateData.store.staffList[0].salary, 32000);
    assert.equal(stateData.store.staffList[0].attendance.length, 2);
    assert.equal(stateData.store.staffList[0].salaryPayments.length, 1);

    console.log('ALL STAFF MANAGEMENT REDESIGN TESTS PASSED');
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('STAFF MANAGEMENT TEST FAILED:', err);
  process.exit(1);
});
