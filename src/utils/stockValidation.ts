import type {
  Product,
  PurchaseReturn,
  PurchaseTransaction,
  SaleReturn,
  SaleTransaction,
  StockTransaction,
} from '../types/pos.ts';

export const STOCK_ALREADY_ZERO_MESSAGE =
  'STOCK ALREADY ZERO! Is item ka stock pehle se zero hai. Minus stock allowed nahi hai.';

export function buildInsufficientStockMessage(availableStock: number): string {
  const cleanQty = Number.isFinite(availableStock)
    ? Math.round(availableStock * 10000) / 10000
    : 0;
  return `INSUFFICIENT STOCK! Available Stock: ${cleanQty}. Zero se kam stock allowed nahi hai.`;
}

export function roundStockQty(value: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 10000) / 10000;
}

export type StockValidationErrorCode = 'STOCK_ALREADY_ZERO' | 'INSUFFICIENT_STOCK';

export interface StockValidationFailure {
  ok: false;
  code: StockValidationErrorCode;
  message: string;
  productId?: string;
  productName?: string;
  availableStock: number;
  delta: number;
  projectedStock: number;
}

export interface StockValidationSuccess {
  ok: true;
  availableStock: number;
  delta: number;
  projectedStock: number;
}

export type StockValidationResult = StockValidationSuccess | StockValidationFailure;

/**
 * Core Zero-Stock Protection rule:
 * - Positive delta (adding/restocking stock): ALWAYS allowed (even from 0 or legacy < 0).
 * - Zero delta: ALWAYS allowed.
 * - Negative delta (selling, returning to supplier, purchase negative adjustment, deleting/reducing a purchase):
 *   - Allowed if availableStock + delta >= 0 (including exact 0: 10 - 10 = 0 is valid).
 *   - Blocked if availableStock <= 0 -> STOCK ALREADY ZERO! ...
 *   - Blocked if availableStock > 0 and availableStock + delta < 0 -> INSUFFICIENT STOCK! ...
 */
export function validateSingleProductStockChange(params: {
  productId?: string;
  productName?: string;
  availableStock: number;
  delta: number;
}): StockValidationResult {
  const availableStock = roundStockQty(params.availableStock);
  const delta = roundStockQty(params.delta);
  const projectedStock = roundStockQty(availableStock + delta);

  // Adding stock or zero net change is always valid
  if (delta >= 0) {
    return {
      ok: true,
      availableStock,
      delta,
      projectedStock,
    };
  }

  // Deduction (delta < 0)
  if (availableStock <= 0) {
    return {
      ok: false,
      code: 'STOCK_ALREADY_ZERO',
      message: STOCK_ALREADY_ZERO_MESSAGE,
      productId: params.productId,
      productName: params.productName,
      availableStock: Math.max(0, availableStock),
      delta,
      projectedStock,
    };
  }

  if (projectedStock < 0) {
    return {
      ok: false,
      code: 'INSUFFICIENT_STOCK',
      message: buildInsufficientStockMessage(availableStock),
      productId: params.productId,
      productName: params.productName,
      availableStock,
      delta,
      projectedStock,
    };
  }

  return {
    ok: true,
    availableStock,
    delta,
    projectedStock,
  };
}

/**
 * Finds the authoritative live catalog product matching an item reference.
 * Strictly matches by ID first, then exact non-empty barcode.
 */
export function findLiveProduct(
  products: Product[],
  ref: { productId?: string; id?: string; barcode?: string }
): Product | undefined {
  const targetId = ref.productId || ref.id;
  if (targetId) {
    const byId = products.find((p) => p.id === targetId);
    if (byId) return byId;
  }
  const cleanBarcode = (ref.barcode || '').trim().toLowerCase();
  if (cleanBarcode) {
    return products.find(
      (p) => (p.barcode || '').trim().toLowerCase() === cleanBarcode
    );
  }
  return undefined;
}

/**
 * Resolves a product's own uploaded image URL strictly by its product ID / barcode.
 * Never leaks another product's image and never falls back to generic icons/cars.
 */
export function resolveProductImageUrl(
  products: Product[],
  ref: { productId?: string; id?: string; barcode?: string; imageUrl?: string }
): string {
  const live = findLiveProduct(products, ref);
  if (live) {
    return typeof live.imageUrl === 'string' ? live.imageUrl.trim() : '';
  }
  return typeof ref.imageUrl === 'string' ? ref.imageUrl.trim() : '';
}

/**
 * Validates an aggregated map of (productKey -> stock delta) against live products.
 * Ensures ALL lines pass before allowing any mutation (atomic guarantee).
 */
export function validateBatchStockDeltas(
  products: Product[],
  deltas: Map<string, { product?: Product; productName?: string; delta: number }>
): { ok: true } | StockValidationFailure {
  for (const [key, entry] of deltas.entries()) {
    const live =
      entry.product ||
      products.find((p) => p.id === key);
    if (!live) continue;

    const check = validateSingleProductStockChange({
      productId: live.id,
      productName: entry.productName || live.name,
      availableStock: Number(live.stock) || 0,
      delta: entry.delta,
    });
    if (!check.ok) {
      return check;
    }
  }
  return { ok: true };
}

/**
 * Safely validates a purchase return (each returned item reduces stock by -qty).
 * Aggregates duplicate product rows cleanly.
 */
