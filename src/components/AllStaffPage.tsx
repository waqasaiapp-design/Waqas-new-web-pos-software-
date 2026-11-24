import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Users,
  Plus,
  Search,
  Printer,
  Trash2,
  Edit2,
  X,
  CheckCircle2,
  DollarSign,
  Camera,
  Upload,
  AlertCircle,
  User as UserIcon,
  KeyRound,
  Shield,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Phone,
  MapPin,
  Briefcase,
  Calendar,
  Clock,
  Lock,
  Check,
  Eye,
  UserCheck,
  Wallet,
} from 'lucide-react';
import {
  StaffMember,
  StaffSalaryPayment,
  StaffAttendanceRecord,
  StaffModulePermissions,
  DEFAULT_STAFF_PERMISSIONS,
  StoreBranding,
} from '../types/pos';
import { formatRs } from '../data/defaultProducts';
import { FullScreenPageHeader } from './FullScreenPageHeader';
import { printStaffDirectoryReport, printStaffProfileReport } from '../utils/printerService';

interface AllStaffPageProps {
  staffList: StaffMember[];
  branding?: StoreBranding;
  onSaveStaff: (staff: StaffMember) => void;
  onDeleteStaff: (staffId: string) => void;
  onDeleteAllStaff?: () => void;
  onBackToHome?: () => void;
}

type StaffViewMode = 'overview' | 'list' | 'profile';
type StatusFilterType = 'ALL' | 'active' | 'suspended' | 'resigned';

const MODULE_PERMISSION_ITEMS: Array<[keyof StaffModulePermissions, string]> = [
  ['newSale', 'New Sale'],
  ['oldSale', 'Old Sale'],
  ['newPurchase', 'New Purchase'],
  ['oldPurchase', 'Old Purchase'],
  ['stock', 'Stock Mgmt'],
  ['products', 'Products'],
  ['customers', 'Customers'],
  ['suppliers', 'Suppliers'],
  ['expenses', 'Expenses'],
  ['reports', 'Reports'],
  ['printing', 'Printing'],
  ['settings', 'Settings'],
];

const GRANULAR_PERMISSION_ITEMS: Array<[keyof StaffModulePermissions, string]> = [
  ['canViewCostAndProfit', 'View Cost Prices & Profit'],
  ['canEditPrice', 'Edit Item Prices'],
  ['canGiveDiscount', 'Apply Discounts'],
  ['canDeleteItems', 'Delete Invoices / Rows'],
];

const ALLOW_ALL_PERMISSIONS: StaffModulePermissions = {
  newSale: true,
  oldSale: true,
  newPurchase: true,
  oldPurchase: true,
  stock: true,
  products: true,
  customers: true,
  suppliers: true,
  expenses: true,
  reports: true,
  printing: true,
  settings: true,
  canEditPrice: true,
  canGiveDiscount: true,
  canDeleteItems: true,
  canAccessReports: true,
  canAccessSettings: true,
  canAccessLedgers: true,
  canViewCostAndProfit: true,
};

function getInitials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'ST';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

const StaffAvatar: React.FC<{
  photoUrl?: string;
  name: string;
  sizeClass?: string;
  textClass?: string;
}> = ({ photoUrl, name, sizeClass = 'w-12 h-12 rounded-xl', textClass = 'text-sm' }) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [photoUrl]);

  const showImg = Boolean(photoUrl && !imgError);

  return (
    <div
      className={`${sizeClass} bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0 text-slate-700 font-bold ${textClass}`}
    >
      {showImg ? (
        <img
          src={photoUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
};

function renderStatusText(status: StaffMember['accountStatus']) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>Active</span>
      </span>
    );
  }
  if (status === 'suspended') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>Suspended</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      <span>Resigned</span>
    </span>
  );
}

