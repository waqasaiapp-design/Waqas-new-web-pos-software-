import { ReceiptDesignerModal } from './components/ReceiptDesignerModal';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  LayoutGrid,
  Users,
  ShoppingCart,
  ShoppingBag,
  Package,
  Settings,
  ScanBarcode,
  Search,
  PlusCircle,
  Clock,
  RotateCcw,
  AlertCircle,
  Database,
  History,
  X,
  PauseCircle,
  Home,
  FileText,
  Layers,
  Truck,
  FileSpreadsheet,
  Wallet,
  CreditCard,
  Undo,
  TrendingUp,
  Shield,
  ShieldCheck,
  Smartphone,
  QrCode,
  Download,
  Laptop,
  Camera,
  UserCheck,
  Crown,
  Store,
  KeyRound,
  LogOut,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import {
  applyPurchaseDeleteAllToState,
  applyPurchaseDeleteToState,
  applyPurchaseSaveToState,
  formatStockAuditTimestamp,
} from './utils/purchaseHelpers';
import {
  STOCK_ALREADY_ZERO_MESSAGE,
  buildInsufficientStockMessage,
  findLiveProduct,
  reconcileNegativeStockFromHistory,
  roundStockQty,
  validatePurchaseReturnStock,
  validateSaleItemsStock,
} from './utils/stockValidation';
import {
  Product,
  CartItem,
  POSMode,
  SaleTransaction,
  SaleReturn,
  HeldBill,
  CategoryInfo,
  Supplier,
  PurchaseTransaction,
  Customer,
  CustomerLedgerEntry,
  UserProfile,
  DeviceInfo,
  StoreBranding,
  ReceiptSettings,
  DEFAULT_RECEIPT_SETTINGS,
  SupplierLedgerEntry,
  ExpenseEntry,
  PurchaseReturn,
  StaffMember,
  CctvCamera,
  DvrNvrConfig,
  PaymentMethod,
  StockTransaction,
  PrinterSettings,
  DEFAULT_PRINTER_SETTINGS,
  DailyHisabRow,
  StoreFullState,
  SyncStatusSnapshot,
  AuthSession,
  StaffModulePermissions,
  DEFAULT_STAFF_PERMISSIONS,
  AppLockPublicConfig,
  DEFAULT_APP_LOCK_PUBLIC_CONFIG,
} from './types/pos';
import {
  SCREENSHOT_CATEGORIES,
  INITIAL_SUPPLIERS,
  SEED_CATALOG_PRODUCTS,
  formatRs,
} from './data/defaultProducts';
import { sounds } from './utils/audio';
import { syncService } from './utils/syncService';
import { loadPrinterSettings, savePrinterSettings } from './utils/printerService';
import { PrinterSettingsModal } from './components/PrinterSettingsModal';
import { BarcodeScannerModal } from './components/BarcodeScannerModal';
import { AddNewProductModal } from './components/AddNewProductModal';
import { PurchaseEntryPage } from './components/PurchaseEntryPage';
import { NewPurchaseEntryPage } from './components/NewPurchaseEntryPage';
import { SaleSummaryPage } from './components/SaleSummaryPage';
import { DailyHisabExcelPage } from './components/DailyHisabExcelPage';
import { CustomerLedgersPage } from './components/CustomerLedgersPage';
import { TotalStockPage } from './components/TotalStockPage';
import { SaleReturnCenter } from './components/SaleReturnCenter';
import { HomePage } from './components/HomePage';
import { ReceiptModal } from './components/ReceiptModal';
import { HeldBillsModal } from './components/HeldBillsModal';
import { CheckoutModal } from './components/CheckoutModal';
import { CartDrawerModal } from './components/CartDrawerModal';
import { TransactionHistoryModal } from './components/TransactionHistoryModal';
import { DeviceManagementPage } from './components/DeviceManagementPage';
import { ConnectDeviceQrModal } from './components/ConnectDeviceQrModal';
import { PairDeviceModal } from './components/PairDeviceModal';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { RevokedDeviceModal } from './components/RevokedDeviceModal';
import { SalePosPage } from './components/SalePosPage';
import { NewSalePosPage } from './components/NewSalePosPage';
import { BrandingSettingsModal } from './components/BrandingSettingsModal';
import { WaqasBrandingCard } from './components/WaqasBrandingCard';
import { ResetSystemModal } from './components/ResetSystemModal';
import { SupplierLedgersPage } from './components/SupplierLedgersPage';
import { ExpensesPage } from './components/ExpensesPage';
import { PurchaseReturnsPage } from './components/PurchaseReturnsPage';
import { CctvPage } from './components/CctvPage';
import { AllStaffPage } from './components/AllStaffPage';
import { BarcodeManagementPage } from './components/BarcodeManagementPage';
import { BackupRestorePage } from './components/BackupRestorePage';
import { QrConnectionPage } from './components/QrConnectionPage';
import { SecuritySettingsPage } from './components/SecuritySettingsPage';
import { SuperAdminDashboard } from './components/SuperAdminDashboard';
import { AppLockScreen } from './components/AppLockScreen';
import { ExitSecurityModal } from './components/ExitSecurityModal';
import {
  cacheAppLockConfig,
  fetchAppLockStatus,
  getCachedAppLockConfig,
  getTimeoutDurationMs,
} from './utils/appLockClient';
import { LoginGateway } from './components/Auth/LoginGateway';
import {
  purgeLegacyLockKeys,
  enforceAuthPolicyMigration,
  isStandalonePwaAuthenticated,
  markStandalonePwaAuthenticated,
  clearStandalonePwaAuthenticated,
  fetchCurrentSession,
  getStoredAuthSession,
  clearStoredAuthSession,
  logoutSession,
} from './utils/authClient';
import { AUTH_POLICY_VERSION } from './version';
import { calculateCartTotals } from './utils/oldSaleHelpers';
import {
  safeStorageGetRaw,
  safeStorageGetJson,
  safeStorageSetRaw,
  safeStorageSetJson,
  safeStorageRemove,
  scheduleStorageSetJson,
  saveWorkspaceNavState,
  loadWorkspaceNavState,
  saveOldSaleDraft,
  loadOldSaleDraft,
  clearOldSaleDraft,
  clearAllShopDrafts,
} from './utils/safeStorage';

const STORAGE_KEYS = {
  INVENTORY: 'waqas_mart_inventory_v6',
  HELD_BILLS: 'waqas_mart_held_bills_v6',
  TRANSACTIONS: 'waqas_mart_transactions_v6',
  SUPPLIERS: 'waqas_mart_suppliers_v6',
  PURCHASES: 'waqas_mart_purchases_v6',
  CATEGORIES: 'waqas_mart_categories_v6',
  CUSTOMERS: 'waqas_mart_customers_v6',
  CUSTOMER_LEDGERS: 'waqas_mart_customer_ledgers_v6',
  RETURNS: 'waqas_mart_sale_returns_v6',
  USER_PROFILE: 'waqas_mart_user_profile_v6',
  DEVICE_ID: 'waqas_mart_device_id_v6',
  BRANDING: 'waqas_mart_branding_v6',
  RECEIPT_SETTINGS: 'waqas_mart_receipt_settings_v6',
  SUPPLIER_LEDGERS: 'waqas_mart_supplier_ledgers_v6',
  EXPENSES: 'waqas_mart_expenses_v6',
  PURCHASE_RETURNS: 'waqas_mart_purchase_returns_v6',
  STAFF: 'waqas_mart_staff_v6',
  CCTV_CAMERAS: 'waqas_mart_cctv_cameras_v6',
  DVR_CONFIG: 'waqas_mart_dvr_config_v6',
  STOCK_HISTORY: 'waqas_mart_stock_history_v1',
  PRINTER_SETTINGS: 'waqas_mart_printer_settings_v1',
  ACTIVE_SHOP_ID: 'waqas_pos_active_shop_id',
};

const SUPER_ADMIN_POS_SHOP_ID = 'SHOP-SA-POS';
const SA_MODE_VIEW_SESSION_KEY = 'waqas_pos_sa_mode_view';

// Purge legacy obsolete cached keys (IMPORTANT: NEVER remove waqas_mart_daily_hisab_v2!)
[
  'waqas_mart_inventory_v2',
  'waqas_mart_inventory_v3',
  'waqas_mart_inventory_v4',
  'waqas_mart_inventory_v5',
  'waqas_mart_transactions_v2',
  'waqas_mart_purchases_v2',
  'waqas_mart_customers_v2',
].forEach((k) => safeStorageRemove(k));

const isEligiblePairedDevice = (dev: DeviceInfo | null | undefined): boolean =>
  Boolean(
    dev?.pairedViaQr &&
      dev?.sessionToken &&
      dev?.status !== 'revoked' &&
      dev?.authPolicyVersion === AUTH_POLICY_VERSION &&
      isStandalonePwaAuthenticated()
  );

