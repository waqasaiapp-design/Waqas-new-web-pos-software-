import React, { useEffect, useState } from 'react';
import {
  Lock,
  Fingerprint,
  ShieldCheck,
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  CheckCircle2,
  AlertCircle,
  Clock,
  LogOut,
  RotateCcw,
} from 'lucide-react';
import {
  AppLockPublicConfig,
  AppLockTimeoutOption,
  AppLockUnlockMethod,
  DEFAULT_APP_LOCK_PUBLIC_CONFIG,
} from '../types/pos';
import {
  BiometricCapability,
  detectBiometricCapability,
  fetchAppLockStatus,
  formatTimeoutLabel,
  registerPlatformBiometric,
  removePlatformBiometric,
  saveAppLockPassword,
  saveAppLockPin,
  updateAppLockSettings,
} from '../utils/appLockClient';

interface AppLockSettingsPanelProps {
  shopId?: string;
  canConfigure?: boolean;
  config?: AppLockPublicConfig;
  onConfigChange?: (next: AppLockPublicConfig) => void;
  onLockNow?: () => void;
}

const TIMEOUT_OPTIONS: AppLockTimeoutOption[] = ['immediate', '30s', '1m', '5m', '10m', '15m'];

export const AppLockSettingsPanel: React.FC<AppLockSettingsPanelProps> = ({
  shopId,
  canConfigure = true,
  config: externalConfig,
  onConfigChange,
  onLockNow,
}) => {
  const [config, setConfig] = useState<AppLockPublicConfig>(externalConfig || DEFAULT_APP_LOCK_PUBLIC_CONFIG);
  const [loading, setLoading] = useState(false);
  const [serverCanConfigure, setServerCanConfigure] = useState(canConfigure);
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // PIN form state
  const [pinPreset, setPinPreset] = useState<'4' | '6' | 'custom'>('4');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  // App Lock Password form state
  const [currentAppPwd, setCurrentAppPwd] = useState('');
  const [newAppPwd, setNewAppPwd] = useState('');
  const [confirmAppPwd, setConfirmAppPwd] = useState('');
  const [showNewAppPwd, setShowNewAppPwd] = useState(false);
  const [showCurrAppPwd, setShowCurrAppPwd] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);

  // Biometric registration label
  const [deviceLabelInput, setDeviceLabelInput] = useState('');
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    if (externalConfig) {
      setConfig(externalConfig);
    }
  }, [externalConfig]);

  useEffect(() => {
    detectBiometricCapability().then(setCapability).catch(() => {});
    setLoading(true);
    fetchAppLockStatus(shopId)
      .then((res) => {
        setConfig(res.config);
        setServerCanConfigure(res.canConfigure);
        onConfigChange?.(res.config);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [shopId]);

  const applyUpdatedConfig = (next: AppLockPublicConfig, msg?: string) => {
    setConfig(next);
    onConfigChange?.(next);
    if (msg) {
      setFeedback({ type: 'success', text: msg });
    }
  };

  const allowEdit = canConfigure && serverCanConfigure;

  const handleToggleSetting = async (
    patch: Partial<{
      enabled: boolean;
      autoLockTimeout: AppLockTimeoutOption;
      defaultUnlockMethod: AppLockUnlockMethod;
      requireAuthOnExit: boolean;
      requireAuthOnReopen: boolean;
      resetFailedAttempts: boolean;
    }>,
    successText?: string
  ) => {
    if (!allowEdit) return;
    setFeedback(null);
    try {
      const next = await updateAppLockSettings(patch, shopId);
      applyUpdatedConfig(next, successText);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Unable to update App Lock policy.' });
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowEdit) return;
    setFeedback(null);
    const cleaned = newPin.trim();
    const cleanedConfirm = confirmPin.trim();
    if (pinPreset === '4' && cleaned.length !== 4) {
      setFeedback({ type: 'error', text: 'Please enter an exact 4-digit PIN (or choose 6-digit / Custom).' });
      return;
    }
    if (pinPreset === '6' && cleaned.length !== 6) {
      setFeedback({ type: 'error', text: 'Please enter an exact 6-digit PIN (or choose 4-digit / Custom).' });
      return;
    }
    if (!/^\d{4,12}$/.test(cleaned)) {
      setFeedback({ type: 'error', text: 'PIN must be 4 to 12 digits.' });
      return;
    }
    if (cleaned !== cleanedConfirm) {
      setFeedback({ type: 'error', text: 'PIN and Confirm PIN do not match.' });
      return;
    }

    setPinBusy(true);
    try {
      const res = await saveAppLockPin({
        currentPin: config.hasPin ? currentPin : undefined,
        pin: cleaned,
        confirmPin: cleanedConfirm,
        shopId,
      });
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      applyUpdatedConfig(res.config, res.message);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Unable to save PIN.' });
    } finally {
      setPinBusy(false);
    }
  };

  const handleRemovePin = async () => {
    if (!allowEdit || !config.hasPin) return;
    setFeedback(null);
    setPinBusy(true);
    try {
      const res = await saveAppLockPin({
        currentPin,
        remove: true,
        shopId,
      });
      setCurrentPin('');
      applyUpdatedConfig(res.config, res.message);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Enter your Current PIN above before removing it.' });
    } finally {
      setPinBusy(false);
    }
  };

  const handleSaveAppPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowEdit) return;
    setFeedback(null);
    if (newAppPwd.length < 4) {
      setFeedback({ type: 'error', text: 'App Lock Password must be at least 4 characters.' });
      return;
    }
    if (newAppPwd !== confirmAppPwd) {
      setFeedback({ type: 'error', text: 'App Lock Password and confirmation do not match.' });
      return;
    }
    setPwdBusy(true);
    try {
      const res = await saveAppLockPassword({
        currentPassword: config.hasPassword ? currentAppPwd : undefined,
        password: newAppPwd,
        confirmPassword: confirmAppPwd,
        shopId,
      });
      setCurrentAppPwd('');
      setNewAppPwd('');
      setConfirmAppPwd('');
      applyUpdatedConfig(res.config, res.message);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Unable to save App Lock Password.' });
    } finally {
      setPwdBusy(false);
    }
  };

  const handleRemoveAppPassword = async () => {
    if (!allowEdit || !config.hasPassword) return;
    setFeedback(null);
    setPwdBusy(true);
    try {
      const res = await saveAppLockPassword({
        currentPassword: currentAppPwd,
        remove: true,
        shopId,
      });
      setCurrentAppPwd('');
      applyUpdatedConfig(res.config, res.message);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Enter your Current App Lock Password before removing.' });
    } finally {
      setPwdBusy(false);
    }
  };

  const handleRegisterBiometric = async () => {
    if (!allowEdit) return;
    setFeedback(null);
    setBioBusy(true);
    try {
      const res = await registerPlatformBiometric({
        deviceLabel: deviceLabelInput.trim() || capability?.label || 'Fingerprint / Biometric',
        authenticatorType: capability?.label || 'Platform Biometric Sensor',
        shopId,
      });
      setDeviceLabelInput('');
      applyUpdatedConfig(res.config, res.message);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Biometric registration failed.' });
    } finally {
      setBioBusy(false);
    }
  };

  const handleRemoveBiometric = async (credId: string) => {
    if (!allowEdit) return;
    setFeedback(null);
    try {
      const next = await removePlatformBiometric(credId, shopId);
      applyUpdatedConfig(next, 'Biometric authenticator removed.');
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Failed to remove biometric authenticator.' });
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
            <Lock className="w-4 h-4 text-emerald-700" />
            <span>App Lock, Biometric &amp; Exit Security</span>
          </div>
          <p className="text-xs text-slate-500">
            Protect POS screens on reopen, idle timeout, and application exit using Fingerprint, PIN, or Password.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onLockNow && config.enabled && (
            <button
              type="button"
              onClick={onLockNow}
              data-testid="security-lock-now-btn"
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock App Now</span>
            </button>
          )}

          <button
            type="button"
            disabled={!allowEdit || loading}
            onClick={() =>
              handleToggleSetting(
                { enabled: !config.enabled },
                !config.enabled ? 'App Lock enabled.' : 'App Lock disabled.'
              )
            }
            data-testid="applock-enable-toggle"
            className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-black flex items-center gap-2 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50 ${
              config.enabled
                ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{config.enabled ? 'App Lock: ENABLED' : 'App Lock: DISABLED'}</span>
          </button>
        </div>
      </div>

      {!allowEdit && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium">
          Only an authorized Mart Owner or Super Admin can modify App Lock credentials, biometric devices, and exit policies.
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Policy Settings Row: Default Method, Timeout, Exit & Reopen Switches */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
          <label className="font-bold text-slate-700 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
            <span>Default Unlock Method</span>
          </label>
          <select
            disabled={!allowEdit}
            value={config.defaultUnlockMethod}
            onChange={(e) =>
              handleToggleSetting(
                { defaultUnlockMethod: e.target.value as AppLockUnlockMethod },
                'Default unlock method updated.'
              )
            }
            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold text-slate-900 focus:outline-none focus:border-emerald-700"
          >
            <option value="pin">PIN Code</option>
            <option value="fingerprint">Fingerprint / Biometric</option>
            <option value="password">App Lock Password</option>
          </select>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
          <label className="font-bold text-slate-700 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-700" />
            <span>Auto-Lock Timeout</span>
          </label>
          <select
            disabled={!allowEdit}
            value={config.autoLockTimeout}
            onChange={(e) =>
              handleToggleSetting(
                { autoLockTimeout: e.target.value as AppLockTimeoutOption },
                `Auto-Lock timeout set to ${formatTimeoutLabel(e.target.value as AppLockTimeoutOption)}.`
              )
            }
            data-testid="applock-timeout-select"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold text-slate-900 focus:outline-none focus:border-emerald-700"
          >
            {TIMEOUT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {formatTimeoutLabel(opt)}
              </option>
            ))}
          </select>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-2">
          <div>
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <LogOut className="w-3.5 h-3.5 text-red-600" />
              <span>Require Auth on Exit</span>
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">Verify PIN/Biometric before exiting app</p>
          </div>
          <button
            type="button"
            disabled={!allowEdit}
            onClick={() =>
              handleToggleSetting(
                { requireAuthOnExit: !config.requireAuthOnExit },
                `Exit authentication ${!config.requireAuthOnExit ? 'enabled' : 'disabled'}.`
              )
            }
            data-testid="applock-exit-toggle"
            className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
              config.requireAuthOnExit
                ? 'bg-emerald-700 text-white'
                : 'bg-white border border-slate-300 text-slate-700'
            }`}
          >
            {config.requireAuthOnExit ? 'ON (Protected Exit)' : 'OFF'}
          </button>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-2">
          <div>
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
              <span>Require Auth on Reopen</span>
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">Always start locked on fresh launch</p>
          </div>
          <button
            type="button"
            disabled={!allowEdit}
            onClick={() =>
              handleToggleSetting(
                { requireAuthOnReopen: !config.requireAuthOnReopen },
                `Reopen authentication ${!config.requireAuthOnReopen ? 'enabled' : 'disabled'}.`
              )
            }
            data-testid="applock-reopen-toggle"
            className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
              config.requireAuthOnReopen
                ? 'bg-emerald-700 text-white'
                : 'bg-white border border-slate-300 text-slate-700'
            }`}
          >
            {config.requireAuthOnReopen ? 'ON (Lock on Launch)' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Credentials Configuration: Fingerprint, PIN, App Lock Password */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 1. Fingerprint / Biometric Card */}
        <div className="rounded-xl border border-slate-200 p-4 space-y-3 flex flex-col justify-between">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                <Fingerprint className="w-4 h-4 text-emerald-700" />
                <span>Fingerprint / Biometric</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums font-semibold text-slate-600">
                {config.webauthnCredentials.length} device(s)
              </span>
            </div>

            <p className="text-[11px] text-slate-600 leading-relaxed">
              Status:{' '}
              <strong className={capability?.platformAvailable ? 'text-emerald-700' : 'text-amber-700'}>
                {capability?.label || 'Checking sensor...'}
              </strong>
              {capability?.reason ? ` — ${capability.reason}` : ''}
            </p>

            {config.webauthnCredentials.length > 0 && (
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {config.webauthnCredentials.map((cred) => (
                  <div
                    key={cred.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 truncate">{cred.deviceLabel}</div>
                      <div className="text-slate-500 truncate">{cred.authenticatorType}</div>
                    </div>
                    {allowEdit && (
                      <button
                        type="button"
                        onClick={() => handleRemoveBiometric(cred.id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer shrink-0"
                        title="Remove registered biometric"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {allowEdit && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <input
                type="text"
                value={deviceLabelInput}
                onChange={(e) => setDeviceLabelInput(e.target.value)}
                placeholder="Label (e.g. Owner Phone Fingerprint)"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-emerald-700"
              />
              <button
                type="button"
                disabled={bioBusy || capability?.platformAvailable === false}
                onClick={handleRegisterBiometric}
                data-testid="applock-register-biometric-btn"
                className="w-full min-h-[38px] px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{bioBusy ? 'Follow Device Prompt...' : 'Register Fingerprint / Biometric'}</span>
              </button>
            </div>
          )}
        </div>

        {/* 2. Security PIN Card */}
        <form onSubmit={handleSavePin} className="rounded-xl border border-slate-200 p-4 space-y-3 flex flex-col justify-between">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                <ShieldCheck className="w-4 h-4 text-blue-700" />
                <span>Security PIN Code</span>
              </div>
              <span className={`text-[11px] font-semibold ${config.hasPin ? 'text-emerald-700' : 'text-slate-500'}`}>
                {config.hasPin ? `${config.pinLength}-Digit Active` : 'Not Set'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              {(
                [
                  { id: '4', label: '4 Digits' },
                  { id: '6', label: '6 Digits' },
                  { id: 'custom', label: 'Custom (4–12)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={!allowEdit}
                  onClick={() => setPinPreset(opt.id)}
                  className={`py-1.5 px-2 rounded-lg font-semibold border cursor-pointer ${
                    pinPreset === opt.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {config.hasPin && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Current PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={12}
                  disabled={!allowEdit}
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter current PIN"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:outline-none focus:border-emerald-700"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">New PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={pinPreset === '4' ? 4 : pinPreset === '6' ? 6 : 12}
                  disabled={!allowEdit}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                  data-testid="applock-new-pin-input"
                  placeholder={pinPreset === '4' ? '4 digits' : pinPreset === '6' ? '6 digits' : '4-12 digits'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:outline-none focus:border-emerald-700"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Confirm PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={pinPreset === '4' ? 4 : pinPreset === '6' ? 6 : 12}
                  disabled={!allowEdit}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  data-testid="applock-confirm-pin-input"
                  placeholder="Repeat PIN"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-xs focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>
          </div>

          {allowEdit && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <button
                type="submit"
                disabled={pinBusy}
                data-testid="applock-save-pin-btn"
                className="flex-1 min-h-[38px] px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {pinBusy ? 'Saving...' : config.hasPin ? 'Update PIN' : 'Save PIN'}
              </button>
              {config.hasPin && (
                <button
                  type="button"
                  disabled={pinBusy}
                  onClick={handleRemovePin}
                  className="min-h-[38px] px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold cursor-pointer"
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </form>

        {/* 3. App Lock Password Card */}
        <form onSubmit={handleSaveAppPassword} className="rounded-xl border border-slate-200 p-4 space-y-3 flex flex-col justify-between">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                <KeyRound className="w-4 h-4 text-amber-700" />
                <span>App Lock Password</span>
              </div>
              <span className={`text-[11px] font-semibold ${config.hasPassword ? 'text-emerald-700' : 'text-slate-500'}`}>
                {config.hasPassword ? 'Configured' : 'Not Set'}
              </span>
            </div>

            {config.hasPassword && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Current Lock Password</label>
                <div className="relative">
                  <input
                    type={showCurrAppPwd ? 'text' : 'password'}
                    disabled={!allowEdit}
                    value={currentAppPwd}
                    onChange={(e) => setCurrentAppPwd(e.target.value)}
                    placeholder="Current lock password"
                    className="w-full px-3 py-2 pr-9 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-emerald-700"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrAppPwd((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showCurrAppPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">New Lock Password</label>
              <div className="relative">
                <input
                  type={showNewAppPwd ? 'text' : 'password'}
                  disabled={!allowEdit}
                  value={newAppPwd}
                  onChange={(e) => setNewAppPwd(e.target.value)}
                  data-testid="applock-new-password-input"
                  placeholder="Min 4 characters"
                  className="w-full px-3 py-2 pr-9 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-emerald-700"
                />
                <button
                  type="button"
                  onClick={() => setShowNewAppPwd((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showNewAppPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Confirm Lock Password</label>
              <input
                type={showNewAppPwd ? 'text' : 'password'}
                disabled={!allowEdit}
                value={confirmAppPwd}
                onChange={(e) => setConfirmAppPwd(e.target.value)}
                data-testid="applock-confirm-password-input"
                placeholder="Repeat password"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-emerald-700"
              />
            </div>
          </div>

          {allowEdit && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <button
                type="submit"
                disabled={pwdBusy}
                data-testid="applock-save-password-btn"
                className="flex-1 min-h-[38px] px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {pwdBusy ? 'Saving...' : config.hasPassword ? 'Update Password' : 'Save Password'}
              </button>
              {config.hasPassword && (
                <button
                  type="button"
                  disabled={pwdBusy}
                  onClick={handleRemoveAppPassword}
                  className="min-h-[38px] px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold cursor-pointer"
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </form>
      </div>

      {/* Failed Attempts Monitor & Recovery Note */}
      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
        <div className="flex items-center gap-3">
          <span>
            Failed Unlock / Exit Attempts:{' '}
            <strong className="font-mono tabular-nums text-slate-900">{config.failedAttempts || 0}</strong>
          </span>
          {config.lastFailedAt && (
            <span className="text-[11px] text-slate-500 font-mono">
              Last failed: {new Date(config.lastFailedAt).toLocaleString('en-PK')}
            </span>
          )}
        </div>

        {allowEdit && config.failedAttempts > 0 && (
          <button
            type="button"
            onClick={() => handleToggleSetting({ resetFailedAttempts: true }, 'Failed attempt counter cleared.')}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Clear Failed Count
          </button>
        )}
      </div>
    </div>
  );
};