export function validatePurchaseReturnStock(
  products: Product[],
  items: Array<{ productId: string; productName?: string; barcode?: string; quantity: number }>
): { ok: true } | StockValidationFailure {
  const deltas = new Map<string, { product?: Product; productName?: string; delta: number }>();

  for (const it of items || []) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    const live = findLiveProduct(products, {
      productId: it.productId,
      barcode: it.barcode,
    });
    if (!live) continue;
    const prev = deltas.get(live.id);
    deltas.set(live.id, {
      product: live,
      productName: it.productName || live.name,
      delta: (prev?.delta || 0) - qty,
    });
  }

  return validateBatchStockDeltas(products, deltas);
}

/**
 * Safely validates a sale transaction (each sold item reduces stock by -qty).
 * Aggregates duplicate product rows cleanly. Ignores untracked custom ad-hoc POS items
 * whose ID starts with 'custom-' and do not exist in catalog.
 */
export function validateSaleItemsStock(
  products: Product[],
  items: Array<{ product: Product; quantity: number }>
): { ok: true } | StockValidationFailure {
  const deltas = new Map<string, { product?: Product; productName?: string; delta: number }>();

  for (const it of items || []) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    const prod = it.product;
    if (!prod) continue;
    const live = findLiveProduct(products, {
      productId: prod.id,
      barcode: prod.barcode,
    });
    // Untracked custom ad-hoc item not in catalog
    if (!live && prod.id?.startsWith('custom-')) {
      continue;
    }
    const target = live || prod;
    const prev = deltas.get(target.id);
    deltas.set(target.id, {
      product: target,
      productName: target.name,
      delta: (prev?.delta || 0) - qty,
    });
  }

  return validateBatchStockDeltas(products, deltas);
}

/**
 * Reconciles any pre-existing negative stock items (stock < 0) to 0 with a complete audit trail,
 * without modifying or deleting any historical sales, purchases, returns, or unrelated products.
 */
export function reconcileNegativeStockFromHistory(params: {
  products: Product[];
  purchases?: PurchaseTransaction[];
  transactions?: SaleTransaction[];
  saleReturns?: SaleReturn[];
  purchaseReturns?: PurchaseReturn[];
  actor?: string;
  timestampStr?: string;
}): {
  reconciledCount: number;
  products: Product[];
  stockEntries: StockTransaction[];
  reconciledItems: Array<{
    productId: string;
    productName: string;
    previousStock: number;
    newStock: number;
    purchasedQty: number;
    soldQty: number;
  }>;
} {
  const {
    products,
    purchases = [],
    transactions = [],
    saleReturns = [],
    purchaseReturns = [],
    actor = 'Admin',
    timestampStr = new Date().toLocaleString('en-PK', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }),
  } = params;

  const stockEntries: StockTransaction[] = [];
  const reconciledItems: Array<{
    productId: string;
    productName: string;
    previousStock: number;
    newStock: number;
    purchasedQty: number;
    soldQty: number;
  }> = [];

  const nextProducts = products.map((prod) => {
    const curStock = roundStockQty(Number(prod.stock) || 0);
    if (curStock >= 0) return prod;

    let purchasedQty = 0;
    let soldQty = 0;
    let saleRetQty = 0;
    let purchRetQty = 0;

    for (const pur of purchases) {
      for (const it of pur.items || []) {
        if (it.productId === prod.id || (prod.barcode && it.barcode === prod.barcode)) {
          purchasedQty += Number(it.quantity) || 0;
        }
      }
    }
    for (const tx of transactions) {
      for (const it of tx.items || []) {
        if (it.product?.id === prod.id || (prod.barcode && it.product?.barcode === prod.barcode)) {
          soldQty += Number(it.quantity) || 0;
        }
      }
    }
    for (const sr of saleReturns) {
      for (const it of sr.items || []) {
        if (
          (it.condition === undefined || it.condition === 'resaleable') &&
          (it.productId === prod.id || (prod.barcode && it.barcode === prod.barcode))
        ) {
          saleRetQty += Number(it.quantity) || 0;
        }
      }
    }
    for (const pr of purchaseReturns) {
      for (const it of pr.items || []) {
        if (it.productId === prod.id || (prod.barcode && it.barcode === prod.barcode)) {
          purchRetQty += Number(it.quantity) || 0;
        }
      }
    }

    // Reconcile negative stock up to 0 safely (zero-stock protection minimum)
    const ledgerComputed = roundStockQty(purchasedQty - soldQty + saleRetQty - purchRetQty);
    const targetStock = Math.max(0, ledgerComputed > 0 ? 0 : 0);
    const delta = roundStockQty(targetStock - curStock);

    stockEntries.push({
      id: `stk-rec-${Date.now()}-${prod.id}-${Math.random().toString(36).slice(2, 6)}`,
      productId: prod.id,
      productName: prod.name,
      barcode: prod.barcode,
      previousStock: curStock,
      quantityChange: delta,
      newStock: targetStock,
      transactionType: 'Stock Adjustment',
      invoiceNumber: 'RECONCILE-ZERO',
      dateTime: timestampStr,
      userName: actor,
      notes: `Negative stock reconciled (${curStock} -> 0). Audit summary: Purchased=${purchasedQty}, Sold=${soldQty}, SaleRet=${saleRetQty}, PurchRet=${purchRetQty}.`,
    });

    reconciledItems.push({
      productId: prod.id,
      productName: prod.name,
      previousStock: curStock,
      newStock: targetStock,
      purchasedQty,
      soldQty,
    });

    return {
      ...prod,
      stock: targetStock,
    };
  });

  return {
    reconciledCount: reconciledItems.length,
    products: nextProducts,
    stockEntries,
    reconciledItems,
  };
}
