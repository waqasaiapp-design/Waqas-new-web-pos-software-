import type {
  CartItem,
  POSMode,
  PurchaseItem,
} from '../types/pos';

// Safe LocalStorage wrappers with QuotaExceededError recovery
// Preserves authentication session and live drafts; trims optional bulky cached logs only if quota is exceeded.
const pendingWrites = new Map<string, { value: unknown; timer: ReturnType<typeof setTimeout> | null }>();
let lifecycleHooksAttached = false;

const OPTIONAL_TRIM_KEYS = [
  'waqas_mart_stock_history_v1',
];

function trimOptionalStorageBloat(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of OPTIONAL_TRIM_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw && raw.length > 60_000) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 200) {
            localStorage.setItem(key, JSON.stringify(parsed.slice(0, 200)));
          }
        } catch {
          localStorage.removeItem(key);
        }
      }
    }
  } catch {
    // ignore cleanup failure
  }
}

export function safeStorageGetRaw(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageGetJson<T>(key: string, fallback: T): T {
  const raw = safeStorageGetRaw(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeStorageSetRaw(key: string, rawValue: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, rawValue);
    return true;
  } catch (err: any) {
    const isQuota =
      err?.name === 'QuotaExceededError' ||
      err?.code === 22 ||
      err?.code === 1014;
    if (isQuota) {
      trimOptionalStorageBloat();
      try {
        localStorage.setItem(key, rawValue);
        return true;
      } catch {
        console.warn(`[safeStorage] Quota exceeded while writing "${key}". Skipping write safely.`);
        return false;
      }
    }
    console.warn(`[safeStorage] Failed writing "${key}":`, err);
    return false;
  }
}

export function safeStorageSetJson(key: string, value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    return safeStorageSetRaw(key, serialized);
  } catch (err) {
    console.warn(`[safeStorage] Serialization failed for "${key}":`, err);
    return false;
  }
}

export function safeStorageRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    pendingWrites.delete(key);
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function flushAllPendingStorageWrites(): void {
  for (const [key, entry] of pendingWrites.entries()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    safeStorageSetJson(key, entry.value);
    pendingWrites.delete(key);
  }
}

function ensureLifecycleFlushHooks(): void {
  if (typeof window === 'undefined' || lifecycleHooksAttached) return;
  lifecycleHooksAttached = true;

  const flushOnHide = () => {
    flushAllPendingStorageWrites();
  };

  window.addEventListener('pagehide', flushOnHide);
  window.addEventListener('beforeunload', flushOnHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushAllPendingStorageWrites();
    }
  });
}

export function scheduleStorageSetJson(key: string, value: unknown, delayMs = 250): void {
  if (typeof window === 'undefined') return;
  ensureLifecycleFlushHooks();
  const existing = pendingWrites.get(key);
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }
  const timer = setTimeout(() => {
    const latest = pendingWrites.get(key);
    if (latest) {
      pendingWrites.delete(key);
      safeStorageSetJson(key, latest.value);
    }
  }, delayMs);
  pendingWrites.set(key, { value, timer });
}

// =========================================================================
// WORKSPACE ROUTE & UNSAVED DRAFT AUTO-RECOVERY (SCOPED BY SHOP ID)
// =========================================================================

function normalizeScope(shopId?: string | null): string {
  const clean = (shopId || '').trim();
  return clean ? clean.replace(/[^a-zA-Z0-9_-]/g, '_') : 'default';
}

export interface PersistedWorkspaceNavState {
  shopId: string;
  activeNav: string;
  mode: POSMode;
  selectedCategory: string;
  selectedLedgerCustomerId: string | null;
  updatedAt: number;
}

const WORKSPACE_NAV_KEY_PREFIX = 'waqas_pos_workspace_nav_v1_';
const OLD_SALE_DRAFT_PREFIX = 'waqas_pos_draft_old_sale_v1_';
const NEW_SALE_DRAFT_PREFIX = 'waqas_pos_draft_new_sale_v1_';
const NEW_PURCHASE_DRAFT_PREFIX = 'waqas_pos_draft_new_purchase_v1_';
const WORKSTATION_PURCHASE_DRAFT_PREFIX = 'waqas_pos_draft_workstation_purchase_v1_';