export default function App() {
  // Single centralized authentication session (Super Admin, Shop Owner, Staff) or paired terminal
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => {
    const policyReset = enforceAuthPolicyMigration();
    if (policyReset) {
      syncService.clearDeviceSessionAccess();
      return null;
    }
    const stored = getStoredAuthSession();
    return stored?.token && stored?.user?.role ? stored : null;
  });
  const [authChecked, setAuthChecked] = useState<boolean>(() => {
    const stored = getStoredAuthSession();
    const dev = syncService.getDevice();
    return !stored?.token && !isEligiblePairedDevice(dev);
  });
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [currentDevice, setCurrentDevice] = useState<DeviceInfo>(() => syncService.getDevice());
  const [isPairedTerminal, setIsPairedTerminal] = useState<boolean>(() => {
    return isEligiblePairedDevice(syncService.getDevice());
  });

  const [superAdminModeView, setSuperAdminModeView] = useState<'dashboard' | 'pos'>(() => {
    try {
      const stored = getStoredAuthSession();
      if (stored?.user?.role === 'SUPER_ADMIN' && sessionStorage.getItem(SA_MODE_VIEW_SESSION_KEY) === 'pos') {
        return 'pos';
      }
    } catch {}
    return 'dashboard';
  });

  const activeShopScopeId =
    authSession?.user?.role === 'SUPER_ADMIN'
      ? SUPER_ADMIN_POS_SHOP_ID
      : authSession?.user?.shopId ||
        authSession?.shop?.id ||
        currentDevice?.shopId ||
        safeStorageGetRaw(STORAGE_KEYS.ACTIVE_SHOP_ID) ||
        'WM-001';

  // App Lock & Exit Security State (never persists unlocked state across restarts)
  const unlockedOnceInTabRef = useRef<boolean>(false);
  const hiddenAtTimestampRef = useRef<number | null>(null);
  const [appLockConfig, setAppLockConfig] = useState<AppLockPublicConfig>(
    () => getCachedAppLockConfig(activeShopScopeId) || DEFAULT_APP_LOCK_PUBLIC_CONFIG
  );
  const [isAppLocked, setIsAppLocked] = useState<boolean>(() => {
    const cached = getCachedAppLockConfig(activeShopScopeId);
    return Boolean(cached?.enabled && cached?.requireAuthOnReopen);
  });
  const [appLockReason, setAppLockReason] = useState<string | null>(() => {
    const cached = getCachedAppLockConfig(activeShopScopeId);
    return cached?.enabled && cached?.requireAuthOnReopen
      ? 'App Lock active — verify Fingerprint, PIN, or Password to continue.'
      : null;
  });
  const [isExitSecurityOpen, setIsExitSecurityOpen] = useState<boolean>(false);

  // Navigation: Restored cleanly per shop after refresh/mobile tab discard
  const [activeNav, setActiveNav] = useState<string>(
    () => loadWorkspaceNavState(activeShopScopeId)?.activeNav || 'Home'
  );
  const [mode, setMode] = useState<POSMode>(
    () => loadWorkspaceNavState(activeShopScopeId)?.mode || 'sale'
  );
  const [isReceiptDesignerOpen, setIsReceiptDesignerOpen] = useState(false);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(() => {
    const saved = safeStorageGetJson<Partial<ReceiptSettings> | null>(STORAGE_KEYS.RECEIPT_SETTINGS, null);
    if (saved && typeof saved === 'object') {
      return { ...DEFAULT_RECEIPT_SETTINGS, ...saved };
    }
    return DEFAULT_RECEIPT_SETTINGS;
  });

  const handleSaveReceiptSettings = (newSettings: ReceiptSettings) => {
    setReceiptSettings(newSettings);
    safeStorageSetJson(STORAGE_KEYS.RECEIPT_SETTINGS, newSettings);
    syncService.syncReceiptSettings(newSettings);
  };

  // Products - Clean Zero State initially
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = safeStorageGetJson<Product[] | null>(STORAGE_KEYS.INVENTORY, null);
    return Array.isArray(saved) ? saved : [];
  });

  // Categories
  const [categories, setCategories] = useState<CategoryInfo[]>(() => {
    const saved = safeStorageGetJson<CategoryInfo[] | null>(STORAGE_KEYS.CATEGORIES, null);
    return Array.isArray(saved) ? saved : SCREENSHOT_CATEGORIES;
  });

  // Suppliers
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    const saved = safeStorageGetJson<Supplier[] | null>(STORAGE_KEYS.SUPPLIERS, null);
    return Array.isArray(saved) ? saved : INITIAL_SUPPLIERS;
  });

  // Purchases
  const [purchases, setPurchases] = useState<PurchaseTransaction[]>(() => {
    const saved = safeStorageGetJson<PurchaseTransaction[] | null>(STORAGE_KEYS.PURCHASES, null);
    return Array.isArray(saved) ? saved : [];
  });

  // POS Cart (Restored automatically per shop across mobile reloads/discards)
  const [cart, setCart] = useState<CartItem[]>(
    () => loadOldSaleDraft(activeShopScopeId)?.cart || []
  );
  const [discountAmount, setDiscountAmount] = useState<number>(
    () => Number(loadOldSaleDraft(activeShopScopeId)?.discountAmount) || 0
  );
  const [taxAmount, setTaxAmount] = useState<number>(
    () => Number(loadOldSaleDraft(activeShopScopeId)?.taxAmount) || 0
  );
  const [resumedHeldBillId, setResumedHeldBillId] = useState<string | null>(
    () => loadOldSaleDraft(activeShopScopeId)?.resumedHeldBillId ?? null
  );
  const [resumedNewSaleBill, setResumedNewSaleBill] = useState<HeldBill | null>(null);

  // Search & Category Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL ITEMS');

  // Held Bills
  const [heldBills, setHeldBills] = useState<HeldBill[]>(() => {
    const saved = safeStorageGetJson<HeldBill[] | null>(STORAGE_KEYS.HELD_BILLS, null);
    return Array.isArray(saved) ? saved : [];
  });

  // Sales Transactions History
  const [transactions, setTransactions] = useState<SaleTransaction[]>(() => {
    const saved = safeStorageGetJson<SaleTransaction[] | null>(STORAGE_KEYS.TRANSACTIONS, null);
    return Array.isArray(saved) ? saved : [];
  });

  // Customers (Customer Udhar Accounts)
  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = safeStorageGetJson<Customer[] | null>(STORAGE_KEYS.CUSTOMERS, null);
    return Array.isArray(saved) ? saved : [];
  });

  // Customer Ledger Entries (Credit & Debit / Recovery History)
  const [customerLedgerEntries, setCustomerLedgerEntries] = useState<CustomerLedgerEntry[]>(() => {
    const saved = safeStorageGetJson<CustomerLedgerEntry[] | null>(STORAGE_KEYS.CUSTOMER_LEDGERS, null);
    return Array.isArray(saved) ? saved : [];
  });

  const [selectedLedgerCustomerId, setSelectedLedgerCustomerId] = useState<string | null>(
    () => loadWorkspaceNavState(activeShopScopeId)?.selectedLedgerCustomerId ?? null
  );

  // Modals
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const [isHeldBillsOpen, setIsHeldBillsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [currentTransaction, setCurrentTransaction] = useState<SaleTransaction | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPrinterSettingsOpen, setIsPrinterSettingsOpen] = useState(false);
  const [, setPrinterSettings] = useState<PrinterSettings>(() => loadPrinterSettings());
  const [stockHistory, setStockHistory] = useState<StockTransaction[]>(() => {
    const saved = safeStorageGetJson<StockTransaction[] | null>(STORAGE_KEYS.STOCK_HISTORY, null);
    return Array.isArray(saved) ? saved : [];
  });
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [scannedBarcodeForNewPos, setScannedBarcodeForNewPos] = useState<string | null>(null);
  const [scannedBarcodeForPurchase, setScannedBarcodeForPurchase] = useState<string | null>(null);
  const [scannedBarcodeForTools, setScannedBarcodeForTools] = useState<string | null>(null);
  const [dailyHisab, setDailyHisab] = useState<Record<string, Record<string, Partial<DailyHisabRow>>>>(() => {
    const saved = safeStorageGetJson<Record<string, Record<string, Partial<DailyHisabRow>>> | null>(
      'waqas_mart_daily_hisab_v2',
      null
    );
    return saved && typeof saved === 'object' ? saved : {};
  });

  // Multi-Device & PWA states
  const [isConnectQrOpen, setIsConnectQrOpen] = useState(false);
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [isPwaInstallOpen, setIsPwaInstallOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isRevoked, setIsRevoked] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot>(() => syncService.getStatusSnapshot());
  const [isResetAllZeroConfirmOpen, setIsResetAllZeroConfirmOpen] = useState(false);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);

  // Auto-save active workspace route & Old Sale draft (survives tab discard & reloads)
  useEffect(() => {
    if (authSession?.user?.role === 'SUPER_ADMIN' && superAdminModeView !== 'pos') return;
    if (!authSession && !isPairedTerminal) return;
    saveWorkspaceNavState(activeShopScopeId, {
      activeNav,
      mode,
      selectedCategory,
      selectedLedgerCustomerId,
    });
  }, [
    activeShopScopeId,
    activeNav,
    mode,
    selectedCategory,
    selectedLedgerCustomerId,
    authSession,
    superAdminModeView,
    isPairedTerminal,
  ]);

  useEffect(() => {
    if (authSession?.user?.role === 'SUPER_ADMIN' && superAdminModeView !== 'pos') return;
    if (!authSession && !isPairedTerminal) return;
    saveOldSaleDraft(activeShopScopeId, {
      cart,
      discountAmount,
      taxAmount,
      resumedHeldBillId,
    });
  }, [activeShopScopeId, cart, discountAmount, taxAmount, resumedHeldBillId, authSession, superAdminModeView, isPairedTerminal]);

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.STOCK_HISTORY, stockHistory);
  }, [stockHistory]);

  const appendStockTransactions = (entries: StockTransaction[]) => {
    if (!entries || entries.length === 0) return;
    setStockHistory((prev) => {
      const next = [...entries, ...prev].slice(0, 5000);
      syncService.syncStockHistory(next);
      return next;
    });
  };

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Sync state with debounced QuotaExceeded-safe localStorage (flushed synchronously on pagehide/visibilitychange)
  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.INVENTORY, products);
  }, [products]);

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.CATEGORIES, categories);
  }, [categories]);

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.SUPPLIERS, suppliers);
  }, [suppliers]);

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.PURCHASES, purchases);
  }, [purchases]);

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.HELD_BILLS, heldBills);
  }, [heldBills]);

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.TRANSACTIONS, transactions);
  }, [transactions]);

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.CUSTOMERS, customers);
  }, [customers]);

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.CUSTOMER_LEDGERS, customerLedgerEntries);
  }, [customerLedgerEntries]);

  // Sale Returns
  const [saleReturns, setSaleReturns] = useState<SaleReturn[]>(() => {
    const saved = safeStorageGetJson<SaleReturn[] | null>(STORAGE_KEYS.RETURNS, null);
    return Array.isArray(saved) ? saved : [];
  });

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.RETURNS, saleReturns);
  }, [saleReturns]);

  // 1. Supplier Ledgers State
  const [supplierLedgers, setSupplierLedgers] = useState<SupplierLedgerEntry[]>(() => {
    const saved = safeStorageGetJson<SupplierLedgerEntry[] | null>(STORAGE_KEYS.SUPPLIER_LEDGERS, null);
    return Array.isArray(saved) ? saved : [];
  });

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.SUPPLIER_LEDGERS, supplierLedgers);
  }, [supplierLedgers]);

  // 2. Expenses State
  const [expenses, setExpenses] = useState<ExpenseEntry[]>(() => {
    const saved = safeStorageGetJson<ExpenseEntry[] | null>(STORAGE_KEYS.EXPENSES, null);
    return Array.isArray(saved) ? saved : [];
  });

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.EXPENSES, expenses);
  }, [expenses]);

  // 3. Purchase Returns State
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>(() => {
    const saved = safeStorageGetJson<PurchaseReturn[] | null>(STORAGE_KEYS.PURCHASE_RETURNS, null);
    return Array.isArray(saved) ? saved : [];
  });

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.PURCHASE_RETURNS, purchaseReturns);
  }, [purchaseReturns]);

  // 4. Staff Members State
  const [staffList, setStaffList] = useState<StaffMember[]>(() => {
    const saved = safeStorageGetJson<StaffMember[] | null>(STORAGE_KEYS.STAFF, null);
    return Array.isArray(saved) ? saved : [];
  });

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.STAFF, staffList);
  }, [staffList]);

  // 5. CCTV Cameras & DVR/NVR Config State
  const [cctvCameras, setCctvCameras] = useState<CctvCamera[]>(() => {
    const saved = safeStorageGetJson<CctvCamera[] | null>(STORAGE_KEYS.CCTV_CAMERAS, null);
    return Array.isArray(saved) ? saved : [];
  });

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.CCTV_CAMERAS, cctvCameras);
  }, [cctvCameras]);

  const [dvrConfig, setDvrConfig] = useState<DvrNvrConfig>(() => {
    const saved = safeStorageGetJson<DvrNvrConfig | null>(STORAGE_KEYS.DVR_CONFIG, null);
    if (saved && typeof saved === 'object') return saved;
    return {
      brand: 'Hikvision',
      dvrIp: '192.168.1.100',
      port: 554,
      username: 'admin',
      channelCount: 8,
      connected: false,
    };
  });

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.DVR_CONFIG, dvrConfig);
  }, [dvrConfig]);

  // User Profile
  const [currentUser, setCurrentUser] = useState<UserProfile>(() => {
    const saved = safeStorageGetJson<UserProfile | null>(STORAGE_KEYS.USER_PROFILE, null);
    if (saved && typeof saved === 'object') return saved;
    return {
      id: `USR-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 6)}`.toUpperCase(),
      displayName: 'Waqas Ahmad',
      email: 'waqasmart.pos@gmail.com',
      phone: '+92 300 1234567',
      role: 'Master Admin',
      createdAt: new Date().toLocaleDateString('en-GB'),
    };
  });

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.USER_PROFILE, currentUser);
  }, [currentUser]);

  const applyServerStoreSnapshot = (serverStore: Partial<StoreFullState> | null | undefined) => {
    if (!serverStore || typeof serverStore !== 'object') return;
    if (Array.isArray(serverStore.products)) setProducts(serverStore.products);
    if (Array.isArray(serverStore.categories) && serverStore.categories.length > 0) {
      setCategories(serverStore.categories);
    }
    if (Array.isArray(serverStore.transactions)) setTransactions(serverStore.transactions);
    if (Array.isArray(serverStore.purchases)) setPurchases(serverStore.purchases);
    if (Array.isArray(serverStore.customers)) setCustomers(serverStore.customers);
    if (Array.isArray(serverStore.customerLedgers)) setCustomerLedgerEntries(serverStore.customerLedgers);
    if (Array.isArray(serverStore.saleReturns)) setSaleReturns(serverStore.saleReturns);
    if (Array.isArray(serverStore.suppliers)) setSuppliers(serverStore.suppliers);
    if (Array.isArray(serverStore.heldBills)) setHeldBills(serverStore.heldBills);
    if (serverStore.branding) setBranding(serverStore.branding);
    if (Array.isArray(serverStore.stockHistory)) setStockHistory(serverStore.stockHistory);
    if (Array.isArray(serverStore.purchaseReturns)) setPurchaseReturns(serverStore.purchaseReturns);
    if (Array.isArray(serverStore.supplierLedgers)) setSupplierLedgers(serverStore.supplierLedgers);
    if (Array.isArray(serverStore.expenses)) setExpenses(serverStore.expenses);
    if (Array.isArray(serverStore.staffList)) setStaffList(serverStore.staffList);
    if (serverStore.dailyHisab && typeof serverStore.dailyHisab === 'object') {
      setDailyHisab(serverStore.dailyHisab);
      safeStorageSetJson('waqas_mart_daily_hisab_v2', serverStore.dailyHisab);
    }
    if (serverStore.receiptSettings) {
      setReceiptSettings(serverStore.receiptSettings);
      safeStorageSetJson(STORAGE_KEYS.RECEIPT_SETTINGS, serverStore.receiptSettings);
    }
    if (serverStore.printerSettings) {
      setPrinterSettings(serverStore.printerSettings);
      savePrinterSettings(serverStore.printerSettings);
    }
    if (Array.isArray(serverStore.cctvCameras)) {
      setCctvCameras(serverStore.cctvCameras);
    }
    if (serverStore.dvrConfig && typeof serverStore.dvrConfig === 'object') {
      setDvrConfig(serverStore.dvrConfig);
    }
  };

  const clearLocalShopWorkspaceState = (nextShopId: string) => {
    const prevShopId = safeStorageGetRaw(STORAGE_KEYS.ACTIVE_SHOP_ID) || '';
    if (prevShopId) {
      clearAllShopDrafts(prevShopId);
    }
    setProducts([]);
    setTransactions([]);
    setPurchases([]);
    setHeldBills([]);
    setCustomers([]);
    setCustomerLedgerEntries([]);
    setSaleReturns([]);
    setSuppliers(INITIAL_SUPPLIERS);
    setSupplierLedgers([]);
    setExpenses([]);
    setPurchaseReturns([]);
    setStaffList([]);
    setStockHistory([]);
    setDailyHisab({});
    setCctvCameras([]);
    setDvrConfig({
      brand: 'Hikvision',
      dvrIp: '192.168.1.100',
      port: 554,
      username: 'admin',
      channelCount: 8,
      connected: false,
    });
    setCart([]);
    setDiscountAmount(0);
    setTaxAmount(0);
    setResumedHeldBillId(null);
    setResumedNewSaleBill(null);
    setBranding({
      storeName: nextShopId === SUPER_ADMIN_POS_SHOP_ID ? 'MY POS APP' : 'WAQAS MART',
      primaryName: nextShopId === SUPER_ADMIN_POS_SHOP_ID ? 'MY POS' : 'WAQAS',
      accentName: nextShopId === SUPER_ADMIN_POS_SHOP_ID ? 'APP' : 'MART',
      subtitle: 'Quality Products • Better Life',
      sidebarPromoTitle: 'Small Steps Big Dreams',
      sidebarPromoBadge: nextShopId === SUPER_ADMIN_POS_SHOP_ID ? 'MY POS APP' : 'WAQAS MART',
      bottomBannerTitle: 'Fresh Products Everyday',
      bottomBannerSubtitle: 'Best Quality • Lowest Prices',
      terminalDeviceId: 'WM-001',
      primaryColor: '#00a859',
    });
    syncService.clearOfflineQueueForSwitch();
    [
      STORAGE_KEYS.INVENTORY,
      STORAGE_KEYS.TRANSACTIONS,
      STORAGE_KEYS.PURCHASES,
      STORAGE_KEYS.HELD_BILLS,
      STORAGE_KEYS.CUSTOMERS,
      STORAGE_KEYS.CUSTOMER_LEDGERS,
      STORAGE_KEYS.RETURNS,
      STORAGE_KEYS.SUPPLIERS,
      STORAGE_KEYS.SUPPLIER_LEDGERS,
      STORAGE_KEYS.EXPENSES,
      STORAGE_KEYS.PURCHASE_RETURNS,
      STORAGE_KEYS.STAFF,
      STORAGE_KEYS.STOCK_HISTORY,
      STORAGE_KEYS.BRANDING,
      STORAGE_KEYS.RECEIPT_SETTINGS,
      STORAGE_KEYS.CCTV_CAMERAS,
      STORAGE_KEYS.DVR_CONFIG,
      'waqas_mart_daily_hisab_v2',
      'waqas_mart_owner_profile_v2',
    ].forEach((k) => safeStorageRemove(k));
    safeStorageSetRaw(STORAGE_KEYS.ACTIVE_SHOP_ID, nextShopId || '');
  };

  const applyAuthenticatedShopBootstrap = (session: AuthSession) => {
    const targetShopId = session.user.shopId || session.shop?.id || '';
    const prevShopId = safeStorageGetRaw(STORAGE_KEYS.ACTIVE_SHOP_ID) || '';
    if (prevShopId !== targetShopId) {
      clearLocalShopWorkspaceState(targetShopId);
    } else {
      safeStorageSetRaw(STORAGE_KEYS.ACTIVE_SHOP_ID, targetShopId);
    }

    setCurrentUser((prev) => ({
      ...prev,
      id: session.user.id,
      displayName: session.user.fullName,
      email: session.user.email || session.user.username || prev.email,
      phone: session.user.phone || prev.phone,
      role: session.user.role,
    }));

    syncService.registerPrimaryDevice().then((dev) => {
      if (dev) setCurrentDevice(dev);
    });
    syncService.connectSse();
    syncService.fetchServerStore().then((serverStore) => {
      if (serverStore) applyServerStoreSnapshot(serverStore);
    });
  };

  const handleLoginSuccess = (session: AuthSession) => {
    setAuthNotice(null);
    setAuthSession(session);
    setIsRevoked(false);
    // User just proved primary account login credentials in LoginGateway
    unlockedOnceInTabRef.current = true;
    setIsAppLocked(false);
    setAppLockReason(null);
    if (session.user.role === 'SUPER_ADMIN') {
      try {
        sessionStorage.removeItem(SA_MODE_VIEW_SESSION_KEY);
      } catch {}
      setSuperAdminModeView('dashboard');
      clearLocalShopWorkspaceState('');
      syncService.closeSse();
      return;
    }
    setActiveNav('Home');
    applyAuthenticatedShopBootstrap(session);
  };

  const handleOpenSuperAdminPos = () => {
    if (!authSession || authSession.user.role !== 'SUPER_ADMIN') return;
    try {
      sessionStorage.setItem(SA_MODE_VIEW_SESSION_KEY, 'pos');
    } catch {}
    clearLocalShopWorkspaceState(SUPER_ADMIN_POS_SHOP_ID);
    setSuperAdminModeView('pos');
    setActiveNav('Home');
    applyAuthenticatedShopBootstrap({
      ...authSession,
      user: {
        ...authSession.user,
        shopId: SUPER_ADMIN_POS_SHOP_ID,
        shopName: 'MY POS APP',
      },
    });
  };

  const handleReturnToSuperAdminDashboard = () => {
    try {
      sessionStorage.removeItem(SA_MODE_VIEW_SESSION_KEY);
    } catch {}
    syncService.closeSse();
    setSuperAdminModeView('dashboard');
  };

  const handlePairedSuccess = (device: DeviceInfo, storeState?: any) => {
    const existingSession = getStoredAuthSession();
    if (
      existingSession &&
      (existingSession.user?.role === 'SUPER_ADMIN' ||
        (device.shopId && existingSession.user?.shopId !== device.shopId))
    ) {
      clearStoredAuthSession();
      setAuthSession(null);
    }
    try {
      sessionStorage.removeItem(SA_MODE_VIEW_SESSION_KEY);
    } catch {}
    setSuperAdminModeView('dashboard');
    markStandalonePwaAuthenticated();
    clearLocalShopWorkspaceState(device.shopId || '');
    setCurrentDevice(syncService.getDevice());
    setIsPairedTerminal(true);
    setIsRevoked(false);
    setAuthNotice(null);
    setActiveNav('Home');
    unlockedOnceInTabRef.current = true;
    setIsAppLocked(false);
    setAppLockReason(null);
    if (storeState) {
      applyServerStoreSnapshot(storeState);
    } else {
      syncService.fetchServerStore().then((srv) => {
        if (srv) applyServerStoreSnapshot(srv);
      });
    }
    syncService.connectSse();
  };

  const handleSignOut = async () => {
    try {
      sessionStorage.removeItem(SA_MODE_VIEW_SESSION_KEY);
    } catch {}
    setSuperAdminModeView('dashboard');
    unlockedOnceInTabRef.current = false;
    setIsAppLocked(false);
    setIsExitSecurityOpen(false);
    setAppLockReason(null);
    clearAllShopDrafts(activeShopScopeId);
    await logoutSession();
    syncService.clearDeviceSessionAccess();
    clearLocalShopWorkspaceState('');
    setCurrentDevice(syncService.getDevice());
    setAuthSession(null);
    setIsPairedTerminal(false);
    setIsRevoked(false);
    setAuthNotice(null);
    setActiveNav('Home');
  };

  const triggerManualAppLock = useCallback((reason?: string) => {
    unlockedOnceInTabRef.current = false;
    setAppLockReason(reason || 'Application locked · Authenticate to continue.');
    setIsAppLocked(true);
    setIsExitSecurityOpen(false);
  }, []);

  const handleRequestAppExit = useCallback(() => {
    if (appLockConfig.enabled && appLockConfig.requireAuthOnExit) {
      setIsExitSecurityOpen(true);
      return;
    }
    if (appLockConfig.enabled) {
      unlockedOnceInTabRef.current = false;
      setAppLockReason('Session locked on Exit · Authenticate to reopen.');
      setIsAppLocked(true);
      syncService.closeSse();
      return;
    }
    showToast('Enable App Lock in Security Settings to protect Exit with PIN, Password, or Fingerprint.', 'info');
  }, [appLockConfig.enabled, appLockConfig.requireAuthOnExit]);

  // Validate active session on initial load & subscribe to real-time shop SSE events
  useEffect(() => {
    const handlePwaInstalled = () => {
      clearStandalonePwaAuthenticated();
    };
    window.addEventListener('appinstalled', handlePwaInstalled);

    const migrated = enforceAuthPolicyMigration();
    if (migrated) {
      syncService.clearDeviceSessionAccess();
      setCurrentDevice(syncService.getDevice());
    }
    purgeLegacyLockKeys();
    const dev = syncService.getDevice();
    const pairedOk = isEligiblePairedDevice(dev);
    setIsPairedTerminal(pairedOk);

    let cancelled = false;
    fetchCurrentSession()
      .then(async (verifiedSession) => {
        if (cancelled) return;
        if (verifiedSession?.token && verifiedSession?.user?.role) {
          setAuthSession(verifiedSession);
          if (verifiedSession.user.role === 'SUPER_ADMIN') {
            let resumePos = false;
            try {
              resumePos = sessionStorage.getItem(SA_MODE_VIEW_SESSION_KEY) === 'pos';
            } catch {}
            if (resumePos) {
              setSuperAdminModeView('pos');
              applyAuthenticatedShopBootstrap({
                ...verifiedSession,
                user: {
                  ...verifiedSession.user,
                  shopId: SUPER_ADMIN_POS_SHOP_ID,
                  shopName: 'MY POS APP',
                },
              });
            } else {
              setSuperAdminModeView('dashboard');
              syncService.closeSse();
            }
          } else {
            applyAuthenticatedShopBootstrap(verifiedSession);
          }
        } else {
          setAuthSession(null);
          if (pairedOk) {
            const check = await syncService.verifyPairedTerminalAccess();
            if (cancelled) return;
            setCurrentDevice(syncService.getDevice());
            if (check.ok) {
              setIsPairedTerminal(true);
              syncService.connectSse();
              syncService.fetchServerStore().then((serverStore) => {
                if (!cancelled && serverStore) applyServerStoreSnapshot(serverStore);
              });
            } else if (check.reason === 'DEVICE_REVOKED') {
              setIsPairedTerminal(true);
              setIsRevoked(true);
            } else {
              setIsPairedTerminal(false);
              if (check.message) setAuthNotice(check.message);
            }
          } else {
            syncService.closeSse();
          }
        }
      })
      .catch(async (err: any) => {
        if (cancelled) return;
        setAuthSession(null);
        const latestDev = syncService.getDevice();
        const stillPaired = isEligiblePairedDevice(latestDev);
        if (stillPaired) {
          const check = await syncService.verifyPairedTerminalAccess();
          if (cancelled) return;
          setCurrentDevice(syncService.getDevice());
          if (check.ok) {
            setIsPairedTerminal(true);
            syncService.connectSse();
            syncService.fetchServerStore().then((serverStore) => {
              if (!cancelled && serverStore) applyServerStoreSnapshot(serverStore);
            });
          } else if (check.reason === 'DEVICE_REVOKED') {
            setIsPairedTerminal(true);
            setIsRevoked(true);
          } else {
            setIsPairedTerminal(false);
            if (check.message || err?.message) setAuthNotice(check.message || err.message);
          }
        } else {
          setIsPairedTerminal(false);
          syncService.closeSse();
          if (err?.message) setAuthNotice(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });

    const unsubscribeStatus = syncService.subscribeStatus((snap) => {
      setSyncStatus(snap);
      if (snap.isRevoked) {
        setIsRevoked(true);
      }
    });

    // Real-time synchronization stream listener
    const unsubscribe = syncService.subscribe((event) => {
      const myDeviceId = syncService.getDevice().deviceId;
      const isRemote = event.sourceDeviceId !== myDeviceId;

      if (event.type === 'sale:completed') {
        const { transaction, updatedProducts, customerLedgers, customers: srvCusts, stockHistory: srvHist } = event.payload || {};
        if (transaction && isRemote) {
          setTransactions((prev) => {
            if (prev.some((t) => t.invoiceNumber === transaction.invoiceNumber)) return prev;
            return [transaction, ...prev];
          });
          if (Array.isArray(updatedProducts)) setProducts(updatedProducts);
          if (Array.isArray(srvCusts)) setCustomers(srvCusts);
          if (Array.isArray(customerLedgers)) setCustomerLedgerEntries(customerLedgers);
          if (Array.isArray(srvHist)) setStockHistory(srvHist);
          showToast(`Real-Time Sync: Sale #${transaction.invoiceNumber} synced from another terminal.`, 'info');
        }
      } else if (event.type === 'purchase:added' || event.type === 'purchase:updated') {
        const { purchase, updatedProducts, suppliers: srvSup, stockHistory: srvHist } = event.payload || {};
        if (purchase && isRemote) {
          setPurchases((prev) => {
            const exists = prev.some((p) => p.id === purchase.id || p.purchaseInvoiceNo === purchase.purchaseInvoiceNo);
            if (exists) return prev.map((p) => (p.id === purchase.id ? purchase : p));
            return [purchase, ...prev];
          });
          if (Array.isArray(updatedProducts)) setProducts(updatedProducts);
          if (Array.isArray(srvSup)) setSuppliers(srvSup);
          if (Array.isArray(srvHist)) setStockHistory(srvHist);
          showToast(`Real-Time Sync: Purchase #${purchase.purchaseInvoiceNo} synced.`, 'info');
        }
      } else if (event.type === 'purchase:deleted') {
        const { purchaseId, updatedProducts, suppliers: srvSup, stockHistory: srvHist } = event.payload || {};
        if (isRemote) {
          if (purchaseId) setPurchases((prev) => prev.filter((p) => p.id !== purchaseId));
          if (Array.isArray(updatedProducts)) setProducts(updatedProducts);
          if (Array.isArray(srvSup)) setSuppliers(srvSup);
          if (Array.isArray(srvHist)) setStockHistory(srvHist);
        }
      } else if (event.type === 'return:processed') {
        const { saleReturn, updatedProducts, customerLedgers, stockHistory: srvHist } = event.payload || {};
        if (saleReturn && isRemote) {
          setSaleReturns((prev) => {
            if (prev.some((r) => r.returnNumber === saleReturn.returnNumber)) return prev;
            return [saleReturn, ...prev];
          });
          if (Array.isArray(updatedProducts)) setProducts(updatedProducts);
          if (Array.isArray(customerLedgers)) setCustomerLedgerEntries(customerLedgers);
          if (Array.isArray(srvHist)) setStockHistory(srvHist);
          showToast(`Real-Time Sync: Return #${saleReturn.returnNumber} restocked.`, 'info');
        }
      } else if (event.type === 'purchase_return:processed') {
        const { purchaseReturn, updatedProducts, suppliers: srvSup, stockHistory: srvHist } = event.payload || {};
        if (purchaseReturn && isRemote) {
          setPurchaseReturns((prev) => {
            if (prev.some((r) => r.returnNumber === purchaseReturn.returnNumber)) return prev;
            return [purchaseReturn, ...prev];
          });
          if (Array.isArray(updatedProducts)) setProducts(updatedProducts);
          if (Array.isArray(srvSup)) setSuppliers(srvSup);
          if (Array.isArray(srvHist)) setStockHistory(srvHist);
        }
      } else if (event.type === 'stock:updated') {
        if (isRemote) {
          if (Array.isArray(event.payload)) {
            setProducts(event.payload);
          } else if (event.payload?.products && Array.isArray(event.payload.products)) {
            setProducts(event.payload.products);
            if (Array.isArray(event.payload.stockHistory)) setStockHistory(event.payload.stockHistory);
          }
        }
      } else if (event.type === 'customer:ledger_updated') {
        if (isRemote) {
          if (Array.isArray(event.payload?.customers)) setCustomers(event.payload.customers);
          if (Array.isArray(event.payload?.customerLedgers)) setCustomerLedgerEntries(event.payload.customerLedgers);
        }
      } else if (event.type === 'supplier:ledger_updated') {
        if (isRemote) {
          if (Array.isArray(event.payload?.suppliers)) setSuppliers(event.payload.suppliers);
          if (Array.isArray(event.payload?.supplierLedgers)) setSupplierLedgers(event.payload.supplierLedgers);
        }
      } else if (event.type === 'categories:updated') {
        if (isRemote && Array.isArray(event.payload)) {
          setCategories(event.payload);
        }
      } else if (event.type === 'expenses:updated') {
        if (isRemote && Array.isArray(event.payload)) {
          setExpenses(event.payload);
        }
      } else if (event.type === 'staff:updated') {
        if (isRemote && Array.isArray(event.payload)) {
          setStaffList(event.payload);
        }
      } else if (event.type === 'daily_hisab:updated') {
        if (isRemote && event.payload && typeof event.payload === 'object') {
          setDailyHisab(event.payload);
          safeStorageSetJson('waqas_mart_daily_hisab_v2', event.payload);
        }
      } else if (event.type === 'printer:updated') {
        if (isRemote && event.payload) {
          setPrinterSettings(event.payload);
          savePrinterSettings(event.payload);
        }
      } else if (event.type === 'receipt:updated') {
        if (isRemote && event.payload) {
          setReceiptSettings(event.payload);
          safeStorageSetJson(STORAGE_KEYS.RECEIPT_SETTINGS, event.payload);
        }
      } else if (event.type === 'store:sync') {
        if (event.payload) {
          applyServerStoreSnapshot(event.payload);
        }
      } else if (event.type === 'device:revoked') {
        if (event.payload?.deviceId === myDeviceId) {
          setIsRevoked(true);
        }
      } else if (event.type === 'device:pairing_request') {
        showToast(`Pairing request received from ${event.payload?.candidateDevice?.deviceName || 'new device'}. Check Device Management.`, 'info');
      } else if (event.type === 'auth:shop_restricted') {
        clearStoredAuthSession();
        syncService.clearDeviceSessionAccess();
        clearLocalShopWorkspaceState('');
        setCurrentDevice(syncService.getDevice());
        setAuthSession(null);
        setIsPairedTerminal(false);
        setAuthNotice(event.payload?.message || 'This shop account has been suspended or restricted.');
      }
    });

    return () => {
      cancelled = true;
      window.removeEventListener('appinstalled', handlePwaInstalled);
      unsubscribe();
      unsubscribeStatus();
    };
  }, []);

  // Fetch & sync authoritative App Lock status whenever shop/session becomes active
  useEffect(() => {
    const hasAuth = Boolean(authSession?.token && authSession?.user?.role);
    if (!authChecked || (!hasAuth && !isPairedTerminal)) return;

    let cancelled = false;
    fetchAppLockStatus(activeShopScopeId)
      .then(({ config }) => {
        if (cancelled) return;
        setAppLockConfig(config);
        cacheAppLockConfig(activeShopScopeId, config);
        if (config.enabled && config.requireAuthOnReopen && !unlockedOnceInTabRef.current) {
          setAppLockReason('App Lock active — verify Fingerprint, PIN, or Password to open WAQAS POS.');
          setIsAppLocked(true);
        } else if (!config.enabled) {
          setIsAppLocked(false);
        }
      })
      .catch(() => {
        const cached = getCachedAppLockConfig(activeShopScopeId);
        if (cached && !cancelled) {
          setAppLockConfig(cached);
          if (cached.enabled && cached.requireAuthOnReopen && !unlockedOnceInTabRef.current) {
            setIsAppLocked(true);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authChecked, authSession?.token, authSession?.user?.role, isPairedTerminal, activeShopScopeId]);

  // Idle Timeout & Background/Visibility Auto-Lock (blocks unattended access reliably)
  useEffect(() => {
    const hasAuth = Boolean(authSession?.token && authSession?.user?.role);
    if (!authChecked || (!hasAuth && !isPairedTerminal) || !appLockConfig.enabled || isAppLocked) {
      return;
    }

    const timeoutMs = getTimeoutDurationMs(appLockConfig.autoLockTimeout);
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (timeoutMs > 0) {
        idleTimer = setTimeout(() => {
          triggerManualAppLock('Session locked automatically due to inactivity.');
        }, timeoutMs);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtTimestampRef.current = Date.now();
        if (appLockConfig.autoLockTimeout === 'immediate') {
          triggerManualAppLock('Locked immediately when application moved to background.');
        }
      } else if (document.visibilityState === 'visible') {
        const hiddenAt = hiddenAtTimestampRef.current;
        hiddenAtTimestampRef.current = null;
        if (hiddenAt && timeoutMs > 0 && Date.now() - hiddenAt >= timeoutMs) {
          triggerManualAppLock('Session timed out while in background — verify to continue.');
          return;
        }
        resetIdleTimer();
      }
    };

    resetIdleTimer();
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach((ev) => window.addEventListener(ev, resetIdleTimer, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      activityEvents.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    authChecked,
    authSession?.token,
    authSession?.user?.role,
    isPairedTerminal,
    appLockConfig.enabled,
    appLockConfig.autoLockTimeout,
    isAppLocked,
    triggerManualAppLock,
  ]);

  // Store Branding & Theme Configuration
  const [branding, setBranding] = useState<StoreBranding>(() => {
    const parsed = safeStorageGetJson<Partial<StoreBranding> | null>(STORAGE_KEYS.BRANDING, null);
    if (parsed && typeof parsed === 'object') {
      return {
        storeName: parsed.storeName || 'WAQAS MART',
        primaryName: parsed.primaryName || 'WAQAS',
        accentName: parsed.accentName || 'MART',
        subtitle: parsed.subtitle || 'Quality Products • Better Life',
        logoUrl: parsed.logoUrl,
        bannerUrl: parsed.bannerUrl,
        sidebarPromoTitle: parsed.sidebarPromoTitle || 'Small Steps Big Dreams',
        sidebarPromoBadge: parsed.sidebarPromoBadge || 'WAQAS MART',
        bottomBannerTitle: parsed.bottomBannerTitle || 'Fresh Products Everyday',
        bottomBannerSubtitle: parsed.bottomBannerSubtitle || 'Best Quality • Lowest Prices',
        terminalDeviceId: parsed.terminalDeviceId || 'WM-001',
        primaryColor: parsed.primaryColor || '#00a859',
      };
    }
    return {
      storeName: 'WAQAS MART',
      primaryName: 'WAQAS',
      accentName: 'MART',
      subtitle: 'Quality Products • Better Life',
      sidebarPromoTitle: 'Small Steps Big Dreams',
      sidebarPromoBadge: 'WAQAS MART',
      bottomBannerTitle: 'Fresh Products Everyday',
      bottomBannerSubtitle: 'Best Quality • Lowest Prices',
      terminalDeviceId: 'WM-001',
      primaryColor: '#00a859',
    };
  });

  useEffect(() => {
    scheduleStorageSetJson(STORAGE_KEYS.BRANDING, branding);
  }, [branding]);

  // Toast notification (race-free cleanup)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setStatusMessage({ text, type });
    toastTimerRef.current = setTimeout(() => {
      setStatusMessage(null);
      toastTimerRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Keyboard Shortcuts (stable listener via ref)
  const cartLengthRef = useRef(0);
  cartLengthRef.current = cart.length;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setIsScannerOpen(true);
      } else if (e.key === 'F4') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (cartLengthRef.current > 0) {
          setIsCheckoutOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Cart Calculations
  const { totalQty, subtotal, discount, tax, grandTotal } = calculateCartTotals(
    cart,
    discountAmount,
    taxAmount
  );

  // Seed Catalog (Exact 15 Picture Items)
  const handleLoadSeedCatalog = async () => {
    setProducts(SEED_CATALOG_PRODUCTS);
    safeStorageSetJson(STORAGE_KEYS.INVENTORY, SEED_CATALOG_PRODUCTS);
    showToast('تصویر والے ۱۵ اصلی آئٹمز کامیابی سے لوڈ ہو گئے! (Loaded 15 Picture Items)', 'success');
    try {
      await syncService.postMutation('load_seed_catalog', {});
    } catch {}
  };

  const handleUpdateBranding = (nextBranding: StoreBranding) => {
    setBranding(nextBranding);
    safeStorageSetJson(STORAGE_KEYS.BRANDING, nextBranding);
    syncService.updateBranding(nextBranding);
  };

  const handleUpdateCategories = (nextCategories: CategoryInfo[]) => {
    setCategories(nextCategories);
    syncService.syncCategories(nextCategories);
  };

  const handleSaveDailyHisab = (nextHisab: Record<string, Record<string, Partial<DailyHisabRow>>>) => {
    setDailyHisab(nextHisab);
    safeStorageSetJson('waqas_mart_daily_hisab_v2', nextHisab);
    syncService.syncDailyHisab(nextHisab);
  };

  // Reset All Records to Zero via in-app modal confirmation (zero window.confirm)
  const executeResetAllZero = async () => {
    setProducts([]);
    setCart([]);
    setTransactions([]);
    setPurchases([]);
    setHeldBills([]);
    setCustomers([]);
    setCustomerLedgerEntries([]);
    setSaleReturns([]);
    setSupplierLedgers([]);
    setExpenses([]);
    setPurchaseReturns([]);
    setStaffList([]);
    clearOldSaleDraft(activeShopScopeId);
    safeStorageSetJson(STORAGE_KEYS.INVENTORY, []);
    safeStorageSetJson(STORAGE_KEYS.TRANSACTIONS, []);
    safeStorageSetJson(STORAGE_KEYS.PURCHASES, []);
    safeStorageSetJson(STORAGE_KEYS.HELD_BILLS, []);
    safeStorageSetJson(STORAGE_KEYS.CUSTOMERS, []);
    safeStorageSetJson(STORAGE_KEYS.CUSTOMER_LEDGERS, []);
    safeStorageSetJson(STORAGE_KEYS.RETURNS, []);
    safeStorageSetJson(STORAGE_KEYS.SUPPLIER_LEDGERS, []);
    safeStorageSetJson(STORAGE_KEYS.EXPENSES, []);
    safeStorageSetJson(STORAGE_KEYS.PURCHASE_RETURNS, []);
    safeStorageSetJson(STORAGE_KEYS.STAFF, []);
    setIsResetAllZeroConfirmOpen(false);
    showToast('All stock, sales, and ledger balances have been reset to 0.', 'info');
    try {
      await syncService.postMutation('reset_all_zero', {});
    } catch {}
  };

  const handleResetAllZero = () => {
    setIsResetAllZeroConfirmOpen(true);
  };

  // Handlers for Suppliers & Ledgers:
  const handleSaveSupplier = (supplier: Supplier) => {
    const idx = suppliers.findIndex((s) => s.id === supplier.id);
    const next = idx > -1 ? suppliers.map((s) => (s.id === supplier.id ? supplier : s)) : [supplier, ...suppliers];
    setSuppliers(next);
    syncService.syncSupplierLedgers(next, supplierLedgers);
  };

  const handleDeleteSupplier = (supplierId: string) => {
    const next = suppliers.filter((s) => s.id !== supplierId);
    setSuppliers(next);
    syncService.syncSupplierLedgers(next, supplierLedgers);
  };

  const handleSaveSupplierLedgerEntry = (entry: SupplierLedgerEntry) => {
    const idx = supplierLedgers.findIndex((e) => e.id === entry.id);
    const next = idx > -1 ? supplierLedgers.map((e) => (e.id === entry.id ? entry : e)) : [entry, ...supplierLedgers];
    setSupplierLedgers(next);
    syncService.syncSupplierLedgers(suppliers, next);
  };

  const handleDeleteSupplierLedgerEntry = (entryId: string) => {
    const next = supplierLedgers.filter((e) => e.id !== entryId);
    setSupplierLedgers(next);
    syncService.syncSupplierLedgers(suppliers, next);
  };

  const handleDeleteAllSupplierLedgers = (supplierId?: string) => {
    const next = supplierId ? supplierLedgers.filter((e) => e.supplierId !== supplierId) : [];
    setSupplierLedgers(next);
    syncService.syncSupplierLedgers(suppliers, next);
  };

  const handleSaveExpense = (expense: ExpenseEntry) => {
    setExpenses((prev) => {
      const idx = prev.findIndex((e) => e.id === expense.id);
      const next = idx > -1 ? prev.map((e) => (e.id === expense.id ? expense : e)) : [expense, ...prev];
      syncService.syncExpenses(next);
      return next;
    });
  };

  const handleDeleteExpense = (expenseId: string) => {
    setExpenses((prev) => {
      const next = prev.filter((e) => e.id !== expenseId);
      syncService.syncExpenses(next);
      return next;
    });
  };

  const handleDeleteAllExpenses = () => {
    setExpenses([]);
    syncService.syncExpenses([]);
  };

  const handleSavePurchaseReturn = (ret: PurchaseReturn): { ok: boolean; message?: string } => {
    if (purchaseReturns.some((r) => r.returnNumber === ret.returnNumber)) {
      const msg = `Purchase return #${ret.returnNumber} already saved.`;
      showToast(msg, 'info');
      return { ok: false, message: msg };
    }

    const stockCheck = validatePurchaseReturnStock(products, ret.items || []);
    if (!stockCheck.ok) {
      sounds.playErrorTone();
      showToast(stockCheck.message, 'error');
      return { ok: false, message: stockCheck.message };
    }

    const nowStr = new Date().toLocaleString('en-PK', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const histEntries: StockTransaction[] = [];

    // 1. Save return record
    setPurchaseReturns((prev) => [ret, ...prev]);

    // 2. Adjust product stock (subtract returned quantity, never below zero)
    const qtyByProdId = new Map<string, number>();
    for (const item of ret.items || []) {
      const matched = findLiveProduct(products, { productId: item.productId, barcode: item.barcode });
      if (matched) {
        qtyByProdId.set(matched.id, roundStockQty((qtyByProdId.get(matched.id) || 0) + (Number(item.quantity) || 0)));
      }
    }

    setProducts((prev) =>
      prev.map((prod) => {
        const deduct = qtyByProdId.get(prod.id);
        if (!deduct) return prod;
        const prevStock = roundStockQty(Number(prod.stock) || 0);
        const nextStock = roundStockQty(prevStock - deduct);
        histEntries.push({
          id: `stk-pret-${Date.now()}-${prod.id}`,
          productId: prod.id,
          productName: prod.name,
          barcode: prod.barcode,
          previousStock: prevStock,
          quantityChange: -deduct,
          newStock: nextStock,
          transactionType: 'Purchase Return',
          invoiceNumber: ret.returnNumber,
          dateTime: nowStr,
        });
        return { ...prod, stock: nextStock };
      })
    );
    if (histEntries.length > 0) {
      appendStockTransactions(histEntries);
    }

    // 3. Record in Supplier Ledgers as debit (reduces our payable balance to supplier)
    const ledgerEntry: SupplierLedgerEntry = {
      id: `supp-ledger-${Date.now()}`,
      supplierId: ret.supplierId,
      date: ret.date,
      description: `Purchase Return #${ret.returnNumber} for Invoice #${ret.originalInvoiceNumber}`,
      invoiceNumber: ret.originalInvoiceNumber,
      debit: ret.totalRefund,
      credit: 0,
      runningBalance: 0,
      paymentMethod: 'Purchase Return Adjustment',
      createdAt: new Date().toISOString(),
    };
    handleSaveSupplierLedgerEntry(ledgerEntry);
    syncService.syncPurchaseReturn(ret);
    showToast(`Purchase return of Rs. ${ret.totalRefund.toFixed(0)} saved and inventory adjusted.`, 'success');
    return { ok: true };
  };

  const handleDeletePurchaseReturn = (returnId: string) => {
    const next = purchaseReturns.filter((r) => r.id !== returnId);
    setPurchaseReturns(next);
    syncService.postMutation('sync_purchase_returns', next);
  };

  const handleDeleteAllPurchaseReturns = () => {
    setPurchaseReturns([]);
    syncService.postMutation('sync_purchase_returns', []);
  };

  const handleSaveStaff = (staff: StaffMember) => {
    setStaffList((prev) => {
      const idx = prev.findIndex((s) => s.id === staff.id);
      const next = idx > -1 ? prev.map((s) => (s.id === staff.id ? staff : s)) : [staff, ...prev];
      syncService.syncStaff(next);
      return next;
    });
  };

  const handleDeleteStaff = (staffId: string) => {
    setStaffList((prev) => {
      const next = prev.filter((s) => s.id !== staffId);
      syncService.syncStaff(next);
      return next;
    });
  };

  const handleDeleteAllStaff = () => {
    setStaffList([]);
    syncService.syncStaff([]);
  };

  const handleSyncCctvCameras = (nextCams: CctvCamera[]) => {
    setCctvCameras(nextCams);
  };

  const handleSyncDvrConfig = (config: DvrNvrConfig) => {
    setDvrConfig(config);
  };

  // Add Product to Cart with Strict Zero-Stock Protection (0 allowed, < 0 never allowed)
  const addToCart = (product: Product, qtyToAdd = 1): { ok: boolean; message?: string } => {
    const liveProduct =
      findLiveProduct(products, { productId: product.id, barcode: product.barcode }) || product;
    const availStock = roundStockQty(Number(liveProduct.stock) || 0);
    const existingCartQty = cart
      .filter((i) => i.product.id === liveProduct.id)
      .reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

    if (mode === 'sale') {
      if (availStock <= 0) {
        sounds.playErrorTone();
        showToast(STOCK_ALREADY_ZERO_MESSAGE, 'error');
        return { ok: false, message: STOCK_ALREADY_ZERO_MESSAGE };
      }
      if (roundStockQty(existingCartQty + qtyToAdd) > availStock) {
        const msg = buildInsufficientStockMessage(availStock);
        sounds.playErrorTone();
        showToast(msg, 'error');
        return { ok: false, message: msg };
      }
    }

    sounds.playBarcodeBeep();

    setCart((prevCart) => {
      const index = prevCart.findIndex((i) => i.product.id === liveProduct.id);
      if (index > -1) {
        const next = [...prevCart];
        const newQty = roundStockQty(next[index].quantity + qtyToAdd);
        next[index] = {
          ...next[index],
          product: liveProduct,
          quantity: newQty,
          lineTotal: newQty * next[index].unitPrice,
        };
        return next;
      } else {
        const newItem: CartItem = {
          id: `item-${Date.now()}-${liveProduct.id}`,
          product: liveProduct,
          quantity: qtyToAdd,
          unitPrice: liveProduct.price,
          discountAmount: 0,
          lineTotal: liveProduct.price * qtyToAdd,
        };
        return [...prevCart, newItem];
      }
    });
    return { ok: true };
  };

  const updateCartQty = (itemId: string, newQty: number): { ok: boolean; message?: string } => {
    if (newQty <= 0) {
      removeCartItem(itemId);
      return { ok: true };
    }

    if (mode === 'sale') {
      const targetItem = cart.find((i) => i.id === itemId);
      if (targetItem) {
        const liveProduct =
          findLiveProduct(products, { productId: targetItem.product.id, barcode: targetItem.product.barcode }) ||
          targetItem.product;
        const availStock = roundStockQty(Number(liveProduct.stock) || 0);
        const otherQty = cart
          .filter((i) => i.id !== itemId && i.product.id === liveProduct.id)
          .reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

        if (availStock <= 0) {
          sounds.playErrorTone();
          showToast(STOCK_ALREADY_ZERO_MESSAGE, 'error');
          return { ok: false, message: STOCK_ALREADY_ZERO_MESSAGE };
        }
        if (roundStockQty(otherQty + newQty) > availStock) {
          const msg = buildInsufficientStockMessage(availStock);
          sounds.playErrorTone();
          showToast(msg, 'error');
          return { ok: false, message: msg };
        }
      }
    }

    setCart((prev) =>
      prev.map((i) => {
        if (i.id === itemId) {
          return {
            ...i,
            quantity: newQty,
            lineTotal: newQty * i.unitPrice,
          };
        }
        return i;
      })
    );
    return { ok: true };
  };

  const updateCartPrice = (itemId: string, newPrice: number) => {
    const safePrice = Math.max(0, Number(newPrice) || 0);
    setCart((prev) =>
      prev.map((i) => {
        if (i.id === itemId) {
          return {
            ...i,
            unitPrice: safePrice,
            lineTotal: i.quantity * safePrice,
          };
        }
        return i;
      })
    );
  };

  const removeCartItem = (itemId: string) => {
    setCart((prev) => prev.filter((i) => i.id !== itemId));
  };

  const handleClearCart = () => {
    setCart([]);
    setDiscountAmount(0);
    setTaxAmount(0);
    setResumedHeldBillId(null);
    clearOldSaleDraft(activeShopScopeId);
  };

  const handleBarcodeDetected = (code: string) => {
    if (activeNav === 'New Sale POS' || activeNav === 'New Sale' || activeNav === 'New Sale Page' || activeNav === 'POS Terminal' || activeNav === 'New POS') {
      setScannedBarcodeForNewPos(code);
      setIsScannerOpen(false);
      return;
    }
    if (
      activeNav === 'New Purchase Entry' ||
      activeNav === 'New Purchase' ||
      activeNav === 'Purchase Entry' ||
      activeNav === 'Old Purchase' ||
      activeNav === 'Classic Purchase' ||
      activeNav === 'Old Purchase Entry'
    ) {
      setScannedBarcodeForPurchase(code);
      setIsScannerOpen(false);
      return;
    }
    if (
      activeNav === 'Total Stock' ||
      activeNav === 'Products' ||
      activeNav === 'Stock' ||
      activeNav === 'Stock Management' ||
      activeNav === 'Products Management' ||
      activeNav === 'Barcode Management'
    ) {
      setScannedBarcodeForTools(code);
      setIsScannerOpen(false);
      return;
    }
    const clean = (code || '').trim().toLowerCase();
    if (!clean) return;

    const matched = products.find((p) => {
      const b = (p?.barcode || '').trim().toLowerCase();
      const s = (p?.sku || '').trim().toLowerCase();
      const n = (p?.name || '').trim().toLowerCase();
      return b === clean || s === clean || n === clean;
    });

    if (matched) {
      addToCart(matched, 1);
      sounds.playBarcodeBeep();
      showToast(`Added: ${matched.name}`, 'success');
      setIsScannerOpen(false);
    } else {
      sounds.playErrorTone();
      showToast(`Barcode "${code}" not found in product database.`, 'error');
      setIsAddProductOpen(true);
    }
  };

  // Real Purchase Processing (With Duplicate Guard, Zero-Stock Protection & Stock Transaction History)
  const handleSavePurchase = (
    purchase: PurchaseTransaction,
    isEdit: boolean = false
  ): { ok: boolean; message?: string } => {
    const actor = purchase.editBy || purchase.userName || currentUser.displayName || 'Admin';
    const result = applyPurchaseSaveToState({
      purchase: {
        ...purchase,
        userName: purchase.userName || actor,
      },
      isEdit,
      products,
      suppliers,
      purchases,
      userName: actor,
      timestampStr: formatStockAuditTimestamp(),
    });

    if (result.duplicateBlocked) {
      const msg = `Purchase #${purchase.purchaseInvoiceNo} is already saved. Stock was not modified twice.`;
      showToast(msg, 'info');
      return { ok: false, message: msg };
    }

    if (result.stockError) {
      sounds.playErrorTone();
      showToast(result.stockError.message, 'error');
      return { ok: false, message: result.stockError.message };
    }

    setProducts(result.products);
    setSuppliers(result.suppliers);
    setPurchases(result.purchases);
    if (result.stockEntries.length > 0) {
      appendStockTransactions(result.stockEntries);
    }

    if (isEdit) {
      syncService.syncPurchaseUpdate(purchase);
    } else {
      syncService.syncPurchase(purchase);
    }
    sounds.playSuccessChime();
    return { ok: true };
  };

  const handleDeletePurchase = (purchaseId: string): { ok: boolean; message?: string } => {
    const reversed = applyPurchaseDeleteToState({
      purchaseId,
      products,
      suppliers,
      purchases,
      userName: currentUser.displayName || 'Admin',
      timestampStr: formatStockAuditTimestamp(),
    });

    if (reversed.stockError) {
      sounds.playErrorTone();
      showToast(reversed.stockError.message, 'error');
      return { ok: false, message: reversed.stockError.message };
    }

    if (!reversed.deletedPurchase) return { ok: false, message: 'Purchase record not found.' };

    setProducts(reversed.products);
    setSuppliers(reversed.suppliers);
    setPurchases(reversed.purchases);
    if (reversed.stockEntries.length > 0) {
      appendStockTransactions(reversed.stockEntries);
    }
    syncService.syncPurchaseDelete(reversed.deletedPurchase.id);
    sounds.playSuccessChime();
    showToast(`Purchase #${reversed.deletedPurchase.purchaseInvoiceNo} cancelled & stock reversed.`, 'info');
    return { ok: true };
  };

  const handleAddSupplier = (supplier: Supplier) => {
    const next = [supplier, ...suppliers];
    setSuppliers(next);
    syncService.syncSupplierLedgers(next, supplierLedgers);
    showToast(`Supplier "${supplier.name}" added to ledgers.`, 'success');
  };

  const handleSaveNewProduct = (newProd: Product): { ok: boolean; message?: string } => {
    if ((Number(newProd.stock) || 0) < 0) {
      sounds.playErrorTone();
      showToast(STOCK_ALREADY_ZERO_MESSAGE, 'error');
      return { ok: false, message: STOCK_ALREADY_ZERO_MESSAGE };
    }
    const cleanBarcode = (newProd.barcode || '').trim().toLowerCase();
    if (cleanBarcode) {
      const duplicate = products.find(
        (p) => p.id !== newProd.id && (p.barcode || '').trim().toLowerCase() === cleanBarcode
      );
      if (duplicate) {
        sounds.playErrorTone();
        const msg = `Duplicate barcode "${newProd.barcode}" is already assigned to "${duplicate.name}".`;
        showToast(msg, 'error');
        return { ok: false, message: msg };
      }
    }

    const next = [newProd, ...products];
    setProducts(next);
    syncService.syncStock(next);
    if ((Number(newProd.stock) || 0) > 0) {
      appendStockTransactions([
        {
          id: `stk-open-${Date.now()}-${newProd.id}`,
          productId: newProd.id,
          productName: newProd.name,
          barcode: newProd.barcode,
          previousStock: 0,
          quantityChange: Number(newProd.stock),
          newStock: Number(newProd.stock),
          transactionType: 'Opening Stock',
          invoiceNumber: 'NEW-PRODUCT',
          dateTime: new Date().toLocaleString('en-PK', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }),
        },
      ]);
    }
    sounds.playSuccessChime();
    showToast(`Product "${newProd.name}" saved to inventory!`, 'success');
    return { ok: true };
  };

  const handleSaveProduct = (prod: Product): { ok: boolean; message?: string } => {
    const cleanBarcode = (prod.barcode || '').trim().toLowerCase();
    if (cleanBarcode) {
      const duplicate = products.find(
        (p) => p.id !== prod.id && (p.barcode || '').trim().toLowerCase() === cleanBarcode
      );
      if (duplicate) {
        sounds.playErrorTone();
        const msg = `Duplicate barcode "${prod.barcode}" belongs to "${duplicate.name}".`;
        showToast(msg, 'error');
        return { ok: false, message: msg };
      }
    }

    const idx = products.findIndex((p) => p.id === prod.id);
    const next =
      idx > -1
        ? products.map((p, i) => (i === idx ? { ...prod, stock: p.stock } : p))
        : [prod, ...products];
    setProducts(next);
    syncService.syncStock(next);
    sounds.playSuccessChime();
    showToast(`Product "${prod.name}" updated in inventory!`, 'success');
    return { ok: true };
  };

  const handleDeleteProduct = (productId: string) => {
    const prod = products.find((p) => p.id === productId);
    setProducts((prev) => {
      const remaining = prev.filter((p) => p.id !== productId);
      syncService.syncStock(remaining);
      return remaining;
    });
    showToast(`Product "${prod?.name || 'Item'}" removed from inventory.`, 'info');
  };

  // Real Sale Return with Automatic Restocking & Refund Settlement
  const handleConfirmReturn = (returnRecord: SaleReturn) => {
    if (saleReturns.some((r) => r.returnNumber === returnRecord.returnNumber)) {
      showToast(`Return #${returnRecord.returnNumber} already processed.`, 'info');
      return;
    }

    const nowStr = new Date().toLocaleString('en-PK', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const histEntries: StockTransaction[] = [];

    // 1. Restock accepted resaleable items back to product inventory
    let restockedUnits = 0;
    setProducts((prev) =>
      prev.map((prod) => {
        const returnItem = returnRecord.items.find(
          (i) => i.productId === prod.id && i.condition === 'resaleable'
        );
        if (returnItem) {
          restockedUnits += returnItem.quantity;
          const prevStock = Number(prod.stock) || 0;
          const nextStock = prevStock + returnItem.quantity;
          histEntries.push({
            id: `stk-sret-${Date.now()}-${prod.id}`,
            productId: prod.id,
            productName: prod.name,
            barcode: prod.barcode,
            previousStock: prevStock,
            quantityChange: returnItem.quantity,
            newStock: nextStock,
            transactionType: 'Sale Return',
            invoiceNumber: returnRecord.returnNumber,
            dateTime: nowStr,
          });
          return {
            ...prod,
            stock: nextStock,
          };
        }
        return prod;
      })
    );
    appendStockTransactions(histEntries);

    // 2. If refund method is Credit Adjustment, reduce customer's Udhar balance in customer ledger
    if (returnRecord.refundMethod === 'credit' && returnRecord.customerName) {
      const cust = customers.find(
        (c) => c.name.toLowerCase() === returnRecord.customerName?.toLowerCase()
      );
      if (cust) {
        const ledgerEntry: CustomerLedgerEntry = {
          id: `entry-${Date.now()}`,
          customerId: cust.id,
          date: returnRecord.date,
          details: `Return Adjustment #${returnRecord.returnNumber} (Orig #${returnRecord.originalInvoiceNumber})`,
          credit: 0,
          debit: returnRecord.totalRefund, // Debit reduces outstanding Udhar
          runningBalance: 0,
          invoiceNumber: returnRecord.returnNumber,
          paymentMethod: 'Credit Adjustment',
          createdAt: new Date().toISOString(),
        };
        setCustomerLedgerEntries((prev) => [...prev, ledgerEntry]);
      }
    }

    // 3. Save Return Record
    setSaleReturns((prev) => [returnRecord, ...prev]);
    syncService.syncReturn(returnRecord);

    sounds.playSuccessChime();
    showToast(
      `Return #${returnRecord.returnNumber} completed! ${restockedUnits} units restocked to inventory. Refund of ${formatRs(
        returnRecord.totalRefund
      )} settled.`,
      'success'
    );
  };

  // Hold Bill
  const handleHoldBill = () => {
    if (cart.length === 0) {
      sounds.playErrorTone();
      showToast('Cannot hold an empty cart!', 'error');
      return;
    }

    const holdNumber = `HOLD-${Math.floor(100 + Math.random() * 900)}`;
    const newHeldBill: HeldBill = {
      id: `hold-${Date.now()}`,
      holdNumber,
      createdAt: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true }),
      mode,
      items: [...cart],
      subtotal,
      discount,
      taxAmount: tax,
      grandTotal,
      totalQty,
      sourcePage: 'Old Sale',
    };

    let updatedHeld = [...heldBills];
    if (resumedHeldBillId) {
      updatedHeld = updatedHeld.filter((b) => b.id !== resumedHeldBillId);
    }
    updatedHeld.push(newHeldBill);

    setHeldBills(updatedHeld);
    syncService.syncHeldBills(updatedHeld);
    setCart([]);
    setDiscountAmount(0);
    setTaxAmount(0);
    setResumedHeldBillId(null);
    clearOldSaleDraft(activeShopScopeId);
    setIsCartDrawerOpen(false);

    sounds.playSuccessChime();
    showToast(`Bill parked as ${holdNumber} in Old Sale. Ready for next customer!`, 'success');
  };

  const handleResumeHeldBill = (bill: HeldBill) => {
    if (!bill || !bill.items || bill.items.length === 0) {
      sounds.playErrorTone();
      showToast('Held bill contains no items to resume.', 'error');
      return;
    }

    try {
      // Remove the held entry from active Hold Bills list ONLY after successful restoration
      setHeldBills((prev) => {
        const nextHeld = prev.filter((b) => b.id !== bill.id);
        safeStorageSetJson(STORAGE_KEYS.HELD_BILLS, nextHeld);
        return nextHeld;
      });

      setResumedHeldBillId(null);
      setIsHeldBillsOpen(false);

      if (bill.sourcePage === 'New Sale') {
        // ALWAYS reopen inside New Sale Page
        setResumedNewSaleBill(bill);
        setActiveNav('New Sale POS');
        sounds.playBarcodeBeep();
        showToast(`Resumed ${bill.holdNumber} into New Sale (${bill.totalQty} items).`, 'success');
      } else {
        // ALWAYS reopen inside Old Sale Page
        if (cart.length > 0) {
          // Automatically preserve active cart to prevent data loss
          const activeHoldNumber = `HOLD-${Math.floor(100 + Math.random() * 900)}`;
          const heldActive: HeldBill = {
            id: `hold-${Date.now()}`,
            holdNumber: activeHoldNumber,
            createdAt: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true }),
            mode,
            items: [...cart],
            subtotal,
            discount,
            grandTotal,
            totalQty,
            sourcePage: 'Old Sale',
          };
          const updatedHeld = [...heldBills, heldActive];
          setHeldBills(updatedHeld);
          syncService.syncHeldBills(updatedHeld);
          showToast(`Previous cart preserved safely as ${activeHoldNumber}`, 'info');
        }

        // Restore all products, quantities, prices, discounts into Old Sale cart
        setMode(bill.mode || 'sale');
        setCart(bill.items);
        setDiscountAmount(bill.discount || 0);
        setTaxAmount(bill.taxAmount || 0);
        setActiveNav('Sale POS');

        sounds.playBarcodeBeep();
        showToast(`Resumed ${bill.holdNumber} into Old Sale (${bill.totalQty} items). Ready for checkout!`, 'success');
      }
    } catch (err) {
      console.error('Failed to restore held bill', err);
      sounds.playErrorTone();
      showToast('Failed to resume held bill. The bill remains safely parked.', 'error');
    }
  };

  // Manual Delete of Held Bill
  const handleDeleteHeldBill = (billId: string) => {
    setHeldBills((prev) => {
      const nextHeld = prev.filter((b) => b.id !== billId);
      safeStorageSetJson(STORAGE_KEYS.HELD_BILLS, nextHeld);
      syncService.deleteHeldBill(billId);
      return nextHeld;
    });

    if (resumedHeldBillId === billId) {
      setResumedHeldBillId(null);
    }

    sounds.playBarcodeBeep();
    showToast('Held bill permanently deleted from active list and database.', 'info');
  };

  const handleCancelHeldBill = (billId: string) => {
    handleDeleteHeldBill(billId);
  };

  const handleDeleteAllHeldBills = () => {
    setHeldBills([]);
    safeStorageSetJson(STORAGE_KEYS.HELD_BILLS, []);
    syncService.postMutation('delete_all_held_bills', {});
    sounds.playSuccessChime();
    showToast('All held bills permanently deleted.', 'info');
  };

  const handleDeleteAllProducts = () => {
    setProducts([]);
    syncService.syncStock([]);
    safeStorageSetJson(STORAGE_KEYS.INVENTORY, []);
    sounds.playSuccessChime();
    showToast('All products deleted from inventory.', 'info');
  };

  const handleReconcileNegativeStock = (): { count: number } => {
    const actor = currentUser.displayName || 'Admin';
    const res = reconcileNegativeStockFromHistory({
      products,
      purchases,
      transactions,
      saleReturns,
      purchaseReturns,
      actor,
      timestampStr: formatStockAuditTimestamp(),
    });

    if (res.reconciledCount > 0) {
      setProducts(res.products);
      if (res.stockEntries.length > 0) {
        appendStockTransactions(res.stockEntries);
      }
      syncService.postMutation('reconcile_negative_stock', {});
      sounds.playSuccessChime();
      showToast(
        `Reconciled ${res.reconciledCount} negative-stock product(s) cleanly to 0 with full audit entries.`,
        'success'
      );
    } else {
      showToast('All products already have 0 or positive stock.', 'info');
    }
    return { count: res.reconciledCount };
  };

  const handleDeleteAllPurchases = () => {
    if (purchases.length === 0) return;
    const res = applyPurchaseDeleteAllToState({
      products,
      suppliers,
      purchases,
      userName: currentUser.displayName || 'Admin',
      timestampStr: formatStockAuditTimestamp(),
    });

    if (!res.ok || res.stockError) {
      sounds.playErrorTone();
      showToast(res.stockError?.message || STOCK_ALREADY_ZERO_MESSAGE, 'error');
      return;
    }

    const clearedCount = purchases.length;
    setProducts(res.products);
    setSuppliers(res.suppliers);
    setPurchases([]);
    if (res.stockEntries.length > 0) {
      appendStockTransactions(res.stockEntries);
    }
    syncService.postMutation('delete_all_purchases', {});
    sounds.playSuccessChime();
    showToast(`All ${clearedCount} purchase records deleted and stock reversed.`, 'info');
  };

  const handleDeleteAllCustomers = () => {
    setCustomers([]);
    setCustomerLedgerEntries([]);
    safeStorageSetJson(STORAGE_KEYS.CUSTOMERS, []);
    safeStorageSetJson(STORAGE_KEYS.CUSTOMER_LEDGERS, []);
    syncService.syncLedgers([], []);
    sounds.playSuccessChime();
    showToast('All customers and customer ledgers permanently deleted.', 'info');
  };

  const [isResetSystemOpen, setIsResetSystemOpen] = useState(false);

  const handlePerformCompleteReset = () => {
    // 1. Create full complete JSON backup file before any wipe
    const backupData = {
      exportedAt: new Date().toISOString(),
      martName: branding.storeName || 'WAQAS MART',
      appletId: 'waqas-mart-pos',
      transactions,
      purchases,
      products,
      customers,
      customerLedgerEntries,
      suppliers,
      heldBills,
      saleReturns,
      branding,
    };

    const fileName = `waqas_mart_full_backup_${new Date().toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}.json`;
    const jsonBlob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(jsonBlob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);

    const stats = {
      transactionsCount: transactions.length,
      purchasesCount: purchases.length,
      customersCount: customers.length,
      productsCount: products.length,
      heldBillsCount: heldBills.length,
    };

    // 2. Clear all business transactions and ledgers
    setTransactions([]);
    setPurchases([]);
    setHeldBills([]);
    setCustomerLedgerEntries([]);
    setSaleReturns([]);
    setCart([]);
    setDiscountAmount(0);
    setTaxAmount(0);
    clearOldSaleDraft(activeShopScopeId);

    // 3. Zero balances for customers and suppliers
    setCustomers((prev) => prev.map((c) => ({ ...c, previousBalance: 0, currentBalance: 0 })));
    setSuppliers((prev) => prev.map((s) => ({ ...s, payableBalance: 0 })));

    // 4. Zero stock quantities for products
    setProducts((prev) => prev.map((p) => ({ ...p, stock: 0 })));

    // 5. Update local storage safely (preserving branding, accounts, and credentials)
    safeStorageSetJson(STORAGE_KEYS.TRANSACTIONS, []);
    safeStorageSetJson(STORAGE_KEYS.HELD_BILLS, []);
    safeStorageSetJson(STORAGE_KEYS.PURCHASES, []);
    safeStorageRemove('wm_expenses');
    safeStorageRemove('wm_cash_register');

    sounds.playSuccessChime();
    showToast('System Reset Complete! Automatic JSON backup downloaded.', 'success');

    return {
      backupFileName: fileName,
      stats,
    };
  };

  // Duplicate submission guard refs to prevent double billing on rapid clicks / recovery
  const isSaleSubmitLockedRef = useRef(false);
  const isNewSaleSubmitLockedRef = useRef(false);

  // Checkout Confirmation (With Strict Zero-Stock Protection, Double-Submit Guard & Stock History)
  const handleConfirmCheckout = (details: {
    method: PaymentMethod;
    cashTendered?: number;
    changeDue?: number;
    cardBank?: string;
    cardRef?: string;
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    note?: string;
  }): { ok: boolean; message?: string } => {
    if (isSaleSubmitLockedRef.current) return { ok: false, message: 'Sale submission already in progress.' };
    if (cart.length === 0 || grandTotal < 0) return { ok: false, message: 'Cart is empty.' };

    // Validate available stock for normal sales (0 allowed, < 0 never allowed)
    if (mode === 'sale') {
      const batchCheck = validateSaleItemsStock(products, cart);
      if (!batchCheck.ok) {
        sounds.playErrorTone();
        showToast(batchCheck.message, 'error');
        return { ok: false, message: batchCheck.message };
      }
    }

    isSaleSubmitLockedRef.current = true;
    try {

    const invoiceNumber = `WM-${Date.now().toString().slice(-6)}`;
    const nowStr = new Date().toLocaleString('en-PK', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    // Deduct stock ONLY when sale is completed & record StockTransaction
    if (mode === 'sale') {
      const soldQtyByProductId = new Map<string, number>();
      for (const item of cart) {
        const live = findLiveProduct(products, { productId: item.product.id, barcode: item.product.barcode });
        if (live) {
          soldQtyByProductId.set(
            live.id,
            roundStockQty((soldQtyByProductId.get(live.id) || 0) + (Number(item.quantity) || 0))
          );
        }
      }

      const histEntries: StockTransaction[] = [];
      setProducts((prev) =>
        prev.map((p) => {
          const deductQty = soldQtyByProductId.get(p.id);
          if (deductQty) {
            const prevStock = roundStockQty(Number(p.stock) || 0);
            const nextStock = roundStockQty(prevStock - deductQty);
            histEntries.push({
              id: `stk-sale-${Date.now()}-${p.id}`,
              productId: p.id,
              productName: p.name,
              barcode: p.barcode,
              previousStock: prevStock,
              quantityChange: -deductQty,
              newStock: nextStock,
              transactionType: 'Sale',
              invoiceNumber,
              dateTime: nowStr,
            });
            return { ...p, stock: nextStock };
          }
          return p;
        })
      );
      if (histEntries.length > 0) {
        appendStockTransactions(histEntries);
      }
    }

    const transaction: SaleTransaction = {
      invoiceNumber,
      dateTime: nowStr,
      mode,
      items: [...cart],
      subtotal,
      discount,
      taxAmount: tax,
      grandTotal,
      paymentMethod: details.method,
      cashTendered: details.cashTendered,
      changeDue: details.changeDue,
      cardReference: details.cardRef,
      cardBank: details.cardBank,
      customerName: details.customerName,
      customerPhone: details.customerPhone,
      cashierName: 'Counter 01 / کاؤنٹر ۱',
      status: 'completed',
    };

    setTransactions((prev) => [transaction, ...prev]);
    syncService.syncSale(transaction);

    // If Credit / Pay Later or partial credit sale: record into Customer Ledger deterministically
    if (details.method === 'credit' && details.customerName) {
      let cust = customers.find((c) =>
        (details.customerId && c.id === details.customerId) ||
        c.name.toLowerCase() === details.customerName?.toLowerCase()
      );
      let nextCustomers = customers;

      if (!cust) {
        cust = {
          id: details.customerId || `cust-${Date.now()}`,
          name: details.customerName,
          phone: details.customerPhone,
          previousBalance: 0,
          createdAt: new Date().toLocaleDateString('en-GB'),
        };
        nextCustomers = [cust, ...customers];
        setCustomers(nextCustomers);
      }

      const advancePaid = details.cashTendered || 0;
      const unpaidCredit = Math.max(0, grandTotal - advancePaid);

      if (unpaidCredit > 0) {
        const todayFormatted = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
        const ledgerId = `LED-SALE-${invoiceNumber}`;
        const ledgerEntry: CustomerLedgerEntry = {
          id: ledgerId,
          customerId: cust.id,
          date: todayFormatted,
          details: `POS Sale Invoice #${invoiceNumber}`,
          credit: unpaidCredit,
          debit: 0,
          runningBalance: 0,
          invoiceNumber,
          paymentMethod: 'Credit / Pay Later',
          createdAt: new Date().toISOString(),
        };

        const nextLedgers = customerLedgerEntries.some((l) => l.id === ledgerId)
          ? customerLedgerEntries
          : [...customerLedgerEntries, ledgerEntry];
        setCustomerLedgerEntries(nextLedgers);
        if (nextCustomers !== customers) {
          syncService.syncLedgers(nextCustomers, nextLedgers);
        }
        showToast(`Udhar of ${formatRs(unpaidCredit)} recorded in ${cust.name}'s ledger!`, 'info');
      } else if (nextCustomers !== customers) {
        syncService.syncLedgers(nextCustomers, customerLedgerEntries);
      }
    }

    if (resumedHeldBillId) {
      setHeldBills((prev) => prev.filter((b) => b.id !== resumedHeldBillId));
      setResumedHeldBillId(null);
    }

    sounds.playSuccessChime();
    try {
      confetti({
        particleCount: 45,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#16a34a', '#10b981', '#34d399', '#ffffff'],
      });
    } catch {}

    setCart([]);
    setDiscountAmount(0);
    setTaxAmount(0);
    clearOldSaleDraft(activeShopScopeId);
    setIsCheckoutOpen(false);

    setCurrentTransaction(transaction);
    setIsReceiptOpen(true);
    return { ok: true };
    } finally {
      setTimeout(() => {
        isSaleSubmitLockedRef.current = false;
      }, 300);
    }
  };

  // Customer Management Handlers
  const handleSaveNewPosInvoice = (invoiceData: {
    items: CartItem[];
    subtotal: number;
    discount: number;
    taxAmount: number;
    grandTotal: number;
    paymentMethod: 'cash' | 'card' | 'credit';
    cashTendered?: number;
    changeDue?: number;
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    invoiceNumber: string;
    note?: string;
  }) => {
    if (isNewSaleSubmitLockedRef.current) return { ok: false, message: 'Sale submission already in progress.' };
    if (transactions.some((t) => t.invoiceNumber === invoiceData.invoiceNumber)) {
      const msg = `Invoice #${invoiceData.invoiceNumber} is already saved.`;
      showToast(msg, 'info');
      return { ok: false, message: msg };
    }

    // Validate available stock across all items before completing sale
    const batchCheck = validateSaleItemsStock(products, invoiceData.items || []);
    if (!batchCheck.ok) {
      sounds.playErrorTone();
      showToast(batchCheck.message, 'error');
      return { ok: false, message: batchCheck.message };
    }

    isNewSaleSubmitLockedRef.current = true;
    try {

    const nowStr = new Date().toLocaleString('en-PK', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const histEntries: StockTransaction[] = [];

    // 1. Deduct aggregated stock from shared products inventory & record StockTransaction
    const soldQtyByProductId = new Map<string, number>();
    for (const it of invoiceData.items || []) {
      const live = findLiveProduct(products, { productId: it.product.id, barcode: it.product.barcode });
      if (live) {
        soldQtyByProductId.set(
          live.id,
          roundStockQty((soldQtyByProductId.get(live.id) || 0) + (Number(it.quantity) || 0))
        );
      }
    }

    setProducts((prev) =>
      prev.map((p) => {
        const deductQty = soldQtyByProductId.get(p.id);
        if (deductQty) {
          const prevStock = roundStockQty(Number(p.stock) || 0);
          const nextStock = roundStockQty(prevStock - deductQty);
          histEntries.push({
            id: `stk-nsale-${Date.now()}-${p.id}`,
            productId: p.id,
            productName: p.name,
            barcode: p.barcode,
            previousStock: prevStock,
            quantityChange: -deductQty,
            newStock: nextStock,
            transactionType: 'Sale',
            invoiceNumber: invoiceData.invoiceNumber,
            dateTime: nowStr,
          });
          return { ...p, stock: nextStock };
        }
        return p;
      })
    );
    if (histEntries.length > 0) {
      appendStockTransactions(histEntries);
    }

    // 2. Create SaleTransaction
    const transaction: SaleTransaction = {
      invoiceNumber: invoiceData.invoiceNumber,
      dateTime: nowStr,
      mode: 'sale',
      items: [...invoiceData.items],
      subtotal: invoiceData.subtotal,
      discount: invoiceData.discount,
      taxAmount: invoiceData.taxAmount,
      grandTotal: invoiceData.grandTotal,
      paymentMethod: invoiceData.paymentMethod,
      cashTendered: invoiceData.cashTendered,
      changeDue: invoiceData.changeDue,
      customerId: invoiceData.customerId,
      customerName: invoiceData.customerName,
      customerPhone: invoiceData.customerPhone,
      cashierName: currentUser.displayName || 'Counter 01',
      status: 'completed',
    };

    setTransactions((prev) => [transaction, ...prev]);
    syncService.syncSale(transaction);

    // 3. Customer Khata Udhar recording (deterministic LED-SALE-* ID matching server)
    if (invoiceData.paymentMethod === 'credit' && (invoiceData.customerId || invoiceData.customerName)) {
      let cust = customers.find(
        (c) =>
          (invoiceData.customerId && c.id === invoiceData.customerId) ||
          (invoiceData.customerName && c.name.toLowerCase() === invoiceData.customerName.toLowerCase())
      );
      let nextCustomers = customers;
      if (!cust && invoiceData.customerName) {
        cust = {
          id: invoiceData.customerId || `cust-${Date.now()}`,
          name: invoiceData.customerName,
          phone: invoiceData.customerPhone,
          previousBalance: 0,
          createdAt: new Date().toLocaleDateString('en-GB'),
        };
        nextCustomers = [cust, ...customers];
        setCustomers(nextCustomers);
      }
      if (cust) {
        const advancePaid = invoiceData.cashTendered || 0;
        const unpaidCredit = Math.max(0, invoiceData.grandTotal - advancePaid);
        if (unpaidCredit > 0) {
          const todayFormatted = new Date().toLocaleDateString('en-GB');
          const ledgerId = `LED-SALE-${invoiceData.invoiceNumber}`;
          const ledgerEntry: CustomerLedgerEntry = {
            id: ledgerId,
            customerId: cust.id,
            date: todayFormatted,
            details: `POS Sale Invoice #${invoiceData.invoiceNumber}`,
            credit: unpaidCredit,
            debit: 0,
            runningBalance: (cust.previousBalance || 0) + unpaidCredit,
            invoiceNumber: invoiceData.invoiceNumber,
            paymentMethod: 'Credit / Pay Later',
            createdAt: new Date().toISOString(),
          };
          const nextLedgers = customerLedgerEntries.some((l) => l.id === ledgerId)
            ? customerLedgerEntries
            : [...customerLedgerEntries, ledgerEntry];
          setCustomerLedgerEntries(nextLedgers);
          if (nextCustomers !== customers) {
            syncService.syncLedgers(nextCustomers, nextLedgers);
          }
        } else if (nextCustomers !== customers) {
          syncService.syncLedgers(nextCustomers, customerLedgerEntries);
        }
      }
    }

    setCurrentTransaction(transaction);
    setIsReceiptOpen(true);
    } finally {
      setTimeout(() => {
        isNewSaleSubmitLockedRef.current = false;
      }, 300);
    }
  };

  const handleHoldBillFromNewPos = (billData: {
    items: CartItem[];
    subtotal: number;
    discount: number;
    grandTotal: number;
    customerName?: string;
    customerPhone?: string;
  }) => {
    const holdNumber = "HOLD-" + Date.now().toString().slice(-4);
    const newHeldBill: HeldBill = {
      id: "held-" + Date.now(),
      holdNumber,
      createdAt: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true }),
      mode: 'sale',
      items: billData.items,
      subtotal: billData.subtotal,
      discount: billData.discount,
      grandTotal: billData.grandTotal,
      totalQty: billData.items.reduce((sum, it) => sum + it.quantity, 0),
      customerName: billData.customerName,
      customerPhone: billData.customerPhone,
    };
    const nextList = [newHeldBill, ...heldBills];
    setHeldBills(nextList);
    syncService.syncHeldBills(nextList);
    showToast("Bill parked as " + holdNumber, 'info');
  };

  const handleSaveCustomer = (customer: Customer) => {
    const idx = customers.findIndex((c) => c.id === customer.id);
    const next = idx > -1 ? customers.map((c) => (c.id === customer.id ? customer : c)) : [customer, ...customers];
    setCustomers(next);
    syncService.syncLedgers(next, customerLedgerEntries);
  };

  const handleDeleteCustomer = (customerId: string) => {
    const nextCustomers = customers.filter((c) => c.id !== customerId);
    const nextLedgers = customerLedgerEntries.filter((e) => e.customerId !== customerId);
    setCustomers(nextCustomers);
    setCustomerLedgerEntries(nextLedgers);
    syncService.syncLedgers(nextCustomers, nextLedgers);
  };

  const handleSaveLedgerEntry = (entry: CustomerLedgerEntry) => {
    const idx = customerLedgerEntries.findIndex((e) => e.id === entry.id);
    const next = idx > -1
      ? customerLedgerEntries.map((e) => (e.id === entry.id ? entry : e))
      : [...customerLedgerEntries, entry];
    setCustomerLedgerEntries(next);
    syncService.syncLedgers(customers, next);
  };

  const handleDeleteLedgerEntry = (entryId: string) => {
    const next = customerLedgerEntries.filter((e) => e.id !== entryId);
    setCustomerLedgerEntries(next);
    syncService.syncLedgers(customers, next);
  };

  // Filtered Products for POS (memoized to avoid re-scanning full catalog on unrelated re-renders)
  const cleanSearchQuery = (searchQuery || '').toLowerCase().trim();
  const filteredProducts = useMemo(() => {
    const targetCat = (selectedCategory || 'ALL ITEMS').toUpperCase();
    return products.filter((p) => {
      const pCat = (p?.category || '').toUpperCase();
      const matchesCategory = targetCat === 'ALL ITEMS' || pCat.includes(targetCat);

      if (!cleanSearchQuery) return matchesCategory;

      const pName = (p?.name || '').toLowerCase();
      const pBarcode = (p?.barcode || '').toLowerCase();
      const pSku = (p?.sku || '').toLowerCase();
      const pUrdu = p?.urduName ? p.urduName.toLowerCase() : '';

      const matchesName = pName.includes(cleanSearchQuery);
      const matchesBarcode = pBarcode.includes(cleanSearchQuery) || (pSku && pSku === cleanSearchQuery);
      const matchesUrdu = pUrdu.includes(cleanSearchQuery);

      return matchesCategory && (matchesName || matchesBarcode || matchesUrdu);
    });
  }, [products, selectedCategory, cleanSearchQuery]);

  // Handlers for Supplier Ledgers
  const handleSaveSupplierLedger = (entry: SupplierLedgerEntry) => {
    setSupplierLedgers((prev) => {
      const idx = prev.findIndex((e) => e.id === entry.id);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = entry;
        return next;
      }
      return [entry, ...prev];
    });
  };

  const handleDeleteSupplierLedger = (entryId: string) => {
    setSupplierLedgers((prev) => prev.filter((e) => e.id !== entryId));
  };

  const activeRole = authSession?.user?.role;
  const staffPermissions: StaffModulePermissions | null =
    activeRole === 'STAFF'
      ? { ...DEFAULT_STAFF_PERMISSIONS, ...(authSession?.user?.permissions || {}) }
      : null;
  const canViewCostAndProfit =
    activeRole === 'STAFF' ? Boolean(staffPermissions?.canViewCostAndProfit) : true;

  const canAccessNav = (nav: string): boolean => {
    if (activeRole !== 'STAFF' || !staffPermissions) return true;
    const p = staffPermissions;
    switch (nav) {
      case 'Home':
        return true;
      case 'New Sale POS':
      case 'New Sale':
      case 'New Sale Page':
      case 'POS Terminal':
      case 'New POS':
        return Boolean(p.newSale);
      case 'Sale POS':
      case 'Old Sale':
      case 'Classic Sale POS':
      case 'Classic Sale':
      case 'Old Sale Page':
      case 'Sale Returns':
      case 'Sale Return':
      case 'Return Mode':
      case 'Sales Return':
        return Boolean(p.oldSale);
      case 'New Purchase Entry':
      case 'New Purchase':
        return Boolean(p.newPurchase);
      case 'Purchase Entry':
      case 'Old Purchase':
      case 'Classic Purchase':
      case 'Old Purchase Entry':
      case 'Purchase Returns':
      case 'Purchase Return':
        return Boolean(p.oldPurchase);
      case 'Total Stock':
      case 'Stock':
      case 'Stock Management':
        return Boolean(p.stock);
      case 'Products':
      case 'Products Management':
      case 'Barcode Management':
        return Boolean(p.products);
      case 'Customers':
      case 'Customers Management':
      case 'Customer Udhar':
      case 'Customer Udhaar':
      case 'Udhaar':
      case 'Customer Ledgers':
      case 'Customer Ledger':
      case 'All Customer Udhar':
      case 'Customers / Udhaar':
        return Boolean(p.customers || p.canAccessLedgers);
      case 'Suppliers':
      case 'Suppliers Management':
      case 'Supplier Payments':
      case 'Supplier Ledgers':
      case 'Supplier Ledger':
        return Boolean(p.suppliers || p.canAccessLedgers);
      case 'Expenses':
        return Boolean(p.expenses);
      case 'Daily Hisab':
      case 'Sale Summary':
      case 'Sales Reports':
      case 'Reports':
      case 'Purchase Reports':
      case 'Stock Reports':
        return Boolean(p.reports || p.canAccessReports);
      case 'Profit & Loss Reports':
        return Boolean((p.reports || p.canAccessReports) && p.canViewCostAndProfit);
      case 'Printer Settings':
        return Boolean(p.printing);
      case 'All Staff':
      case 'Staff':
      case 'Staff Management':
      case 'Device Management':
      case 'QR Code Connection':
      case 'Connect New Device':
      case 'Application Settings':
      case 'Settings':
      case 'Owner Profiles':
      case 'Backup & Restore':
      case 'Backup and Restore':
      case 'Security & Login':
      case 'Security and Login':
      case 'CCTV':
      case 'Cameras':
        return Boolean(p.settings || p.canAccessSettings);
      default:
        return true;
    }
  };

  // Central Navigation Dispatcher - Guarantees distinct routing for ALL 29 application pages & modules
  const handleNavigate = (page: string) => {
    let nextTarget = page;
    if (page === 'Home') {
      nextTarget = 'Home';
    } else if (page === 'New Sale POS' || page === 'New Sale Page' || page === 'New Sale' || page === 'New POS' || page === 'POS Terminal') {
      nextTarget = 'New Sale POS';
    } else if (page === 'Sale POS' || page === 'Classic Sale POS' || page === 'Old Sale Page' || page === 'Old Sale' || page === 'Classic Sale') {
      nextTarget = 'Sale POS';
    } else if (page === 'New Purchase Entry' || page === 'New Purchase') {
      nextTarget = 'New Purchase Entry';
    } else if (page === 'Purchase Entry' || page === 'Classic Purchase' || page === 'Old Purchase Entry' || page === 'Old Purchase') {
      nextTarget = 'Purchase Entry';
    } else if (page === 'Sale Returns' || page === 'Sale Return' || page === 'Return Mode' || page === 'Sales Return') {
      nextTarget = 'Sale Returns';
    } else if (page === 'Purchase Returns' || page === 'Purchase Return') {
      nextTarget = 'Purchase Returns';
    } else if (page === 'Daily Hisab') {
      nextTarget = 'Daily Hisab';
    } else if (page === 'Customers' || page === 'Customers Management') {
      nextTarget = 'Customers';
    } else if (page === 'Customer Udhar' || page === 'Customer Udhaar' || page === 'Udhaar') {
      nextTarget = 'Customer Udhar';
    } else if (page === 'Customer Ledgers' || page === 'Customer Ledger' || page === 'All Customer Udhar' || page === 'Customers / Udhaar') {
      nextTarget = 'Customer Ledgers';
    } else if (page === 'Suppliers' || page === 'Suppliers Management') {
      nextTarget = 'Suppliers';
    } else if (page === 'Supplier Payments') {
      nextTarget = 'Supplier Payments';
    } else if (page === 'Supplier Ledgers' || page === 'Supplier Ledger') {
      nextTarget = 'Supplier Ledgers';
    } else if (page === 'Expenses') {
      nextTarget = 'Expenses';
    } else if (page === 'All Staff' || page === 'Staff' || page === 'Staff Management') {
      nextTarget = 'All Staff';
    } else if (page === 'CCTV' || page === 'Cameras') {
      nextTarget = 'CCTV';
    } else if (page === 'Sale Summary' || page === 'Sales Reports' || page === 'Reports') {
      nextTarget = 'Sale Summary';
    } else if (page === 'Purchase Reports') {
      nextTarget = 'Purchase Reports';
    } else if (page === 'Profit & Loss Reports') {
      nextTarget = 'Profit & Loss Reports';
    } else if (page === 'Stock Reports') {
      nextTarget = 'Stock Reports';
    } else if (page === 'Products' || page === 'Products Management') {
      nextTarget = 'Products';
    } else if (page === 'Total Stock' || page === 'Stock' || page === 'Stock Management') {
      nextTarget = 'Total Stock';
    } else if (page === 'Barcode Management') {
      nextTarget = 'Barcode Management';
    } else if (page === 'Device Management') {
      nextTarget = 'Device Management';
    } else if (page === 'QR Code Connection') {
      nextTarget = 'QR Code Connection';
    } else if (page === 'Connect New Device') {
      if (!canAccessNav('Connect New Device')) {
        showToast('Access denied: Staff permission required for Device Pairing.', 'error');
        return;
      }
      setIsConnectQrOpen(true);
      return;
    } else if (page === 'Printer Settings') {
      nextTarget = 'Printer Settings';
    } else if (page === 'Application Settings' || page === 'Settings' || page === 'Owner Profiles') {
      nextTarget = 'Application Settings';
    } else if (page === 'Backup & Restore' || page === 'Backup and Restore') {
      nextTarget = 'Backup & Restore';
    } else if (page === 'Security & Login' || page === 'Security and Login') {
      nextTarget = 'Security & Login';
    }

    if (!canAccessNav(nextTarget)) {
      showToast(`Access denied: your staff account does not have permission for "${nextTarget}".`, 'error');
      return;
    }

    if (
      nextTarget === 'Customers' ||
      nextTarget === 'Customer Udhar' ||
      nextTarget === 'Customer Ledgers'
    ) {
      setSelectedLedgerCustomerId(null);
    }
    if (nextTarget === 'New Sale POS' || nextTarget === 'Sale POS') {
      setMode('sale');
    } else if (nextTarget === 'New Purchase Entry' || nextTarget === 'Purchase Entry') {
      setMode('purchase');
    } else if (nextTarget === 'Sale Returns') {
      setMode('return');
    }
    setActiveNav(nextTarget);
  };

  if (!authChecked) {
    return (
      <div className="min-h-[100dvh] w-full bg-[#022c16] text-white flex flex-col items-center justify-center p-6">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center mb-3 animate-pulse">
          <Crown className="w-6 h-6 text-amber-400" />
        </div>
        <p className="text-sm font-black tracking-wide uppercase">WAQAS POS SOFTWARE</p>
        <p className="text-xs text-emerald-300 mt-1">Verifying secure session...</p>
      </div>
    );
  }

  const hasValidAuthSession = Boolean(authSession?.token && authSession?.user?.role);

  // Centralized Auth Gateway when unauthenticated and not a QR-paired terminal
  if (!hasValidAuthSession && !isPairedTerminal) {
    return (
      <LoginGateway
        onLoginSuccess={handleLoginSuccess}
        onPairedSuccess={handlePairedSuccess}
        initialNotice={authNotice}
      />
    );
  }

  // SECURITY GATE: Blocks ALL private pages, routes, and POS data until unlocked
  if (appLockConfig.enabled && isAppLocked) {
    return (
      <AppLockScreen
        config={appLockConfig}
        storeName={
          authSession?.user?.role === 'SUPER_ADMIN' && superAdminModeView !== 'pos'
            ? 'SUPER ADMIN PORTAL'
            : branding.storeName || authSession?.shop?.shopName || 'WAQAS MART'
        }
        shopId={activeShopScopeId}
        authUser={authSession?.user || null}
        reasonMessage={appLockReason}
        onConfigUpdated={(next) => {
          setAppLockConfig(next);
          cacheAppLockConfig(activeShopScopeId, next);
        }}
        onUnlocked={(next) => {
          if (next) {
            setAppLockConfig(next);
            cacheAppLockConfig(activeShopScopeId, next);
          }
          unlockedOnceInTabRef.current = true;
          setAppLockReason(null);
          setIsAppLocked(false);
          if (authSession?.user?.role !== 'SUPER_ADMIN' || superAdminModeView === 'pos') {
            syncService.connectSse();
          }
        }}
        onSignOut={hasValidAuthSession ? handleSignOut : undefined}
      />
    );
  }

  // Super Admin Authority Console (or Isolated Personal MY POS APP when toggled)
  if (authSession?.user?.role === 'SUPER_ADMIN' && superAdminModeView !== 'pos') {
    return (
      <>
        <SuperAdminDashboard
          authUser={authSession.user}
          appLockConfig={appLockConfig}
          onAppLockConfigChange={(next) => {
            setAppLockConfig(next);
            cacheAppLockConfig(activeShopScopeId, next);
          }}
          onLockNow={() => triggerManualAppLock('Locked manually by Super Admin.')}
          onExitApp={handleRequestAppExit}
          onOpenMyPosApp={handleOpenSuperAdminPos}
          onSignOut={handleSignOut}
        />
        <ExitSecurityModal
          isOpen={isExitSecurityOpen}
          config={appLockConfig}
          storeName="SUPER ADMIN PORTAL"
          shopId={activeShopScopeId}
          onConfigUpdated={(next) => {
            setAppLockConfig(next);
            cacheAppLockConfig(activeShopScopeId, next);
          }}
          onCancel={() => setIsExitSecurityOpen(false)}
          onConfirmExitSuccess={() => {
            unlockedOnceInTabRef.current = false;
            setIsExitSecurityOpen(false);
            setAppLockReason('Session locked safely on Exit · Authenticate to reopen.');
            setIsAppLocked(true);
            try {
              window.close();
            } catch {}
          }}
        />
      </>
    );
  }

  const isSuperAdminPosMode = authSession?.user?.role === 'SUPER_ADMIN' && superAdminModeView === 'pos';
  const effectiveNav = canAccessNav(activeNav) ? activeNav : 'Home';
  const isHomePage = effectiveNav === 'Home';
  const isNewSalePage = effectiveNav === 'New Sale POS' || effectiveNav === 'New Sale' || effectiveNav === 'New Sale Page' || effectiveNav === 'POS Terminal' || effectiveNav === 'New POS';
  const isOldSalePage = effectiveNav === 'Sale POS' || effectiveNav === 'Old Sale' || effectiveNav === 'Classic Sale POS' || effectiveNav === 'Classic Sale' || effectiveNav === 'Old Sale Page';
  const isPurchaseWorkstationPage = effectiveNav === 'New Purchase Entry' || effectiveNav === 'New Purchase' || effectiveNav === 'Purchase Entry' || effectiveNav === 'Old Purchase' || effectiveNav === 'Classic Purchase' || effectiveNav === 'Old Purchase Entry';

  return (
    <div className="h-[100dvh] w-full max-w-full bg-[#f8fafc] text-slate-900 flex flex-col font-sans overflow-hidden">
      {isSuperAdminPosMode && (
        <div
          data-testid="super-admin-pos-bar"
          className="shrink-0 bg-slate-900 text-white border-b border-amber-500/40 px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs z-40"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 font-black uppercase tracking-wider shrink-0">
              MY POS APP
            </span>
            <span className="text-slate-200 font-semibold truncate">
              Super Admin Personal POS (Isolated from all Mart accounts)
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleReturnToSuperAdminDashboard}
              data-testid="back-to-super-admin-dashboard"
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to Super Admin Dashboard</span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              data-testid="sa-pos-bar-signout"
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-1.5 transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
      {/* MAIN CONTENT WORKSPACE (Allows complete vertical scrolling for every page) */}
      <main className={`flex-1 flex flex-col min-w-0 min-h-0 w-full ${isPurchaseWorkstationPage ? 'overflow-hidden pb-0' : isNewSalePage || isOldSalePage ? 'overflow-y-auto overflow-x-hidden pb-0' : 'overflow-y-auto overflow-x-hidden pb-16 lg:pb-0'} overscroll-y-contain`}>
        {/* CONDITIONAL PAGE RENDER (ALL 29 APPLICATION PAGES + MODULES) */}
        {effectiveNav === 'Device Management' || effectiveNav === 'Connect New Device' ? (
          <DeviceManagementPage
            currentDevice={currentDevice}
            branding={branding}
            onNavigateHome={() => setActiveNav('Home')}
            onOpenConnectNewQr={() => setIsConnectQrOpen(true)}
            onOpenPairThisDevice={() => setIsPairModalOpen(true)}
            onOpenPwaInstall={() => setIsPwaInstallOpen(true)}
            isPwaInstallable={true}
          />
        ) : effectiveNav === 'QR Code Connection' ? (
          <QrConnectionPage
            currentDevice={currentDevice}
            branding={branding}
            onOpenGenerateQr={() => setIsConnectQrOpen(true)}
            onOpenPairThisDevice={() => setIsPairModalOpen(true)}
            onNavigateDevices={() => setActiveNav('Device Management')}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : effectiveNav === 'Barcode Management' ? (
          <BarcodeManagementPage
            products={products}
            branding={branding}
            onSaveProduct={handleSaveProduct}
            onOpenScanner={() => setIsScannerOpen(true)}
            onOpenAddProduct={() => setIsAddProductOpen(true)}
            onBackToHome={() => setActiveNav('Home')}
            initialSearch={scannedBarcodeForTools || ''}
          />
        ) : effectiveNav === 'Printer Settings' ? (
          <PrinterSettingsModal
            isOpen={true}
            asPage={true}
            onClose={() => setActiveNav('Home')}
            branding={branding}
            onSettingsUpdated={(updated) => {
              setPrinterSettings(updated);
              syncService.syncPrinterSettings(updated);
            }}
          />
        ) : effectiveNav === 'Application Settings' || effectiveNav === 'Settings' || effectiveNav === 'Owner Profiles' ? (
          <BrandingSettingsModal
            isOpen={true}
            asPage={true}
            onClose={() => setActiveNav('Home')}
            branding={branding}
            currentUser={currentUser}
            onSaveBranding={(updated) => {
              handleUpdateBranding(updated);
              showToast('Store branding & Owner Profile saved and synced!', 'success');
            }}
            onOpenReceiptDesigner={() => setIsReceiptDesignerOpen(true)}
            onOpenPrinterSettings={() => setActiveNav('Printer Settings')}
            onOpenResetSystem={() => setIsResetSystemOpen(true)}
          />
        ) : effectiveNav === 'Backup & Restore' || effectiveNav === 'Backup and Restore' ? (
          <BackupRestorePage
            currentStore={{
              products,
              categories,
              transactions,
              purchases,
              customers,
              customerLedgers: customerLedgerEntries,
              saleReturns,
              purchaseReturns,
              suppliers,
              supplierLedgers,
              heldBills,
              expenses,
              staffList,
              stockHistory,
              dailyHisab,
              branding,
              receiptSettings,
            }}
            onRestoreApplied={(restored) => {
              applyServerStoreSnapshot(restored);
              showToast('Backup restored and synchronized across connected devices!', 'success');
            }}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : effectiveNav === 'Security & Login' || effectiveNav === 'Security and Login' ? (
          <SecuritySettingsPage
            currentDevice={currentDevice}
            authUser={authSession?.user || null}
            shopName={branding.storeName || authSession?.shop?.shopName || 'WAQAS MART'}
            shopId={activeShopScopeId}
            branding={branding}
            appLockConfig={appLockConfig}
            onAppLockConfigChange={(next) => {
              setAppLockConfig(next);
              cacheAppLockConfig(activeShopScopeId, next);
            }}
            onLockNow={() => triggerManualAppLock('Application locked manually from Security Settings.')}
            onSignOut={handleSignOut}
            onNavigate={handleNavigate}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : effectiveNav === 'Daily Hisab' ? (
          <DailyHisabExcelPage
            transactions={transactions}
            purchases={purchases}
            customerLedgerEntries={customerLedgerEntries}
            expenses={expenses}
            serverDailyHisab={dailyHisab}
            onSyncDailyHisab={handleSaveDailyHisab}
            branding={branding}
            onNavigateToSummary={() => setActiveNav('Sale Summary')}
            onNavigateToLedgers={() => {
              setActiveNav('Customer Ledgers');
              setSelectedLedgerCustomerId(null);
            }}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : effectiveNav === 'Customers' ||
          effectiveNav === 'Customers Management' ||
          effectiveNav === 'Customer Udhar' ||
          effectiveNav === 'Customer Udhaar' ||
          effectiveNav === 'Udhaar' ||
          effectiveNav === 'Customer Ledgers' ||
          effectiveNav === 'Customer Ledger' ||
          effectiveNav === 'All Customer Udhar' ||
          effectiveNav === 'Customers / Udhaar' ? (
          <CustomerLedgersPage
            customers={customers}
            ledgerEntries={customerLedgerEntries}
            branding={branding}
            initialTab={
              effectiveNav === 'Customers' || effectiveNav === 'Customers Management'
                ? 'customers'
                : effectiveNav === 'Customer Udhar' || effectiveNav === 'Customer Udhaar' || effectiveNav === 'Udhaar'
                ? 'udhaar'
                : 'ledger'
            }
            onSaveCustomer={handleSaveCustomer}
            onDeleteCustomer={handleDeleteCustomer}
            onSaveLedgerEntry={handleSaveLedgerEntry}
            onDeleteLedgerEntry={handleDeleteLedgerEntry}
            onDeleteAllCustomers={handleDeleteAllCustomers}
            initialSelectedCustomerId={selectedLedgerCustomerId}
            onBackToPos={() => setActiveNav('Sale POS')}
            onNavigateToDailyHisab={() => setActiveNav('Daily Hisab')}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : effectiveNav === 'Suppliers' ||
          effectiveNav === 'Suppliers Management' ||
          effectiveNav === 'Supplier Payments' ||
          effectiveNav === 'Supplier Ledgers' ||
          effectiveNav === 'Supplier Ledger' ? (
          <SupplierLedgersPage
            suppliers={suppliers}
            purchases={purchases}
            ledgerEntries={supplierLedgers}
            branding={branding}
            initialTab={
              effectiveNav === 'Supplier Payments'
                ? 'payments'
                : effectiveNav === 'Supplier Ledgers' || effectiveNav === 'Supplier Ledger'
                ? 'ledger'
                : 'suppliers'
            }
            onSaveLedgerEntry={handleSaveSupplierLedgerEntry}
            onDeleteLedgerEntry={handleDeleteSupplierLedgerEntry}
            onSaveSupplier={handleSaveSupplier}
            onDeleteSupplier={handleDeleteSupplier}
            onNavigateToPurchases={() => setActiveNav('New Purchase Entry')}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : effectiveNav === 'Total Stock' ||
          effectiveNav === 'Stock' ||
          effectiveNav === 'Stock Management' ||
          effectiveNav === 'Products' ||
          effectiveNav === 'Products Management' ? (
          <TotalStockPage
            products={products}
            categories={categories}
            stockHistory={stockHistory}
            transactions={transactions}
            purchases={purchases}
            saleReturns={saleReturns}
            purchaseReturns={purchaseReturns}
            initialViewMode={
              effectiveNav === 'Products' || effectiveNav === 'Products Management' ? 'products' : 'stock'
            }
            scannedBarcode={scannedBarcodeForTools}
            onClearScannedBarcode={() => setScannedBarcodeForTools(null)}
            branding={branding}
            onSaveProduct={handleSaveProduct}
            onDeleteProduct={handleDeleteProduct}
            onDeleteAllProducts={handleDeleteAllProducts}
            onReconcileNegativeStock={handleReconcileNegativeStock}
            onOpenAddProduct={() => setIsAddProductOpen(true)}
            onOpenScanner={() => setIsScannerOpen(true)}
            onNavigateToPos={() => {
              setActiveNav('New Sale POS');
              setMode('sale');
            }}
            onBackToHome={() => setActiveNav('Home')}
            canViewCostAndProfit={canViewCostAndProfit}
          />
        ) : effectiveNav === 'Sale Summary' ||
          effectiveNav === 'Sales Reports' ||
          effectiveNav === 'Reports' ||
          effectiveNav === 'Purchase Reports' ||
          effectiveNav === 'Profit & Loss Reports' ||
          effectiveNav === 'Stock Reports' ? (
          <SaleSummaryPage
            transactions={transactions}
            saleReturns={saleReturns}
            products={products}
            purchases={purchases}
            expenses={expenses}
            initialTab={
              effectiveNav === 'Purchase Reports'
                ? 'purchase'
                : effectiveNav === 'Profit & Loss Reports'
                ? 'profit'
                : effectiveNav === 'Stock Reports'
                ? 'stock'
                : 'sales'
            }
            branding={branding}
            onSelectInvoiceToPrint={(tx) => {
              setCurrentTransaction(tx);
              setIsReceiptOpen(true);
            }}
            onNavigate={(p) => handleNavigate(p)}
            activeNav={effectiveNav}
            onBackToHome={() => setActiveNav('Home')}
            canViewCostAndProfit={canViewCostAndProfit}
          />
        ) : effectiveNav === 'New Sale POS' || effectiveNav === 'New Sale' || effectiveNav === 'New Sale Page' || effectiveNav === 'POS Terminal' || effectiveNav === 'New POS' ? (
          <NewSalePosPage
            products={products}
            customers={customers}
            heldBills={heldBills}
            transactions={transactions}
            branding={branding}
            currentUser={currentUser}
            currentDevice={currentDevice}
            scannedBarcode={scannedBarcodeForNewPos}
            onClearScannedBarcode={() => setScannedBarcodeForNewPos(null)}
            onSaveInvoice={handleSaveNewPosInvoice}
            onHoldBill={handleHoldBillFromNewPos}
            onResumeHeldBill={handleResumeHeldBill}
            onDeleteHeldBill={handleDeleteHeldBill}
            onOpenHeldBillsModal={() => setIsHeldBillsOpen(true)}
            onOpenScanner={() => setIsScannerOpen(true)}
            onOpenAddProduct={() => setIsAddProductOpen(true)}
            onQuickAddCustomer={handleSaveCustomer}
            onNavigate={handleNavigate}
            onViewReceipt={(tx) => {
              setCurrentTransaction(tx);
              setIsReceiptOpen(true);
            }}
            resumedBill={resumedNewSaleBill}
            onClearResumedBill={() => setResumedNewSaleBill(null)}
            onSwitchToOldSale={() => handleNavigate('Sale POS')}
            onBackToHome={() => setActiveNav('Home')}
            canViewCostAndProfit={canViewCostAndProfit}
            canAccessSaleSummary={canAccessNav('Sale Summary')}
            saleReturns={saleReturns}
            shopId={activeShopScopeId}
          />
        ) : effectiveNav === 'Sale POS' || effectiveNav === 'Old Sale' || effectiveNav === 'Classic Sale POS' || effectiveNav === 'Classic Sale' || effectiveNav === 'Old Sale Page' ? (
          <SalePosPage
            products={products}
            categories={categories}
            cart={cart}
            mode={mode}
            totalQty={totalQty}
            subtotal={subtotal}
            discount={discount}
            taxAmount={tax}
            grandTotal={grandTotal}
            heldBillsCount={heldBills.length}
            branding={branding}
            currentUser={currentUser}
            currentDevice={currentDevice}
            transactions={transactions}
            saleReturns={saleReturns}
            canAccessSaleSummary={canAccessNav('Sale Summary')}
            onAddToCart={addToCart}
            onUpdateCartQty={updateCartQty}
            onUpdateCartPrice={updateCartPrice}
            onUpdateDiscount={setDiscountAmount}
            onUpdateTax={setTaxAmount}
            onRemoveCartItem={removeCartItem}
            onClearCart={handleClearCart}
            onSwitchMode={(newMode) => {
              setMode(newMode);
              if (newMode === 'purchase') handleNavigate('New Purchase Entry');
              if (newMode === 'return') handleNavigate('Sale Returns');
            }}
            onOpenCheckout={() => {
              setIsCheckoutOpen(true);
            }}
            onOpenCartDrawer={() => setIsCartDrawerOpen(true)}
            onHoldBill={handleHoldBill}
            onOpenHeldBills={() => setIsHeldBillsOpen(true)}
            heldBills={heldBills}
            onResumeHeldBill={handleResumeHeldBill}
            onDeleteHeldBill={handleDeleteHeldBill}
            onOpenScanner={() => setIsScannerOpen(true)}
            onOpenAddProduct={() => setIsAddProductOpen(true)}
            onOpenHistory={() => setIsHistoryOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onNavigate={handleNavigate}
            onViewReceipt={(tx) => {
              setCurrentTransaction(tx);
              setIsReceiptOpen(true);
            }}
            onSwitchToNewSale={() => setActiveNav('New Sale POS')}
            onLoadSeedProducts={handleLoadSeedCatalog}
            onResetAllZero={handleResetAllZero}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            statusMessage={statusMessage}
            customers={customers}
            onQuickAddCustomer={handleSaveCustomer}
            onConfirmCheckout={handleConfirmCheckout}
            onDeleteTransaction={(invNum) => {
              setTransactions((prev) => prev.filter((t) => t.invoiceNumber !== invNum));
              showToast(`Invoice #${invNum} deleted successfully`, 'info');
            }}
            onEditTransaction={(tx) => {
              setCart(tx.items);
              setDiscountAmount(tx.discount || 0);
              setTaxAmount(tx.taxAmount || 0);
              showToast(`Invoice #${tx.invoiceNumber} loaded into cart for editing.`, 'info');
            }}
          />
        ) : effectiveNav === 'New Purchase Entry' || effectiveNav === 'New Purchase' ? (
          <NewPurchaseEntryPage
            products={products}
            suppliers={suppliers}
            purchases={purchases}
            branding={branding}
            currentUser={currentUser}
            currentDevice={currentDevice}
            scannedBarcode={scannedBarcodeForPurchase}
            onClearScannedBarcode={() => setScannedBarcodeForPurchase(null)}
            onSavePurchase={handleSavePurchase}
            onDeletePurchase={handleDeletePurchase}
            onAddSupplier={handleAddSupplier}
            onOpenAddProduct={() => setIsAddProductOpen(true)}
            onOpenScanner={() => setIsScannerOpen(true)}
            onNavigate={handleNavigate}
            onUpdateBranding={handleUpdateBranding}
            shopId={activeShopScopeId}
          />
        ) : effectiveNav === 'Purchase Entry' || effectiveNav === 'Old Purchase' || effectiveNav === 'Classic Purchase' || effectiveNav === 'Old Purchase Entry' ? (
          <div className="flex-1 flex flex-col w-full h-full min-h-0 overflow-hidden">
            <PurchaseEntryPage
              products={products}
              suppliers={suppliers}
              purchases={purchases}
              branding={branding}
              currentUser={currentUser}
              currentDevice={currentDevice}
              scannedBarcode={scannedBarcodeForPurchase}
              onClearScannedBarcode={() => setScannedBarcodeForPurchase(null)}
              onSavePurchase={handleSavePurchase}
              onDeletePurchase={handleDeletePurchase}
              onDeleteAllPurchases={handleDeleteAllPurchases}
              onAddSupplier={handleAddSupplier}
              onOpenAddProduct={() => setIsAddProductOpen(true)}
              onOpenScanner={() => setIsScannerOpen(true)}
              onNavigate={handleNavigate}
              onBackToHome={() => setActiveNav('Home')}
              shopId={activeShopScopeId}
            />
          </div>
        ) : effectiveNav === 'Sale Returns' || effectiveNav === 'Sale Return' || effectiveNav === 'Return Mode' || effectiveNav === 'Sales Return' ? (
          <SaleReturnCenter
            products={products}
            transactions={transactions}
            saleReturns={saleReturns}
            customers={customers}
            onConfirmReturn={handleConfirmReturn}
            onOpenScanner={() => setIsScannerOpen(true)}
            onSwitchMode={(newMode) => {
              if (newMode === 'purchase') {
                handleNavigate('New Purchase Entry');
              } else {
                handleNavigate('New Sale POS');
              }
            }}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : effectiveNav === 'Expenses' ? (
          <ExpensesPage
            expenses={expenses}
            branding={branding}
            onSaveExpense={handleSaveExpense}
            onDeleteExpense={handleDeleteExpense}
            onDeleteAllExpenses={handleDeleteAllExpenses}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : effectiveNav === 'Purchase Returns' || effectiveNav === 'Purchase Return' ? (
          <PurchaseReturnsPage
            purchases={purchases}
            purchaseReturns={purchaseReturns}
            suppliers={suppliers}
            products={products}
            branding={branding}
            onSavePurchaseReturn={handleSavePurchaseReturn}
            onDeletePurchaseReturn={handleDeletePurchaseReturn}
            onDeleteAllReturns={handleDeleteAllPurchaseReturns}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : effectiveNav === 'All Staff' || effectiveNav === 'Staff' || effectiveNav === 'Staff Management' ? (
          <AllStaffPage
            staffList={staffList}
            branding={branding}
            onSaveStaff={handleSaveStaff}
            onDeleteStaff={handleDeleteStaff}
            onDeleteAllStaff={handleDeleteAllStaff}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : effectiveNav === 'CCTV' || effectiveNav === 'Cameras' ? (
          <CctvPage
            cameras={cctvCameras}
            dvrConfig={dvrConfig}
            activeShopId={activeShopScopeId}
            canManage={
              activeRole !== 'STAFF' ||
              Boolean(staffPermissions?.settings || staffPermissions?.canAccessSettings)
            }
            onSyncCameras={handleSyncCctvCameras}
            onSyncDvrConfig={handleSyncDvrConfig}
            onBackToHome={() => setActiveNav('Home')}
          />
        ) : (
          <HomePage
            products={products}
            transactions={transactions}
            purchases={purchases}
            customers={customers}
            customerLedgerEntries={customerLedgerEntries}
            suppliers={suppliers}
            saleReturns={saleReturns}
            currentUser={currentUser}
            currentDevice={currentDevice}
            branding={branding}
            onUpdateBranding={handleUpdateBranding}
            onUpdateUser={setCurrentUser}
            onNavigate={handleNavigate}
            onOpenScanner={() => setIsScannerOpen(true)}
            onOpenAddProduct={() => setIsAddProductOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenHistory={() => setIsHistoryOpen(true)}
            onOpenConnectNewQr={() => setIsConnectQrOpen(true)}
            onOpenPairThisDevice={() => setIsPairModalOpen(true)}
            onSelectCustomer={(id) => {
              setSelectedLedgerCustomerId(id);
              setActiveNav('Customer Ledgers');
            }}
            onSelectTransaction={(tx) => {
              setCurrentTransaction(tx);
              setIsReceiptOpen(true);
            }}
            onOpenReceiptDesigner={() => setIsReceiptDesignerOpen(true)}
            onOpenPrinterSettings={() => setIsPrinterSettingsOpen(true)}
            onOpenResetSystem={() => setIsResetSystemOpen(true)}
            deferredPrompt={deferredPrompt}
            shopId={activeShopScopeId}
            syncStatus={syncStatus}
            authUser={authSession?.user || null}
            staffPermissions={staffPermissions}
            appLockEnabled={appLockConfig.enabled}
            onLockApp={() => triggerManualAppLock('Application locked manually.')}
            onExitApp={handleRequestAppExit}
            onSignOut={handleSignOut}
            onSyncNow={() => {
              syncService.forceFullSync().then((store) => {
                if (store) {
                  applyServerStoreSnapshot(store);
                  showToast('All devices synchronized with latest business data.', 'success');
                }
              });
            }}
          />
        )}
      </main>

      {/* ============================================================== */}
      {/* 3. MOBILE BOTTOM NAVIGATION BAR (MATCHING MOBILE REFERENCE)    */}
      {/* ============================================================== */}
      {!isNewSalePage && !isOldSalePage && !isPurchaseWorkstationPage && (
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 h-16 flex items-center justify-around px-2 shadow-lg">
          {/* 1. HOME */}
          <button
            type="button"
            onClick={() => handleNavigate('Home')}
            className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-colors cursor-pointer ${
              activeNav === 'Home' ? 'text-blue-600 font-black' : 'text-slate-400 hover:text-slate-700 font-semibold'
            }`}
            title="Home Dashboard"
          >
            <Home className="w-5 h-5 stroke-[2]" />
            <span className="text-[10px] font-bold uppercase mt-0.5 tracking-wider">Home</span>
          </button>

          {/* 2. SALE */}
          {canAccessNav('New Sale POS') && (
            <button
              type="button"
              onClick={() => handleNavigate('New Sale POS')}
              className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-colors cursor-pointer ${
                effectiveNav === 'New Sale POS' || effectiveNav === 'Sale POS'
                  ? 'text-blue-600 font-black'
                  : 'text-slate-400 hover:text-slate-700 font-semibold'
              }`}
              title="Sale POS Workstation"
            >
              <ShoppingCart className="w-5 h-5 stroke-[2]" />
              <span className="text-[10px] font-bold uppercase mt-0.5 tracking-wider">Sale</span>
            </button>
          )}

          {/* 3. PURCHASE */}
          {canAccessNav('New Purchase Entry') && (
            <button
              type="button"
              onClick={() => handleNavigate('New Purchase Entry')}
              className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-colors cursor-pointer ${
                effectiveNav === 'New Purchase Entry' || effectiveNav === 'Purchase Entry' || effectiveNav === 'Purchase Returns'
                  ? 'text-blue-600 font-black'
                  : 'text-slate-400 hover:text-slate-700 font-semibold'
              }`}
              title="Purchase Entry"
            >
              <Truck className="w-5 h-5 stroke-[2]" />
              <span className="text-[10px] font-bold uppercase mt-0.5 tracking-wider">Purchase</span>
            </button>
          )}

          {/* 4. REPORTS */}
          {canAccessNav('Sale Summary') && (
            <button
              type="button"
              onClick={() => handleNavigate('Sale Summary')}
              className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-colors cursor-pointer ${
                effectiveNav === 'Sale Summary' || effectiveNav === 'Reports' || effectiveNav === 'Daily Hisab'
                  ? 'text-blue-600 font-black'
                  : 'text-slate-400 hover:text-slate-700 font-semibold'
              }`}
              title="Reports & Analytics"
            >
              <TrendingUp className="w-5 h-5 stroke-[2]" />
              <span className="text-[10px] font-bold uppercase mt-0.5 tracking-wider">Reports</span>
            </button>
          )}

          {/* 5. SETTINGS */}
          {canAccessNav('Application Settings') && (
            <button
              type="button"
              onClick={() => handleNavigate('Application Settings')}
              className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-colors cursor-pointer ${
                isSettingsOpen || effectiveNav === 'Settings' || effectiveNav === 'Application Settings'
                  ? 'text-blue-600 font-black'
                  : 'text-slate-400 hover:text-slate-700 font-semibold'
              }`}
              title="Settings & System Database"
            >
              <Settings className="w-5 h-5 stroke-[2]" />
              <span className="text-[10px] font-bold uppercase mt-0.5 tracking-wider">Settings</span>
            </button>
          )}
        </nav>
      )}

      {/* ============================================================== */}
      {/* 4. REUSABLE UNIVERSAL BARCODE SCANNER (SCREENSHOT 2 DESIGN)    */}
      {/* ============================================================== */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onBarcodeDetected={handleBarcodeDetected}
        totalItems={totalQty}
        totalAmount={grandTotal}
        onCheckout={() => {
          if (cart.length > 0) {
            setIsCheckoutOpen(true);
          }
        }}
        pageContext={mode === 'purchase' ? 'purchase' : 'pos'}
        lang="bi"
      />

      {/* Add New Product Modal (Screenshot 2 Design) */}
      <AddNewProductModal
        isOpen={isAddProductOpen}
        categories={categories}
        existingProducts={products}
        onClose={() => setIsAddProductOpen(false)}
        onSaveProduct={handleSaveNewProduct}
        onUpdateCategories={handleUpdateCategories}
      />

      {/* Held Bills Modal */}
      <HeldBillsModal
        isOpen={isHeldBillsOpen}
        heldBills={heldBills}
        onClose={() => setIsHeldBillsOpen(false)}
        onResumeBill={handleResumeHeldBill}
        onDeleteHeldBill={handleDeleteHeldBill}
        onDeleteAllHeldBills={handleDeleteAllHeldBills}
      />

      {/* Cart Drawer */}
      <CartDrawerModal
        isOpen={isCartDrawerOpen}
        mode={mode}
        cart={cart}
        subtotal={subtotal}
        discount={discount}
        taxAmount={tax}
        grandTotal={grandTotal}
        totalQty={totalQty}
        onClose={() => setIsCartDrawerOpen(false)}
        onUpdateQty={updateCartQty}
        onUpdatePrice={updateCartPrice}
        onRemoveItem={removeCartItem}
        onClearCart={handleClearCart}
        onHoldBill={handleHoldBill}
        onProceedCheckout={() => {
          setIsCartDrawerOpen(false);
          setIsCheckoutOpen(true);
        }}
        onUpdateDiscount={setDiscountAmount}
        onUpdateTax={setTaxAmount}
      />

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        mode={mode}
        cart={cart}
        subtotal={subtotal}
        discount={discount}
        taxAmount={tax}
        grandTotal={grandTotal}
        totalQty={totalQty}
        customers={customers}
        onQuickAddCustomer={handleSaveCustomer}
        onClose={() => setIsCheckoutOpen(false)}
        onConfirmCheckout={handleConfirmCheckout}
      />

      {/* Thermal Receipt Modal */}
      <ReceiptModal
        isOpen={isReceiptOpen}
        transaction={currentTransaction}
        storeBranding={branding}
        receiptSettings={receiptSettings}
        onOpenPrinterSettings={() => setIsPrinterSettingsOpen(true)}
        onSaveReceiptSettings={(updated) => {
          handleSaveReceiptSettings(updated);
          showToast('Receipt settings saved and synced!', 'success');
        }}
        onClose={() => setIsReceiptOpen(false)}
        onNewSale={() => {
          setIsReceiptOpen(false);
          setCurrentTransaction(null);
        }}
      />

      {/* Sales Transactions History Modal */}
      <TransactionHistoryModal
        isOpen={isHistoryOpen}
        transactions={transactions}
        onClose={() => setIsHistoryOpen(false)}
        onViewReceipt={(tx) => {
          setCurrentTransaction(tx);
          setIsReceiptOpen(true);
        }}
      />

      {/* Settings & Branding Modal */}
      <BrandingSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        branding={branding}
        currentUser={currentUser}
        onSaveBranding={(updated) => {
          handleUpdateBranding(updated);
          showToast('Store branding & Owner Profile saved and synced!', 'success');
        }}
        onOpenReceiptDesigner={() => {
          setIsSettingsOpen(false);
          setIsReceiptDesignerOpen(true);
        }}
        onOpenPrinterSettings={() => {
          setIsSettingsOpen(false);
          setIsPrinterSettingsOpen(true);
        }}
        onOpenResetSystem={() => {
          setIsSettingsOpen(false);
          setIsResetSystemOpen(true);
        }}
      />

      {/* Complete Printer Settings Modal */}
      <PrinterSettingsModal
        isOpen={isPrinterSettingsOpen}
        onClose={() => setIsPrinterSettingsOpen(false)}
        branding={branding}
        onSettingsUpdated={(updated) => {
          setPrinterSettings(updated);
          syncService.syncPrinterSettings(updated);
        }}
      />

      {/* Complete Reset / Fresh Start Modal with JSON backup */}
      <ResetSystemModal
        isOpen={isResetSystemOpen}
        onClose={() => setIsResetSystemOpen(false)}
        onPerformReset={handlePerformCompleteReset}
      />

      {/* Dedicated Receipt Designer & Bill Customizer Modal */}
      <ReceiptDesignerModal
        isOpen={isReceiptDesignerOpen}
        onClose={() => setIsReceiptDesignerOpen(false)}
        settings={receiptSettings}
        onSaveSettings={(updated) => {
          handleSaveReceiptSettings(updated);
          showToast('Receipt layout & owner details saved and synced!', 'success');
        }}
        sampleTransaction={currentTransaction || (transactions.length > 0 ? transactions[0] : null)}
      />

      {/* Multi-Device QR Code Authorization Modal (For Owner) */}
      <ConnectDeviceQrModal
        isOpen={isConnectQrOpen}
        onClose={() => setIsConnectQrOpen(false)}
        onDeviceApproved={(dev) => {
          showToast(`Device "${dev.deviceName}" authorized & connected!`, 'success');
        }}
      />

      {/* Pair This Device Modal (With Camera Scanner & Manual Code) */}
      <PairDeviceModal
        isOpen={isPairModalOpen}
        onClose={() => {
          setIsPairModalOpen(false);
          if (syncService.getDevice().status === 'revoked') {
            setIsRevoked(true);
          }
        }}
        onPairSuccess={(dev, serverStore) => {
          setIsPairModalOpen(false);
          handlePairedSuccess(dev, serverStore);
          showToast(`Successfully paired this terminal to WAQAS MART!`, 'success');
        }}
      />

      {/* PWA Install Desktop & Mobile Prompt */}
      <PwaInstallPrompt
        isOpen={isPwaInstallOpen}
        onClose={() => setIsPwaInstallOpen(false)}
        deferredPrompt={deferredPrompt}
      />

      {/* Revoked Terminal Security Lockout Screen */}
      {isRevoked && (
        <RevokedDeviceModal
          device={currentDevice}
          onOpenPairQr={() => {
            setIsRevoked(false);
            setIsPairModalOpen(true);
          }}
          onRetryAccess={async () => {
            const res = await syncService.retryDeviceAccess();
            if (res.ok) {
              setCurrentDevice(syncService.getDevice());
              setIsRevoked(false);
              setIsPairedTerminal(true);
              const srv = await syncService.forceFullSync();
              if (srv) applyServerStoreSnapshot(srv);
              showToast('Device access restored and reconnected!', 'success');
            }
            return res;
          }}
        />
      )}

      {/* Non-Home Compact Multi-Device Conflict / Offline Sync Pill */}
      {!isHomePage && (!syncStatus.isOnline || syncStatus.pendingCount > 0 || syncStatus.conflicts.length > 0) && (
        <div className="fixed bottom-18 lg:bottom-4 right-4 z-40 flex items-center gap-2">
          {syncStatus.conflicts.length > 0 && (
            <button
              type="button"
              onClick={() => setIsConflictModalOpen(true)}
              className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black shadow-lg flex items-center gap-1.5 cursor-pointer"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>{syncStatus.conflicts.length} Sync Conflict</span>
            </button>
          )}
          {(!syncStatus.isOnline || syncStatus.pendingCount > 0) && (
            <button
              type="button"
              onClick={() =>
                syncService.forceFullSync().then((store) => {
                  if (store) {
                    applyServerStoreSnapshot(store);
                    showToast('Offline queue flushed & synced with server.', 'success');
                  }
                })
              }
              className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black shadow-lg flex items-center gap-1.5 cursor-pointer"
            >
              <WifiOff className="w-3.5 h-3.5" />
              <span>
                {!syncStatus.isOnline ? 'Offline Mode' : 'Sync Pending'} ({syncStatus.pendingCount})
              </span>
            </button>
          )}
        </div>
      )}

      {/* Global Toast Notification Banner */}
      {statusMessage && (
        <div className="fixed top-4 right-4 z-[90] max-w-sm animate-in fade-in duration-150">
          <div
            className={`px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold flex items-center gap-2.5 ${
              statusMessage.type === 'error'
                ? 'bg-red-50 border-red-300 text-red-900'
                : statusMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : 'bg-slate-900 border-slate-700 text-white'
            }`}
          >
            {statusMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            ) : statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span className="flex-1">{statusMessage.text}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="p-0.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* In-App Confirmation Modal: Reset All Store Records to Zero */}
      {isResetAllZeroConfirmOpen && (
        <div className="fixed inset-0 z-[95] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">Reset All Records to Zero?</h3>
                <p className="text-xs text-slate-600 mt-1">
                  This clears all stock, products, invoices, customer Udhaar, expenses, and staff across all connected devices. Use Backup &amp; Restore first if you want a saved copy.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsResetAllZeroConfirmOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeResetAllZero}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black cursor-pointer"
              >
                Confirm Reset to 0
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sync Conflict Review Modal */}
      {isConflictModalOpen && (
        <div className="fixed inset-0 z-[95] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">Multi-Device Sync Conflicts</h3>
                  <p className="text-[11px] text-slate-500">Newer changes were already saved on the server.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConflictModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2">
              {syncStatus.conflicts.map((conf) => (
                <div key={conf.id} className="p-3 rounded-2xl border border-red-200 bg-red-50/70 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black uppercase text-red-800">{conf.action}</span>
                    <button
                      type="button"
                      onClick={() => syncService.resolveConflict(conf.id)}
                      className="px-2.5 py-1 rounded-lg bg-white border border-red-200 text-[10px] font-bold text-red-700 hover:bg-red-100 cursor-pointer"
                    >
                      Accept Server State
                    </button>
                  </div>
                  <p className="text-xs text-red-900">{conf.message}</p>
                </div>
              ))}
              {syncStatus.conflicts.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">All conflicts resolved.</p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  syncService.forceFullSync().then((s) => {
                    if (s) applyServerStoreSnapshot(s);
                  });
                }}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Pull Latest Server Data</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  syncService.clearConflicts();
                  setIsConflictModalOpen(false);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Dismiss All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exit Security Authentication Gate */}
      <ExitSecurityModal
        isOpen={isExitSecurityOpen}
        config={appLockConfig}
        storeName={branding.storeName || authSession?.shop?.shopName || 'WAQAS MART'}
        shopId={activeShopScopeId}
        onConfigUpdated={(next) => {
          setAppLockConfig(next);
          cacheAppLockConfig(activeShopScopeId, next);
        }}
        onCancel={() => setIsExitSecurityOpen(false)}
        onConfirmExitSuccess={() => {
          unlockedOnceInTabRef.current = false;
          setIsExitSecurityOpen(false);
          setAppLockReason('Session locked safely on Exit · Authenticate to reopen.');
          setIsAppLocked(true);
          syncService.closeSse();
          try {
            window.close();
          } catch {}
        }}
      />
    </div>
  );
}
