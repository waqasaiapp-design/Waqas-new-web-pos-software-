import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawn, ChildProcess } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CctvPage } from '../src/components/CctvPage.tsx';
import type { CctvCamera, DvrNvrConfig } from '../src/types/pos.ts';

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
  throw new Error(`Server at ${baseUrl} did not become healthy`);
}

async function runTests() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-cctv-test-'));
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-cctv-media-'));

  // Create genuine short H.264 MP4 + HLS segments using ffmpeg for realistic live streaming & snapshot tests
  const sampleMp4 = path.join(mediaDir, 'live.mp4');
  const sampleM3u8 = path.join(mediaDir, 'live.m3u8');
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=15',
    '-t', '4',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    sampleMp4,
  ], { stdio: 'ignore' });

  execFileSync('ffmpeg', [
    '-y',
    '-i', sampleMp4,
    '-c:v', 'copy',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '0',
    '-hls_segment_filename', path.join(mediaDir, 'seg_%03d.ts'),
    sampleM3u8,
  ], { stdio: 'ignore' });

  let receivedPtzXml = '';
  const camPort = await getFreePort();
  const camBase = `http://127.0.0.1:${camPort}`;

  const camServer = http.createServer((req, res) => {
    const reqUrl = (req.url || '/').split('?')[0];

    if (reqUrl === '/web-login') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>Camera Web Portal</body></html>');
      return;
    }

    // Require Basic Auth on protected endpoints
    const auth = req.headers.authorization || '';
    const expectedAuth = `Basic ${Buffer.from('camadmin:CamSecret#99').toString('base64')}`;
    if (auth !== expectedAuth) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="IP Camera"' });
      res.end('Unauthorized');
      return;
    }

    if (reqUrl === '/live.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(fs.readFileSync(sampleM3u8));
      return;
    }

    if (/^\/seg_\d+\.ts$/.test(reqUrl)) {
      const segFile = path.join(mediaDir, path.basename(reqUrl));
      if (fs.existsSync(segFile)) {
        res.writeHead(200, { 'Content-Type': 'video/mp2t' });
        fs.createReadStream(segFile).pipe(res);
        return;
      }
    }

    if (reqUrl === '/video.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      fs.createReadStream(sampleMp4).pipe(res);
      return;
    }

    if (reqUrl === '/onvif/ptz_service' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        receivedPtzXml = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'Content-Type': 'application/soap+xml' });
        res.end('<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><ContinuousMoveResponse/></s:Body></s:Envelope>');
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise<void>((resolve) => camServer.listen(camPort, '127.0.0.1', () => resolve()));

  const SA_GMAIL = 'test-cctv-sa@gmail.com';
  const SA_PASS = 'SuperPass!234';
  const saSalt = crypto.randomBytes(16).toString('hex');
  const saHash = 'scrypt:' + crypto.scryptSync(SA_PASS, saSalt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');

  let serverProc: ChildProcess | null = null;
  try {
    console.log(`1. Starting isolated test server on ${baseUrl}...`);
    serverProc = spawn('npx', ['tsx', 'server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        WAQAS_DATA_DIR: dataDir,
        SUPER_ADMIN_EMAIL: SA_GMAIL,
        SUPER_ADMIN_PASSWORD_SALT: saSalt,
        SUPER_ADMIN_PASSWORD_HASH: saHash,
        WAQAS_ALLOW_LOOPBACK_CAMERAS: '1',
        NODE_ENV: 'production',
      },
      stdio: 'pipe',
    });

    await waitForHealth(baseUrl);

    // Login Super Admin & Create Mart A + Mart B
    const saLogin = await jsonReq(baseUrl, '/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({ gmail: SA_GMAIL, password: SA_PASS }),
    });
    assert.equal(saLogin.status, 200);
    const superToken = saLogin.data.token as string;

    const createMartA = await jsonReq(baseUrl, '/api/super-admin/shops', {
      method: 'POST',
      headers: { Authorization: `Bearer ${superToken}` },
      body: JSON.stringify({
        shopName: 'CCTV Test Mart A',
        ownerName: 'Tariq Owner',
        username: 'cctv_owner_a',
        password: 'OwnerPass!234',
        phone: '03001112233',
        planType: 'MONTHLY',
        subscriptionDays: 30,
      }),
    });
    assert.equal(createMartA.status, 200);
    const martAId = createMartA.data.shop.id as string;

    const ownerLogin = await jsonReq(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'cctv_owner_a', password: 'OwnerPass!234' }),
    });
    assert.equal(ownerLogin.status, 200);
    const ownerToken = ownerLogin.data.token as string;

    // Create Cashier (no settings/CCTV permission) + Manager (settings permission)
    const syncStaffRes = await jsonReq(baseUrl, '/api/store/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'x-shop-id': martAId },
      body: JSON.stringify({
        action: 'sync_staff',
        sourceDeviceId: 'TEST-PC',
        payload: [
          {
            id: 'staff-cashier',
            name: 'Cashier NoCCTV',
            phone: '03001110000',
            role: 'Cashier',
            salary: 25000,
            joiningDate: '2026-01-01',
            accountStatus: 'active',
            username: 'cashier_nocctv',
            newPassword: 'StaffPass!123',
            permissions: {
              newSale: true,
              oldSale: true,
              settings: false,
              canAccessSettings: false,
            },
          },
          {
            id: 'staff-mgr',
            name: 'Manager WithCCTV',
            phone: '03002220000',
            role: 'Manager',
            salary: 40000,
            joiningDate: '2026-01-01',
            accountStatus: 'active',
            username: 'mgr_cctv',
            newPassword: 'StaffPass!123',
            permissions: {
              newSale: true,
              oldSale: true,
              settings: true,
              canAccessSettings: true,
            },
          },
        ],
      }),
    });
    assert.equal(syncStaffRes.status, 200);

    const cashierLogin = await jsonReq(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'cashier_nocctv', password: 'StaffPass!123' }),
    });
    assert.equal(cashierLogin.status, 200);
    const cashierToken = cashierLogin.data.token as string;

    const mgrLogin = await jsonReq(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'mgr_cctv', password: 'StaffPass!123' }),
    });
    assert.equal(mgrLogin.status, 200);
    const mgrToken = mgrLogin.data.token as string;

    console.log('2. Verifying RBAC authorization on CCTV routes...');
    const deniedOverview = await jsonReq(baseUrl, '/api/cctv/overview', {
      headers: { Authorization: `Bearer ${cashierToken}` },
    });
    assert.equal(deniedOverview.status, 403);
    assert.equal(deniedOverview.data.error, 'CCTV_ACCESS_DENIED');

    const allowedOverview = await jsonReq(baseUrl, '/api/cctv/overview', {
      headers: { Authorization: `Bearer ${mgrToken}` },
    });
    assert.equal(allowedOverview.status, 200);
    assert.equal(allowedOverview.data.gateway.ffmpegAvailable, true);

    console.log('3. Testing input validation, SSRF protection, and error diagnostics...');
    const badIpTest = await jsonReq(baseUrl, '/api/cctv/test-connection', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ cameraType: 'rtsp', ipAddress: '999.999.1.1', port: 554 }),
    });
    assert.equal(badIpTest.data.result.ok, false);
    assert.equal(badIpTest.data.result.errorCode, 'INVALID_IP_OR_URL');

    const metadataSsrfTest = await jsonReq(baseUrl, '/api/cctv/test-connection', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ cameraType: 'ip', streamUrl: 'http://169.254.169.254/latest/meta-data/' }),
    });
    assert.equal(metadataSsrfTest.data.result.ok, false);
    assert.equal(metadataSsrfTest.data.result.errorCode, 'INVALID_IP_OR_URL');

    const badSchemeTest = await jsonReq(baseUrl, '/api/cctv/test-connection', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ cameraType: 'ip', streamUrl: 'javascript:alert(1)' }),
    });
    assert.equal(badSchemeTest.data.result.ok, false);
    assert.equal(badSchemeTest.data.result.errorCode, 'UNSUPPORTED_FORMAT');

    const closedPort = await getFreePort();
    const disconnectedTest = await jsonReq(baseUrl, '/api/cctv/test-connection', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ cameraType: 'ip', ipAddress: '127.0.0.1', port: closedPort }),
    });
    assert.equal(disconnectedTest.data.result.ok, false);
    assert.equal(disconnectedTest.data.result.errorCode, 'CAMERA_DISCONNECTED');

    const wrongPwdTest = await jsonReq(baseUrl, '/api/cctv/test-connection', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        cameraType: 'hls',
        streamUrl: `${camBase}/live.m3u8`,
        username: 'camadmin',
        password: 'WrongPassword!',
      }),
    });
    assert.equal(wrongPwdTest.data.result.ok, false);
    assert.equal(wrongPwdTest.data.result.errorCode, 'AUTH_FAILED');

    const htmlFormatTest = await jsonReq(baseUrl, '/api/cctv/test-connection', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        cameraType: 'ip',
        streamUrl: `${camBase}/web-login`,
      }),
    });
    assert.equal(htmlFormatTest.data.result.ok, false);
    assert.equal(htmlFormatTest.data.result.errorCode, 'UNSUPPORTED_FORMAT');

    console.log('4. Testing genuine HLS/MP4 camera creation, secret redaction & CRUD...');
    const goodTest = await jsonReq(baseUrl, '/api/cctv/test-connection', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        cameraType: 'hls',
        streamUrl: `${camBase}/live.m3u8`,
        username: 'camadmin',
        password: 'CamSecret#99',
        supportsPtz: true,
      }),
    });
    assert.equal(goodTest.data.result.ok, true, `Unexpected probe failure: ${JSON.stringify(goodTest.data.result)}`);
    assert.equal(goodTest.data.result.status, 'online');
    assert.equal(goodTest.data.result.capabilities.playbackProtocol, 'hls');

    const createCamRes = await jsonReq(baseUrl, '/api/cctv/cameras', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        name: 'Cash Counter 1',
        location: 'Cash Counter 01',
        cameraType: 'hls',
        ipAddress: '127.0.0.1',
        port: camPort,
        channelNumber: 1,
        username: 'camadmin',
        password: 'CamSecret#99',
        streamUrl: `http://camadmin:CamSecret%2399@127.0.0.1:${camPort}/live.m3u8`,
        supportsPtz: true,
        description: 'Main cash register view',
      }),
    });
    assert.equal(createCamRes.status, 200);
    const camId = createCamRes.data.camera.id as string;
    assert.equal(createCamRes.data.camera.status, 'online');
    assert.equal(createCamRes.data.camera.hasPassword, true);
    assert.equal(createCamRes.text.includes('CamSecret#99'), false, 'Password must NEVER leak to client!');

    // Verify store/state and backup/export never expose password or encrypted hashes
    const storeState = await jsonReq(baseUrl, '/api/store/state', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(storeState.text.includes('CamSecret#99'), false);
    assert.equal(storeState.text.includes('passwordEncrypted'), false);
    assert.equal(storeState.text.includes('streamUrlEncrypted'), false);

    const backupRes = await jsonReq(baseUrl, '/api/shop/backup/export', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(backupRes.text.includes('CamSecret#99'), false);
    assert.equal(backupRes.text.includes('passwordEncrypted'), false);

    // Edit camera WITHOUT re-entering password -> preserved & stays online!
    const editRes = await jsonReq(baseUrl, `/api/cctv/cameras/${camId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        name: 'Cash Counter Main',
        location: 'Cash Counter 01',
        keepExistingPassword: true,
        keepExistingStreamUrl: true,
        supportsPtz: true,
      }),
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.data.camera.name, 'Cash Counter Main');
    assert.equal(editRes.data.camera.status, 'online');

    console.log('5. Verifying genuine live stream gateway, segment proxy, snapshot capture, ONVIF PTZ & MP4 recording...');
    const sessionRes = await jsonReq(baseUrl, `/api/cctv/cameras/${camId}/stream-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(sessionRes.status, 200);
    assert.equal(sessionRes.data.protocol, 'hls');
    assert.ok(sessionRes.data.streamPath.includes('st='));

    const m3u8Fetch = await fetch(`${baseUrl}${sessionRes.data.streamPath}`);
    assert.equal(m3u8Fetch.status, 200);
    const playlistBody = await m3u8Fetch.text();
    assert.ok(playlistBody.includes('#EXTM3U'));
    const firstSegLine = playlistBody.split(/\r?\n/).find((l) => l.includes('remote-seg'));
    assert.ok(firstSegLine, 'Playlist must rewrite segments through authenticated gateway');

    const segFetch = await fetch(`${baseUrl}${firstSegLine}`);
    assert.equal(segFetch.status, 200);
    const segBuf = Buffer.from(await segFetch.arrayBuffer());
    assert.ok(segBuf.length > 500, 'HLS segment bytes must be delivered from upstream camera');

    // Create a second MP4 camera to test FFmpeg transcoding gateway, snapshot JPEG, and MP4 recording
    const mp4CamRes = await jsonReq(baseUrl, '/api/cctv/cameras', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        name: 'Entrance IP Cam',
        location: 'Main Entrance',
        cameraType: 'ip',
        ipAddress: '127.0.0.1',
        port: camPort,
        username: 'camadmin',
        password: 'CamSecret#99',
        streamUrl: `${camBase}/video.mp4`,
        supportsPtz: false,
      }),
    });
    assert.equal(mp4CamRes.status, 200);
    const mp4CamId = mp4CamRes.data.camera.id as string;
    assert.equal(mp4CamRes.data.camera.status, 'online');

    // Snapshot capture returns valid JPEG bytes (FFD8)
    const snapFetch = await fetch(`${baseUrl}/api/cctv/cameras/${mp4CamId}/snapshot`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(snapFetch.status, 200);
    const snapBuf = Buffer.from(await snapFetch.arrayBuffer());
    assert.equal(snapBuf[0], 0xff);
    assert.equal(snapBuf[1], 0xd8);

    // ONVIF PTZ command on PTZ camera
    const ptzRes = await jsonReq(baseUrl, `/api/cctv/cameras/${camId}/ptz`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ action: 'left', speed: 0.6 }),
    });
    assert.equal(ptzRes.status, 200);
    assert.ok(receivedPtzXml.includes('ContinuousMove'));
    assert.ok(receivedPtzXml.includes('camadmin'));

    // PTZ rejected if camera doesn't support PTZ
    const ptzDenied = await jsonReq(baseUrl, `/api/cctv/cameras/${mp4CamId}/ptz`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ action: 'left' }),
    });
    assert.equal(ptzDenied.status, 400);

    // Server recording start -> wait -> stop -> playback -> delete
    const recStart = await jsonReq(baseUrl, `/api/cctv/cameras/${mp4CamId}/recordings/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(recStart.status, 200);
    const recId = recStart.data.recording.id as string;
    await new Promise((r) => setTimeout(r, 1400));
    const recStop = await jsonReq(baseUrl, `/api/cctv/cameras/${mp4CamId}/recordings/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ recordingId: recId }),
    });
    assert.equal(recStop.status, 200);
    assert.ok(recStop.data.recording.sizeBytes > 0);

    const recFileRes = await fetch(`${baseUrl}/api/cctv/recordings/${recId}/file`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(recFileRes.status, 200);
    const recBytes = Buffer.from(await recFileRes.arrayBuffer());
    assert.ok(recBytes.length > 500);

    const recDelRes = await jsonReq(baseUrl, `/api/cctv/recordings/${recId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(recDelRes.status, 200);

    // Multi-Shop Isolation: Super Admin POS does not see Mart A's cameras
    const saOverview = await jsonReq(baseUrl, '/api/cctv/overview?shopId=SHOP-SA-POS', {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    assert.equal(saOverview.status, 200);
    assert.equal(saOverview.data.cameras.length, 0);

    // Delete Camera
    const delCamRes = await jsonReq(baseUrl, `/api/cctv/cameras/${mp4CamId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(delCamRes.status, 200);

    const refreshAllRes = await jsonReq(baseUrl, '/api/cctv/refresh-all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(refreshAllRes.status, 200);
    assert.equal(refreshAllRes.data.cameras.length, 1);

    console.log('6. Verifying CctvPage React SSR layout & responsive grid controls...');
    const sampleCams: CctvCamera[] = [createCamRes.data.camera];
    const sampleDvr: DvrNvrConfig = {
      brand: 'Hikvision',
      dvrIp: '192.168.1.100',
      port: 554,
      username: 'admin',
      channelCount: 8,
      connected: true,
    };
    const html = renderToStaticMarkup(
      React.createElement(CctvPage, {
        cameras: sampleCams,
        dvrConfig: sampleDvr,
        activeShopId: martAId,
        canManage: true,
        onSyncCameras: () => {},
        onSyncDvrConfig: () => {},
      })
    );
    assert.ok(html.includes('1 Cam'));
    assert.ok(html.includes('4 Grid'));
    assert.ok(html.includes('9 Grid'));
    assert.ok(html.includes('16 Grid'));
    assert.ok(html.includes('Cash Counter 1'));
    assert.ok(!html.includes('CamSecret#99'));

    console.log('ALL CCTV Gateway, Live Playback, Security, PTZ, Snapshot & UI tests PASSED!');
  } finally {
    camServer.close();
    if (serverProc) {
      serverProc.stdout?.destroy();
      serverProc.stderr?.destroy();
      serverProc.kill('SIGKILL');
      serverProc.unref();
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
