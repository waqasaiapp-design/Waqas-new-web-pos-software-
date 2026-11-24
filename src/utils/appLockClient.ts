import {
  AppLockPublicConfig,
  AppLockTimeoutOption,
  AppLockUnlockMethod,
  DEFAULT_APP_LOCK_PUBLIC_CONFIG,
} from '../types/pos';
import { safeFetchJson } from './apiClient';
import { safeStorageGetJson, safeStorageSetJson } from './safeStorage';

const APP_LOCK_CACHE_PREFIX = 'waqas_pos_applock_cfg_v1_';

export interface BiometricCapability {
  supported: boolean;
  platformAvailable: boolean;
  label: string;
  reason?: string;
}

export function getCachedAppLockConfig(shopId: string): AppLockPublicConfig | null {
  if (!shopId) return null;
  const cached = safeStorageGetJson<AppLockPublicConfig | null>(
    `${APP_LOCK_CACHE_PREFIX}${shopId}`,
    null
  );
  return cached && typeof cached === 'object' ? { ...DEFAULT_APP_LOCK_PUBLIC_CONFIG, ...cached } : null;
}

export function cacheAppLockConfig(shopId: string, config: AppLockPublicConfig): void {
  if (!shopId) return;
  safeStorageSetJson(`${APP_LOCK_CACHE_PREFIX}${shopId}`, config);
}

export function getTimeoutDurationMs(timeout: AppLockTimeoutOption): number {
  switch (timeout) {
    case 'immediate':
      return 0;
    case '30s':
      return 30 * 1000;
    case '1m':
      return 60 * 1000;
    case '5m':
      return 5 * 60 * 1000;
    case '10m':
      return 10 * 60 * 1000;
    case '15m':
      return 15 * 60 * 1000;
    default:
      return 60 * 1000;
  }
}

export function formatTimeoutLabel(timeout: AppLockTimeoutOption): string {
  switch (timeout) {
    case 'immediate':
      return 'Lock Immediately';
    case '30s':
      return '30 Seconds';
    case '1m':
      return '1 Minute';
    case '5m':
      return '5 Minutes';
    case '10m':
      return '10 Minutes';
    case '15m':
      return '15 Minutes';
    default:
      return '1 Minute';
  }
}

export function arrayBufferToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const norm = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (norm.length % 4)) % 4;
  const binary = atob(norm + '='.repeat(padLen));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function detectBiometricCapability(): Promise<BiometricCapability> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return {
      supported: false,
      platformAvailable: false,
      label: 'Unavailable on this browser',
      reason: 'WebAuthn biometric API is not supported by this browser/WebView.',
    };
  }

  if (!window.isSecureContext) {
    return {
      supported: true,
      platformAvailable: false,
      label: 'Requires HTTPS',
      reason: 'Biometric authentication requires HTTPS or localhost.',
    };
  }

  try {
    const fn = window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    const available = typeof fn === 'function' ? await fn.call(window.PublicKeyCredential) : false;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isAndroid = /Android/i.test(ua);
    const isApple = /iPhone|iPad|Macintosh/i.test(ua);
    const isWindows = /Windows/i.test(ua);

    const label = available
      ? isAndroid
        ? 'Android Fingerprint / Biometric Sensor'
        : isApple
        ? 'Touch ID / Face ID'
        : isWindows
        ? 'Windows Hello / Fingerprint'
        : 'Device Biometric / Fingerprint'
      : 'No Device Biometric Sensor Detected';

    return {
      supported: true,
      platformAvailable: Boolean(available),
      label,
      reason: available
        ? undefined
        : 'No platform fingerprint/biometric lock is active on this device. Use PIN or Password.',
    };
  } catch {
    return {
      supported: true,
      platformAvailable: false,
      label: 'Biometric Check Unavailable',
      reason: 'Unable to query platform biometric sensor. PIN and Password remain available.',
    };
  }
}

