import React, { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Video,
  Grid3X3,
  LayoutGrid,
  Maximize2,
  Minimize2,
  RefreshCw,
  Plus,
  Trash2,
  Edit2,
  AlertCircle,
  CheckCircle2,
  Wifi,
  WifiOff,
  Server,
  Camera,
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Search,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Circle,
  Square,
  Film,
  Sliders,
  ShieldAlert,
  Loader2,
  MapPin,
} from 'lucide-react';
import {
  CctvCamera,
  CctvCameraInput,
  CctvCameraType,
  CctvConnectionTestResult,
  CctvGatewayStatus,
  CctvRecordingEntry,
  DvrNvrConfig,
} from '../types/pos';
import { FullScreenPageHeader } from './FullScreenPageHeader';
import {
  captureCameraSnapshotBlob,
  createCameraApi,
  deleteCameraApi,
  deleteCameraRecordingApi,
  fetchAuthorizedRecordingBlobUrl,
  fetchCctvOverview,
  listCameraRecordingsApi,
  refreshAllCamerasApi,
  refreshCameraApi,
  resolveCctvMediaUrl,
  saveDvrConfigApi,
  sendCameraPtzApi,
  startCameraRecordingApi,
  startCameraStreamSessionApi,
  stopCameraRecordingApi,
  testCameraConnectionApi,
  updateCameraApi,
} from '../utils/cctvClient';

interface CctvPageProps {
  cameras: CctvCamera[];
  dvrConfig: DvrNvrConfig;
  activeShopId?: string;
  canManage?: boolean;
  onSyncCameras: (cameras: CctvCamera[]) => void;
  onSyncDvrConfig: (config: DvrNvrConfig) => void;
  onBackToHome?: () => void;
}

type GridLayoutMode = '1x1' | '2x2' | '3x3' | '4x4';

const CAMERA_TYPE_OPTIONS: Array<{ value: CctvCameraType; label: string; defaultPort: number }> = [
  { value: 'rtsp', label: 'RTSP Camera', defaultPort: 554 },
  { value: 'ip', label: 'IP Camera (HTTP/RTSP)', defaultPort: 80 },
  { value: 'onvif', label: 'ONVIF Camera', defaultPort: 80 },
  { value: 'dvr', label: 'DVR Channel', defaultPort: 554 },
  { value: 'nvr', label: 'NVR Channel', defaultPort: 554 },
  { value: 'hls', label: 'HLS Live Stream (.m3u8)', defaultPort: 80 },
  { value: 'mjpeg', label: 'MJPEG / HTTP Camera', defaultPort: 80 },
  { value: 'webrtc', label: 'WebRTC (WHEP Gateway)', defaultPort: 8889 },
];

const LOCATION_PRESETS = [
  'Cash Counter 01',
  'Cash Counter 02',
  'Main Entrance',
  'Stock Room',
  'Warehouse',
  'Back Exit',
];

function getFriendlyErrorLabel(code?: string): string {
  switch (code) {
    case 'AUTH_FAILED':
      return 'Incorrect Username or Password';
    case 'INVALID_IP_OR_URL':
      return 'Invalid IP Address / Stream URL';
    case 'UNSUPPORTED_FORMAT':
      return 'Unsupported Stream Format';
    case 'GATEWAY_UNAVAILABLE':
      return 'Streaming Gateway Unavailable';
    case 'NETWORK_FAILURE':
      return 'Network Connection Failure';
    case 'CAMERA_DISCONNECTED':
      return 'Camera Disconnected';
    default:
      return 'Connection Error';
  }
}

interface LivePlayerViewProps {
  camera: CctvCamera;
  shopId?: string;
  isActiveView: boolean;
  muted: boolean;
  paused: boolean;
  refreshSignal: number;
  videoElRef?: React.MutableRefObject<HTMLVideoElement | null>;
  onCameraUpdated: (cam: CctvCamera) => void;
  onAudioAvailabilityChange?: (hasAudio: boolean) => void;
  onToast: (msg: string, tone?: 'ok' | 'err') => void;
}

