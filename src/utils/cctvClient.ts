import {
  CctvCamera,
  CctvCameraInput,
  CctvCapabilities,
  CctvConnectionTestResult,
  CctvGatewayStatus,
  CctvPlaybackProtocol,
  CctvRecordingEntry,
  DvrNvrConfig,
} from '../types/pos';
import { getApiBaseUrl, safeFetchJson } from './apiClient';

function buildHeaders(shopId?: string): Record<string, string> {
  return shopId ? { 'x-shop-id': shopId } : {};
}

export interface CctvOverviewResponse {
  cameras: CctvCamera[];
  dvrConfig: DvrNvrConfig;
  gateway: CctvGatewayStatus;
  recordings: CctvRecordingEntry[];
}

export interface CctvStreamSession {
  protocol: CctvPlaybackProtocol;
  streamPath: string;
  snapshotPath: string;
  capabilities: CctvCapabilities;
  camera: CctvCamera;
}

export function resolveCctvMediaUrl(relativeOrAbsolutePath: string): string {
  if (!relativeOrAbsolutePath) return '';
  if (relativeOrAbsolutePath.startsWith('http://') || relativeOrAbsolutePath.startsWith('https://')) {
    return relativeOrAbsolutePath;
  }
  const base = getApiBaseUrl();
  const clean = relativeOrAbsolutePath.startsWith('/') ? relativeOrAbsolutePath : `/${relativeOrAbsolutePath}`;
  return `${base}${clean}`;
}

export async function fetchCctvOverview(shopId?: string): Promise<CctvOverviewResponse> {
  const query = shopId ? `?shopId=${encodeURIComponent(shopId)}` : '';
  const res = await safeFetchJson<{
    success: boolean;
    cameras: CctvCamera[];
    dvrConfig: DvrNvrConfig;
    gateway: CctvGatewayStatus;
    recordings: CctvRecordingEntry[];
  }>(`/api/cctv/overview${query}`, {
    method: 'GET',
    headers: buildHeaders(shopId),
  });
  return {
    cameras: Array.isArray(res.data?.cameras) ? res.data.cameras : [],
    dvrConfig: res.data?.dvrConfig,
    gateway: res.data?.gateway,
    recordings: Array.isArray(res.data?.recordings) ? res.data.recordings : [],
  };
}

export async function testCameraConnectionApi(
  payload: Partial<CctvCameraInput> & { cameraId?: string },
  shopId?: string
): Promise<CctvConnectionTestResult> {
  const res = await safeFetchJson<{ success: boolean; result: CctvConnectionTestResult }>(
    '/api/cctv/test-connection',
    {
      method: 'POST',
      headers: buildHeaders(shopId),
      body: JSON.stringify(payload),
    }
  );
  return res.data.result;
}

export async function createCameraApi(
  payload: CctvCameraInput & { testOnSave?: boolean },
  shopId?: string
): Promise<{ camera: CctvCamera; testResult?: CctvConnectionTestResult | null }> {
  const res = await safeFetchJson<{
    success: boolean;
    camera: CctvCamera;
    testResult?: CctvConnectionTestResult | null;
  }>('/api/cctv/cameras', {
    method: 'POST',
    headers: buildHeaders(shopId),
    body: JSON.stringify(payload),
  });
  return { camera: res.data.camera, testResult: res.data.testResult };
}

export async function updateCameraApi(
  cameraId: string,
  payload: Partial<CctvCameraInput> & { testOnSave?: boolean },
  shopId?: string
): Promise<{ camera: CctvCamera; testResult?: CctvConnectionTestResult | null }> {
  const res = await safeFetchJson<{
    success: boolean;
    camera: CctvCamera;
    testResult?: CctvConnectionTestResult | null;
  }>(`/api/cctv/cameras/${encodeURIComponent(cameraId)}`, {
    method: 'PUT',
    headers: buildHeaders(shopId),
    body: JSON.stringify(payload),
  });
  return { camera: res.data.camera, testResult: res.data.testResult };
}

export async function deleteCameraApi(cameraId: string, shopId?: string): Promise<void> {
  await safeFetchJson(`/api/cctv/cameras/${encodeURIComponent(cameraId)}`, {
    method: 'DELETE',
    headers: buildHeaders(shopId),
  });
}

export async function refreshCameraApi(
  cameraId: string,
  shopId?: string
): Promise<{ ok: boolean; camera: CctvCamera; result: CctvConnectionTestResult }> {
  const res = await safeFetchJson<{
    success: boolean;
    camera: CctvCamera;
    result: CctvConnectionTestResult;
  }>(`/api/cctv/cameras/${encodeURIComponent(cameraId)}/refresh`, {
    method: 'POST',
    headers: buildHeaders(shopId),
    body: JSON.stringify({}),
  });
  return { ok: Boolean(res.data.success), camera: res.data.camera, result: res.data.result };
}

export async function refreshAllCamerasApi(shopId?: string): Promise<CctvCamera[]> {
  const res = await safeFetchJson<{ success: boolean; cameras: CctvCamera[] }>('/api/cctv/refresh-all', {
    method: 'POST',
    headers: buildHeaders(shopId),
    body: JSON.stringify({}),
  });
  return Array.isArray(res.data?.cameras) ? res.data.cameras : [];
}