export async function fetchAppLockStatus(shopId?: string): Promise<{
  config: AppLockPublicConfig;
  canConfigure: boolean;
}> {
  const qs = shopId ? `?shopId=${encodeURIComponent(shopId)}` : '';
  const res = await safeFetchJson<{
    success: boolean;
    shopId: string;
    canConfigure: boolean;
    config: AppLockPublicConfig;
  }>(`/api/app-lock/status${qs}`);
  if (res.ok && res.data?.success && res.data.config) {
    if (res.data.shopId) cacheAppLockConfig(res.data.shopId, res.data.config);
    return { config: res.data.config, canConfigure: Boolean(res.data.canConfigure) };
  }
  throw new Error('Could not load App Lock configuration.');
}

export async function updateAppLockSettings(
  payload: Partial<{
    enabled: boolean;
    autoLockTimeout: AppLockTimeoutOption;
    defaultUnlockMethod: AppLockUnlockMethod;
    requireAuthOnExit: boolean;
    requireAuthOnReopen: boolean;
    resetFailedAttempts: boolean;
  }>,
  shopId?: string
): Promise<AppLockPublicConfig> {
  const res = await safeFetchJson<{ success: boolean; config: AppLockPublicConfig; message?: string }>(
    '/api/app-lock/settings',
    {
      method: 'POST',
      body: JSON.stringify({ ...payload, shopId }),
    }
  );
  if (!res.ok || !res.data?.success) {
    throw new Error(res.data?.message || 'Unable to save App Lock settings.');
  }
  if (shopId) cacheAppLockConfig(shopId, res.data.config);
  return res.data.config;
}

export async function saveAppLockPin(params: {
  currentPin?: string;
  pin?: string;
  confirmPin?: string;
  remove?: boolean;
  shopId?: string;
}): Promise<{ config: AppLockPublicConfig; message: string }> {
  const res = await safeFetchJson<{
    success: boolean;
    config: AppLockPublicConfig;
    message?: string;
  }>('/api/app-lock/pin', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!res.ok || !res.data?.success) {
    throw new Error(res.data?.message || 'Unable to update App Lock PIN.');
  }
  if (params.shopId) cacheAppLockConfig(params.shopId, res.data.config);
  return { config: res.data.config, message: res.data.message || 'PIN updated.' };
}

export async function saveAppLockPassword(params: {
  currentPassword?: string;
  password?: string;
  confirmPassword?: string;
  remove?: boolean;
  shopId?: string;
}): Promise<{ config: AppLockPublicConfig; message: string }> {
  const res = await safeFetchJson<{
    success: boolean;
    config: AppLockPublicConfig;
    message?: string;
  }>('/api/app-lock/password', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!res.ok || !res.data?.success) {
    throw new Error(res.data?.message || 'Unable to update App Lock Password.');
  }
  if (params.shopId) cacheAppLockConfig(params.shopId, res.data.config);
  return { config: res.data.config, message: res.data.message || 'Password updated.' };
}