export function saveWorkspaceNavState(
  shopId: string | null | undefined,
  state: Omit<PersistedWorkspaceNavState, 'shopId' | 'updatedAt'>
): void {
  const scope = normalizeScope(shopId);
  safeStorageSetJson(`${WORKSPACE_NAV_KEY_PREFIX}${scope}`, {
    ...state,
    shopId: shopId || '',
    updatedAt: Date.now(),
  });
}

export function loadWorkspaceNavState(
  shopId: string | null | undefined
): PersistedWorkspaceNavState | null {
  const scope = normalizeScope(shopId);
  const parsed = safeStorageGetJson<PersistedWorkspaceNavState | null>(
    `${WORKSPACE_NAV_KEY_PREFIX}${scope}`,
    null
  );
  if (!parsed || typeof parsed.activeNav !== 'string') return null;
  return parsed;
}

export interface OldSaleDraftState {
  cart: CartItem[];
  discountAmount: number;
  taxAmount: number;
  resumedHeldBillId: string | null;
  updatedAt: number;
}

export function saveOldSaleDraft(
  shopId: string | null | undefined,
  draft: Omit<OldSaleDraftState, 'updatedAt'>
): void {
  const scope = normalizeScope(shopId);
  const hasContent =
    (Array.isArray(draft.cart) && draft.cart.length > 0) ||
    draft.discountAmount > 0 ||
    draft.taxAmount > 0;
  const key = `${OLD_SALE_DRAFT_PREFIX}${scope}`;
  if (!hasContent) {
    safeStorageRemove(key);
    return;
  }
  safeStorageSetJson(key, { ...draft, updatedAt: Date.now() });
}

export function loadOldSaleDraft(
  shopId: string | null | undefined
): OldSaleDraftState | null {
  const scope = normalizeScope(shopId);
  const parsed = safeStorageGetJson<OldSaleDraftState | null>(
    `${OLD_SALE_DRAFT_PREFIX}${scope}`,
    null
  );
  if (!parsed || !Array.isArray(parsed.cart)) return null;
  return parsed;
}

export function clearOldSaleDraft(shopId: string | null | undefined): void {
  safeStorageRemove(`${OLD_SALE_DRAFT_PREFIX}${normalizeScope(shopId)}`);
}

export interface NewSaleDraftState {
  invoiceNumber: string;
  saleItems: CartItem[];
  selectedCustomerId: string;
  paymentMethod: 'cash' | 'card' | 'credit';
  cashReceived: number;
  cashReceivedInput: string;
  invoiceDiscountOverride: number;
  invoiceTaxOverride: number;
  updatedAt: number;
}

export function saveNewSaleDraft(
  shopId: string | null | undefined,
  draft: Omit<NewSaleDraftState, 'updatedAt'>
): void {
  const scope = normalizeScope(shopId);
  const key = `${NEW_SALE_DRAFT_PREFIX}${scope}`;
  const hasContent =
    (Array.isArray(draft.saleItems) && draft.saleItems.length > 0) ||
    draft.invoiceDiscountOverride > 0 ||
    draft.invoiceTaxOverride > 0 ||
    Boolean(draft.cashReceivedInput);
  if (!hasContent) {
    safeStorageRemove(key);
    return;
  }
  safeStorageSetJson(key, { ...draft, updatedAt: Date.now() });
}

export function loadNewSaleDraft(
  shopId: string | null | undefined
): NewSaleDraftState | null {
  const scope = normalizeScope(shopId);
  const parsed = safeStorageGetJson<NewSaleDraftState | null>(
    `${NEW_SALE_DRAFT_PREFIX}${scope}`,
    null
  );
  if (!parsed || !Array.isArray(parsed.saleItems)) return null;
  return parsed;
}

export function clearNewSaleDraft(shopId: string | null | undefined): void {
  safeStorageRemove(`${NEW_SALE_DRAFT_PREFIX}${normalizeScope(shopId)}`);
}

export interface NewPurchaseDraftState {
  invoiceNo: string;
  supplierInvoiceNo: string;
  purchaseDate: string;
  selectedSupplierId: string;
  paymentMethod: 'cash' | 'credit' | 'card';
  notes: string;
  purchaseItems: PurchaseItem[];
  qtyDrafts: Record<string, string>;
  vatRatePercent: number;
  discountType: 'rs' | 'percent';
  discountInput: number;
  expensesAmount: number;
  amountPaidInput: string;
  updatedAt: number;
}