const LiveCameraFeed: React.FC<LivePlayerViewProps> = ({
  camera,
  shopId,
  isActiveView,
  muted,
  paused,
  refreshSignal,
  videoElRef,
  onCameraUpdated,
  onAudioAvailabilityChange,
  onToast,
}) => {
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamProtocol, setStreamProtocol] = useState<string>('none');
  const [streamSrc, setStreamSrc] = useState<string>('');
  const [snapshotTick, setSnapshotTick] = useState(0);
  const [liveConnected, setLiveConnected] = useState(false);

  const attachVideoRef = (el: HTMLVideoElement | null) => {
    internalVideoRef.current = el;
    if (videoElRef) videoElRef.current = el;
  };

  const cleanupPlayers = () => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {}
      hlsRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }
  };

  const connectStream = async () => {
    cleanupPlayers();
    setLoading(true);
    setStreamError(null);
    setLiveConnected(false);

    try {
      const session = await startCameraStreamSessionApi(camera.id, shopId);
      onCameraUpdated(session.camera);
      setStreamProtocol(session.protocol);
      setStreamSrc(session.streamPath);
      onAudioAvailabilityChange?.(Boolean(session.capabilities?.audio));
      setLoading(false);
    } catch (err: any) {
      setLoading(false);
      setLiveConnected(false);
      const updatedCam = err?.data?.camera as CctvCamera | undefined;
      if (updatedCam) onCameraUpdated(updatedCam);
      setStreamError(err?.message || camera.lastError || 'Camera disconnected or unreachable.');
    }
  };

  useEffect(() => {
    if (!isActiveView && camera.status !== 'online') {
      cleanupPlayers();
      setStreamSrc('');
      setLiveConnected(false);
      setStreamError(camera.lastError || null);
      return;
    }
    connectStream();
    return () => {
      cleanupPlayers();
    };
  }, [camera.id, isActiveView, refreshSignal]);

  // Poll snapshot if snapshot-poll mode
  useEffect(() => {
    if (streamProtocol !== 'snapshot-poll' || !streamSrc || paused) return;
    const id = window.setInterval(() => {
      setSnapshotTick((t) => t + 1);
    }, 2000);
    return () => window.clearInterval(id);
  }, [streamProtocol, streamSrc, paused]);

  // Attach HLS / MP4 / WebRTC to <video>
  useEffect(() => {
    const videoEl = internalVideoRef.current;
    if (!videoEl || !streamSrc) return;
    if (streamProtocol === 'mjpeg' || streamProtocol === 'snapshot-poll') return;

    cleanupPlayers();
    let cancelled = false;

    const attach = async () => {
      if (streamProtocol === 'hls') {
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 10,
          });
          hlsRef.current = hls;
          hls.loadSource(streamSrc);
          hls.attachMedia(videoEl);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            setLiveConnected(true);
            setStreamError(null);
            if (!paused) {
              videoEl.play().catch(() => {});
            }
          });
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (!data.fatal || cancelled) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              setStreamError('Live stream interrupted (network/camera unreachable). Click Retry.');
              setLiveConnected(false);
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              setStreamError('Unsupported video stream format or codec error.');
              setLiveConnected(false);
              hls.destroy();
            }
          });
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
          videoEl.src = streamSrc;
          setLiveConnected(true);
          if (!paused) videoEl.play().catch(() => {});
        } else {
          setStreamError('Browser does not support HLS live playback.');
        }
      } else if (streamProtocol === 'mp4') {
        videoEl.src = streamSrc;
        videoEl.onloadeddata = () => {
          if (!cancelled) {
            setLiveConnected(true);
            setStreamError(null);
          }
        };
        videoEl.onerror = () => {
          if (!cancelled) {
            setLiveConnected(false);
            setStreamError('Camera HTTP video stream disconnected or unsupported codec.');
          }
        };
        if (!paused) videoEl.play().catch(() => {});
      } else if (streamProtocol === 'webrtc') {
        try {
          const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
          pcRef.current = pc;
          pc.addTransceiver('video', { direction: 'recvonly' });
          pc.addTransceiver('audio', { direction: 'recvonly' });
          pc.ontrack = (evt) => {
            if (cancelled) return;
            if (evt.streams?.[0]) {
              videoEl.srcObject = evt.streams[0];
              setLiveConnected(true);
              setStreamError(null);
              if (!paused) videoEl.play().catch(() => {});
            }
          };
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          const resp = await fetch(streamSrc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdp: offer.sdp }),
          });
          const json = await resp.json();
          if (!resp.ok || !json?.sdp) {
            throw new Error(json?.message || 'WebRTC gateway rejected stream offer.');
          }
          await pc.setRemoteDescription({ type: 'answer', sdp: json.sdp });
        } catch (err: any) {
          if (!cancelled) {
            setLiveConnected(false);
            setStreamError(err?.message || 'WebRTC live stream connection failed.');
          }
        }
      }
    };

    attach();
    return () => {
      cancelled = true;
      cleanupPlayers();
    };
  }, [streamSrc, streamProtocol]);

  useEffect(() => {
    const v = internalVideoRef.current;
    if (!v) return;
    v.muted = muted;
  }, [muted]);

  useEffect(() => {
    const v = internalVideoRef.current;
    if (!v || !streamSrc) return;
    if (paused) v.pause();
    else v.play().catch(() => {});
  }, [paused, streamSrc]);

  const handleManualTest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      const res = await refreshCameraApi(camera.id, shopId);
      onCameraUpdated(res.camera);
      if (res.ok) {
        onToast(`${camera.name}: ${res.result.message}`, 'ok');
        await connectStream();
      } else {
        setStreamError(res.result.message);
        onToast(res.result.message, 'err');
      }
    } catch (err: any) {
      setStreamError(err?.message || 'Connection test failed.');
      onToast(err?.message || 'Connection test failed.', 'err');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 p-4 text-center">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mb-2" />
        <p className="text-xs font-bold text-white">Connecting to {camera.name}...</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Probing {camera.cameraType.toUpperCase()} stream via secure gateway
        </p>
      </div>
    );
  }

  if (streamError || !streamSrc) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 p-4 text-center space-y-2.5">
        <div className="w-11 h-11 rounded-2xl bg-red-950/60 border border-red-500/30 flex items-center justify-center text-red-400">
          <WifiOff className="w-5 h-5" />
        </div>
        <div className="space-y-1 max-w-md">
          <p className="text-xs font-black text-red-300 uppercase tracking-wide">
            {getFriendlyErrorLabel(camera.errorCode)}
          </p>
          <p className="text-[11px] text-slate-300 leading-relaxed line-clamp-3">
            {streamError || camera.lastError || 'Camera is offline or standby. Click Retry or Test Connection.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => connectStream()}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry Stream</span>
          </button>
          <button
            type="button"
            onClick={handleManualTest}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span>Test Connection</span>
          </button>
        </div>
      </div>
    );
  }

  if (streamProtocol === 'mjpeg' || streamProtocol === 'snapshot-poll') {
    const imgUrl =
      streamProtocol === 'snapshot-poll'
        ? `${streamSrc}${streamSrc.includes('?') ? '&' : '?'}_t=${snapshotTick}`
        : streamSrc;
    return (
      <div className="w-full h-full bg-black relative flex items-center justify-center overflow-hidden">
        <img
          src={resolveCctvMediaUrl(imgUrl)}
          alt={camera.name}
          onLoad={() => setLiveConnected(true)}
          onError={() => {
            setLiveConnected(false);
            setStreamError('Camera disconnected or stream format rejected by browser.');
          }}
          className="w-full h-full object-contain"
        />
        {!liveConnected && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-slate-300">
            Loading live camera frames...
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-black relative flex items-center justify-center overflow-hidden">
      <video
        ref={attachVideoRef}
        playsInline
        autoPlay
        muted={muted}
        controls={false}
        className="w-full h-full object-contain"
      />
      {!liveConnected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-xs text-slate-300 pointer-events-none">
          <Loader2 className="w-6 h-6 text-emerald-400 animate-spin mb-1.5" />
          <span>Buffering live video...</span>
        </div>
      )}
    </div>
  );
};