export async function verifyAppLockSecret(params: {
  method: 'pin' | 'password';
  secret: string;
  context: 'unlock' | 'exit';
  shopId?: string;
}): Promise<{ ok: boolean; config?: AppLockPublicConfig; message?: string }> {
  try {
    const res = await safeFetchJson<{
      success: boolean;
      config?: AppLockPublicConfig;
      message?: string;
    }>('/api/app-lock/verify', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (res.data?.config && params.shopId) {
      cacheAppLockConfig(params.shopId, res.data.config);
    }
    return {
      ok: Boolean(res.ok && res.data?.success),
      config: res.data?.config,
      message: res.data?.message,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Incorrect authentication credentials.',
    };
  }
}

export async function recoverAppLockWithAccountPassword(params: {
  accountPassword: string;
  newPin?: string;
  confirmNewPin?: string;
  disableAppLock?: boolean;
  shopId?: string;
}): Promise<{ config: AppLockPublicConfig; message: string }> {
  const res = await safeFetchJson<{
    success: boolean;
    config: AppLockPublicConfig;
    message?: string;
  }>('/api/app-lock/recover', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!res.ok || !res.data?.success) {
    throw new Error(res.data?.message || 'Recovery verification failed.');
  }
  if (params.shopId) cacheAppLockConfig(params.shopId, res.data.config);
  return { config: res.data.config, message: res.data.message || 'Recovered cleanly.' };
}

export async function registerPlatformBiometric(params: {
  deviceLabel?: string;
  authenticatorType?: string;
  shopId?: string;
}): Promise<{ config: AppLockPublicConfig; message: string }> {
  const cap = await detectBiometricCapability();
  if (!cap.supported || !cap.platformAvailable) {
    throw new Error(cap.reason || 'Biometric authenticator is not available on this device.');
  }

  const optRes = await safeFetchJson<{
    success: boolean;
    challengeId: string;
    options: {
      challenge: string;
      rp: { name: string; id: string };
      user: { id: string; name: string; displayName: string };
      pubKeyCredParams: PublicKeyCredentialParameters[];
      timeout: number;
      attestation?: AttestationConveyancePreference;
      authenticatorSelection?: AuthenticatorSelectionCriteria;
      excludeCredentials?: Array<{ id: string; type: 'public-key'; transports?: AuthenticatorTransport[] }>;
    };
    message?: string;
  }>('/api/app-lock/webauthn/register-options', {
    method: 'POST',
    body: JSON.stringify({ shopId: params.shopId }),
  });

  if (!optRes.ok || !optRes.data?.success) {
    throw new Error(optRes.data?.message || 'Failed to prepare biometric registration.');
  }

  const { challengeId, options } = optRes.data;
  const publicKeyOptions: PublicKeyCredentialCreationOptions = {
    challenge: base64UrlToUint8Array(options.challenge) as BufferSource,
    rp: options.rp,
    user: {
      id: base64UrlToUint8Array(options.user.id) as BufferSource,
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout || 60000,
    attestation: options.attestation || 'none',
    authenticatorSelection: options.authenticatorSelection || {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required',
    },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({
      id: base64UrlToUint8Array(c.id) as BufferSource,
      type: 'public-key',
      transports: c.transports,
    })),
  };

  let created: Credential | null = null;
  try {
    created = await navigator.credentials.create({ publicKey: publicKeyOptions });
  } catch (err: any) {
    if (err?.name === 'NotAllowedError') {
      throw new Error('Fingerprint / Biometric prompt was cancelled or timed out.');
    }
    if (err?.name === 'InvalidStateError') {
      throw new Error('This device biometric authenticator is already registered.');
    }
    throw new Error(err?.message || 'Biometric registration failed on this device.');
  }

  if (!created || !(created instanceof PublicKeyCredential)) {
    throw new Error('No biometric credential was created.');
  }

  const attResp = created.response as AuthenticatorAttestationResponse;
  let publicKeySpkiBase64: string | undefined;
  let publicKeyAlgorithm: number | undefined;
  let authenticatorData: string | undefined;
  let transports: string[] | undefined;

  try {
    if (typeof attResp.getPublicKey === 'function') {
      const pk = attResp.getPublicKey();
      if (pk) publicKeySpkiBase64 = uint8ArrayToBase64(new Uint8Array(pk));
    }
    if (typeof attResp.getPublicKeyAlgorithm === 'function') {
      publicKeyAlgorithm = attResp.getPublicKeyAlgorithm();
    }
    if (typeof attResp.getAuthenticatorData === 'function') {
      const ad = attResp.getAuthenticatorData();
      if (ad) authenticatorData = arrayBufferToBase64Url(ad);
    }
    if (typeof attResp.getTransports === 'function') {
      transports = attResp.getTransports();
    }
  } catch {}

  const verifyRes = await safeFetchJson<{
    success: boolean;
    config: AppLockPublicConfig;
    message?: string;
  }>('/api/app-lock/webauthn/register-verify', {
    method: 'POST',
    body: JSON.stringify({
      shopId: params.shopId,
      challengeId,
      deviceLabel: params.deviceLabel || cap.label,
      authenticatorType: params.authenticatorType || cap.label,
      credential: {
        id: created.id,
        rawId: arrayBufferToBase64Url(created.rawId),
        type: created.type,
        response: {
          clientDataJSON: arrayBufferToBase64Url(attResp.clientDataJSON),
          attestationObject: arrayBufferToBase64Url(attResp.attestationObject),
          authenticatorData,
          publicKeySpkiBase64,
          publicKeyAlgorithm,
          transports,
        },
      },
    }),
  });

  if (!verifyRes.ok || !verifyRes.data?.success) {
    throw new Error(verifyRes.data?.message || 'Biometric registration verification failed.');
  }
  if (params.shopId) cacheAppLockConfig(params.shopId, verifyRes.data.config);
  return {
    config: verifyRes.data.config,
    message: verifyRes.data.message || 'Biometric registered.',
  };
}

export async function removePlatformBiometric(
  credId: string,
  shopId?: string
): Promise<AppLockPublicConfig> {
  const qs = shopId ? `?shopId=${encodeURIComponent(shopId)}` : '';
  const res = await safeFetchJson<{ success: boolean; config: AppLockPublicConfig; message?: string }>(
    `/api/app-lock/webauthn/${encodeURIComponent(credId)}${qs}`,
    { method: 'DELETE' }
  );
  if (!res.ok || !res.data?.success) {
    throw new Error(res.data?.message || 'Could not remove biometric authenticator.');
  }
  if (shopId) cacheAppLockConfig(shopId, res.data.config);
  return res.data.config;
}

export async function authenticateWithBiometric(params: {
  context: 'unlock' | 'exit';
  shopId?: string;
}): Promise<{ ok: boolean; config?: AppLockPublicConfig; message?: string }> {
  const cap = await detectBiometricCapability();
  if (!cap.supported || !cap.platformAvailable) {
    return { ok: false, message: cap.reason || 'Biometric sensor unavailable on this device.' };
  }

  try {
    const optRes = await safeFetchJson<{
      success: boolean;
      challengeId: string;
      options: {
        challenge: string;
        rpId: string;
        timeout: number;
        userVerification: UserVerificationRequirement;
        allowCredentials: Array<{ id: string; type: 'public-key'; transports?: AuthenticatorTransport[] }>;
      };
      message?: string;
    }>('/api/app-lock/webauthn/auth-options', {
      method: 'POST',
      body: JSON.stringify({ shopId: params.shopId }),
    });

    if (!optRes.ok || !optRes.data?.success) {
      return { ok: false, message: optRes.data?.message || 'No registered biometric device found.' };
    }

    const { challengeId, options } = optRes.data;
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: base64UrlToUint8Array(options.challenge) as BufferSource,
        rpId: options.rpId,
        timeout: options.timeout || 60000,
        userVerification: 'required',
        allowCredentials: (options.allowCredentials || []).map((c) => ({
          id: base64UrlToUint8Array(c.id) as BufferSource,
          type: 'public-key',
          transports: c.transports,
        })),
      },
    });

    if (!assertion || !(assertion instanceof PublicKeyCredential)) {
      return { ok: false, message: 'Biometric authentication cancelled.' };
    }

    const resp = assertion.response as AuthenticatorAssertionResponse;
    const verifyRes = await safeFetchJson<{
      success: boolean;
      config?: AppLockPublicConfig;
      message?: string;
    }>('/api/app-lock/webauthn/auth-verify', {
      method: 'POST',
      body: JSON.stringify({
        shopId: params.shopId,
        context: params.context,
        challengeId,
        credential: {
          id: assertion.id,
          rawId: arrayBufferToBase64Url(assertion.rawId),
          type: assertion.type,
          response: {
            clientDataJSON: arrayBufferToBase64Url(resp.clientDataJSON),
            authenticatorData: arrayBufferToBase64Url(resp.authenticatorData),
            signature: arrayBufferToBase64Url(resp.signature),
            userHandle: resp.userHandle ? arrayBufferToBase64Url(resp.userHandle) : null,
          },
        },
      }),
    });

    if (verifyRes.data?.config && params.shopId) {
      cacheAppLockConfig(params.shopId, verifyRes.data.config);
    }

    return {
      ok: Boolean(verifyRes.ok && verifyRes.data?.success),
      config: verifyRes.data?.config,
      message: verifyRes.data?.message,
    };
  } catch (err: any) {
    if (err?.name === 'NotAllowedError') {
      return { ok: false, message: 'Fingerprint prompt cancelled or failed. Try again or use PIN/Password.' };
    }
    return { ok: false, message: err?.message || 'Fingerprint verification failed.' };
  }
}
