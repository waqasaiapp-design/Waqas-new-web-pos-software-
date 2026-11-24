import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  Fingerprint,
  KeyRound,
  ShieldCheck,
  Eye,
  EyeOff,
  AlertCircle,
  LogOut,
  X,
} from 'lucide-react';
import { AppLockPublicConfig, AppLockUnlockMethod } from '../types/pos';
import {
  BiometricCapability,
  authenticateWithBiometric,
  detectBiometricCapability,
  verifyAppLockSecret,
} from '../utils/appLockClient';

interface ExitSecurityModalProps {
  isOpen: boolean;
  config: AppLockPublicConfig;
  storeName?: string;
  shopId?: string;
  onConfigUpdated: (next: AppLockPublicConfig) => void;
  onCancel: () => void;
  onConfirmExitSuccess: () => void;
}

export const ExitSecurityModal: React.FC<ExitSecurityModalProps> = ({
  isOpen,
  config,
  storeName = 'WAQAS MART',
  shopId,
  onConfigUpdated,
  onCancel,
  onConfirmExitSuccess,
}) => {
  const hasFingerprint = (config.webauthnCredentials?.length || 0) > 0;
  const hasPin = Boolean(config.hasPin);
  const hasPassword = Boolean(config.hasPassword);

  const pickMethod = (): AppLockUnlockMethod => {
    if (config.defaultUnlockMethod === 'fingerprint' && hasFingerprint) return 'fingerprint';
    if (config.defaultUnlockMethod === 'password' && hasPassword) return 'password';
    if (config.defaultUnlockMethod === 'pin' && hasPin) return 'pin';
    if (hasPin) return 'pin';
    if (hasFingerprint) return 'fingerprint';
    if (hasPassword) return 'password';
    return 'pin';
  };

  const [method, setMethod] = useState<AppLockUnlockMethod>(pickMethod);
  const [pinInput, setPinInput] = useState('');
  const [pwdInput, setPwdInput] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [capability, setCapability] = useState<BiometricCapability | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setMethod(pickMethod());
    setPinInput('');
    setPwdInput('');
    setErrorMsg(null);
    detectBiometricCapability().then(setCapability).catch(() => {});
  }, [isOpen, config.hasPin, config.hasPassword, hasFingerprint]);

  if (!isOpen) return null;

  const handleConfirmExit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (busy) return;
    setErrorMsg(null);

    if (method === 'fingerprint') {
      setBusy(true);
      const res = await authenticateWithBiometric({ context: 'exit', shopId });
      setBusy(false);
      if (res.config) onConfigUpdated(res.config);
      if (res.ok) {
        onConfirmExitSuccess();
      } else {
        setErrorMsg(res.message || 'Fingerprint verification failed. Exit denied.');
      }
      return;
    }

    const secret = method === 'pin' ? pinInput.trim() : pwdInput;
    if (!secret) {
      setErrorMsg(method === 'pin' ? 'Enter your security PIN to confirm exit.' : 'Enter your password to confirm exit.');
      return;
    }

    setBusy(true);
    const res = await verifyAppLockSecret({
      method,
      secret,
      context: 'exit',
      shopId,
    });
    setBusy(false);
    if (res.config) onConfigUpdated(res.config);
    if (res.ok) {
      setPinInput('');
      setPwdInput('');
      onConfirmExitSuccess();
    } else {
      setErrorMsg(res.message || 'Authentication failed. Exit blocked.');
    }
  };

  return (
    <div
      data-testid="exit-security-modal"
      className="fixed inset-0 z-[130] bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden text-slate-900">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-black uppercase tracking-wide truncate">
                Exit Security Verification
              </h2>
              <p className="text-[11px] text-amber-300 truncate">
                {storeName} · Authenticate before exiting
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
            aria-label="Cancel exit"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleConfirmExit} className="p-6 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            Your POS data and active records will be preserved safely and locked. Reopening WAQAS POS SOFTWARE will require authentication again.
          </p>

          {/* Method Tabs */}
          <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              disabled={!hasFingerprint}
              onClick={() => {
                setMethod('fingerprint');
                setErrorMsg(null);
              }}
              className={`min-h-[38px] px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                method === 'fingerprint' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Fingerprint className="w-3.5 h-3.5 shrink-0" />
              <span>Fingerprint</span>
            </button>

            <button
              type="button"
              disabled={!hasPin}
              onClick={() => {
                setMethod('pin');
                setErrorMsg(null);
              }}
              className={`min-h-[38px] px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                method === 'pin' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>PIN</span>
            </button>

            <button
              type="button"
              disabled={!hasPassword}
              onClick={() => {
                setMethod('password');
                setErrorMsg(null);
              }}
              className={`min-h-[38px] px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                method === 'password' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5 shrink-0" />
              <span>Password</span>
            </button>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {method === 'fingerprint' && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-2">
              <Fingerprint className="w-8 h-8 text-emerald-700 mx-auto" />
              <p className="text-xs font-bold text-slate-900">
                {capability?.platformAvailable ? capability.label : 'Biometric Sensor'}
              </p>
              <p className="text-[11px] text-slate-500">
                {capability?.platformAvailable
                  ? 'Press CONFIRM EXIT below to scan your fingerprint and lock the application.'
                  : capability?.reason || 'Biometric sensor unavailable on this device. Use PIN or Password.'}
              </p>
            </div>
          )}

          {method === 'pin' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Security PIN ({config.pinLength || 4} digits)
              </label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={12}
                autoFocus
                value={pinInput}
                onChange={(e) => {
                  setErrorMsg(null);
                  setPinInput(e.target.value.replace(/\D/g, ''));
                }}
                data-testid="exit-pin-input"
                placeholder="Enter security PIN"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-base tracking-[0.35em] text-center focus:outline-none focus:border-slate-900"
              />
            </div>
          )}

          {method === 'password' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                App Lock Password
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  autoFocus
                  value={pwdInput}
                  onChange={(e) => {
                    setErrorMsg(null);
                    setPwdInput(e.target.value);
                  }}
                  data-testid="exit-password-input"
                  placeholder="Enter App Lock password"
                  className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={onCancel}
              data-testid="exit-cancel-btn"
              className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              CANCEL
            </button>

            <button
              type="submit"
              disabled={busy || (method === 'fingerprint' && capability?.platformAvailable === false)}
              data-testid="exit-confirm-btn"
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-45"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{busy ? 'VERIFYING...' : 'CONFIRM EXIT'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