export function saveNewPurchaseDraft(
  shopId: string | null | undefined,
  draft: Omit<NewPurchaseDraftState, 'updatedAt'>
): void {
  const scope = normalizeScope(shopId);
  const key = `${NEW_PURCHASE_DRAFT_PREFIX}${scope}`;
  const hasContent =
    (Array.isArray(draft.purchaseItems) && draft.purchaseItems.length > 0) ||
    Boolean(draft.supplierInvoiceNo?.trim()) ||
    Boolean(draft.notes?.trim()) ||
    draft.discountInput > 0 ||
    draft.expensesAmount > 0 ||
    Boolean(draft.amountPaidInput);
  if (!hasContent) {
    safeStorageRemove(key);
    return;
  }
  safeStorageSetJson(key, { ...draft, updatedAt: Date.now() });
}

export function loadNewPurchaseDraft(
  shopId: string | null | undefined
): NewPurchaseDraftState | null {
  const scope = normalizeScope(shopId);
  const parsed = safeStorageGetJson<NewPurchaseDraftState | null>(
    `${NEW_PURCHASE_DRAFT_PREFIX}${scope}`,
    null
  );
  if (!parsed || !Array.isArray(parsed.purchaseItems)) return null;
  return parsed;
}

export function clearNewPurchaseDraft(shopId: string | null | undefined): void {
  safeStorageRemove(`${NEW_PURCHASE_DRAFT_PREFIX}${normalizeScope(shopId)}`);
}

export interface WorkstationPurchaseDraftState {
  refNo: string;
  supplierInvoiceNo: string;
  purchaseDate: string;
  entryDate: string;
  selectedSupplierId: string;
  paymentMethod: 'cash' | 'credit' | 'card';
  vatType: 'Default VAT' | 'Out of Scope';
  selectedTaxLabel: string;
  selectedStore: string;
  expensesLabel: string;
  expensesAmount: number;
  purchaseItems: PurchaseItem[];
  qtyDrafts: Record<string, string>;
  costDiscountPercent: number;
  costDiscountAmount: number;
  roundoff: number;
  amountPaidInput: string;
  remarks: string;
  updatedAt: number;
}

export function saveWorkstationPurchaseDraft(
  shopId: string | null | undefined,
  variant: 'new' | 'old',
  draft: Omit<WorkstationPurchaseDraftState, 'updatedAt'>
): void {
  const scope = normalizeScope(shopId);
  const key = `${WORKSTATION_PURCHASE_DRAFT_PREFIX}${variant}_${scope}`;
  const hasContent =
    (Array.isArray(draft.purchaseItems) && draft.purchaseItems.length > 0) ||
    Boolean(draft.supplierInvoiceNo?.trim()) ||
    Boolean(draft.remarks?.trim()) ||
    draft.costDiscountAmount > 0 ||
    draft.expensesAmount > 0 ||
    Boolean(draft.amountPaidInput);
  if (!hasContent) {
    safeStorageRemove(key);
    return;
  }
  safeStorageSetJson(key, { ...draft, updatedAt: Date.now() });
}

export function loadWorkstationPurchaseDraft(
  shopId: string | null | undefined,
  variant: 'new' | 'old'
): WorkstationPurchaseDraftState | null {
  const scope = normalizeScope(shopId);
  const parsed = safeStorageGetJson<WorkstationPurchaseDraftState | null>(
    `${WORKSTATION_PURCHASE_DRAFT_PREFIX}${variant}_${scope}`,
    null
  );
  if (!parsed || !Array.isArray(parsed.purchaseItems)) return null;
  return parsed;
}

export function clearWorkstationPurchaseDraft(
  shopId: string | null | undefined,
  variant: 'new' | 'old'
): void {
  safeStorageRemove(`${WORKSTATION_PURCHASE_DRAFT_PREFIX}${variant}_${normalizeScope(shopId)}`);
}

export function clearAllShopDrafts(shopId: string | null | undefined): void {
  const scope = normalizeScope(shopId);
  safeStorageRemove(`${WORKSPACE_NAV_KEY_PREFIX}${scope}`);
  clearOldSaleDraft(shopId);
  clearNewSaleDraft(shopId);
  clearNewPurchaseDraft(shopId);
  clearWorkstationPurchaseDraft(shopId, 'new');
  clearWorkstationPurchaseDraft(shopId, 'old');
}
