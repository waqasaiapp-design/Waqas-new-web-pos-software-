import { AuthSession, AuthUser, BootstrapAuthStatus, ShopAccount } from '../types/pos';
import { AUTH_POLICY_VERSION } from '../version';
import { getApiBaseUrl, safeFetchJson } from './apiClient';

export const AUTH_STORAGE_KEY = 'waqas_pos_session_v1';
export const AUTH_POLICY_STORAGE_KEY = 'waqas_pos_auth_policy_version';
export const PWA_AUTH_POLICY_KEY = 'waqas_pos_pwa_authed_policy';

const LEGACY_LOCK_KEYS = [
  'waqas_mart_auth_session',
  'waqas_mart_device_unlock_v1',
  'waqas_mart_app_pin_hash_v6',
  'waqas_mart_security_config_v6',
  'waqas_mart_session_token',
  'waqas_mart_master_pin_v1',
];

export function isStandalonePwaContext(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const mediaStandalone =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    const iosStandalone = (window.navigator as unknown as { standalone?: boolean })?.standalone === true;
    const pwaQueryParam = String(window.location?.search || '').includes('source=pwa');
    return Boolean(mediaStandalone || iosStandalone || pwaQueryParam);
  } catch {
    return false;
  }
}

export function isStandalonePwaAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  if (!isStandalonePwaContext()) return true;
  try {
    return localStorage.getItem(PWA_AUTH_POLICY_KEY) === AUTH_POLICY_VERSION;
  } catch {
    return false;
  }
}

export function markStandalonePwaAuthenticated(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTH_POLICY_STORAGE_KEY, AUTH_POLICY_VERSION);
    if (isStandalonePwaContext()) {
      localStorage.setItem(PWA_AUTH_POLICY_KEY, AUTH_POLICY_VERSION);
    }
  } catch {}
}

export function clearStandalonePwaAuthenticated(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PWA_AUTH_POLICY_KEY);
  } catch {}
}

export function purgeLegacyLockKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of LEGACY_LOCK_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {}
}

/**
 * Forces login on newly installed/downloaded builds, policy upgrades from older app versions,
 * or freshly installed standalone PWAs sharing browser storage, without touching business data.
 * Returns true if stale/pre-policy credentials were invalidated.
 */
export function enforceAuthPolicyMigration(): boolean {
  if (typeof window === 'undefined') return false;
  purgeLegacyLockKeys();
  try {
    const savedPolicy = localStorage.getItem(AUTH_POLICY_STORAGE_KEY);
    const rawSession = localStorage.getItem(AUTH_STORAGE_KEY);
    let hasStaleSession = false;
    if (rawSession) {
      try {
        const parsed = JSON.parse(rawSession);
        if (!parsed?.token || !parsed?.user?.role || parsed?.policyVersion !== AUTH_POLICY_VERSION) {
          hasStaleSession = true;
        }
      } catch {
        hasStaleSession = true;
      }
    }

    const standaloneNeedsLogin =
      isStandalonePwaContext() && localStorage.getItem(PWA_AUTH_POLICY_KEY) !== AUTH_POLICY_VERSION;

    if (savedPolicy !== AUTH_POLICY_VERSION || hasStaleSession || standaloneNeedsLogin) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      if (standaloneNeedsLogin) {
        localStorage.removeItem(PWA_AUTH_POLICY_KEY);
      }
      localStorage.setItem(AUTH_POLICY_STORAGE_KEY, AUTH_POLICY_VERSION);
      return true;
    }
  } catch {}
  return false;
}

export function getStoredAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    if (localStorage.getItem(AUTH_POLICY_STORAGE_KEY) !== AUTH_POLICY_VERSION) {
      return null;
    }
    if (!isStandalonePwaAuthenticated()) {
      return null;
    }
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.token &&
      parsed.user?.role &&
      parsed.policyVersion === AUTH_POLICY_VERSION
    ) {
      return parsed as AuthSession;
    }
  } catch {}
  return null;
}

export function getStoredToken(): string | null {
  return getStoredAuthSession()?.token || null;
}

