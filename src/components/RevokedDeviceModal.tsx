import React, { useState } from 'react';
import { ShieldAlert, QrCode, RefreshCw, AlertCircle } from 'lucide-react';
import { DeviceInfo } from '../types/pos';

interface RevokedDeviceModalProps {
  device: DeviceInfo;
  onOpenPairQr: () => void;
  onRetryAccess?: () => Promise<{ ok: boolean; message?: string }>;
}

export const RevokedDeviceModal: React.FC<RevokedDeviceModalProps> = ({
  device,
  onOpenPairQr,
  onRetryAccess,
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);

  const handleRetry = async () => {
    if (!onRetryAccess || isChecking) return;
    setIsChecking(true);
    setRetryFeedback(null);
    try {
      const result = await onRetryAccess();
      if (!result.ok) {
        setRetryFeedback(
          result.message || 'Access is still revoked. Ask owner to Restore Access or scan a new QR code.'
        );
      }
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
      <div className="w-full max-w-md bg-white rounded-3xl p-6 text-center shadow-2xl border border-red-200 space-y-5 animate-in fade-in zoom-in-95">
        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto shadow-inner">
          <ShieldAlert className="w-9 h-9" />
        </div>

        <div>
          <h2 className="text-xl font-black text-slate-900">Device Access Disconnected</h2>
          <p className="text-xs text-red-600 font-bold mt-1">Re-Authentication Required</p>
        </div>

        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-left text-slate-600 space-y-1.5">
          <p className="text-slate-500 font-medium">
            This device is currently disconnected and cannot access store records until restored or re-paired:
          </p>
          <div className="pt-1 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400">Terminal Name:</span>
              <span className="font-bold text-slate-900">{device.deviceName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Device ID:</span>
              <span className="font-mono text-slate-700">{device.deviceId}</span>
            </div>
          </div>
        </div>

        {retryFeedback && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-start gap-2 text-left">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>{retryFeedback}</span>
          </div>
        )}

        <p className="text-[11px] text-slate-500">
          Ask the store owner to tap <b>Restore Access</b> in Device Management or approve a new QR connection below.
        </p>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={onOpenPairQr}
            className="w-full py-3.5 bg-[#057a44] hover:bg-[#046337] text-white font-black text-xs rounded-2xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
          >
            <QrCode className="w-4 h-4" />
            <span>Scan New QR Code / Re-Authenticate</span>
          </button>

          {onRetryAccess && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={isChecking}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-2xl transition border border-slate-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
              <span>{isChecking ? 'Checking Access...' : 'Check Restored Access'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
