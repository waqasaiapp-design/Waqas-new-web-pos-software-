import React, { useEffect, useState } from 'react';
import {
  Lock,
  Fingerprint,
  KeyRound,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Delete,
  LogOut,
  RotateCcw,
  Crown,
} from 'lucide-react';
import {
  AppLockPublicConfig,
  AppLockUnlockMethod,
  AuthUser,
} from '../types/pos';
import {
  BiometricCapability,
  authenticateWithBiometric,
  detectBiometricCapability,
  recoverAppLockWithAccountPassword,
  verifyAppLockSecret,
} from '../utils/appLockClient';

interface AppLockScreenProps {
  config: AppLockPublicConfig;
  storeName?: string;
  shopId?: string;
  authUser?: AuthUser | null;
  reasonMessage?: string | null;
  onConfigUpdated: (next: AppLockPublicConfig) => void;
  onUnlocked: (nextConfig?: AppLockPublicConfig) => void;
  onSignOut?: () => void;
}

export const AppLockScreen: React.FC<AppLockScreenProps> = ({
  config,
  storeName = 'WAQAS MART',
  shopId,
  authUser,
  reasonMessage,
  onConfigUpdated,
  onUnlocked,
  onSignOut,
}) => {
  const hasFingerprintCreds = (config.webauthnCredentials?.length || 0) > 0;
  const hasPin = Boolean(config.hasPin);
  const hasPassword = Boolean(config.hasPassword);

  const pickInitialMethod = (): AppLockUnlockMethod => {
    if (config.defaultUnlockMethod === 'fingerprint' && hasFingerprintCreds) return 'fingerprint';
    if (config.defaultUnlockMethod === 'password' && hasPassword) return 'password';
    if (config.defaultUnlockMethod === 'pin' && hasPin) return 'pin';
    if (hasPin) return 'pin';
    if (hasFingerprintCreds) return 'fingerprint';
    if (hasPassword) return 'password';
    return 'pin';
  };

  const [activeMethod, setActiveMethod] = useState<AppLockUnlockMethod>(pickInitialMethod);
  const [pinValue, setPinValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [capability, setCapability] = useState<BiometricCapability | null>(null);

  // Forgot PIN / Password secure recovery state
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryAccountPwd, setRecoveryAccountPwd] = useState('');
  const [showRecoveryAccountPwd, setShowRecoveryAccountPwd] = useState(false);
  const [recoveryNewPin, setRecoveryNewPin] = useState('');
  const [recoveryConfirmPin, setRecoveryConfirmPin] = useState('');
  const [recoveryAction, setRecoveryAction] = useState<'reset_pin' | 'disable'>('reset_pin');
  const [recoveryFeedback, setRecoveryFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    detectBiometricCapability().then(setCapability).catch(() => {});
  }, []);

  useEffect(() => {
    setActiveMethod(pickInitialMethod());
    setPinValue('');
    setPasswordValue('');
    setErrorMsg(null);
  }, [config.hasPin, config.hasPassword, config.defaultUnlockMethod, hasFingerprintCreds]);

  const canRecoverHere = !authUser || authUser.role === 'SHOP_OWNER' || authUser.role === 'SUPER_ADMIN';

  const handlePinVerify = async (secretToCheck?: string) => {
    const pin = (secretToCheck ?? pinValue).trim();
    if (!pin) {
      setErrorMsg('Please enter your App Lock PIN.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    const res = await verifyAppLockSecret({
      method: 'pin',
      secret: pin,
      context: 'unlock',
      shopId,
    });
    setBusy(false);
    if (res.config) onConfigUpdated(res.config);
    if (res.ok) {
      setPinValue('');
      onUnlocked(res.config);
    } else {
      setPinValue('');
      setErrorMsg(res.message || 'Incorrect PIN. Please try again.');
    }
  };

  const handlePasswordVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordValue) {
      setErrorMsg('Please enter your App Lock Password.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    const res = await verifyAppLockSecret({
      method: 'password',
      secret: passwordValue,
      context: 'unlock',
      shopId,
    });
    setBusy(false);
    if (res.config) onConfigUpdated(res.config);
    if (res.ok) {
      setPasswordValue('');
      onUnlocked(res.config);
    } else {
      setErrorMsg(res.message || 'Incorrect Password. Please try again.');
    }
  };

  const handleBiometricVerify = async () => {
    setBusy(true);
    setErrorMsg(null);
    const res = await authenticateWithBiometric({ context: 'unlock', shopId });
    setBusy(false);
    if (res.config) onConfigUpdated(res.config);
    if (res.ok) {
      onUnlocked(res.config);
    } else {
      setErrorMsg(res.message || 'Biometric verification failed. Use PIN or Password.');
    }
  };

  const handleDigitClick = (digit: string) => {
    if (busy) return;
    setErrorMsg(null);
    const maxLen = Math.max(4, config.pinLength || 4);
    if (pinValue.length >= 12) return;
    const next = `${pinValue}${digit}`;
    setPinValue(next);
    if (next.length === maxLen && config.pinLength > 0) {
      handlePinVerify(next);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryFeedback(null);
    if (!recoveryAccountPwd) {
      setRecoveryFeedback({ ok: false, text: 'Enter your Mart Owner or Super Admin login password.' });
      return;
    }
    if (recoveryAction === 'reset_pin') {
      if (!/^\d{4,12}$/.test(recoveryNewPin.trim())) {
        setRecoveryFeedback({ ok: false, text: 'New PIN must be 4 to 12 digits.' });
        return;
      }
      if (recoveryNewPin.trim() !== recoveryConfirmPin.trim()) {
        setRecoveryFeedback({ ok: false, text: 'New PIN and Confirm PIN do not match.' });
        return;
      }
    }

    setBusy(true);
    try {
      const result = await recoverAppLockWithAccountPassword({
        accountPassword: recoveryAccountPwd,
        newPin: recoveryAction === 'reset_pin' ? recoveryNewPin.trim() : undefined,
        confirmNewPin: recoveryAction === 'reset_pin' ? recoveryConfirmPin.trim() : undefined,
        disableAppLock: recoveryAction === 'disable',
        shopId,
      });
      onConfigUpdated(result.config);
      setRecoveryFeedback({ ok: true, text: result.message });
      setRecoveryAccountPwd('');
      setRecoveryNewPin('');
      setRecoveryConfirmPin('');
      setTimeout(() => {
        setShowRecovery(false);
        if (recoveryAction === 'disable') {
          onUnlocked(result.config);
        } else {
          setActiveMethod('pin');
        }
      }, 650);
    } catch (err: any) {
      setRecoveryFeedback({ ok: false, text: err?.message || 'Verification failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="app-lock-screen"
      className="fixed inset-0 z-[120] bg-[#021d0e] text-white flex flex-col items-center justify-center p-4 overflow-y-auto"
    >
      <div className="w-full max-w-md bg-[#032a15] border border-amber-500/35 rounded-3xl shadow-2xl p-6 sm:p-7 space-y-5">
        {/* Branding & Lock Shield */}
        <div className="text-center space-y-2.5">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-500 text-slate-950 flex items-center justify-center shadow-lg">
            <Lock className="w-7 h-7 stroke-[2.4]" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300 uppercase tracking-wider">
              <Crown className="w-3.5 h-3.5" />
              <span>WAQAS POS SOFTWARE</span>
            </div>
            <h1 className="text-xl font-black text-white tracking-tight mt-0.5 uppercase">
              {storeName}
            </h1>
            <p className="text-xs text-emerald-200/85 mt-1">
              {reasonMessage || 'Application Locked · Authenticate to access POS data'}
            </p>
          </div>
        </div>

        {/* Recovery Mode vs Standard Unlock Mode */}
        {showRecovery ? (
          <form onSubmit={handleRecoverySubmit} className="space-y-3.5 bg-[#021f0f] border border-emerald-800/70 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-amber-300 font-bold text-xs">
                <RotateCcw className="w-4 h-4" />
                <span>Forgot PIN / Password Recovery</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowRecovery(false);
                  setRecoveryFeedback(null);
                }}
                className="text-xs text-slate-300 hover:text-white underline cursor-pointer"
              >
                Back to Unlock
              </button>
            </div>

            {!canRecoverHere ? (
              <p className="text-xs text-amber-200 leading-relaxed">
                Staff accounts cannot reset App Lock directly. Ask your Mart Owner or Super Admin to unlock or reset App Lock in Security Settings.
              </p>
            ) : (
              <>
                <p className="text-[11px] text-emerald-200/80 leading-relaxed">
                  Verify your {authUser?.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Mart Owner'} login password to set a new PIN or turn off App Lock.
                </p>

                {recoveryFeedback && (
                  <div
                    className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                      recoveryFeedback.ok
                        ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
                        : 'bg-red-950/90 border-red-500/50 text-red-200'
                    }`}
                  >
                    {recoveryFeedback.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span>{recoveryFeedback.text}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-200">
                    Account Login Password
                  </label>
                  <div className="relative">
                    <input
                      type={showRecoveryAccountPwd ? 'text' : 'password'}
                      required
                      value={recoveryAccountPwd}
                      onChange={(e) => setRecoveryAccountPwd(e.target.value)}
                      placeholder="Enter account login password"
                      className="w-full px-3 py-2.5 pr-10 rounded-xl bg-slate-900/90 border border-emerald-700 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRecoveryAccountPwd((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                      aria-label={showRecoveryAccountPwd ? 'Hide password' : 'Show password'}
                    >
                      {showRecoveryAccountPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setRecoveryAction('reset_pin')}
                    className={`py-2 px-3 rounded-xl font-bold border cursor-pointer ${
                      recoveryAction === 'reset_pin'
                        ? 'bg-amber-400 text-slate-950 border-amber-300'
                        : 'bg-slate-900/70 text-slate-200 border-slate-700'
                    }`}
                  >
                    Set New PIN
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecoveryAction('disable')}
                    className={`py-2 px-3 rounded-xl font-bold border cursor-pointer ${
                      recoveryAction === 'disable'
                        ? 'bg-amber-400 text-slate-950 border-amber-300'
                        : 'bg-slate-900/70 text-slate-200 border-slate-700'
                    }`}
                  >
                    Disable App Lock
                  </button>
                </div>

                {recoveryAction === 'reset_pin' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-200 mb-1">New PIN (4–12 digits)</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={12}
                        value={recoveryNewPin}
                        onChange={(e) => setRecoveryNewPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="e.g. 2468"
                        className="w-full px-3 py-2 rounded-xl bg-slate-900/90 border border-emerald-700 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-200 mb-1">Confirm PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={12}
                        value={recoveryConfirmPin}
                        onChange={(e) => setRecoveryConfirmPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="Repeat PIN"
                        className="w-full px-3 py-2 rounded-xl bg-slate-900/90 border border-emerald-700 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full min-h-[44px] py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black text-xs uppercase tracking-wide cursor-pointer disabled:opacity-50"
                >
                  {busy ? 'Verifying...' : recoveryAction === 'disable' ? 'Verify & Disable App Lock' : 'Verify & Save New PIN'}
                </button>
              </>
            )}
          </form>
        ) : (
          <>
            {/* Method Switcher */}
            <div className="grid grid-cols-3 gap-1.5 bg-[#021f0f] p-1 rounded-2xl border border-emerald-800/70">
              <button
                type="button"
                disabled={!hasFingerprintCreds}
                onClick={() => {
                  setActiveMethod('fingerprint');
                  setErrorMsg(null);
                }}
                className={`min-h-[40px] px-2 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  activeMethod === 'fingerprint'
                    ? 'bg-amber-400 text-slate-950 font-black'
                    : 'text-emerald-100 hover:bg-emerald-900/60'
                }`}
              >
                <Fingerprint className="w-3.5 h-3.5 shrink-0" />
                <span>Fingerprint</span>
              </button>

              <button
                type="button"
                disabled={!hasPin}
                onClick={() => {
                  setActiveMethod('pin');
                  setErrorMsg(null);
                }}
                className={`min-h-[40px] px-2 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  activeMethod === 'pin'
                    ? 'bg-amber-400 text-slate-950 font-black'
                    : 'text-emerald-100 hover:bg-emerald-900/60'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>PIN</span>
              </button>

              <button
                type="button"
                disabled={!hasPassword}
                onClick={() => {
                  setActiveMethod('password');
                  setErrorMsg(null);
                }}
                className={`min-h-[40px] px-2 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  activeMethod === 'password'
                    ? 'bg-amber-400 text-slate-950 font-black'
                    : 'text-emerald-100 hover:bg-emerald-900/60'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                <span>Password</span>
              </button>
            </div>

            {/* Clear Error Banner */}
            {errorMsg && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-red-950/90 border border-red-500/60 text-red-100 text-xs font-semibold flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* FINGERPRINT UNLOCK */}
            {activeMethod === 'fingerprint' && (
              <div className="bg-[#021f0f] border border-emerald-800/70 rounded-2xl p-5 text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-900/80 border-2 border-amber-400/70 flex items-center justify-center text-amber-300">
                  <Fingerprint className="w-9 h-9" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-white">
                    {capability?.platformAvailable
                      ? capability.label
                      : 'Biometric Verification'}
                  </p>
                  <p className="text-xs text-emerald-200/80">
                    {capability?.platformAvailable
                      ? 'Tap below and verify using your registered fingerprint or device biometric sensor.'
                      : capability?.reason || 'Device biometric sensor not detected here. Switch to PIN or Password.'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || !hasFingerprintCreds || capability?.platformAvailable === false}
                  onClick={handleBiometricVerify}
                  data-testid="applock-biometric-unlock-btn"
                  className="w-full min-h-[46px] py-3 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 hover:brightness-105 text-slate-950 font-black text-xs uppercase tracking-wide flex items-center justify-center gap-2 cursor-pointer disabled:opacity-45"
                >
                  <Fingerprint className="w-4 h-4" />
                  <span>{busy ? 'Waiting for Sensor...' : 'Scan Fingerprint to Unlock'}</span>
                </button>
              </div>
            )}

            {/* PIN UNLOCK */}
            {activeMethod === 'pin' && (
              <div className="space-y-3">
                <div className="bg-[#021f0f] border border-emerald-800/70 rounded-2xl p-3.5 text-center space-y-2.5">
                  <label className="block text-[11px] font-bold text-emerald-200 uppercase tracking-wider">
                    Enter {config.pinLength || 4}-Digit Security PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={12}
                    autoFocus
                    value={pinValue}
                    onChange={(e) => {
                      setErrorMsg(null);
                      setPinValue(e.target.value.replace(/\D/g, ''));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handlePinVerify();
                      }
                    }}
                    data-testid="applock-pin-input"
                    placeholder={'• '.repeat(Math.min(6, config.pinLength || 4)).trim()}
                    className="w-full text-center tracking-[0.45em] font-mono text-lg font-black py-2.5 px-3 rounded-xl bg-slate-900 border border-emerald-700 text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                {/* Touch-Friendly Numeric Keypad */}
                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={busy}
                      onClick={() => handleDigitClick(d)}
                      className="min-h-[46px] rounded-xl bg-[#021f0f] hover:bg-emerald-900/70 border border-emerald-800/80 text-white font-mono font-black text-base tabular-nums cursor-pointer active:scale-95 transition-all"
                    >
                      {d}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setPinValue('');
                      setErrorMsg(null);
                    }}
                    className="min-h-[46px] rounded-xl bg-[#021f0f] hover:bg-emerald-900/70 border border-emerald-800/80 text-xs font-bold text-amber-300 cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDigitClick('0')}
                    className="min-h-[46px] rounded-xl bg-[#021f0f] hover:bg-emerald-900/70 border border-emerald-800/80 text-white font-mono font-black text-base tabular-nums cursor-pointer active:scale-95 transition-all"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    disabled={busy || pinValue.length === 0}
                    onClick={() => setPinValue((p) => p.slice(0, -1))}
                    className="min-h-[46px] rounded-xl bg-[#021f0f] hover:bg-emerald-900/70 border border-emerald-800/80 text-slate-200 flex items-center justify-center cursor-pointer disabled:opacity-40"
                    aria-label="Backspace"
                  >
                    <Delete className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  disabled={busy || pinValue.length < 4}
                  onClick={() => handlePinVerify()}
                  data-testid="applock-pin-submit"
                  className="w-full min-h-[46px] py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 hover:brightness-105 text-slate-950 font-black text-xs uppercase tracking-wide cursor-pointer disabled:opacity-45"
                >
                  {busy ? 'Verifying PIN...' : 'Unlock Application'}
                </button>
              </div>
            )}

            {/* PASSWORD UNLOCK */}
            {activeMethod === 'password' && (
              <form onSubmit={handlePasswordVerify} className="space-y-3 bg-[#021f0f] border border-emerald-800/70 rounded-2xl p-4">
                <label className="block text-[11px] font-bold text-emerald-200 uppercase tracking-wider">
                  App Lock Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoFocus
                    required
                    value={passwordValue}
                    onChange={(e) => {
                      setErrorMsg(null);
                      setPasswordValue(e.target.value);
                    }}
                    data-testid="applock-password-input"
                    placeholder="Enter App Lock password"
                    className="w-full px-3.5 py-2.5 pr-11 rounded-xl bg-slate-900 border border-emerald-700 text-sm text-white focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={busy || !passwordValue}
                  data-testid="applock-password-submit"
                  className="w-full min-h-[46px] py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 hover:brightness-105 text-slate-950 font-black text-xs uppercase tracking-wide cursor-pointer disabled:opacity-45"
                >
                  {busy ? 'Verifying...' : 'Unlock Application'}
                </button>
              </form>
            )}
          </>
        )}

        {/* Footer Info: Failed attempts, Forgot PIN/Password, Sign Out */}
        <div className="pt-2 border-t border-emerald-800/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => setShowRecovery((s) => !s)}
            className="text-amber-300 hover:text-amber-200 font-semibold underline cursor-pointer"
          >
            Forgot PIN / Password?
          </button>

          {config.failedAttempts > 0 && (
            <span className="text-red-300 font-mono tabular-nums">
              Failed attempts: {config.failedAttempts}
            </span>
          )}

          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="text-red-300 hover:text-red-200 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