export const AllStaffPage: React.FC<AllStaffPageProps> = ({
  staffList,
  branding,
  onSaveStaff,
  onDeleteStaff,
  onDeleteAllStaff,
  onBackToHome,
}) => {
  // 3-screen navigation state
  const [viewMode, setViewMode] = useState<StaffViewMode>('overview');
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [profileSectionTab, setProfileSectionTab] = useState<'details' | 'records'>('details');

  // Directory filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Modals & notifications
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPaySalaryModalOpen, setIsPaySalaryModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [salaryError, setSalaryError] = useState<string | null>(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [staffToDeleteId, setStaffToDeleteId] = useState<string | null>(null);
  const [printFeedback, setPrintFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Add/Edit Form collapsible sections
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);
  const [showPermissionsSection, setShowPermissionsSection] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [role, setRole] = useState<StaffMember['role']>('Cashier');
  const [department, setDepartment] = useState<StaffMember['department']>('Sales');
  const [joiningDate, setJoiningDate] = useState(new Date().toLocaleDateString('en-GB'));
  const [salary, setSalary] = useState('');
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [staffFormError, setStaffFormError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<StaffModulePermissions>({ ...DEFAULT_STAFF_PERMISSIONS });
  const [shift, setShift] = useState<StaffMember['shift']>('Morning');
  const [accountStatus, setAccountStatus] = useState<StaffMember['accountStatus']>('active');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  // Camera / File upload refs & state
  const photoUploadRef = useRef<HTMLInputElement>(null);
  const cameraFileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Salary Payment State
  const [salaryPayAmount, setSalaryPayAmount] = useState('');
  const [salaryMonth, setSalaryMonth] = useState(
    new Date().toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })
  );
  const [salaryPayMethod, setSalaryPayMethod] = useState('Cash');

  const showToast = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const stopCameraStream = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setIsCameraOpen(false);
    setCameraError(null);
  };

  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const selectedStaff = useMemo(
    () => staffList.find((s) => s.id === selectedStaffId) || null,
    [staffList, selectedStaffId]
  );

  useEffect(() => {
    if (viewMode === 'profile' && !selectedStaff) {
      setViewMode('list');
      setSelectedStaffId(null);
    }
  }, [viewMode, selectedStaff]);

  const metrics = useMemo(() => {
    const total = staffList.length;
    const active = staffList.filter((s) => s.accountStatus === 'active').length;
    const cashiersAndSales = staffList.filter(
      (s) => s.role === 'Cashier' || s.role === 'Sales Staff'
    ).length;
    const monthlyPayroll = staffList.reduce((acc, s) => acc + (Number(s.salary) || 0), 0);
    return { total, active, cashiersAndSales, monthlyPayroll };
  }, [staffList]);

  const roleBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const st of staffList) {
      counts.set(st.role, (counts.get(st.role) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [staffList]);

  const filteredStaff = useMemo(() => {
    return staffList.filter((s) => {
      if (statusFilter !== 'ALL' && s.accountStatus !== statusFilter) return false;
      if (roleFilter === 'CASHIERS_SALES') {
        if (s.role !== 'Cashier' && s.role !== 'Sales Staff') return false;
      } else if (roleFilter !== 'ALL' && s.role !== roleFilter) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        s.name.toLowerCase().includes(q) ||
        s.employeeId.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q)
      );
    });
  }, [staffList, statusFilter, roleFilter, searchQuery]);

  const openStaffDirectory = (opts?: { status?: StatusFilterType; role?: string }) => {
    setStatusFilter(opts?.status ?? 'ALL');
    setRoleFilter(opts?.role ?? 'ALL');
    setSelectedStaffId(null);
    setStaffToDeleteId(null);
    setViewMode('list');
  };

  const openStaffProfile = (staffId: string, tab: 'details' | 'records' = 'details') => {
    setSelectedStaffId(staffId);
    setProfileSectionTab(tab);
    setStaffToDeleteId(null);
    setViewMode('profile');
  };

  const compressImageToDataUrl = (srcUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 420;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } else {
          resolve(srcUrl);
        }
      };
      img.onerror = () => resolve(srcUrl);
      img.src = srcUrl;
    });
  };

  const handlePhotoFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target?.result;
      if (typeof raw === 'string') {
        const compressed = await compressImageToDataUrl(raw);
        setPhotoUrl(compressed);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleOpenCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      cameraFileRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setIsCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      cameraFileRef.current?.click();
    }
  };

  const handleCaptureFromCamera = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    const vw = video.videoWidth || 480;
    const vh = video.videoHeight || 480;
    const scale = Math.min(1, 420 / Math.max(vw, vh));
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setPhotoUrl(canvas.toDataURL('image/jpeg', 0.84));
    }
    stopCameraStream();
  };

  const handlePrintStaffList = async () => {
    setIsPrinting(true);
    setPrintFeedback(null);
    const listToPrint = viewMode === 'list' ? filteredStaff : staffList;
    const result = await printStaffDirectoryReport(listToPrint, branding);
    setIsPrinting(false);
    setPrintFeedback({ type: result.ok ? 'success' : 'error', message: result.message });
    setTimeout(() => setPrintFeedback(null), 5000);
  };

  const handlePrintStaffProfile = async (staff: StaffMember) => {
    setIsPrinting(true);
    setPrintFeedback(null);
    const result = await printStaffProfileReport(staff, branding);
    setIsPrinting(false);
    setPrintFeedback({ type: result.ok ? 'success' : 'error', message: result.message });
    setTimeout(() => setPrintFeedback(null), 5000);
  };

  const handleOpenAdd = () => {
    setEditingStaff(null);
    setName('');
    setEmployeeId(`WM-EMP-${String(staffList.length + 1).padStart(3, '0')}`);
    setPhone('');
    setAddress('');
    setRole('Cashier');
    setDepartment('Sales');
    setJoiningDate(new Date().toLocaleDateString('en-GB'));
    setSalary('');
    setUsername(`staff${staffList.length + 1}`);
    setNewPassword('');
    setStaffFormError(null);
    setPermissions({ ...DEFAULT_STAFF_PERMISSIONS });
    setShift('Morning');
    setAccountStatus('active');
    setNotes('');
    setPhotoUrl('');
    setShowAdvancedDetails(false);
    setShowPermissionsSection(false);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (st: StaffMember) => {
    setEditingStaff(st);
    setName(st.name);
    setEmployeeId(st.employeeId);
    setPhone(st.phone);
    setAddress(st.address);
    setRole(st.role);
    setDepartment(st.department);
    setJoiningDate(st.joiningDate);
    setSalary(st.salary.toString());
    setUsername(st.username);
    setNewPassword('');
    setStaffFormError(null);
    setPermissions({ ...DEFAULT_STAFF_PERMISSIONS, ...(st.permissions || {}) });
    setShift(st.shift);
    setAccountStatus(st.accountStatus);
    setNotes(st.notes || '');
    setPhotoUrl(st.photoUrl || '');
    setShowAdvancedDetails(Boolean(st.address || st.notes));
    setShowPermissionsSection(false);
    setIsAddModalOpen(true);
  };

  const handleSaveStaffMember = (e: React.FormEvent) => {
    e.preventDefault();
    setStaffFormError(null);
    if (!name.trim()) {
      setStaffFormError('Full name is required.');
      return;
    }
    if (!username.trim()) {
      setStaffFormError('Login username is required.');
      return;
    }
    if (!editingStaff && newPassword.trim().length > 0 && newPassword.trim().length < 4) {
      setStaffFormError('Staff password must be at least 4 characters.');
      return;
    }
    if (editingStaff && newPassword.trim().length > 0 && newPassword.trim().length < 4) {
      setStaffFormError('New password must be at least 4 characters.');
      return;
    }

    const baseSalary = parseFloat(salary) || 0;
    const syncedPerms: StaffModulePermissions = {
      ...permissions,
      canAccessReports: permissions.reports || permissions.canAccessReports,
      canAccessSettings: permissions.settings || permissions.canAccessSettings,
      canAccessLedgers: permissions.customers || permissions.suppliers || permissions.canAccessLedgers,
    };

    const updated: StaffMember & { newPassword?: string } = {
      id: editingStaff ? editingStaff.id : `staff-${Date.now()}`,
      employeeId: employeeId.trim() || `WM-EMP-${Date.now().toString().slice(-3)}`,
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      role,
      department,
      joiningDate: joiningDate.trim() || new Date().toLocaleDateString('en-GB'),
      salary: baseSalary,
      username: username.trim().toLowerCase() || name.toLowerCase().replace(/\s+/g, ''),
      accountStatus,
      shift,
      photoUrl: photoUrl || undefined,
      notes: notes.trim() || undefined,
      permissions: syncedPerms,
      salaryPayments: editingStaff?.salaryPayments || [],
      attendance: editingStaff?.attendance || [],
      createdAt: editingStaff ? editingStaff.createdAt : new Date().toISOString(),
      ...(newPassword.trim().length >= 4 ? { newPassword: newPassword.trim() } : {}),
    };

    onSaveStaff(updated);
    setIsAddModalOpen(false);
    showToast(`Staff member "${updated.name}" saved successfully!`);
  };

  const handleRecordSalaryPayment = (e: React.FormEvent) => {
    e.preventDefault();
    setSalaryError(null);
    if (!selectedStaff) return;
    const amt = parseFloat(salaryPayAmount);
    if (isNaN(amt) || amt <= 0) {
      setSalaryError('Please enter a valid salary amount.');
      return;
    }

    const payment: StaffSalaryPayment = {
      id: `sal-${Date.now()}`,
      date: new Date().toLocaleDateString('en-GB'),
      month: salaryMonth.trim() || new Date().toLocaleDateString('en-PK', { month: 'long', year: 'numeric' }),
      amount: amt,
      paymentMethod: salaryPayMethod,
      notes: 'Paid monthly salary',
    };

    const updated: StaffMember = {
      ...selectedStaff,
      salaryPayments: [payment, ...(selectedStaff.salaryPayments || [])],
    };

    onSaveStaff(updated);
    setIsPaySalaryModalOpen(false);
    setSalaryPayAmount('');
    showToast(`Salary payment of Rs. ${amt.toFixed(0)} recorded for ${selectedStaff.name}!`);
  };

  const handleMarkTodayAttendance = (status: StaffAttendanceRecord['status']) => {
    if (!selectedStaff) return;
    const todayDate = new Date().toLocaleDateString('en-GB');
    const nowTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const existing = selectedStaff.attendance || [];
    const filtered = existing.filter((a) => a.date !== todayDate);
    const nextRecord: StaffAttendanceRecord = {
      id: `att-${Date.now()}`,
      date: todayDate,
      status,
      checkIn: status === 'present' || status === 'half_day' ? nowTime : undefined,
    };

    const updated: StaffMember = {
      ...selectedStaff,
      attendance: [nextRecord, ...filtered],
    };

    onSaveStaff(updated);
    showToast(`Marked ${selectedStaff.name} as ${status.replace('_', ' ')} for ${todayDate}.`);
  };

  const enabledModulesCount = useMemo(
    () => MODULE_PERMISSION_ITEMS.filter(([key]) => Boolean(permissions[key])).length,
    [permissions]
  );

  return (
    <div className="flex-1 min-h-full w-full bg-[#f8fafc] text-slate-900 flex flex-col font-sans">
      <FullScreenPageHeader
        title="Staff Management"
        subtitle="ملازمین کا انتظام، پروفائل، حاضری اور تنخواہیں"
        icon={<Users className="w-5 h-5 text-sky-600" />}
        onBackToHome={onBackToHome}
        accentColor="sky"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPrinting}
              onClick={handlePrintStaffList}
              className="px-3 py-2 min-h-[38px] bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{isPrinting ? 'Printing...' : 'Print List'}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenAdd}
              className="px-3.5 py-2 min-h-[38px] bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 shadow-xs transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4 stroke-[2.5] shrink-0" />
              <span>Add Staff</span>
            </button>
          </div>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-3 sm:p-5 space-y-4">
          {/* Feedback banners */}
          {feedbackMsg && (
            <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{feedbackMsg}</span>
            </div>
          )}

          {printFeedback && (
            <div
              className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs font-semibold ${
                printFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {printFeedback.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                <span>{printFeedback.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setPrintFeedback(null)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                aria-label="Dismiss print message"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ================================================================
              VIEW 1: COMPACT STAFF OVERVIEW DASHBOARD
              ================================================================ */}
          {viewMode === 'overview' && (
            <div className="space-y-4">
              {/* 4 Clean Clickable Summary Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => openStaffDirectory({ status: 'ALL', role: 'ALL' })}
                  className="text-left bg-sky-600 hover:bg-sky-700 text-white rounded-2xl p-4 shadow-xs transition-all cursor-pointer flex flex-col justify-between min-h-[108px] group"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-100">
                      Total Staff
                    </span>
                    <Users className="w-4 h-4 text-sky-100 shrink-0" />
                  </div>
                  <div className="mt-2">
                    <div className="text-2xl sm:text-3xl font-extrabold tabular-nums">
                      {metrics.total}
                    </div>
                    <div className="text-xs text-sky-100 mt-0.5 flex items-center gap-1 group-hover:underline">
                      <span>Open Staff List</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => openStaffDirectory({ status: 'active', role: 'ALL' })}
                  className="text-left bg-white hover:border-emerald-400 border border-slate-200 rounded-2xl p-4 transition-all cursor-pointer flex flex-col justify-between min-h-[108px]"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Active Staff
                    </span>
                    <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  </div>
                  <div className="mt-2">
                    <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums">
                      {metrics.active}
                    </div>
                    <div className="text-xs text-emerald-700 font-medium mt-0.5">
                      On active POS duty
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => openStaffDirectory({ status: 'ALL', role: 'CASHIERS_SALES' })}
                  className="text-left bg-white hover:border-sky-400 border border-slate-200 rounded-2xl p-4 transition-all cursor-pointer flex flex-col justify-between min-h-[108px]"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Cashiers &amp; Sales
                    </span>
                    <Briefcase className="w-4 h-4 text-sky-600 shrink-0" />
                  </div>
                  <div className="mt-2">
                    <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums">
                      {metrics.cashiersAndSales}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Front counter &amp; floor
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => openStaffDirectory({ status: 'ALL', role: 'ALL' })}
                  className="text-left bg-white hover:border-slate-400 border border-slate-200 rounded-2xl p-4 transition-all cursor-pointer flex flex-col justify-between min-h-[108px]"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Monthly Payroll
                    </span>
                    <Wallet className="w-4 h-4 text-slate-700 shrink-0" />
                  </div>
                  <div className="mt-2">
                    <div className="text-xl sm:text-2xl font-extrabold text-slate-900 tabular-nums truncate">
                      {formatRs(metrics.monthlyPayroll)}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Base salary commitment
                    </div>
                  </div>
                </button>
              </div>

              {/* Clean Quick Actions & Role Summary (NO bloated table on Overview) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        Staff Directory &amp; Operations
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        View employee cards, update POS access permissions, mark attendance, and record salaries.
                      </p>
                    </div>
                  </div>

                  {staffList.length === 0 ? (
                    <div className="py-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 px-4">
                      <Users className="w-9 h-9 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-slate-700">No employees added yet</p>
                      <p className="text-xs text-slate-500 mt-0.5 mb-3">
                        Add your cashiers, managers, and store staff to manage logins and payroll.
                      </p>
                      <button
                        type="button"
                        onClick={handleOpenAdd}
                        className="px-4 py-2.5 min-h-[44px] bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add First Staff Member</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => openStaffDirectory({ status: 'ALL', role: 'ALL' })}
                        className="px-4 py-2.5 min-h-[44px] bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl flex items-center gap-2 cursor-pointer whitespace-nowrap"
                      >
                        <Users className="w-4 h-4" />
                        <span>Open Total Staff ({staffList.length})</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleOpenAdd}
                        className="px-4 py-2.5 min-h-[44px] bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add New Staff</span>
                      </button>

                      <button
                        type="button"
                        disabled={isPrinting}
                        onClick={handlePrintStaffList}
                        className="px-4 py-2.5 min-h-[44px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Printer className="w-4 h-4" />
                        <span>Print Staff List</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Compact Role Distribution */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-900">Team by Role</h3>
                    {staffList.length > 0 && (
                      <button
                        type="button"
                        onClick={() => openStaffDirectory({ status: 'ALL', role: 'ALL' })}
                        className="text-xs font-semibold text-sky-700 hover:underline cursor-pointer"
                      >
                        View all
                      </button>
                    )}
                  </div>

                  {roleBreakdown.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">
                      Role summary appears once staff are registered.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {roleBreakdown.map(([roleName, count]) => (
                        <button
                          key={roleName}
                          type="button"
                          onClick={() => openStaffDirectory({ status: 'ALL', role: roleName })}
                          className="w-full py-2.5 flex items-center justify-between text-left hover:bg-slate-50 px-1.5 -mx-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          <span className="text-xs font-medium text-slate-700">{roleName}</span>
                          <span className="text-xs font-bold text-slate-900 tabular-nums flex items-center gap-1">
                            <span>{count}</span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              VIEW 2: COMPLETE STAFF LIST (CARD GRID)
              ================================================================ */}
          {viewMode === 'list' && (
            <div className="space-y-3.5">
              {/* Toolbar */}
              <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setViewMode('overview');
                        setShowDeleteAllConfirm(false);
                      }}
                      className="px-3 py-2 min-h-[40px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                    <div>
                      <h2 className="text-sm sm:text-base font-bold text-slate-900">
                        Total Staff Directory
                      </h2>
                      <p className="text-xs text-slate-500 tabular-nums">
                        Showing {filteredStaff.length} of {staffList.length} employees
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleOpenAdd}
                      className="px-3.5 py-2 min-h-[40px] bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Staff</span>
                    </button>

                    <button
                      type="button"
                      disabled={isPrinting}
                      onClick={handlePrintStaffList}
                      className="px-3 py-2 min-h-[40px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Print List</span>
                    </button>

                    {staffList.length > 0 && onDeleteAllStaff && (
                      showDeleteAllConfirm ? (
                        <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-xl">
                          <span className="text-xs font-semibold text-red-700">
                            Delete all {staffList.length}?
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteAllStaff();
                              setShowDeleteAllConfirm(false);
                            }}
                            className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowDeleteAllConfirm(false)}
                            className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowDeleteAllConfirm(true)}
                          className="px-3 py-2 min-h-[40px] bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Delete All ({staffList.length})</span>
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Search + Filters */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 pt-2 border-t border-slate-100">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search by name, Employee ID, phone, username..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 min-h-[40px] bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:bg-white focus:border-sky-500"
                    />
                  </div>

                  {/* Interactive Status Tabs */}
                  <div className="inline-flex items-center bg-slate-100 p-1 rounded-xl gap-1 overflow-x-auto">
                    {(
                      [
                        ['ALL', 'All'],
                        ['active', 'Active'],
                        ['suspended', 'Suspended'],
                        ['resigned', 'Resigned'],
                      ] as Array<[StatusFilterType, string]>
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStatusFilter(key)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                          statusFilter === key
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    aria-label="Filter by role"
                    className="px-3 py-2 min-h-[40px] bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:border-sky-500"
                  >
                    <option value="ALL">All Roles</option>
                    <option value="CASHIERS_SALES">Cashiers &amp; Sales</option>
                    <option value="Cashier">Cashier</option>
                    <option value="Manager">Manager</option>
                    <option value="Sales Staff">Sales Staff</option>
                    <option value="Stock Keeper">Stock Keeper</option>
                    <option value="Security">Security</option>
                    <option value="Cleaner">Cleaner</option>
                  </select>
                </div>
              </div>

              {/* Staff Card Grid */}
              {filteredStaff.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl py-12 px-4 text-center">
                  <Users className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                  <p className="text-sm font-bold text-slate-800">No matching staff members</p>
                  <p className="text-xs text-slate-500 mt-1 mb-4">
                    {staffList.length === 0
                      ? 'Add your first employee to get started.'
                      : 'Try clearing your search or switching the status/role filter.'}
                  </p>
                  {staffList.length === 0 ? (
                    <button
                      type="button"
                      onClick={handleOpenAdd}
                      className="px-4 py-2.5 min-h-[44px] bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Staff Member</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setStatusFilter('ALL');
                        setRoleFilter('ALL');
                      }}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl cursor-pointer"
                    >
                      Reset Filters
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {filteredStaff.map((st) => (
                    <div
                      key={st.id}
                      onClick={() => openStaffProfile(st.id, 'details')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openStaffProfile(st.id, 'details');
                        }
                      }}
                      className="bg-white border border-slate-200 hover:border-sky-400 rounded-2xl p-4 transition-all cursor-pointer flex flex-col justify-between gap-3 group"
                    >
                      <div className="flex items-start gap-3">
                        <StaffAvatar
                          photoUrl={st.photoUrl}
                          name={st.name}
                          sizeClass="w-14 h-14 rounded-xl"
                          textClass="text-base"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-semibold text-slate-500 tabular-nums truncate">
                              {st.employeeId}
                            </span>
                            {renderStatusText(st.accountStatus)}
                          </div>
                          <h3 className="text-sm font-bold text-slate-900 truncate mt-0.5 group-hover:text-sky-700">
                            {st.name}
                          </h3>
                          <p className="text-xs text-slate-600 truncate mt-0.5">
                            {st.role} · {st.shift}
                          </p>
                        </div>
                      </div>

                      <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                        <div className="text-slate-600 truncate">
                          <span>{st.phone || st.username}</span>
                        </div>
                        <div className="font-bold text-slate-900 tabular-nums shrink-0">
                          {formatRs(st.salary)}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-xs font-semibold text-sky-700 flex items-center gap-1 group-hover:underline">
                          <span>Open Profile</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </span>

                        {staffToDeleteId === st.id ? (
                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteStaff(st.id);
                                setStaffToDeleteId(null);
                              }}
                              className="px-2.5 py-1 bg-red-600 text-white rounded-lg text-[11px] font-semibold cursor-pointer"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setStaffToDeleteId(null)}
                              className="px-2 py-1 bg-slate-100 text-slate-700 rounded-lg text-[11px] font-semibold cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStaffToDeleteId(st.id);
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete Staff"
                            aria-label={`Delete ${st.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              VIEW 3: INDIVIDUAL EMPLOYEE PROFILE PAGE
              ================================================================ */}
          {viewMode === 'profile' && selectedStaff && (
            <div className="space-y-4">
              {/* Top Action Bar */}
              <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('list');
                    setStaffToDeleteId(null);
                  }}
                  className="px-3.5 py-2 min-h-[40px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setProfileSectionTab((prev) => (prev === 'details' ? 'records' : 'details'))
                    }
                    className={`px-3 py-2 min-h-[40px] border font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                      profileSectionTab === 'details'
                        ? 'bg-sky-50 border-sky-200 text-sky-800'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{profileSectionTab === 'details' ? 'Attendance & Salary' : 'View Details'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenEdit(selectedStaff)}
                    className="px-3 py-2 min-h-[40px] bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit Profile</span>
                  </button>

                  <button
                    type="button"
                    disabled={isPrinting}
                    onClick={() => handlePrintStaffProfile(selectedStaff)}
                    className="px-3 py-2 min-h-[40px] bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print Profile</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSalaryPayAmount(selectedStaff.salary.toString());
                      setSalaryError(null);
                      setIsPaySalaryModalOpen(true);
                    }}
                    className="px-3.5 py-2 min-h-[40px] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>Pay Salary</span>
                  </button>

                  {staffToDeleteId === selectedStaff.id ? (
                    <div className="flex items-center gap-1 bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-xl">
                      <button
                        type="button"
                        onClick={() => {
                          const removedId = selectedStaff.id;
                          setStaffToDeleteId(null);
                          setSelectedStaffId(null);
                          setViewMode('list');
                          onDeleteStaff(removedId);
                        }}
                        className="px-2.5 py-1 bg-red-600 text-white rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Confirm Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setStaffToDeleteId(null)}
                        className="px-2 py-1 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStaffToDeleteId(selectedStaff.id)}
                      className="px-3 py-2 min-h-[40px] bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Employee Identity Banner */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <StaffAvatar
                    photoUrl={selectedStaff.photoUrl}
                    name={selectedStaff.name}
                    sizeClass="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl"
                    textClass="text-xl"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-sky-700 tabular-nums">
                        {selectedStaff.employeeId}
                      </span>
                      <span className="text-slate-300">·</span>
                      {renderStatusText(selectedStaff.accountStatus)}
                    </div>
                    <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 truncate mt-0.5">
                      {selectedStaff.name}
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {selectedStaff.role} · {selectedStaff.department} · {selectedStaff.shift} Shift
                    </p>
                  </div>
                </div>

                <div className="sm:text-right">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 block">
                    Monthly Base Salary
                  </span>
                  <span className="text-2xl font-extrabold text-emerald-700 tabular-nums">
                    {formatRs(selectedStaff.salary)}
                  </span>
                </div>
              </div>

              {/* Profile Tabs */}
              <div className="inline-flex items-center bg-slate-200/70 p-1 rounded-xl gap-1">
                <button
                  type="button"
                  onClick={() => setProfileSectionTab('details')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    profileSectionTab === 'details'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Profile &amp; Permissions
                </button>
                <button
                  type="button"
                  onClick={() => setProfileSectionTab('records')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    profileSectionTab === 'records'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Attendance &amp; Salary ({(selectedStaff.attendance || []).length} /{' '}
                  {(selectedStaff.salaryPayments || []).length})
                </button>
              </div>

              {profileSectionTab === 'details' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Personal, Contact & Account Info */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                    <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
                      Employee Information &amp; Login Account
                    </h3>

                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="space-y-0.5">
                        <dt className="text-slate-500 flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5" />
                          <span>Phone Number</span>
                        </dt>
                        <dd className="font-semibold text-slate-900 tabular-nums">
                          {selectedStaff.phone || 'Not provided'}
                        </dd>
                      </div>

                      <div className="space-y-0.5">
                        <dt className="text-slate-500 flex items-center gap-1">
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>Login Username</span>
                        </dt>
                        <dd className="font-mono font-semibold text-slate-900">
                          {selectedStaff.username}
                        </dd>
                      </div>

                      <div className="space-y-0.5">
                        <dt className="text-slate-500 flex items-center gap-1">
                          <Briefcase className="w-3.5 h-3.5" />
                          <span>Department</span>
                        </dt>
                        <dd className="font-semibold text-slate-900">{selectedStaff.department}</dd>
                      </div>

                      <div className="space-y-0.5">
                        <dt className="text-slate-500 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Work Shift</span>
                        </dt>
                        <dd className="font-semibold text-slate-900">{selectedStaff.shift}</dd>
                      </div>

                      <div className="space-y-0.5">
                        <dt className="text-slate-500 flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>Joining Date</span>
                        </dt>
                        <dd className="font-semibold text-slate-900 tabular-nums">
                          {selectedStaff.joiningDate || 'Not set'}
                        </dd>
                      </div>

                      <div className="space-y-0.5">
                        <dt className="text-slate-500">Account Status</dt>
                        <dd>{renderStatusText(selectedStaff.accountStatus)}</dd>
                      </div>

                      <div className="sm:col-span-2 space-y-0.5">
                        <dt className="text-slate-500 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          <span>Residential Address</span>
                        </dt>
                        <dd className="font-medium text-slate-900">
                          {selectedStaff.address || 'No residential address saved'}
                        </dd>
                      </div>

                      {selectedStaff.notes && (
                        <div className="sm:col-span-2 space-y-0.5 pt-1 border-t border-slate-100">
                          <dt className="text-slate-500">Notes</dt>
                          <dd className="text-slate-700">{selectedStaff.notes}</dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  {/* Module Access Permissions */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <Shield className="w-4 h-4 text-sky-600" />
                        <span>Module Access Permissions</span>
                      </h3>
                      <span className="text-xs font-semibold text-slate-500 tabular-nums">
                        {
                          MODULE_PERMISSION_ITEMS.filter(([k]) =>
                            Boolean(selectedStaff.permissions?.[k])
                          ).length
                        }{' '}
                        / {MODULE_PERMISSION_ITEMS.length} allowed
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2 text-xs">
                      {MODULE_PERMISSION_ITEMS.map(([key, label]) => {
                        const allowed = Boolean(selectedStaff.permissions?.[key]);
                        return (
                          <div key={key} className="flex items-center gap-1.5 py-0.5">
                            {allowed ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <Lock className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                            )}
                            <span
                              className={
                                allowed ? 'font-semibold text-slate-900' : 'text-slate-400'
                              }
                            >
                              {label}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {GRANULAR_PERMISSION_ITEMS.map(([key, label]) => {
                        const allowed = Boolean(selectedStaff.permissions?.[key]);
                        return (
                          <div key={key} className="flex items-center justify-between py-0.5">
                            <span className="text-slate-600">{label}</span>
                            <span
                              className={`font-semibold ${
                                allowed ? 'text-emerald-700' : 'text-slate-400'
                              }`}
                            >
                              {allowed ? 'Allowed' : 'Restricted'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Attendance Section */}
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-slate-100 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-900">Attendance Records</h3>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {(selectedStaff.attendance || []).length} entries
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-500 mr-1">
                          Mark Today:
                        </span>
                        {(
                          [
                            ['present', 'Present', 'bg-emerald-600 hover:bg-emerald-700 text-white'],
                            ['half_day', 'Half Day', 'bg-sky-600 hover:bg-sky-700 text-white'],
                            ['leave', 'Leave', 'bg-amber-500 hover:bg-amber-600 text-white'],
                            ['absent', 'Absent', 'bg-slate-600 hover:bg-slate-700 text-white'],
                          ] as Array<[StaffAttendanceRecord['status'], string, string]>
                        ).map(([statusKey, label, btnClass]) => (
                          <button
                            key={statusKey}
                            type="button"
                            onClick={() => handleMarkTodayAttendance(statusKey)}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${btnClass}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-50 text-slate-600 font-semibold text-[11px] uppercase">
                          <tr>
                            <th className="py-2.5 px-3.5">Date</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3">Check In</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(!selectedStaff.attendance || selectedStaff.attendance.length === 0) ? (
                            <tr>
                              <td colSpan={3} className="py-8 text-center text-slate-400">
                                No attendance logged for this employee yet.
                              </td>
                            </tr>
                          ) : (
                            selectedStaff.attendance.map((att) => (
                              <tr key={att.id}>
                                <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-800">
                                  {att.date}
                                </td>
                                <td className="py-2.5 px-3 font-semibold uppercase text-slate-900">
                                  {att.status.replace('_', ' ')}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                                  {att.checkIn || '—'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Salary History Section */}
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Salary Payment History
                        </h3>
                        <p className="text-xs text-slate-500">
                          Total paid:{' '}
                          <span className="font-semibold text-emerald-700 tabular-nums">
                            {formatRs(
                              (selectedStaff.salaryPayments || []).reduce(
                                (sum, p) => sum + (Number(p.amount) || 0),
                                0
                              )
                            )}
                          </span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSalaryPayAmount(selectedStaff.salary.toString());
                          setSalaryError(null);
                          setIsPaySalaryModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Pay Salary</span>
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-50 text-slate-600 font-semibold text-[11px] uppercase">
                          <tr>
                            <th className="py-2.5 px-3.5">Date</th>
                            <th className="py-2.5 px-3">Month</th>
                            <th className="py-2.5 px-3">Method</th>
                            <th className="py-2.5 px-3.5 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(!selectedStaff.salaryPayments ||
                            selectedStaff.salaryPayments.length === 0) ? (
                            <tr>
                              <td colSpan={4} className="py-8 text-center text-slate-400">
                                No salary payments recorded yet.
                              </td>
                            </tr>
                          ) : (
                            selectedStaff.salaryPayments.map((p) => (
                              <tr key={p.id}>
                                <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-700">
                                  {p.date}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-slate-900">
                                  {p.month}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600">{p.paymentMethod}</td>
                                <td className="py-2.5 px-3.5 text-right font-mono font-bold text-emerald-700 tabular-nums">
                                  {formatRs(p.amount)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ================================================================
          SIMPLIFIED & ORGANIZED ADD / EDIT STAFF MODAL
          ================================================================ */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-xl p-4 sm:p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-sky-600" />
                <h3 className="font-bold text-slate-900 text-base">
                  {editingStaff ? 'Edit Staff Profile' : 'Add Staff Member'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStaffMember} className="space-y-4 text-xs">
              {/* Section 1: Basic Information */}
              <div className="space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  1. Basic Information
                </div>

                {/* Compact Photo Row */}
                <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="w-16 h-16 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                    {photoUrl ? (
                      <img src={photoUrl} alt="Staff preview" className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon className="w-7 h-7 text-slate-400" />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[180px]">
                    <button
                      type="button"
                      onClick={() => photoUploadRef.current?.click()}
                      className="px-3 py-2 min-h-[38px] bg-white hover:bg-sky-50 text-sky-800 border border-slate-200 rounded-xl font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{photoUrl ? 'Change Photo' : 'Upload Photo'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenCamera}
                      className="px-3 py-2 min-h-[38px] bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Camera</span>
                    </button>
                    {photoUrl && (
                      <button
                        type="button"
                        onClick={() => setPhotoUrl('')}
                        className="px-2.5 py-2 min-h-[38px] bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                    <input
                      ref={photoUploadRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoFileSelected}
                      className="hidden"
                    />
                    <input
                      ref={cameraFileRef}
                      type="file"
                      accept="image/*"
                      capture="user"
                      onChange={handlePhotoFileSelected}
                      className="hidden"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Asad Ali"
                      className="w-full font-medium px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Employee ID *</label>
                    <input
                      type="text"
                      required
                      value={employeeId}
                      onChange={(e) => setEmployeeId(e.target.value)}
                      placeholder="WM-EMP-001"
                      className="w-full font-mono font-bold px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0300-1234567"
                    className="w-full font-medium px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Section 2: Job & Salary Information */}
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  2. Job &amp; Salary Information
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as StaffMember['role'])}
                      className="w-full font-medium px-3 py-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-sky-500"
                    >
                      <option value="Cashier">Cashier</option>
                      <option value="Manager">Store Manager</option>
                      <option value="Sales Staff">Sales Staff</option>
                      <option value="Stock Keeper">Stock Keeper</option>
                      <option value="Security">Security</option>
                      <option value="Cleaner">Cleaner / Helper</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Shift</label>
                    <select
                      value={shift}
                      onChange={(e) => setShift(e.target.value as StaffMember['shift'])}
                      className="w-full font-medium px-3 py-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-sky-500"
                    >
                      <option value="Morning">Morning</option>
                      <option value="Evening">Evening</option>
                      <option value="Full Day">Full Day</option>
                      <option value="Night">Night</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Monthly Salary (Rs.) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={salary}
                      onChange={(e) => setSalary(e.target.value)}
                      placeholder="25000"
                      className="w-full font-bold px-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-sky-500 tabular-nums"
                    />
                  </div>
                </div>

                {/* Collapsible Optional & Advanced Details */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedDetails((v) => !v)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    <span>Optional &amp; Advanced Details (Address, Department, Joining Date)</span>
                    {showAdvancedDetails ? (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-500" />
                    )}
                  </button>

                  {showAdvancedDetails && (
                    <div className="p-3.5 space-y-3 bg-white border-t border-slate-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block font-semibold text-slate-700 mb-1">
                            Department
                          </label>
                          <select
                            value={department}
                            onChange={(e) =>
                              setDepartment(e.target.value as StaffMember['department'])
                            }
                            className="w-full font-medium px-3 py-2 rounded-xl border border-slate-200 bg-white outline-none"
                          >
                            <option value="Sales">Sales</option>
                            <option value="Inventory">Inventory</option>
                            <option value="Accounts">Accounts</option>
                            <option value="General Operations">General Operations</option>
                          </select>
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-700 mb-1">
                            Joining Date
                          </label>
                          <input
                            type="text"
                            value={joiningDate}
                            onChange={(e) => setJoiningDate(e.target.value)}
                            placeholder="DD/MM/YYYY"
                            className="w-full font-medium px-3 py-2 rounded-xl border border-slate-200 outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          Residential Address
                        </label>
                        <input
                          type="text"
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                          placeholder="Street / Colony / City"
                          className="w-full font-medium px-3 py-2 rounded-xl border border-slate-200 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Notes</label>
                        <input
                          type="text"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Optional remarks"
                          className="w-full font-medium px-3 py-2 rounded-xl border border-slate-200 outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 3: Login Account */}
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-sky-600" />
                    <span>3. Login Account</span>
                  </span>
                  <select
                    value={accountStatus}
                    onChange={(e) =>
                      setAccountStatus(e.target.value as StaffMember['accountStatus'])
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 font-semibold text-xs text-slate-800 outline-none"
                  >
                    <option value="active">Status: Active</option>
                    <option value="suspended">Status: Suspended</option>
                    <option value="resigned">Status: Resigned</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Login Username *
                    </label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. cashierasif"
                      className="w-full font-mono font-bold px-3 py-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {editingStaff ? 'New Password (optional)' : 'Password (min 4 chars)'}
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={editingStaff ? 'Keep current if blank' : 'Set login password'}
                      className="w-full font-mono font-semibold px-3 py-2.5 rounded-xl border border-slate-200 bg-white outline-none focus:border-sky-500"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Module Permissions (Collapsible) */}
              <div className="pt-3 border-t border-slate-100">
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowPermissionsSection((v) => !v)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-semibold text-slate-800 cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-emerald-600" />
                      <span>4. Module Permissions ({enabledModulesCount}/12 enabled)</span>
                    </span>
                    {showPermissionsSection ? (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-500" />
                    )}
                  </button>

                  {showPermissionsSection && (
                    <div className="p-3.5 bg-white border-t border-slate-200 space-y-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setPermissions({ ...ALLOW_ALL_PERMISSIONS })}
                          className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                        >
                          Allow All
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={() => setPermissions({ ...DEFAULT_STAFF_PERMISSIONS })}
                          className="text-[11px] font-semibold text-slate-600 hover:underline cursor-pointer"
                        >
                          Cashier Default
                        </button>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {MODULE_PERMISSION_ITEMS.map(([key, label]) => (
                          <label
                            key={key}
                            className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:border-sky-300"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(permissions[key])}
                              onChange={(e) =>
                                setPermissions((p) => ({ ...p, [key]: e.target.checked }))
                              }
                              className="accent-sky-600"
                            />
                            <span className="text-[11px] font-semibold text-slate-700">{label}</span>
                          </label>
                        ))}
                      </div>

                      <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {GRANULAR_PERMISSION_ITEMS.map(([key, label]) => (
                          <label
                            key={key}
                            className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border cursor-pointer ${
                              key === 'canViewCostAndProfit'
                                ? 'bg-amber-50/70 border-amber-200'
                                : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(permissions[key])}
                              onChange={(e) =>
                                setPermissions((p) => ({ ...p, [key]: e.target.checked }))
                              }
                              className="accent-amber-600"
                            />
                            <span className="text-[11px] font-semibold text-slate-800">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {staffFormError && (
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{staffFormError}</span>
                </div>
              )}

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2.5 min-h-[40px] font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 min-h-[40px] font-semibold bg-sky-600 hover:bg-sky-700 text-white rounded-xl shadow-xs cursor-pointer"
                >
                  Save Staff Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Live Camera Snapshot Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200">
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">Take Staff Photo</h3>
              </div>
              <button
                type="button"
                onClick={stopCameraStream}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 bg-slate-950">
              {cameraError ? (
                <div className="p-3 rounded-xl bg-red-950 text-red-200 text-xs">{cameraError}</div>
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full rounded-xl bg-black max-h-72 object-cover"
                />
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={stopCameraStream}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCaptureFromCamera}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Capture Photo</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pay Salary Modal */}
      {isPaySalaryModalOpen && selectedStaff && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-sm">Pay Staff Salary</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPaySalaryModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs mb-3 space-y-1">
              <div>
                Employee: <strong>{selectedStaff.name}</strong>
              </div>
              <div>
                Base Salary:{' '}
                <strong className="tabular-nums">{formatRs(selectedStaff.salary)}</strong>
              </div>
            </div>

            <form onSubmit={handleRecordSalaryPayment} className="space-y-3 text-xs">
              {salaryError && (
                <div className="p-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{salaryError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Month *</label>
                <input
                  type="text"
                  required
                  value={salaryMonth}
                  onChange={(e) => setSalaryMonth(e.target.value)}
                  placeholder="November 2026"
                  className="w-full font-semibold px-3 py-2 rounded-xl border border-slate-200 outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Method</label>
                <select
                  value={salaryPayMethod}
                  onChange={(e) => setSalaryPayMethod(e.target.value)}
                  className="w-full font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-white outline-none focus:border-emerald-500"
                >
                  <option value="Cash">Cash</option>
                  <option value="Easypaisa">Easypaisa</option>
                  <option value="JazzCash">JazzCash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Amount Paid (Rs.) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={salaryPayAmount}
                  onChange={(e) => setSalaryPayAmount(e.target.value)}
                  className="w-full font-bold text-sm px-3 py-2 rounded-xl border border-slate-200 outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPaySalaryModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs cursor-pointer"
                >
                  Confirm Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