export async function saveDvrConfigApi(
  payload: {
    brand: DvrNvrConfig['brand'];
    dvrIp: string;
    port: number;
    username: string;
    password?: string;
    channelCount: number;
  },
  shopId?: string
): Promise<{ dvrConfig: DvrNvrConfig; testResult: CctvConnectionTestResult }> {
  const res = await safeFetchJson<{
    success: boolean;
    dvrConfig: DvrNvrConfig;
    testResult: CctvConnectionTestResult;
  }>('/api/cctv/dvr', {
    method: 'PUT',
    headers: buildHeaders(shopId),
    body: JSON.stringify(payload),
  });
  return { dvrConfig: res.data.dvrConfig, testResult: res.data.testResult };
}

export async function startCameraStreamSessionApi(
  cameraId: string,
  shopId?: string
): Promise<CctvStreamSession> {
  const res = await safeFetchJson<{
    success: boolean;
    protocol: CctvPlaybackProtocol;
    streamPath: string;
    snapshotPath: string;
    capabilities: CctvCapabilities;
    camera: CctvCamera;
  }>(`/api/cctv/cameras/${encodeURIComponent(cameraId)}/stream-session`, {
    method: 'POST',
    headers: buildHeaders(shopId),
    body: JSON.stringify({}),
  });
  return {
    protocol: res.data.protocol,
    streamPath: resolveCctvMediaUrl(res.data.streamPath),
    snapshotPath: resolveCctvMediaUrl(res.data.snapshotPath),
    capabilities: res.data.capabilities,
    camera: res.data.camera,
  };
}

export async function sendCameraPtzApi(
  cameraId: string,
  action: 'left' | 'right' | 'up' | 'down' | 'zoom_in' | 'zoom_out' | 'stop',
  shopId?: string
): Promise<{ message: string }> {
  const res = await safeFetchJson<{ success: boolean; message: string }>(
    `/api/cctv/cameras/${encodeURIComponent(cameraId)}/ptz`,
    {
      method: 'POST',
      headers: buildHeaders(shopId),
      body: JSON.stringify({ action, speed: 0.5 }),
    }
  );
  return { message: res.data.message };
}

export async function startCameraRecordingApi(
  cameraId: string,
  shopId?: string
): Promise<CctvRecordingEntry> {
  const res = await safeFetchJson<{ success: boolean; recording: CctvRecordingEntry }>(
    `/api/cctv/cameras/${encodeURIComponent(cameraId)}/recordings/start`,
    {
      method: 'POST',
      headers: buildHeaders(shopId),
      body: JSON.stringify({}),
    }
  );
  return res.data.recording;
}

export async function stopCameraRecordingApi(
  cameraId: string,
  recordingId?: string,
  shopId?: string
): Promise<CctvRecordingEntry> {
  const res = await safeFetchJson<{ success: boolean; recording: CctvRecordingEntry }>(
    `/api/cctv/cameras/${encodeURIComponent(cameraId)}/recordings/stop`,
    {
      method: 'POST',
      headers: buildHeaders(shopId),
      body: JSON.stringify({ recordingId }),
    }
  );
  return res.data.recording;
}

export async function listCameraRecordingsApi(
  cameraId: string,
  shopId?: string
): Promise<CctvRecordingEntry[]> {
  const res = await safeFetchJson<{ success: boolean; recordings: CctvRecordingEntry[] }>(
    `/api/cctv/cameras/${encodeURIComponent(cameraId)}/recordings`,
    {
      method: 'GET',
      headers: buildHeaders(shopId),
    }
  );
  return Array.isArray(res.data?.recordings) ? res.data.recordings : [];
}

export async function deleteCameraRecordingApi(
  recordingId: string,
  shopId?: string
): Promise<void> {
  await safeFetchJson(`/api/cctv/recordings/${encodeURIComponent(recordingId)}`, {
    method: 'DELETE',
    headers: buildHeaders(shopId),
  });
}

export async function captureCameraSnapshotBlob(
  cameraId: string,
  shopId?: string
): Promise<Blob> {
  const base = getApiBaseUrl();
  const url = `${base}/api/cctv/cameras/${encodeURIComponent(cameraId)}/snapshot`;
  let token: string | null = null;
  try {
    const saved = localStorage.getItem('waqas_pos_session_v1');
    if (saved) token = JSON.parse(saved)?.token || null;
  } catch {}
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (shopId) headers['x-shop-id'] = shopId;

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    let errMsg = `Snapshot capture failed (HTTP ${res.status})`;
    try {
      const json = await res.json();
      if (json?.message) errMsg = json.message;
    } catch {}
    throw new Error(errMsg);
  }
  return await res.blob();
}

export async function fetchAuthorizedRecordingBlobUrl(
  recordingId: string,
  shopId?: string
): Promise<string> {
  const base = getApiBaseUrl();
  const url = `${base}/api/cctv/recordings/${encodeURIComponent(recordingId)}/file`;
  let token: string | null = null;
  try {
    const saved = localStorage.getItem('waqas_pos_session_v1');
    if (saved) token = JSON.parse(saved)?.token || null;
  } catch {}
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (shopId) headers['x-shop-id'] = shopId;

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    let errMsg = `Could not load recording (HTTP ${res.status})`;
    try {
      const json = await res.json();
      if (json?.message) errMsg = json.message;
    } catch {}
    throw new Error(errMsg);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