export const CctvPage: React.FC<CctvPageProps> = ({
  cameras,
  dvrConfig,
  activeShopId,
  canManage = true,
  onSyncCameras,
  onSyncDvrConfig,
  onBackToHome,
}) => {
  const [gridLayout, setGridLayout] = useState<GridLayoutMode>('2x2');
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [gatewayStatus, setGatewayStatus] = useState<CctvGatewayStatus>({
    ffmpegAvailable: true,
    ffprobeAvailable: true,
    activeStreamsCount: 0,
    cloudEnvironment: false,
  });
  const [recordings, setRecordings] = useState<CctvRecordingEntry[]>([]);

  // Modals & notifications
  const [isDvrModalOpen, setIsDvrModalOpen] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState<CctvCamera | null>(null);
  const [camToDelete, setCamToDelete] = useState<CctvCamera | null>(null);
  const [recordingToDelete, setRecordingToDelete] = useState<CctvRecordingEntry | null>(null);
  const [playbackRecording, setPlaybackRecording] = useState<{ entry: CctvRecordingEntry; url: string } | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null);

  // Live view controls state
  const liveContainerRef = useRef<HTMLDivElement | null>(null);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [detectedAudio, setDetectedAudio] = useState(false);
  const [refreshTickMap, setRefreshTickMap] = useState<Record<string, number>>({});
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [ptzStatusMsg, setPtzStatusMsg] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // DVR Form State
  const [dvrBrand, setDvrBrand] = useState<DvrNvrConfig['brand']>(dvrConfig.brand || 'Hikvision');
  const [dvrIp, setDvrIp] = useState(dvrConfig.dvrIp || '192.168.1.100');
  const [dvrPort, setDvrPort] = useState(String(dvrConfig.port || 554));
  const [dvrUser, setDvrUser] = useState(dvrConfig.username || 'admin');
  const [dvrPass, setDvrPass] = useState('');
  const [showDvrPass, setShowDvrPass] = useState(false);
  const [channelCount, setChannelCount] = useState(dvrConfig.channelCount || 8);
  const [dvrSaving, setDvrSaving] = useState(false);
  const [dvrTestResult, setDvrTestResult] = useState<CctvConnectionTestResult | null>(null);

  // Add / Edit Camera Form State
  const [camName, setCamName] = useState('');
  const [camLocation, setCamLocation] = useState('Cash Counter 01');
  const [camType, setCamType] = useState<CctvCameraType>('rtsp');
  const [camIp, setCamIp] = useState('');
  const [camPort, setCamPort] = useState('554');
  const [camChannel, setCamChannel] = useState(1);
  const [camUsername, setCamUsername] = useState('');
  const [camPassword, setCamPassword] = useState('');
  const [showCamPassword, setShowCamPassword] = useState(false);
  const [camStreamUrl, setCamStreamUrl] = useState('');
  const [camResolution, setCamResolution] = useState('1080p FHD');
  const [camDescription, setCamDescription] = useState('');
  const [camSupportsPtz, setCamSupportsPtz] = useState(false);
  const [camSupportsAudio, setCamSupportsAudio] = useState(false);
  const [formTestLoading, setFormTestLoading] = useState(false);
  const [formTestResult, setFormTestResult] = useState<CctvConnectionTestResult | null>(null);
  const [formSaveLoading, setFormSaveLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const showToast = (msg: string, tone: 'ok' | 'err' = 'ok') => {
    setFeedbackToast({ msg, tone });
    window.setTimeout(() => setFeedbackToast(null), 4000);
  };

  // Load authoritative CCTV overview from backend on mount / shop switch
  const loadOverviewFromServer = async () => {
    try {
      const overview = await fetchCctvOverview(activeShopId);
      onSyncCameras(overview.cameras);
      if (overview.dvrConfig) onSyncDvrConfig(overview.dvrConfig);
      if (overview.gateway) setGatewayStatus(overview.gateway);
      setRecordings(overview.recordings || []);
    } catch (err: any) {
      if (err?.status === 403) {
        showToast(err.message || 'You are not authorized to access CCTV cameras.', 'err');
      }
    }
  };

  useEffect(() => {
    loadOverviewFromServer();
  }, [activeShopId]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const locationGroups = useMemo(() => {
    const set = new Set<string>();
    cameras.forEach((c) => {
      if (c.location?.trim()) set.add(c.location.trim());
    });
    return ['ALL', ...Array.from(set)];
  }, [cameras]);

  const filteredCameras = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cameras.filter((cam) => {
      const groupMatch = selectedGroup === 'ALL' || (cam.location || '').trim() === selectedGroup;
      if (!groupMatch) return false;
      if (!q) return true;
      return (
        cam.name.toLowerCase().includes(q) ||
        (cam.location || '').toLowerCase().includes(q) ||
        (cam.ipAddress || '').toLowerCase().includes(q) ||
        String(cam.channelNumber || '').includes(q) ||
        (cam.cameraType || '').toLowerCase().includes(q)
      );
    });
  }, [cameras, searchQuery, selectedGroup]);

  const onlineCount = useMemo(() => cameras.filter((c) => c.status === 'online').length, [cameras]);
  const offlineCount = cameras.length - onlineCount;
  const selectedCamera = useMemo(
    () => cameras.find((c) => c.id === selectedCameraId) || null,
    [cameras, selectedCameraId]
  );

  const activeCameraRecordings = useMemo(() => {
    if (!selectedCamera) return [];
    return recordings.filter((r) => r.cameraId === selectedCamera.id);
  }, [recordings, selectedCamera]);

  const handleUpdateSingleCameraInState = (updated: CctvCamera) => {
    onSyncCameras(
      cameras.map((c) => (c.id === updated.id ? updated : c))
    );
  };

  const openAddCameraModal = () => {
    setEditingCamera(null);
    setCamName(`Camera ${cameras.length + 1}`);
    setCamLocation('Cash Counter 01');
    setCamType('rtsp');
    setCamIp('');
    setCamPort('554');
    setCamChannel(cameras.length + 1);
    setCamUsername('');
    setCamPassword('');
    setShowCamPassword(false);
    setCamStreamUrl('');
    setCamResolution('1080p FHD');
    setCamDescription('');
    setCamSupportsPtz(false);
    setCamSupportsAudio(false);
    setFormTestResult(null);
    setFormError(null);
    setIsCameraModalOpen(true);
  };

  const openEditCameraModal = (cam: CctvCamera) => {
    setEditingCamera(cam);
    setCamName(cam.name);
    setCamLocation(cam.location || 'Cash Counter 01');
    setCamType(cam.cameraType || 'rtsp');
    setCamIp(cam.ipAddress || '');
    setCamPort(String(cam.port || 554));
    setCamChannel(cam.channelNumber || 1);
    setCamUsername(cam.username || '');
    setCamPassword('');
    setShowCamPassword(false);
    setCamStreamUrl('');
    setCamResolution(cam.resolution || '1080p FHD');
    setCamDescription(cam.description || '');
    setCamSupportsPtz(Boolean(cam.supportsPtz));
    setCamSupportsAudio(Boolean(cam.supportsAudio));
    setFormTestResult(null);
    setFormError(null);
    setIsCameraModalOpen(true);
  };

  const handleCameraTypeChange = (nextType: CctvCameraType) => {
    setCamType(nextType);
    if (!editingCamera) {
      const opt = CAMERA_TYPE_OPTIONS.find((o) => o.value === nextType);
      if (opt) setCamPort(String(opt.defaultPort));
    }
  };

  const buildCameraPayload = (): CctvCameraInput => ({
    id: editingCamera?.id,
    name: camName.trim(),
    location: camLocation.trim() || 'Main Shop',
    cameraType: camType,
    ipAddress: camIp.trim(),
    port: camPort ? parseInt(camPort, 10) : undefined,
    channelNumber: Math.max(1, camChannel || 1),
    username: camUsername.trim(),
    password: camPassword || undefined,
    keepExistingPassword: editingCamera ? !camPassword : false,
    streamUrl: camStreamUrl.trim() || undefined,
    keepExistingStreamUrl: editingCamera ? !camStreamUrl.trim() : false,
    resolution: camResolution,
    description: camDescription.trim() || undefined,
    supportsPtz: camSupportsPtz,
    supportsAudio: camSupportsAudio,
  });

  const handleTestCameraInForm = async () => {
    setFormError(null);
    setFormTestResult(null);
    setFormTestLoading(true);
    try {
      const payload = buildCameraPayload();
      const result = await testCameraConnectionApi(
        { ...payload, cameraId: editingCamera?.id },
        activeShopId
      );
      setFormTestResult(result);
    } catch (err: any) {
      setFormError(err?.message || 'Connection test failed.');
    } finally {
      setFormTestLoading(false);
    }
  };

  const handleSaveCameraForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!camName.trim()) {
      setFormError('Camera name is required.');
      return;
    }

    setFormSaveLoading(true);
    try {
      const payload = buildCameraPayload();
      if (editingCamera) {
        const res = await updateCameraApi(
          editingCamera.id,
          { ...payload, testOnSave: true },
          activeShopId
        );
        handleUpdateSingleCameraInState(res.camera);
        setIsCameraModalOpen(false);
        showToast(
          res.camera.status === 'online'
            ? `${res.camera.name} updated and connected!`
            : `${res.camera.name} saved (Status: Offline — ${res.camera.lastError || 'Check connection'})`,
          res.camera.status === 'online' ? 'ok' : 'err'
        );
      } else {
        const res = await createCameraApi({ ...payload, testOnSave: true }, activeShopId);
        onSyncCameras([...cameras, res.camera]);
        setIsCameraModalOpen(false);
        showToast(
          res.camera.status === 'online'
            ? `${res.camera.name} added & connected!`
            : `${res.camera.name} saved (Status: Offline — ${res.camera.lastError || 'Check connection'})`,
          res.camera.status === 'online' ? 'ok' : 'err'
        );
      }
    } catch (err: any) {
      setFormError(err?.message || 'Could not save camera configuration.');
    } finally {
      setFormSaveLoading(false);
    }
  };

  const handleConfirmDeleteCamera = async () => {
    if (!camToDelete) return;
    setBusyAction(`delete:${camToDelete.id}`);
    try {
      await deleteCameraApi(camToDelete.id, activeShopId);
      const next = cameras.filter((c) => c.id !== camToDelete.id);
      onSyncCameras(next);
      if (selectedCameraId === camToDelete.id) {
        setSelectedCameraId(next[0]?.id || null);
        if (next.length === 0) setGridLayout('2x2');
      }
      showToast(`Deleted "${camToDelete.name}".`);
      setCamToDelete(null);
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete camera.', 'err');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefreshSingleCamera = async (cam: CctvCamera) => {
    setBusyAction(`refresh:${cam.id}`);
    try {
      const res = await refreshCameraApi(cam.id, activeShopId);
      handleUpdateSingleCameraInState(res.camera);
      setRefreshTickMap((prev) => ({ ...prev, [cam.id]: (prev[cam.id] || 0) + 1 }));
      showToast(
        res.ok ? `${cam.name} is Online (${res.result.latencyMs ?? '-'}ms)` : `${cam.name}: ${res.result.message}`,
        res.ok ? 'ok' : 'err'
      );
    } catch (err: any) {
      showToast(err?.message || 'Refresh connection failed.', 'err');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefreshAll = async () => {
    setIsRefreshingAll(true);
    try {
      const updated = await refreshAllCamerasApi(activeShopId);
      onSyncCameras(updated);
      const nextTicks: Record<string, number> = { ...refreshTickMap };
      updated.forEach((c) => {
        nextTicks[c.id] = (nextTicks[c.id] || 0) + 1;
      });
      setRefreshTickMap(nextTicks);
      const onlineNow = updated.filter((c) => c.status === 'online').length;
      showToast(`Refreshed ${updated.length} cameras: ${onlineNow} Online, ${updated.length - onlineNow} Offline.`, onlineNow > 0 ? 'ok' : 'err');
    } catch (err: any) {
      showToast(err?.message || 'Failed to refresh cameras.', 'err');
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const handleSaveDvr = async (e: React.FormEvent) => {
    e.preventDefault();
    setDvrSaving(true);
    setDvrTestResult(null);
    try {
      const res = await saveDvrConfigApi(
        {
          brand: dvrBrand,
          dvrIp: dvrIp.trim(),
          port: parseInt(dvrPort, 10) || 554,
          username: dvrUser.trim() || 'admin',
          password: dvrPass || undefined,
          channelCount: channelCount || 8,
        },
        activeShopId
      );
      onSyncDvrConfig(res.dvrConfig);
      setDvrTestResult(res.testResult);
      if (res.testResult.ok) {
        showToast(`DVR connected (${dvrIp})!`);
        setIsDvrModalOpen(false);
      } else {
        showToast(`DVR saved, but probe reported: ${res.testResult.message}`, 'err');
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not save DVR setup.', 'err');
    } finally {
      setDvrSaving(false);
    }
  };

  const handleToggleFullscreen = async () => {
    const el = liveContainerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      showToast('Fullscreen mode is not allowed by this browser/frame.', 'err');
    }
  };

  const handleCaptureSnapshot = async (cam: CctvCamera) => {
    setBusyAction(`snap:${cam.id}`);
    try {
      const blob = await captureCameraSnapshotBlob(cam.id, activeShopId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cam.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast(`Snapshot saved from ${cam.name}!`);
    } catch (err: any) {
      // Fallback: if an active <video> has a rendered frame, capture via canvas
      const v = activeVideoRef.current;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
              if (!blob) return;
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${cam.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.jpg`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              window.setTimeout(() => URL.revokeObjectURL(url), 1500);
              showToast(`Snapshot captured from ${cam.name}!`);
            }, 'image/jpeg', 0.92);
            return;
          }
        } catch {}
      }
      showToast(err?.message || 'Snapshot capture failed.', 'err');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePtz = async (cam: CctvCamera, action: 'left' | 'right' | 'up' | 'down' | 'zoom_in' | 'zoom_out' | 'stop') => {
    setPtzStatusMsg(`Sending PTZ ${action}...`);
    try {
      const res = await sendCameraPtzApi(cam.id, action, activeShopId);
      setPtzStatusMsg(res.message);
    } catch (err: any) {
      setPtzStatusMsg(err?.message || 'PTZ command failed.');
      showToast(err?.message || 'PTZ control failed.', 'err');
    }
  };

  const handleToggleRecording = async (cam: CctvCamera) => {
    setBusyAction(`rec:${cam.id}`);
    try {
      if (cam.isRecording) {
        const stopped = await stopCameraRecordingApi(cam.id, undefined, activeShopId);
        handleUpdateSingleCameraInState({ ...cam, isRecording: false });
        const list = await listCameraRecordingsApi(cam.id, activeShopId);
        setRecordings((prev) => [
          ...list,
          ...prev.filter((r) => r.cameraId !== cam.id),
        ]);
        showToast(`Recording stopped (${stopped.durationSec || 0}s saved).`);
      } else {
        const started = await startCameraRecordingApi(cam.id, activeShopId);
        handleUpdateSingleCameraInState({ ...cam, isRecording: true });
        setRecordings((prev) => [started, ...prev]);
        showToast(`Recording started for ${cam.name}.`);
      }
    } catch (err: any) {
      showToast(err?.message || 'Recording operation failed.', 'err');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePlayRecording = async (entry: CctvRecordingEntry) => {
    try {
      const blobUrl = await fetchAuthorizedRecordingBlobUrl(entry.id, activeShopId);
      setPlaybackRecording({ entry, url: blobUrl });
    } catch (err: any) {
      showToast(err?.message || 'Unable to load recording file.', 'err');
    }
  };

  const handleDeleteRecording = async () => {
    if (!recordingToDelete) return;
    try {
      await deleteCameraRecordingApi(recordingToDelete.id, activeShopId);
      setRecordings((prev) => prev.filter((r) => r.id !== recordingToDelete.id));
      if (playbackRecording?.entry.id === recordingToDelete.id) {
        URL.revokeObjectURL(playbackRecording.url);
        setPlaybackRecording(null);
      }
      showToast('Recording deleted.');
      setRecordingToDelete(null);
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete recording.', 'err');
    }
  };

  const gridClassName =
    gridLayout === '4x4'
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
      : gridLayout === '3x3'
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2';

  const activeCapabilities = selectedCamera?.capabilities;
  const showMuteButton = Boolean(selectedCamera && (selectedCamera.supportsAudio || detectedAudio || activeCapabilities?.audio));
  const showSnapshotButton = Boolean(selectedCamera && activeCapabilities?.snapshot !== false);
  const showPtzPanel = Boolean(selectedCamera && selectedCamera.supportsPtz && canManage);
  const showRecordingPanel = Boolean(
    selectedCamera &&
      gatewayStatus.ffmpegAvailable &&
      selectedCamera.cameraType !== 'webrtc' &&
      (canManage || activeCameraRecordings.length > 0)
  );

  return (
    <div className="flex-1 min-h-full w-full bg-[#0b1329] text-white flex flex-col font-sans">
      <FullScreenPageHeader
        title="CCTV Live Security Monitor"
        subtitle="دکان کیمرہ سسٹم — IP، RTSP، ONVIF اور DVR/NVR لائیو مانیٹر"
        icon={<Video className="w-5 h-5 text-emerald-400" />}
        onBackToHome={onBackToHome}
        accentColor="emerald"
        actions={
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Grid Switcher: 1x1, 2x2 (4), 3x3 (9), 4x4 (16) */}
            <div className="bg-[#1b284f] p-1 rounded-xl flex items-center gap-0.5 sm:gap-1 border border-slate-700">
              {(['1x1', '2x2', '3x3', '4x4'] as GridLayoutMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  data-testid={`cctv-grid-${mode}`}
                  onClick={() => {
                    setGridLayout(mode);
                    if (mode === '1x1' && !selectedCameraId && filteredCameras.length > 0) {
                      setSelectedCameraId(filteredCameras[0].id);
                    }
                  }}
                  className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    gridLayout === mode
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {mode === '1x1' ? '1 Cam' : mode === '2x2' ? '4 Grid' : mode === '3x3' ? '9 Grid' : '16 Grid'}
                </button>
              ))}
            </div>

            <button
              type="button"
              data-testid="cctv-refresh-all-btn"
              onClick={handleRefreshAll}
              disabled={isRefreshingAll || cameras.length === 0}
              className="px-2.5 sm:px-3 py-1.5 bg-[#1b284f] hover:bg-[#25376c] disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isRefreshingAll ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {canManage && (
              <>
                <button
                  type="button"
                  data-testid="cctv-dvr-setup-btn"
                  onClick={() => {
                    setDvrBrand(dvrConfig.brand || 'Hikvision');
                    setDvrIp(dvrConfig.dvrIp || '192.168.1.100');
                    setDvrPort(String(dvrConfig.port || 554));
                    setDvrUser(dvrConfig.username || 'admin');
                    setDvrPass('');
                    setChannelCount(dvrConfig.channelCount || 8);
                    setDvrTestResult(null);
                    setIsDvrModalOpen(true);
                  }}
                  className="px-2.5 sm:px-3 py-1.5 bg-[#1b284f] hover:bg-[#25376c] text-white font-bold text-xs rounded-xl flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer"
                >
                  <Server className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">DVR / NVR</span>
                </button>

                <button
                  type="button"
                  data-testid="cctv-add-camera-btn"
                  onClick={openAddCameraModal}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Camera</span>
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col p-3 sm:p-5 lg:p-6 w-full space-y-4 overflow-y-auto">
        {feedbackToast && (
          <div
            className={`fixed top-16 right-4 z-50 px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2 text-xs font-bold border ${
              feedbackToast.tone === 'ok'
                ? 'bg-emerald-700 text-white border-emerald-400/40'
                : 'bg-red-800 text-white border-red-400/40'
            }`}
          >
            {feedbackToast.tone === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedbackToast.msg}</span>
          </div>
        )}

        {/* Dashboard Overview Strip + Gateway Status */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <div className="bg-[#111c38] border border-slate-700/60 rounded-2xl p-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-slate-400">All Cameras</p>
              <p className="text-lg sm:text-xl font-black text-white">{cameras.length}</p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-[#1b284f] flex items-center justify-center text-emerald-400">
              <Camera className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-[#111c38] border border-slate-700/60 rounded-2xl p-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-slate-400">Online Streams</p>
              <p className="text-lg sm:text-xl font-black text-emerald-400">{onlineCount}</p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Wifi className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-[#111c38] border border-slate-700/60 rounded-2xl p-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-slate-400">Offline / Alerts</p>
              <p className={`text-lg sm:text-xl font-black ${offlineCount > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
                {offlineCount}
              </p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-amber-950/40 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <WifiOff className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-[#111c38] border border-slate-700/60 rounded-2xl p-3 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-400">Streaming Gateway</p>
              <p className="text-xs font-bold text-white truncate">
                {gatewayStatus.ffmpegAvailable ? 'FFmpeg HLS Ready' : 'External HLS/WebRTC Only'}
              </p>
              <p className="text-[10px] text-slate-400 truncate">
                DVR: {dvrConfig.brand} ({dvrConfig.dvrIp}:{dvrConfig.port})
              </p>
            </div>
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                gatewayStatus.ffmpegAvailable
                  ? 'bg-emerald-950/60 text-emerald-400'
                  : 'bg-amber-950/50 text-amber-400'
              }`}
            >
              <Server className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Search + Location Group Filters */}
        <div className="bg-[#111c38] border border-slate-700/60 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              data-testid="cctv-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cameras by name, location, IP or channel..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#1b284f] border border-slate-700 text-xs text-white placeholder-slate-400 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {locationGroups.map((grp) => (
              <button
                key={grp}
                type="button"
                onClick={() => setSelectedGroup(grp)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap border transition-colors cursor-pointer ${
                  selectedGroup === grp
                    ? 'bg-emerald-600 text-white border-emerald-500'
                    : 'bg-[#1b284f] text-slate-300 border-slate-700 hover:text-white'
                }`}
              >
                {grp === 'ALL' ? `All Locations (${cameras.length})` : grp}
              </button>
            ))}
          </div>
        </div>

        {/* Main Viewport: Empty State / Single View / Multi Grid */}
        {cameras.length === 0 ? (
          <div className="bg-[#111c38] rounded-2xl border border-slate-800 p-8 sm:p-12 text-center text-slate-400 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-[#1b284f] text-emerald-400 flex items-center justify-center mx-auto">
              <Camera className="w-8 h-8 stroke-[1.7]" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">No CCTV Cameras Added Yet</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Add your shop IP cameras, RTSP streams, ONVIF cameras, HLS feeds, or DVR/NVR channels to view real-time security feeds.
              </p>
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={openAddCameraModal}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl inline-flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add First Camera</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsDvrModalOpen(true)}
                  className="px-4 py-2.5 bg-[#1b284f] hover:bg-[#25376c] text-white font-bold text-xs rounded-xl inline-flex items-center gap-2 border border-slate-700 cursor-pointer"
                >
                  <Server className="w-4 h-4 text-emerald-400" />
                  <span>Configure DVR / NVR</span>
                </button>
              </div>
            )}
          </div>
        ) : gridLayout === '1x1' && selectedCamera ? (
          /* Single Camera Live View + Controls */
          <div className="space-y-4">
            <div
              ref={liveContainerRef}
              className="bg-black rounded-2xl border border-slate-700 overflow-hidden relative shadow-2xl"
            >
              {/* Top Overlay */}
              <div className="p-3 bg-gradient-to-b from-black/85 to-black/30 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      selectedCamera.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'
                    }`}
                  />
                  <span className="font-bold text-xs sm:text-sm text-white truncate">
                    CH-{selectedCamera.channelNumber} • {selectedCamera.name}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 font-semibold hidden sm:inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-emerald-400" />
                    {selectedCamera.location}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                      selectedCamera.status === 'online'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        : 'bg-red-950 text-red-300 border border-red-500/40'
                    }`}
                  >
                    {selectedCamera.status}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleRefreshSingleCamera(selectedCamera)}
                    title="Refresh & Reconnect"
                    className="px-2.5 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busyAction === `refresh:${selectedCamera.id}` ? 'animate-spin' : ''}`} />
                    <span className="hidden sm:inline">Refresh</span>
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => openEditCameraModal(selectedCamera)}
                      title="Camera Settings"
                      className="px-2.5 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="hidden sm:inline">Settings</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setGridLayout('2x2')}
                    title="Back to Grid"
                    className="px-2.5 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Grid</span>
                  </button>
                </div>
              </div>

              {/* Video Area */}
              <div className="aspect-video w-full bg-black">
                <LiveCameraFeed
                  camera={selectedCamera}
                  shopId={activeShopId}
                  isActiveView={true}
                  muted={isMuted}
                  paused={isPaused}
                  refreshSignal={refreshTickMap[selectedCamera.id] || 0}
                  videoElRef={activeVideoRef}
                  onCameraUpdated={handleUpdateSingleCameraInState}
                  onAudioAvailabilityChange={setDetectedAudio}
                  onToast={showToast}
                />
              </div>

              {/* Supported Controls Toolbar */}
              <div className="p-3 bg-[#111c38] border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsPaused((p) => !p)}
                    className="px-3 py-1.5 rounded-xl bg-[#1b284f] hover:bg-[#25376c] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    {isPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
                    <span>{isPaused ? 'Resume' : 'Pause'}</span>
                  </button>

                  {showMuteButton && (
                    <button
                      type="button"
                      onClick={() => setIsMuted((m) => !m)}
                      className="px-3 py-1.5 rounded-xl bg-[#1b284f] hover:bg-[#25376c] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {isMuted ? <VolumeX className="w-3.5 h-3.5 text-slate-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
                      <span>{isMuted ? 'Unmute' : 'Mute'}</span>
                    </button>
                  )}

                  {showSnapshotButton && (
                    <button
                      type="button"
                      data-testid="cctv-snapshot-btn"
                      onClick={() => handleCaptureSnapshot(selectedCamera)}
                      disabled={busyAction === `snap:${selectedCamera.id}`}
                      className="px-3 py-1.5 rounded-xl bg-[#1b284f] hover:bg-[#25376c] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Snapshot</span>
                    </button>
                  )}

                  {showRecordingPanel && canManage && (
                    <button
                      type="button"
                      data-testid="cctv-record-toggle-btn"
                      onClick={() => handleToggleRecording(selectedCamera)}
                      disabled={busyAction === `rec:${selectedCamera.id}`}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                        selectedCamera.isRecording
                          ? 'bg-red-600 hover:bg-red-700 text-white'
                          : 'bg-[#1b284f] hover:bg-[#25376c] text-white'
                      }`}
                    >
                      {selectedCamera.isRecording ? (
                        <>
                          <Square className="w-3.5 h-3.5 fill-current" />
                          <span>Stop Recording</span>
                        </>
                      ) : (
                        <>
                          <Circle className="w-3.5 h-3.5 text-red-400 fill-red-400" />
                          <span>Record Clip</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 font-mono hidden md:inline">
                    {selectedCamera.resolution} • {selectedCamera.cameraType.toUpperCase()}
                    {selectedCamera.latencyMs ? ` • ${selectedCamera.latencyMs}ms` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={handleToggleFullscreen}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Camera Switcher Strip + Supported PTZ / Recordings Panels */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Quick Camera Selector */}
              <div className="bg-[#111c38] border border-slate-700/60 rounded-2xl p-4 space-y-2.5">
                <h4 className="text-xs font-black text-slate-200 uppercase tracking-wider">Switch Camera</h4>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {filteredCameras.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCameraId(c.id)}
                      className={`w-full px-3 py-2 rounded-xl text-left text-xs flex items-center justify-between border transition-all cursor-pointer ${
                        c.id === selectedCamera.id
                          ? 'bg-emerald-950/60 border-emerald-500 text-white'
                          : 'bg-[#1b284f]/60 border-slate-700/60 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-bold truncate">CH-{c.channelNumber}: {c.name}</p>
                        <p className="text-[10px] text-slate-400 truncate">{c.location}</p>
                      </div>
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          c.status === 'online' ? 'bg-emerald-400' : 'bg-red-500'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* PTZ Controls — Strictly Rendered ONLY When Camera Supports PTZ */}
              {showPtzPanel && (
                <div className="bg-[#111c38] border border-slate-700/60 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black text-slate-200 uppercase tracking-wider">ONVIF PTZ Controls</h4>
                    <span className="text-[10px] text-emerald-400 font-bold">Pan • Tilt • Zoom</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 max-w-[180px] mx-auto">
                    <div />
                    <button
                      type="button"
                      onClick={() => handlePtz(selectedCamera, 'up')}
                      className="p-2.5 rounded-xl bg-[#1b284f] hover:bg-emerald-600 flex items-center justify-center cursor-pointer"
                      aria-label="Tilt Up"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <div />
                    <button
                      type="button"
                      onClick={() => handlePtz(selectedCamera, 'left')}
                      className="p-2.5 rounded-xl bg-[#1b284f] hover:bg-emerald-600 flex items-center justify-center cursor-pointer"
                      aria-label="Pan Left"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePtz(selectedCamera, 'stop')}
                      className="p-2.5 rounded-xl bg-slate-800 hover:bg-red-600 text-[10px] font-black flex items-center justify-center cursor-pointer"
                    >
                      STOP
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePtz(selectedCamera, 'right')}
                      className="p-2.5 rounded-xl bg-[#1b284f] hover:bg-emerald-600 flex items-center justify-center cursor-pointer"
                      aria-label="Pan Right"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <div />
                    <button
                      type="button"
                      onClick={() => handlePtz(selectedCamera, 'down')}
                      className="p-2.5 rounded-xl bg-[#1b284f] hover:bg-emerald-600 flex items-center justify-center cursor-pointer"
                      aria-label="Tilt Down"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <div />
                  </div>
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handlePtz(selectedCamera, 'zoom_in')}
                      className="px-3 py-1.5 rounded-xl bg-[#1b284f] hover:bg-emerald-600 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                      <span>Zoom +</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePtz(selectedCamera, 'zoom_out')}
                      className="px-3 py-1.5 rounded-xl bg-[#1b284f] hover:bg-emerald-600 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                      <span>Zoom -</span>
                    </button>
                  </div>
                  {ptzStatusMsg && (
                    <p className="text-[11px] text-center text-slate-300">{ptzStatusMsg}</p>
                  )}
                </div>
              )}

              {/* Recordings & Playback — Rendered ONLY When Supported */}
              {showRecordingPanel && (
                <div className="bg-[#111c38] border border-slate-700/60 rounded-2xl p-4 space-y-2.5 lg:col-span-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Saved Recordings ({activeCameraRecordings.length})</span>
                    </h4>
                  </div>
                  {activeCameraRecordings.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">
                      No recorded clips yet. Click &ldquo;Record Clip&rdquo; while camera is live to save footage.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {activeCameraRecordings.map((rec) => (
                        <div
                          key={rec.id}
                          className="px-3 py-2 rounded-xl bg-[#1b284f]/70 border border-slate-700 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-white truncate">
                              {new Date(rec.startedAt).toLocaleString()}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {rec.status === 'recording' ? 'Recording now...' : `${Math.max(1, Math.round(rec.sizeBytes / 1024))} KB`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {rec.status === 'ready' && (
                              <button
                                type="button"
                                onClick={() => handlePlayRecording(rec)}
                                className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <Play className="w-3 h-3" />
                                <span>Play</span>
                              </button>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => setRecordingToDelete(rec)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-700 text-slate-300 hover:text-white cursor-pointer"
                                title="Delete recording"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : filteredCameras.length === 0 ? (
          <div className="bg-[#111c38] border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-xs">
            No cameras match your current search or location filter.
          </div>
        ) : (
          /* Responsive Multi-Camera Grid (2x2 = 4, 3x3 = 9, 4x4 = 16) */
          <div className={`grid gap-3 ${gridClassName}`} data-testid="cctv-camera-grid">
            {filteredCameras.map((cam) => (
              <div
                key={cam.id}
                data-testid={`cctv-card-${cam.id}`}
                onClick={() => {
                  setSelectedCameraId(cam.id);
                  setGridLayout('1x1');
                }}
                className="bg-black rounded-2xl border border-slate-800 overflow-hidden relative shadow-md group cursor-pointer hover:border-emerald-500 transition-all flex flex-col"
              >
                {/* Top Info Header */}
                <div className="px-3 py-2 bg-[#111c38] border-b border-slate-800 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        cam.status === 'online'
                          ? 'bg-emerald-400'
                          : cam.status === 'connecting'
                          ? 'bg-amber-400 animate-pulse'
                          : 'bg-red-500'
                      }`}
                    />
                    <span className="font-bold text-white truncate">
                      CH-{cam.channelNumber}: {cam.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        cam.status === 'online'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                          : 'bg-red-950 text-red-300 border border-red-500/30'
                      }`}
                    >
                      {cam.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>

                {/* Live Feed / Truthful Offline Diagnostic */}
                <div className="aspect-video w-full bg-slate-950">
                  <LiveCameraFeed
                    camera={cam}
                    shopId={activeShopId}
                    isActiveView={false}
                    muted={true}
                    paused={false}
                    refreshSignal={refreshTickMap[cam.id] || 0}
                    onCameraUpdated={handleUpdateSingleCameraInState}
                    onToast={showToast}
                  />
                </div>

                {/* Bottom Actions */}
                <div
                  className="px-3 py-2 bg-[#111c38] border-t border-slate-800 flex items-center justify-between gap-2 text-[11px] text-slate-300"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{cam.location}</p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {cam.cameraType.toUpperCase()} • {cam.ipAddress || 'Stream URL'} • {cam.resolution}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      data-testid={`cctv-refresh-${cam.id}`}
                      onClick={() => handleRefreshSingleCamera(cam)}
                      className="p-1.5 rounded-lg bg-[#1b284f] hover:bg-emerald-600 text-slate-200 hover:text-white transition-colors cursor-pointer"
                      title="Refresh Connection"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busyAction === `refresh:${cam.id}` ? 'animate-spin' : ''}`} />
                    </button>
                    {canManage && (
                      <>
                        <button
                          type="button"
                          data-testid={`cctv-edit-${cam.id}`}
                          onClick={() => openEditCameraModal(cam)}
                          className="p-1.5 rounded-lg bg-[#1b284f] hover:bg-blue-600 text-slate-200 hover:text-white transition-colors cursor-pointer"
                          title="Edit Camera"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          data-testid={`cctv-delete-${cam.id}`}
                          onClick={() => setCamToDelete(cam)}
                          className="p-1.5 rounded-lg bg-[#1b284f] hover:bg-red-600 text-slate-200 hover:text-white transition-colors cursor-pointer"
                          title="Delete Camera"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCameraId(cam.id);
                        setGridLayout('1x1');
                      }}
                      className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer"
                      title="Open Large View"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Camera Modal */}
      {isCameraModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-[#111c38] text-white rounded-3xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 shadow-2xl border border-slate-700">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700 mb-4">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm sm:text-base">
                  {editingCamera ? `Edit Camera: ${editingCamera.name}` : 'Add CCTV Camera'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCameraModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCameraForm} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Camera Name *</label>
                  <input
                    type="text"
                    required
                    data-testid="cctv-form-name"
                    value={camName}
                    onChange={(e) => setCamName(e.target.value)}
                    placeholder="e.g. Cash Counter 1"
                    className="w-full font-semibold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">Location / Group *</label>
                  <input
                    type="text"
                    required
                    list="cctv-location-presets"
                    data-testid="cctv-form-location"
                    value={camLocation}
                    onChange={(e) => setCamLocation(e.target.value)}
                    placeholder="Cash Counter / Entrance"
                    className="w-full font-semibold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none focus:border-emerald-500"
                  />
                  <datalist id="cctv-location-presets">
                    {LOCATION_PRESETS.map((loc) => (
                      <option key={loc} value={loc} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-300 mb-1">Camera Type *</label>
                  <select
                    data-testid="cctv-form-type"
                    value={camType}
                    onChange={(e) => handleCameraTypeChange(e.target.value as CctvCameraType)}
                    className="w-full font-semibold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none focus:border-emerald-500"
                  >
                    {CAMERA_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">Channel #</label>
                  <input
                    type="number"
                    min="1"
                    max="64"
                    data-testid="cctv-form-channel"
                    value={camChannel}
                    onChange={(e) => setCamChannel(parseInt(e.target.value, 10) || 1)}
                    className="w-full font-bold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-300 mb-1">Camera IP Address / Host</label>
                  <input
                    type="text"
                    data-testid="cctv-form-ip"
                    value={camIp}
                    onChange={(e) => setCamIp(e.target.value)}
                    placeholder="192.168.1.100 or camera.ddns.net"
                    className="w-full font-mono font-bold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Port</label>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    data-testid="cctv-form-port"
                    value={camPort}
                    onChange={(e) => setCamPort(e.target.value)}
                    placeholder="554"
                    className="w-full font-mono font-bold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Username</label>
                  <input
                    type="text"
                    data-testid="cctv-form-username"
                    value={camUsername}
                    onChange={(e) => setCamUsername(e.target.value)}
                    placeholder="admin"
                    autoComplete="off"
                    className="w-full font-semibold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">
                    Password {editingCamera?.hasPassword ? '(Saved — optional)' : ''}
                  </label>
                  <div className="relative">
                    <input
                      type={showCamPassword ? 'text' : 'password'}
                      data-testid="cctv-form-password"
                      value={camPassword}
                      onChange={(e) => setCamPassword(e.target.value)}
                      placeholder={editingCamera?.hasPassword ? 'Leave blank to keep saved' : 'Camera password'}
                      autoComplete="new-password"
                      className="w-full font-semibold pl-3 pr-9 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCamPassword((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showCamPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">
                  Stream URL (RTSP / HLS .m3u8 / MJPEG / WebRTC WHEP)
                </label>
                <input
                  type="text"
                  data-testid="cctv-form-stream-url"
                  value={camStreamUrl}
                  onChange={(e) => setCamStreamUrl(e.target.value)}
                  placeholder={
                    editingCamera?.streamUrlMasked
                      ? `Saved: ${editingCamera.streamUrlMasked} (enter new URL to replace)`
                      : 'rtsp://192.168.1.100:554/Streaming/Channels/101'
                  }
                  className="w-full font-mono text-[11px] px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Credentials are encrypted on the server and never exposed in browser URLs or logs.
                </p>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  data-testid="cctv-form-description"
                  value={camDescription}
                  onChange={(e) => setCamDescription(e.target.value)}
                  placeholder="Optional notes (e.g., Covers main cash register & safe)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200 font-semibold">
                  <input
                    type="checkbox"
                    checked={camSupportsPtz}
                    onChange={(e) => setCamSupportsPtz(e.target.checked)}
                    className="rounded border-slate-600 accent-emerald-500"
                  />
                  <span>Supports ONVIF PTZ Controls</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200 font-semibold">
                  <input
                    type="checkbox"
                    checked={camSupportsAudio}
                    onChange={(e) => setCamSupportsAudio(e.target.checked)}
                    className="rounded border-slate-600 accent-emerald-500"
                  />
                  <span>Camera Audio Enabled</span>
                </label>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-red-950/70 border border-red-500/40 text-red-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {formTestResult && (
                <div
                  data-testid="cctv-test-result"
                  className={`p-3 rounded-xl border flex items-start gap-2 ${
                    formTestResult.ok
                      ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                      : 'bg-red-950/60 border-red-500/40 text-red-200'
                  }`}
                >
                  {formTestResult.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-0.5">
                    <p className="font-bold">
                      {formTestResult.ok ? 'Connection Verified' : getFriendlyErrorLabel(formTestResult.errorCode)}
                    </p>
                    <p className="text-[11px]">{formTestResult.message}</p>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-700/70 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  data-testid="cctv-form-test-btn"
                  onClick={handleTestCameraInForm}
                  disabled={formTestLoading}
                  className="px-4 py-2 font-bold bg-[#1b284f] hover:bg-[#25376c] border border-slate-600 text-white rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  {formTestLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  ) : (
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span>Test Connection</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCameraModalOpen(false)}
                    className="px-4 py-2 font-bold text-slate-400 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    data-testid="cctv-form-save-btn"
                    disabled={formSaveLoading}
                    className="px-5 py-2 font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    {formSaveLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{editingCamera ? 'Save Changes' : 'Save Camera'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DVR / NVR Master Setup Modal */}
      {isDvrModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#111c38] text-white rounded-3xl w-full max-w-sm p-5 shadow-2xl border border-slate-700">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700 mb-4">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm">DVR / NVR Master Setup</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDvrModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveDvr} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-300 mb-1">DVR / NVR Brand</label>
                <select
                  value={dvrBrand}
                  onChange={(e) => setDvrBrand(e.target.value as DvrNvrConfig['brand'])}
                  className="w-full font-semibold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none"
                >
                  <option value="Hikvision">Hikvision</option>
                  <option value="Dahua">Dahua</option>
                  <option value="Uniview">Uniview</option>
                  <option value="CP PLUS">CP PLUS</option>
                  <option value="Generic ONVIF">Generic ONVIF / RTSP</option>
                  <option value="Custom RTSP/IP">Custom RTSP / IP</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">DVR IP Address / DDNS Host *</label>
                <input
                  type="text"
                  required
                  value={dvrIp}
                  onChange={(e) => setDvrIp(e.target.value)}
                  placeholder="192.168.1.100"
                  className="w-full font-mono font-bold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">RTSP Port</label>
                  <input
                    type="number"
                    value={dvrPort}
                    onChange={(e) => setDvrPort(e.target.value)}
                    className="w-full font-mono font-bold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Channels</label>
                  <select
                    value={channelCount}
                    onChange={(e) => setChannelCount(parseInt(e.target.value, 10))}
                    className="w-full font-semibold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none"
                  >
                    <option value={4}>4 Channel</option>
                    <option value={8}>8 Channel</option>
                    <option value={16}>16 Channel</option>
                    <option value={32}>32 Channel</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">DVR Username</label>
                  <input
                    type="text"
                    value={dvrUser}
                    onChange={(e) => setDvrUser(e.target.value)}
                    className="w-full font-semibold px-3 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300 mb-1">DVR Password</label>
                  <div className="relative">
                    <input
                      type={showDvrPass ? 'text' : 'password'}
                      value={dvrPass}
                      onChange={(e) => setDvrPass(e.target.value)}
                      placeholder={dvrConfig.hasPassword ? 'Keep saved' : 'Password'}
                      className="w-full font-semibold pl-3 pr-8 py-2 rounded-xl border border-slate-700 bg-[#1b284f] text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDvrPass((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showDvrPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {dvrTestResult && (
                <div
                  className={`p-2.5 rounded-xl border text-[11px] ${
                    dvrTestResult.ok
                      ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                      : 'bg-red-950/60 border-red-500/40 text-red-200'
                  }`}
                >
                  {dvrTestResult.message}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsDvrModalOpen(false)}
                  className="px-4 py-2 font-bold text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dvrSaving}
                  className="px-5 py-2 font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  {dvrSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save & Test DVR</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Delete Camera Modal */}
      {camToDelete && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#111c38] text-white rounded-3xl w-full max-w-sm p-5 shadow-2xl border border-slate-700 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-950/70 border border-red-500/40 flex items-center justify-center text-red-400 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm">Delete Camera?</h3>
                <p className="text-xs text-slate-400">
                  Remove <strong>{camToDelete.name}</strong> ({camToDelete.location}) from your CCTV monitor?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCamToDelete(null)}
                className="px-4 py-2 rounded-xl bg-[#1b284f] text-slate-300 hover:text-white text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="cctv-confirm-delete-btn"
                onClick={handleConfirmDeleteCamera}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Recording Modal */}
      {recordingToDelete && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#111c38] text-white rounded-3xl w-full max-w-sm p-5 shadow-2xl border border-slate-700 space-y-4">
            <h3 className="font-bold text-sm">Delete Recording Clip?</h3>
            <p className="text-xs text-slate-400">
              This will permanently remove the saved video clip from {recordingToDelete.cameraName}.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRecordingToDelete(null)}
                className="px-4 py-2 rounded-xl bg-[#1b284f] text-slate-300 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteRecording}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
              >
                Delete Recording
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recorded Clip Playback Modal */}
      {playbackRecording && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#111c38] text-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-700">
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm">{playbackRecording.entry.cameraName} — Recorded Playback</h3>
                <p className="text-[11px] text-slate-400">
                  {new Date(playbackRecording.entry.startedAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(playbackRecording.url);
                  setPlaybackRecording(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-black aspect-video">
              <video
                src={playbackRecording.url}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