export function saveAuthSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  purgeLegacyLockKeys();
  try {
    const stamped: AuthSession = {
      ...session,
      policyVersion: AUTH_POLICY_VERSION,
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stamped));
    markStandalonePwaAuthenticated();
  } catch {}
}

export function clearStoredAuthSession(): void {
  if (typeof window === 'undefined') return;
  purgeLegacyLockKeys();
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(PWA_AUTH_POLICY_KEY);
    localStorage.setItem(AUTH_POLICY_STORAGE_KEY, AUTH_POLICY_VERSION);
  } catch {}
}

export async function getBootstrapStatus(): Promise<BootstrapAuthStatus> {
  const res = await safeFetchJson<{
    success: boolean;
    superAdminConfigured: boolean;
    superAdminSetupLocked?: boolean;
    registrationDisabled?: boolean;
    googleOAuthEnabled?: boolean;
  }>('/api/auth/bootstrap-status');
  return {
    superAdminConfigured: Boolean(res.data?.superAdminConfigured),
    superAdminSetupLocked: Boolean(res.data?.superAdminSetupLocked),
    registrationDisabled: Boolean(res.data?.registrationDisabled ?? true),
    googleOAuthEnabled: Boolean(res.data?.googleOAuthEnabled ?? false),
  };
}

export async function loginSuperAdmin(payload: {
  gmail: string;
  password: string;
}): Promise<AuthSession> {
  const res = await safeFetchJson<{
    success: boolean;
    token: string;
    expiresAt?: string;
    policyVersion?: string;
    user: AuthUser;
  }>('/api/auth/super-admin/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const session: AuthSession = {
    token: res.data.token,
    user: res.data.user,
    expiresAt: res.data.expiresAt,
    policyVersion: res.data.policyVersion || AUTH_POLICY_VERSION,
  };
  saveAuthSession(session);
  return session;
}

export async function loginAccount(payload: {
  portal: 'shop';
  identifier: string;
  password: string;
}): Promise<AuthSession> {
  const res = await safeFetchJson<{
    success: boolean;
    token: string;
    expiresAt?: string;
    policyVersion?: string;
    user: AuthUser;
    shop?: ShopAccount;
  }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const session: AuthSession = {
    token: res.data.token,
    user: res.data.user,
    shop: res.data.shop,
    expiresAt: res.data.expiresAt,
    policyVersion: res.data.policyVersion || AUTH_POLICY_VERSION,
  };
  saveAuthSession(session);
  return session;
}

export async function fetchCurrentSession(): Promise<AuthSession | null> {
  const stored = getStoredAuthSession();
  if (!stored?.token) return null;
  try {
    const res = await safeFetchJson<{
      success: boolean;
      policyVersion?: string;
      user: AuthUser;
      shop?: ShopAccount;
      expiresAt?: string;
    }>('/api/auth/me');
    if (res.ok && res.data?.user) {
      if (res.data.policyVersion !== AUTH_POLICY_VERSION) {
        clearStoredAuthSession();
        return null;
      }
      const updated: AuthSession = {
        token: stored.token,
        user: res.data.user,
        shop: res.data.shop,
        expiresAt: res.data.expiresAt || stored.expiresAt,
        policyVersion: AUTH_POLICY_VERSION,
      };
      saveAuthSession(updated);
      return updated;
    }
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      clearStoredAuthSession();
      throw err;
    }
    return stored;
  }
  return stored;
}

export async function logoutSession(): Promise<void> {
  const token = getStoredToken();
  if (token) {
    try {
      const base = getApiBaseUrl();
      await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-session-token': token,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    } catch {}
  }
  clearStoredAuthSession();
}

export async function changeAccountPassword(currentPassword: string, newPassword: string): Promise<string> {
  const res = await safeFetchJson<{ success: boolean; message: string }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return res.data?.message || 'Password updated successfully.';
}

export async function revokeOtherSuperAdminSessions(): Promise<string> {
  const res = await safeFetchJson<{ success: boolean; message: string }>('/api/super-admin/sessions/revoke-others', {
    method: 'POST',
    body: '{}',
  });
  return res.data?.message || 'Other sessions terminated.';
}
