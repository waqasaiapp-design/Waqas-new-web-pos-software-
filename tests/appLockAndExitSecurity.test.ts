import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';

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

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function runTests() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-applock-test-'));
  const SA_GMAIL = 'test-applock-sa@gmail.com';
  const SA_PASS = 'SuperPassword!234';
  const saSalt = crypto.randomBytes(16).toString('hex');
  const saHash =
    'scrypt:' + crypto.scryptSync(SA_PASS, saSalt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');

  let serverProc: ChildProcess | null = null;
  try {
    console.log(`Starting isolated test server on ${baseUrl}...`);
    serverProc = spawn('npx', ['tsx', 'server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        WAQAS_DATA_DIR: dataDir,
        SUPER_ADMIN_EMAIL: SA_GMAIL,
        SUPER_ADMIN_PASSWORD_SALT: saSalt,
        SUPER_ADMIN_PASSWORD_HASH: saHash,
        NODE_ENV: 'production',
      },
      stdio: 'pipe',
    });

    await waitForHealth(baseUrl);

    // 1. Login as Super Admin
    const saLoginRes = await jsonReq(baseUrl, '/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ gmail: SA_GMAIL, password: SA_PASS }),
    });
    assert.equal(saLoginRes.status, 200, `Super Admin login failed: ${saLoginRes.text}`);
    const superToken = saLoginRes.data.token as string;
    assert.ok(superToken);

    // 2. Super Admin creates a Mart shop + Owner login
    const createMartRes = await jsonReq(baseUrl, '/api/super-admin/shops', {
      method: 'POST',
      headers: { Authorization: `Bearer ${superToken}` },
      body: JSON.stringify({
        shopName: 'Al-Noor Mart',
        ownerName: 'Usman Khan',
        username: 'alnoor_owner',
        password: 'OwnerPass!234',
        phone: '03001112233',
        planType: 'MONTHLY',
        subscriptionDays: 30,
      }),
    });
    assert.equal(createMartRes.status, 200, `Create shop failed: ${createMartRes.text}`);
    const martShopId = createMartRes.data.shop.id as string;

    // 3. Login as Mart Owner
    const ownerLoginRes = await jsonReq(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        portal: 'shop',
        identifier: 'alnoor_owner',
        password: 'OwnerPass!234',
      }),
    });
    assert.equal(ownerLoginRes.status, 200, `Owner login failed: ${ownerLoginRes.text}`);
    const ownerToken = ownerLoginRes.data.token as string;
    assert.ok(ownerToken);

    // 4. Create Staff Member with login account via sync_staff
    const staffCreateRes = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-shop-id': martShopId,
      },
      body: JSON.stringify({
        action: 'sync_staff',
        sourceDeviceId: 'TEST-OWNER-PC',
        payload: [
          {
            id: 'staff-1',
            name: 'Cashier Bilal',
            phone: '03009998877',
            role: 'Cashier',
            salary: 30000,
            joiningDate: '2026-01-01',
            username: 'bilal_cashier',
            newPassword: 'StaffPass!234',
            accountStatus: 'active',
            permissions: { pos: true, reports: true },
          },
        ],
      }),
    });
    assert.equal(staffCreateRes.status, 200, `Create staff failed: ${staffCreateRes.text}`);

    const staffLoginRes = await jsonReq(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        portal: 'shop',
        identifier: 'bilal_cashier',
        password: 'StaffPass!234',
      }),
    });
    assert.equal(staffLoginRes.status, 200, `Staff login failed: ${staffLoginRes.text}`);
    const staffToken = staffLoginRes.data.token as string;
    assert.ok(staffToken);

    // 5. Verify Staff cannot modify App Lock settings / PIN / Password / WebAuthn / Recovery (403)
    console.log('Testing RBAC: Staff blocked from configuring App Lock...');
    for (const [ep, body] of [
      ['/api/app-lock/settings', { enabled: true }],
      ['/api/app-lock/pin', { pin: '1234', confirmPin: '1234' }],
      ['/api/app-lock/password', { password: 'MySecretPassword', confirmPassword: 'MySecretPassword' }],
      ['/api/app-lock/webauthn/register-options', {}],
      ['/api/app-lock/recover', { accountPassword: 'StaffPass!234', newPin: '9999', confirmNewPin: '9999' }],
    ] as const) {
      const r = await jsonReq(baseUrl, ep, {
        method: 'POST',
        headers: { Authorization: `Bearer ${staffToken}` },
        body: JSON.stringify(body),
      });
      assert.equal(r.status, 403, `Expected 403 for staff on ${ep}, got ${r.status}`);
    }

    // 6. Verify Owner cannot enable App Lock until at least one unlock method exists
    const earlyEnable = await jsonReq(baseUrl, '/api/app-lock/settings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(earlyEnable.status, 400);

    // 7. Owner sets 4-digit PIN, then updates to 6-digit PIN, and sets App Lock Password
    console.log('Testing PIN (4/6 digits) and App Lock Password setup & verification...');
    const setPin4 = await jsonReq(baseUrl, '/api/app-lock/pin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ pin: '2580', confirmPin: '2580' }),
    });
    assert.equal(setPin4.status, 200);
    assert.equal(setPin4.data.config.hasPin, true);
    assert.equal(setPin4.data.config.pinLength, 4);

    // Updating PIN requires correct current PIN
    const wrongCurrPin = await jsonReq(baseUrl, '/api/app-lock/pin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ currentPin: '0000', pin: '135790', confirmPin: '135790' }),
    });
    assert.equal(wrongCurrPin.status, 401);

    const setPin6 = await jsonReq(baseUrl, '/api/app-lock/pin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ currentPin: '2580', pin: '135790', confirmPin: '135790' }),
    });
    assert.equal(setPin6.status, 200);
    assert.equal(setPin6.data.config.pinLength, 6);

    const setPwd = await jsonReq(baseUrl, '/api/app-lock/password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ password: 'MartLock#9988', confirmPassword: 'MartLock#9988' }),
    });
    assert.equal(setPwd.status, 200);
    assert.equal(setPwd.data.config.hasPassword, true);

    // Enable App Lock + Exit Security + Reopen Lock + Timeout
    const enableRes = await jsonReq(baseUrl, '/api/app-lock/settings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        enabled: true,
        autoLockTimeout: '1m',
        defaultUnlockMethod: 'pin',
        requireAuthOnExit: true,
        requireAuthOnReopen: true,
      }),
    });
    assert.equal(enableRes.status, 200);
    assert.equal(enableRes.data.config.enabled, true);
    assert.equal(enableRes.data.config.requireAuthOnExit, true);
    assert.equal(enableRes.data.config.requireAuthOnReopen, true);

    // 8. Verify store state & backup export NEVER leak private scrypt hashes/salts
    console.log('Verifying store snapshot & backup export sanitize App Lock secrets...');
    const storeRes = await jsonReq(baseUrl, '/api/store/state', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(storeRes.status, 200);
    assert.equal(storeRes.data.store.appLock, undefined);
    assert.equal(storeRes.text.includes('pinHash'), false);
    assert.equal(storeRes.text.includes('passwordHash'), false);
    assert.equal(storeRes.text.includes('appLockPasswordHash'), false);

    const backupRes = await jsonReq(baseUrl, '/api/shop/backup/export', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(backupRes.status, 200);
    assert.equal(backupRes.data.backup.storeDb.appLock, undefined);
    assert.equal(backupRes.text.includes('pinHash'), false);
    assert.equal(backupRes.text.includes('appLockPasswordHash'), false);
    assert.equal(backupRes.text.includes('"appLock"'), false);

    // 9. Verify valid & invalid PIN + Password + Lockout on 5 consecutive failed attempts
    console.log('Testing PIN/Password unlock, Exit verification, and 5-attempt lockout...');
    const verifyPinOk = await jsonReq(baseUrl, '/api/app-lock/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` }, // Staff CAN unlock & confirm exit
      body: JSON.stringify({ method: 'pin', secret: '135790', context: 'unlock' }),
    });
    assert.equal(verifyPinOk.status, 200);
    assert.equal(verifyPinOk.data.success, true);

    const verifyPwdExitOk = await jsonReq(baseUrl, '/api/app-lock/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ method: 'password', secret: 'MartLock#9988', context: 'exit' }),
    });
    assert.equal(verifyPwdExitOk.status, 200);
    assert.equal(verifyPwdExitOk.data.success, true);

    // 5 failed attempts trigger cooldown (429 on 6th)
    for (let i = 1; i <= 5; i++) {
      const bad = await jsonReq(baseUrl, '/api/app-lock/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ method: 'pin', secret: '000000', context: 'unlock' }),
      });
      assert.equal(bad.status, 401);
      assert.equal(bad.data.config.failedAttempts, i);
    }
    const lockedOut = await jsonReq(baseUrl, '/api/app-lock/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ method: 'pin', secret: '135790', context: 'unlock' }),
    });
    assert.equal(lockedOut.status, 429, 'Expected 429 cooldown after 5 consecutive failures');

    // 10. Recovery using Owner Login Password clears lockout & resets PIN
    console.log('Testing Forgot PIN recovery using Owner Account Password...');
    const badRecover = await jsonReq(baseUrl, '/api/app-lock/recover', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        accountPassword: 'WrongOwnerPassword',
        newPin: '4321',
        confirmNewPin: '4321',
      }),
    });
    assert.equal(badRecover.status, 401);

    const goodRecover = await jsonReq(baseUrl, '/api/app-lock/recover', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        accountPassword: 'OwnerPass!234',
        newPin: '4321',
        confirmNewPin: '4321',
      }),
    });
    assert.equal(goodRecover.status, 200);
    assert.equal(goodRecover.data.config.failedAttempts, 0);
    assert.equal(goodRecover.data.config.pinLength, 4);

    const verifyRecoveredPin = await jsonReq(baseUrl, '/api/app-lock/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ method: 'pin', secret: '4321', context: 'unlock' }),
    });
    assert.equal(verifyRecoveredPin.status, 200);

    // 11. Real Cryptographic WebAuthn Biometric Registration & Assertion Verification
    console.log('Testing real WebAuthn ECDSA P-256 biometric registration & assertion verification...');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const spkiBase64 = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');

    const regOptRes = await jsonReq(baseUrl, '/api/app-lock/webauthn/register-options', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(regOptRes.status, 200);
    const { challengeId: regChallengeId, options: regOpts } = regOptRes.data;

    const regClientData = toBase64Url(
      Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: regOpts.challenge,
          origin: baseUrl,
        })
      )
    );
    const credId = toBase64Url(crypto.randomBytes(32));

    const regVerifyRes = await jsonReq(baseUrl, '/api/app-lock/webauthn/register-verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        challengeId: regChallengeId,
        deviceLabel: 'Android Fingerprint Sensor',
        authenticatorType: 'Platform Biometric',
        credential: {
          id: credId,
          rawId: credId,
          type: 'public-key',
          response: {
            clientDataJSON: regClientData,
            attestationObject: toBase64Url(Buffer.from('packed-spki')),
            publicKeySpkiBase64: spkiBase64,
            publicKeyAlgorithm: -7,
            transports: ['internal'],
          },
        },
      }),
    });
    assert.equal(regVerifyRes.status, 200, `WebAuthn register verify failed: ${regVerifyRes.text}`);
    assert.equal(regVerifyRes.data.config.webauthnCredentials.length, 1);

    // Auth options + valid signed assertion
    const authOptRes = await jsonReq(baseUrl, '/api/app-lock/webauthn/auth-options', {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(authOptRes.status, 200);
    const { challengeId: authChallengeId, options: authOpts } = authOptRes.data;

    const authClientDataBuf = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: authOpts.challenge,
        origin: baseUrl,
      })
    );
    const rpIdHash = crypto.createHash('sha256').update(authOpts.rpId).digest();
    const flags = Buffer.from([0x05]); // UP (0x01) + UV (0x04)
    const signCount = Buffer.alloc(4);
    signCount.writeUInt32BE(1, 0);
    const authenticatorDataBuf = Buffer.concat([rpIdHash, flags, signCount]);
    const clientDataHash = crypto.createHash('sha256').update(authClientDataBuf).digest();
    const signedPayload = Buffer.concat([authenticatorDataBuf, clientDataHash]);
    const signatureBuf = crypto.sign('sha256', signedPayload, privateKey);

    const authVerifyOk = await jsonReq(baseUrl, '/api/app-lock/webauthn/auth-verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({
        challengeId: authChallengeId,
        context: 'exit',
        credential: {
          id: credId,
          rawId: credId,
          type: 'public-key',
          response: {
            clientDataJSON: toBase64Url(authClientDataBuf),
            authenticatorData: toBase64Url(authenticatorDataBuf),
            signature: toBase64Url(signatureBuf),
          },
        },
      }),
    });
    assert.equal(authVerifyOk.status, 200, `WebAuthn auth verify failed: ${authVerifyOk.text}`);
    assert.equal(authVerifyOk.data.success, true);

    // Tampered signature must fail (401)
    const authOptRes2 = await jsonReq(baseUrl, '/api/app-lock/webauthn/auth-options', {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({}),
    });
    const badSigVerify = await jsonReq(baseUrl, '/api/app-lock/webauthn/auth-verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({
        challengeId: authOptRes2.data.challengeId,
        context: 'unlock',
        credential: {
          id: credId,
          rawId: credId,
          type: 'public-key',
          response: {
            clientDataJSON: toBase64Url(
              Buffer.from(
                JSON.stringify({
                  type: 'webauthn.get',
                  challenge: authOptRes2.data.options.challenge,
                  origin: baseUrl,
                })
              )
            ),
            authenticatorData: toBase64Url(authenticatorDataBuf),
            signature: toBase64Url(Buffer.from('invalid-signature-bytes')),
          },
        },
      }),
    });
    assert.equal(badSigVerify.status, 401);

    // 12. Verify Super Admin Personal App Lock (SHOP-SA-POS) stays completely isolated from Mart Shop
    console.log('Verifying Super Admin App Lock isolation from Mart shops...');
    const saStatusBefore = await jsonReq(baseUrl, '/api/app-lock/status?shopId=SHOP-SA-POS', {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    assert.equal(saStatusBefore.status, 200);
    assert.equal(saStatusBefore.data.config.enabled, false);
    assert.equal(saStatusBefore.data.config.hasPin, false);

    const saSetPin = await jsonReq(baseUrl, '/api/app-lock/pin', {
      method: 'POST',
      headers: { Authorization: `Bearer ${superToken}` },
      body: JSON.stringify({ shopId: 'SHOP-SA-POS', pin: '778899', confirmPin: '778899' }),
    });
    assert.equal(saSetPin.status, 200);
    assert.equal(saSetPin.data.config.pinLength, 6);

    // Verify Mart shop PIN is still '4321' and unaffected
    const martStillOk = await jsonReq(baseUrl, '/api/app-lock/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ shopId: martShopId, method: 'pin', secret: '4321', context: 'unlock' }),
    });
    assert.equal(martStillOk.status, 200);

    console.log('ALL App Lock, Biometric WebAuthn, RBAC, Recovery & Isolation tests PASSED!');
  } finally {
    if (serverProc) {
      serverProc.stdout?.destroy();
      serverProc.stderr?.destroy();
      serverProc.kill('SIGKILL');
      serverProc.unref();
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
