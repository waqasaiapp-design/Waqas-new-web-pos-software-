import React, { useState } from 'react';
import {
  Crown,
  Store,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  QrCode,
  User,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react';
import { AuthSession, DeviceInfo } from '../../types/pos';
import { loginSuperAdmin, loginAccount } from '../../utils/authClient';
import { PairDeviceModal } from '../PairDeviceModal';
import { APP_VERSION, APP_BUILD_ID } from '../../version';

interface LoginGatewayProps {
  onLoginSuccess: (session: AuthSession) => void;
  onPairedSuccess: (device: DeviceInfo, storeState?: any) => void;
  initialNotice?: string | null;
}

type GatewayView = 'welcome' | 'mart' | 'super_admin';

export const LoginGateway: React.FC<LoginGatewayProps> = ({
  onLoginSuccess,
  onPairedSuccess,
  initialNotice,
}) => {
  const [view, setView] = useState<GatewayView>('welcome');

  // Mart Owner / Staff Login state
  const [martIdentifier, setMartIdentifier] = useState('');
  const [martPassword, setMartPassword] = useState('');
  const [showMartPassword, setShowMartPassword] = useState(false);

  // Fixed Super Admin Login state (Gmail + Password only, zero hardcoded credentials)
  const [saGmail, setSaGmail] = useState('');
  const [saPassword, setSaPassword] = useState('');
  const [showSaPassword, setShowSaPassword] = useState(false);

  // QR Pairing Modal state (opened only from Mart Login)
  const [isPairOpen, setIsPairOpen] = useState(false);

  // Feedback
  const [error, setError] = useState<string | null>(initialNotice || null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [restrictedInfo, setRestrictedInfo] = useState<{ shopName?: string; status?: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetMessages = () => {
    setError(null);
    setSuccessMsg(null);
    setRestrictedInfo(null);
  };

  const goBackToWelcome = () => {
    resetMessages();
    setSaGmail('');
    setSaPassword('');
    setMartPassword('');
    setView('welcome');
  };

  // Mart Login Handler (Shop ID or Shop Username + Shop Password)
  const handleMartLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    resetMessages();
    setIsSubmitting(true);
    try {
      const session = await loginAccount({
        portal: 'shop',
        identifier: martIdentifier.trim(),
        password: martPassword.trim(),
      });
      setMartPassword('');
      onLoginSuccess(session);
    } catch (err: any) {
      const data = err?.data;
      if (data?.error === 'SHOP_ACCOUNT_RESTRICTED') {
        setRestrictedInfo({ shopName: data.shopName, status: data.status });
      }
      setError(err?.message || 'Invalid Shop ID, Shop Username, or Shop Password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Super Admin Login Handler (Authorized Super Admin Gmail + Password)
  const handleSuperAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    resetMessages();

    const cleanGmail = saGmail.trim().toLowerCase();
    const cleanPassword = saPassword.trim();

    if (!cleanGmail) {
      setError('Please enter your Super Admin Gmail.');
      return;
    }
    if (!cleanPassword) {
      setError('Please enter your Super Admin Password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await loginSuperAdmin({
        gmail: cleanGmail,
        password: cleanPassword,
      });
      setSaPassword('');
      onLoginSuccess(session);
    } catch (err: any) {
      setError(err?.message || 'Super Admin authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-br from-slate-950 via-[#031910] to-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-2xl bg-slate-900/95 border border-slate-800/90 rounded-3xl shadow-2xl shadow-black/60 overflow-hidden backdrop-blur">
        {/* Clean Brand Header */}
        <div className="px-6 py-5 sm:px-8 sm:py-6 border-b border-slate-800/90 bg-gradient-to-r from-slate-900 via-[#062216] to-slate-900 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 border border-emerald-400/40 shadow-lg shadow-emerald-950/50 flex items-center justify-center shrink-0">
              <Store className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-400">
                WAQAS MART
              </div>
              <h1 className="text-lg sm:text-2xl font-extrabold tracking-tight text-white truncate">
                WAQAS POS SOFTWARE
              </h1>
              <p className="text-xs text-slate-400 truncate">
                Better Shop Better Business
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] font-semibold text-emerald-300 shrink-0">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Secure Portal</span>
          </div>
        </div>

        {/* Alerts & Status */}
        {(error || successMsg) && (
          <div className="px-6 sm:px-8 pt-5 space-y-3">
            {error && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-red-950/70 border border-red-500/40 text-red-200 text-xs space-y-2"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
                {restrictedInfo && (
                  <div className="pt-1 border-t border-red-800/50 flex items-center justify-between text-[11px]">
                    <span>WhatsApp Support: 03228570782</span>
                    <a
                      href="https://wa.me/923228570782"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-300 font-semibold hover:underline"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Contact Super Admin</span>
                    </a>
                  </div>
                )}
              </div>
            )}

            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-emerald-200 text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}
          </div>
        )}

        {/* VIEW 1: STARTUP SCREEN — ONLY SUPER ADMIN LOGIN & MART LOGIN */}
        {view === 'welcome' && (
          <div className="p-6 sm:p-8 space-y-6">
            <div className="text-center space-y-1.5">
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                Select Login Portal
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                Choose your authorized login option to access WAQAS POS SOFTWARE
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* OPTION 1 — SUPER ADMIN LOGIN */}
              <button
                type="button"
                data-testid="select-super-admin-login"
                onClick={() => {
                  resetMessages();
                  setView('super_admin');
                }}
                className="group text-left p-5 sm:p-6 rounded-2xl bg-slate-950/90 hover:bg-slate-800/90 border border-slate-800 hover:border-amber-400/70 transition-all flex flex-col justify-between gap-5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400 shadow-lg shadow-black/30"
              >
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                    <Crown className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold tracking-wide text-white">
                      SUPER ADMIN LOGIN
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Authorized Super Admin Gmail and Password access for multi-mart administration.
                    </p>
                  </div>
                </div>
                <div className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-amber-500 group-hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm tracking-wide flex items-center justify-center gap-2 transition-colors">
                  <span>SUPER ADMIN LOGIN</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>

              {/* OPTION 2 — MART LOGIN */}
              <button
                type="button"
                data-testid="select-mart-login"
                onClick={() => {
                  resetMessages();
                  setView('mart');
                }}
                className="group text-left p-5 sm:p-6 rounded-2xl bg-slate-950/90 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/70 transition-all flex flex-col justify-between gap-5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-lg shadow-black/30"
              >
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                    <Store className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold tracking-wide text-white">
                      MART LOGIN
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Sign in to your authorized Mart account using Shop ID or Shop Username and Password.
                    </p>
                  </div>
                </div>
                <div className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-emerald-600 group-hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm tracking-wide flex items-center justify-center gap-2 transition-colors">
                  <span>MART LOGIN</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>
            </div>
          </div>
        )}

        {/* VIEW 2: MART LOGIN SCREEN */}
        {view === 'mart' && (
          <div className="p-6 sm:p-8 max-w-md mx-auto w-full space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                  <Store className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Mart Login</h2>
                  <p className="text-xs text-slate-400">Authorized Mart database access</p>
                </div>
              </div>
              <button
                type="button"
                onClick={goBackToWelcome}
                className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            </div>

            <form onSubmit={handleMartLogin} className="space-y-4">
              <div>
                <label htmlFor="mart-login-ident" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Shop ID or Shop Username
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="mart-login-ident"
                    type="text"
                    required
                    autoFocus
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={martIdentifier}
                    onChange={(e) => {
                      setMartIdentifier(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="e.g. SHOP-WM-001 or waqasmart"
                    className="w-full min-h-[48px] pl-10 pr-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="mart-login-pass" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Shop Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="mart-login-pass"
                    type={showMartPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={martPassword}
                    onChange={(e) => {
                      setMartPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Enter shop password"
                    className="w-full min-h-[48px] pl-10 pr-12 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMartPassword((p) => !p)}
                    aria-label={showMartPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                    tabIndex={-1}
                  >
                    {showMartPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !martIdentifier.trim() || !martPassword}
                className="w-full min-h-[48px] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Signing in...' : 'Login'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">Multi-device POS terminal?</span>
              <button
                type="button"
                onClick={() => setIsPairOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Connect via QR Code</span>
              </button>
            </div>
          </div>
        )}

        {/* VIEW 3: SUPER ADMIN LOGIN SCREEN (GMAIL + PASSWORD + LOGIN BUTTON) */}
        {view === 'super_admin' && (
          <div className="p-6 sm:p-8 max-w-md mx-auto w-full space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Super Admin Login</h2>
                  <p className="text-xs text-slate-400">Authorized Gmail & Password Authentication</p>
                </div>
              </div>
              <button
                type="button"
                onClick={goBackToWelcome}
                className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            </div>

            <form onSubmit={handleSuperAdminLogin} className="space-y-4">
              <div>
                <label htmlFor="sa-login-gmail" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Super Admin Gmail
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="sa-login-gmail"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={saGmail}
                    onChange={(e) => {
                      setSaGmail(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Enter Super Admin Gmail"
                    className="w-full min-h-[48px] pl-10 pr-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="sa-login-pass" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="sa-login-pass"
                    type={showSaPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={saPassword}
                    onChange={(e) => {
                      setSaPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Enter Super Admin password"
                    className="w-full min-h-[48px] pl-10 pr-12 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSaPassword((p) => !p)}
                    aria-label={showSaPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                    tabIndex={-1}
                  >
                    {showSaPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !saGmail.trim() || !saPassword}
                className="w-full min-h-[48px] py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Crown className="w-4 h-4" />
                <span>{isSubmitting ? 'Signing in...' : 'Login'}</span>
              </button>
            </form>
          </div>
        )}

        {/* Minimal Clean Footer */}
        <div className="px-6 py-3 bg-slate-950/90 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            WAQAS POS SOFTWARE · v{APP_VERSION} · Build {APP_BUILD_ID}
          </span>
          <span>Currency: PKR (Rs.)</span>
        </div>
      </div>

      <PairDeviceModal
        isOpen={isPairOpen}
        onClose={() => setIsPairOpen(false)}
        onPairSuccess={(device, storeState) => {
          setIsPairOpen(false);
          onPairedSuccess(device, storeState);
        }}
      />
    </div>
  );
};
