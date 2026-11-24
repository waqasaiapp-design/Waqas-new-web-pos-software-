import type {
  Product,
  PurchaseItem,
  PurchaseTransaction,
  StockTransaction,
  StockTransactionType,
  Supplier,
} from '../types/pos.ts';
import {
  roundStockQty,
  validateSingleProductStockChange,
  type StockValidationFailure,
} from './stockValidation.ts';

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Computes line amounts for a purchase item.
 * Supports BOTH positive quantities (+1, +10) and negative stock adjustment quantities (-1, -5).
 */
export function computePurchaseItemAmounts(
  quantity: number,
  purchaseCost: number,
  vatRatePercent: number = 0,
  discountAmount: number = 0
): {
  netAmount: number;
  vat: number;
  wvat: number;
  lineTotal: number;
} {
  const safeQty = Number.isFinite(quantity) ? quantity : 0;
  const safeCost = Math.max(0, Number.isFinite(purchaseCost) ? purchaseCost : 0);
  const rawNet = roundMoney(safeQty * safeCost);
  const netAfterDisc = roundMoney(rawNet - (Number(discountAmount) || 0));
  const vat = roundMoney((netAfterDisc * (Number(vatRatePercent) || 0)) / 100);
  const wvat = roundMoney(netAfterDisc + vat);
  return {
    netAmount: rawNet,
    vat,
    wvat,
    lineTotal: wvat,
  };
}

export interface PurchaseTotalsSummary {
  grossTotal: number;
  discount: number;
  vat: number;
  expensesAmount: number;
  roundoff: number;
  totalAmount: number;
  paid: number;
  outstanding: number;
  totalQty: number;
  hasNegativeItems: boolean;
  negativeItems: PurchaseItem[];
  totalNegativeUnits: number;
}

export function computePurchaseTotals(params: {
  items: PurchaseItem[];
  discountPercent?: number;
  discountAmount?: number;
  expensesAmount?: number;
  roundoff?: number;
  amountPaid?: number | '';
  paymentMethod?: string;
}): PurchaseTotalsSummary {
  const {
    items,
    discountPercent = 0,
    discountAmount = 0,
    expensesAmount = 0,
    roundoff = 0,
    amountPaid = '',
    paymentMethod = 'cash',
  } = params;

  let grossTotal = 0;
  let totalQty = 0;
  let totalVat = 0;
  let totalNegativeUnits = 0;
  const negativeItems: PurchaseItem[] = [];

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const cost = Math.max(0, Number(item.purchaseCost) || 0);
    const net = item.netAmount !== undefined ? Number(item.netAmount) : roundMoney(qty * cost);
    const vat = Number(item.vat) || 0;

    grossTotal += net;
    totalVat += vat;
    totalQty += qty;

    if (qty < 0) {
      negativeItems.push(item);
      totalNegativeUnits += Math.abs(qty);
    }
  }

  grossTotal = roundMoney(grossTotal);
  totalVat = roundMoney(totalVat);

  const safeDiscount =
    Number(discountAmount) > 0
      ? Number(discountAmount)
      : roundMoney((grossTotal * (Number(discountPercent) || 0)) / 100);

  const safeExpenses = Number(expensesAmount) || 0;
  const safeRoundoff = Number(roundoff) || 0;

  // Keep negative totalAmount exact when performing negative stock adjustments with non-zero unit cost
  const totalAmount = roundMoney(grossTotal - safeDiscount + totalVat + safeExpenses + safeRoundoff);

  const methodLower = (paymentMethod || 'cash').toLowerCase();
  const hasExplicitPaid = amountPaid !== '' && amountPaid !== undefined && amountPaid !== null;
  const paid = hasExplicitPaid
    ? Number(amountPaid) || 0
    : methodLower === 'cash' || methodLower === 'card'
    ? totalAmount
    : 0;

  const outstanding = roundMoney(totalAmount - paid);

  return {
    grossTotal,
    discount: roundMoney(safeDiscount),
    vat: totalVat,
    expensesAmount: roundMoney(safeExpenses),
    roundoff: roundMoney(safeRoundoff),
    totalAmount,
    paid: roundMoney(paid),
    outstanding,
    totalQty,
    hasNegativeItems: negativeItems.length > 0,
    negativeItems,
    totalNegativeUnits,
  };
}

/**
 * Formats date + time consistently for stock audit history.
 */
export function formatStockAuditTimestamp(date: Date = new Date()): string {
  return date.toLocaleString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * Aggregates item quantities by productId so duplicate product rows in the same
 * invoice reconcile their net stock change cleanly.
 */
export function aggregatePurchaseQuantitiesByProduct(items: PurchaseItem[]): Map<
  string,
  {
    quantity: number;
    lastPositiveItem?: PurchaseItem;
    lastAnyItem: PurchaseItem;
  }
> {
  const map = new Map<
    string,
    {
      quantity: number;
      lastPositiveItem?: PurchaseItem;
      lastAnyItem: PurchaseItem;
    }
  >();

  for (const item of items || []) {
    if (!item.productId) continue;
    const prev = map.get(item.productId);
    const qty = Number(item.quantity) || 0;
    if (prev) {
      map.set(item.productId, {
        quantity: roundStockQty(prev.quantity + qty),
        lastPositiveItem: qty > 0 ? item : prev.lastPositiveItem,
        lastAnyItem: item,
      });
    } else {
      map.set(item.productId, {
        quantity: roundStockQty(qty),
        lastPositiveItem: qty > 0 ? item : undefined,
        lastAnyItem: item,
      });
    }
  }
  return map;
}

export interface PurchaseReconciliationResult {
  duplicateBlocked: boolean;
  stockError?: StockValidationFailure;
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  stockEntries: StockTransaction[];
}

/**
 * Validates that saving (or editing) a purchase invoice never pushes any product's stock below 0.
 * Allows projected stock === 0 (e.g., 10 - 10 = 0), strictly blocks projected stock < 0.
 */
export function validatePurchaseSaveAgainstStock(params: {
  items: PurchaseItem[];
  isEdit: boolean;
  existingPurchase?: PurchaseTransaction | null;
  products: Product[];
}): { ok: true } | StockValidationFailure {
  const { items, isEdit, existingPurchase, products } = params;
  const newMap = aggregatePurchaseQuantitiesByProduct(items || []);
  const oldMap =
    isEdit && existingPurchase
      ? aggregatePurchaseQuantitiesByProduct(existingPurchase.items || [])
      : new Map<string, { quantity: number; lastPositiveItem?: PurchaseItem; lastAnyItem: PurchaseItem }>();

  for (const prod of products) {
    const oldQty = oldMap.get(prod.id)?.quantity || 0;
    const newQty = newMap.get(prod.id)?.quantity || 0;
    const netDelta = roundStockQty(newQty - oldQty);
    if (netDelta < 0) {
      const check = validateSingleProductStockChange({
        productId: prod.id,
        productName: prod.name,
        availableStock: Number(prod.stock) || 0,
        delta: netDelta,
      });
      if (!check.ok) {
        return check;
      }
    }
  }

  return { ok: true };
}

/**
 * Pure, deterministic reconciliation for saving/updating a PurchaseTransaction
 * (both positive purchases and negative quantity stock adjustments).
 *
 * Guarantees:
 * - Duplicate non-edit saves (matching id or purchaseInvoiceNo) are blocked idempotently.
 * - Zero-stock protection: refuses any save or edit that would drop resulting stock below 0.
 * - New purchase: stock changes by +item.quantity (increases when > 0, decreases when < 0 down to 0).
 * - Edit purchase: computes exact delta (newQty - oldQty) after reversing previous effect.
 * - Never double-adds or double-deducts stock.
 * - Negative quantity items with 0 purchase cost never erase existing product costPrice/salePrice.
 * - Records StockTransaction with date/time, product, quantityChange, userName, and invoiceNumber.
 */
export function applyPurchaseSaveToState(params: {
  purchase: PurchaseTransaction;
  isEdit: boolean;
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  userName?: string;
  timestampStr?: string;
}): PurchaseReconciliationResult {
  const {
    purchase,
    isEdit,
    products,
    suppliers,
    purchases,
    userName = 'Admin',
    timestampStr = formatStockAuditTimestamp(),
  } = params;

  const existingById = purchases.find(
    (p) => p.id === purchase.id || (isEdit && p.purchaseInvoiceNo === purchase.purchaseInvoiceNo)
  );
  const existingByInv = purchases.find(
    (p) => p.purchaseInvoiceNo === purchase.purchaseInvoiceNo
  );

  // Duplicate guard for new purchases
  if (!isEdit && (existingById || existingByInv)) {
    return {
      duplicateBlocked: true,
      products,
      suppliers,
      purchases,
      stockEntries: [],
    };
  }

  // Zero-stock protection check BEFORE mutating anything
  const stockCheck = validatePurchaseSaveAgainstStock({
    items: purchase.items || [],
    isEdit: Boolean(isEdit && existingById),
    existingPurchase: existingById || null,
    products,
  });
  if (!stockCheck.ok) {
    return {
      duplicateBlocked: false,
      stockError: stockCheck,
      products,
      suppliers,
      purchases,
      stockEntries: [],
    };
  }

  const stockEntries: StockTransaction[] = [];
  const actorName = purchase.editBy || purchase.userName || userName;
  const newMap = aggregatePurchaseQuantitiesByProduct(purchase.items || []);

  let nextProducts = products;
  let nextSuppliers = suppliers;
  let nextPurchases = purchases;

  if (isEdit && existingById) {
    const oldPurchase = existingById;
    const oldMap = aggregatePurchaseQuantitiesByProduct(oldPurchase.items || []);

    nextProducts = products.map((prod) => {
      const oldEntry = oldMap.get(prod.id);
      const newEntry = newMap.get(prod.id);
      const oldQty = oldEntry ? oldEntry.quantity : 0;
      const newQty = newEntry ? newEntry.quantity : 0;
      const netDelta = roundStockQty(newQty - oldQty);

      // Only update product costPrice if positive purchase item has cost > 0 (or non-zero adjustment cost)
      const refItem = newEntry?.lastPositiveItem || newEntry?.lastAnyItem;
      const shouldUpdateCost =
        refItem && refItem.purchaseCost > 0 && (refItem.quantity > 0 || prod.costPrice <= 0);
      const nextCost = shouldUpdateCost ? refItem!.purchaseCost : prod.costPrice;
      const nextSale =
        refItem?.salePrice && refItem.salePrice > 0 ? refItem.salePrice : prod.price;

      if (netDelta !== 0) {
        const prevStock = roundStockQty(Number(prod.stock) || 0);
        const nextStock = roundStockQty(prevStock + netDelta);
        const txType: StockTransactionType =
          newQty < 0 || netDelta < 0 ? 'Stock Adjustment' : 'Purchase Edit';

        stockEntries.push({
          id: `stk-ped-${Date.now()}-${prod.id}-${Math.random().toString(36).slice(2, 6)}`,
          productId: prod.id,
          productName: prod.name,
          barcode: prod.barcode,
          previousStock: prevStock,
          quantityChange: netDelta,
          newStock: nextStock,
          transactionType: txType,
          invoiceNumber: purchase.purchaseInvoiceNo,
          dateTime: timestampStr,
          userName: actorName,
          notes:
            newQty < 0
              ? `Negative qty edit (${oldQty} -> ${newQty}, net ${netDelta}) by ${actorName}`
              : `Purchase invoice edited (${oldQty} -> ${newQty}, net ${netDelta >= 0 ? '+' : ''}${netDelta}) by ${actorName}`,
        });

        return {
          ...prod,
          stock: nextStock,
          costPrice: nextCost,
          price: nextSale,
        };
      }

      if (nextCost !== prod.costPrice || nextSale !== prod.price) {
        return {
          ...prod,
          costPrice: nextCost,
          price: nextSale,
        };
      }

      return prod;
    });

    const oldRemaining = Number(oldPurchase.remainingBalance) || 0;
    const newRemaining = Number(purchase.remainingBalance) || 0;
    const balanceDiff = newRemaining - oldRemaining;

    nextSuppliers = suppliers.map((sup) => {
      if (sup.id === purchase.supplierId) {
        return {
          ...sup,
          payableBalance: roundMoney((Number(sup.payableBalance) || 0) + balanceDiff),
        };
      }
      return sup;
    });

    nextPurchases = purchases.map((p) => (p.id === existingById.id ? purchase : p));
  } else {
    // Creating a new purchase (supports positive quantities & safe deductions down to 0)
    nextProducts = products.map((prod) => {
      const entry = newMap.get(prod.id);
      if (!entry || entry.quantity === 0) return prod;

      const prevStock = roundStockQty(Number(prod.stock) || 0);
      const qtyDelta = entry.quantity;
      const nextStock = roundStockQty(prevStock + qtyDelta);

      const refItem = entry.lastPositiveItem || entry.lastAnyItem;
      const shouldUpdateCost =
        refItem && refItem.purchaseCost > 0 && (refItem.quantity > 0 || prod.costPrice <= 0);
      const nextCost = shouldUpdateCost ? refItem!.purchaseCost : prod.costPrice;
      const nextSale =
        refItem?.salePrice && refItem.salePrice > 0 ? refItem.salePrice : prod.price;

      const isNegative = qtyDelta < 0;
      stockEntries.push({
        id: `stk-pur-${Date.now()}-${prod.id}-${Math.random().toString(36).slice(2, 6)}`,
        productId: prod.id,
        productName: prod.name,
        barcode: prod.barcode,
        previousStock: prevStock,
        quantityChange: qtyDelta,
        newStock: nextStock,
        transactionType: isNegative ? 'Stock Adjustment' : 'Purchase',
        invoiceNumber: purchase.purchaseInvoiceNo,
        dateTime: timestampStr,
        userName: actorName,
        notes: isNegative
          ? `Negative purchase qty stock deduction (${qtyDelta}) by ${actorName}`
          : `Purchase stock inflow (+${qtyDelta}) by ${actorName}`,
      });

      return {
        ...prod,
        stock: nextStock,
        costPrice: nextCost,
        price: nextSale,
      };
    });

    nextSuppliers = suppliers.map((sup) => {
      if (sup.id === purchase.supplierId) {
        return {
          ...sup,
          payableBalance: roundMoney(
            (Number(sup.payableBalance) || 0) + (Number(purchase.remainingBalance) || 0)
          ),
        };
      }
      return sup;
    });

    nextPurchases = [purchase, ...purchases];
  }

  return {
    duplicateBlocked: false,
    products: nextProducts,
    suppliers: nextSuppliers,
    purchases: nextPurchases,
    stockEntries,
  };
}

/**
 * Reverses a deleted purchase invoice cleanly (for both positive and negative quantities),
 * enforcing zero-stock protection so deleting a purchase never drives stock below 0.
 */
export function applyPurchaseDeleteToState(params: {
  purchaseId: string;
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  userName?: string;
  timestampStr?: string;
}): {
  deletedPurchase: PurchaseTransaction | null;
  stockError?: StockValidationFailure;
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  stockEntries: StockTransaction[];
} {
  const {
    purchaseId,
    products,
    suppliers,
    purchases,
    userName = 'Admin',
    timestampStr = formatStockAuditTimestamp(),
  } = params;

  const toDelete = purchases.find(
    (p) => p.id === purchaseId || p.purchaseInvoiceNo === purchaseId
  );
  if (!toDelete) {
    return {
      deletedPurchase: null,
      products,
      suppliers,
      purchases,
      stockEntries: [],
    };
  }

  const aggMap = aggregatePurchaseQuantitiesByProduct(toDelete.items || []);

  // Zero-stock protection before reversing purchase
  for (const prod of products) {
    const entry = aggMap.get(prod.id);
    if (!entry || entry.quantity === 0) continue;
    const reversalDelta = roundStockQty(-entry.quantity);
    if (reversalDelta < 0) {
      const check = validateSingleProductStockChange({
        productId: prod.id,
        productName: prod.name,
        availableStock: Number(prod.stock) || 0,
        delta: reversalDelta,
      });
      if (!check.ok) {
        return {
          deletedPurchase: null,
          stockError: check,
          products,
          suppliers,
          purchases,
          stockEntries: [],
        };
      }
    }
  }

  const stockEntries: StockTransaction[] = [];

  const nextProducts = products.map((prod) => {
    const entry = aggMap.get(prod.id);
    if (!entry || entry.quantity === 0) return prod;
    const prevStock = roundStockQty(Number(prod.stock) || 0);
    const reversalDelta = roundStockQty(-entry.quantity);
    const nextStock = roundStockQty(prevStock + reversalDelta);

    stockEntries.push({
      id: `stk-pdel-${Date.now()}-${prod.id}-${Math.random().toString(36).slice(2, 6)}`,
      productId: prod.id,
      productName: prod.name,
      barcode: prod.barcode,
      previousStock: prevStock,
      quantityChange: reversalDelta,
      newStock: nextStock,
      transactionType: 'Purchase Cancel',
      invoiceNumber: toDelete.purchaseInvoiceNo,
      dateTime: timestampStr,
      userName,
      notes: `Reversed deleted purchase ${toDelete.purchaseInvoiceNo} (qty ${entry.quantity} -> ${reversalDelta >= 0 ? '+' : ''}${reversalDelta})`,
    });

    return { ...prod, stock: nextStock };
  });

  const nextSuppliers = suppliers.map((sup) => {
    if (sup.id === toDelete.supplierId) {
      return {
        ...sup,
        payableBalance: roundMoney(
          (Number(sup.payableBalance) || 0) - (Number(toDelete.remainingBalance) || 0)
        ),
      };
    }
    return sup;
  });

  return {
    deletedPurchase: toDelete,
    products: nextProducts,
    suppliers: nextSuppliers,
    purchases: purchases.filter((p) => p.id !== toDelete.id),
    stockEntries,
  };
}

/**
 * Reverses ALL purchases safely with zero-stock protection.
 */
export function applyPurchaseDeleteAllToState(params: {
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  userName?: string;
  timestampStr?: string;
}): {
  ok: boolean;
  stockError?: StockValidationFailure;
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  stockEntries: StockTransaction[];
} {
  const {
    products,
    suppliers,
    purchases,
    userName = 'Admin',
    timestampStr = formatStockAuditTimestamp(),
  } = params;

  const totalByProd = new Map<string, number>();
  const balanceBySup = new Map<string, number>();

  for (const p of purchases) {
    for (const it of p.items || []) {
      if (!it.productId) continue;
      totalByProd.set(
        it.productId,
        roundStockQty((totalByProd.get(it.productId) || 0) + (Number(it.quantity) || 0))
      );
    }
    if (p.supplierId) {
      balanceBySup.set(
        p.supplierId,
        roundMoney((balanceBySup.get(p.supplierId) || 0) + (Number(p.remainingBalance) || 0))
      );
    }
  }

  for (const prod of products) {
    const totalPurchased = totalByProd.get(prod.id) || 0;
    const reversalDelta = roundStockQty(-totalPurchased);
    if (reversalDelta < 0) {
      const check = validateSingleProductStockChange({
        productId: prod.id,
        productName: prod.name,
        availableStock: Number(prod.stock) || 0,
        delta: reversalDelta,
      });
      if (!check.ok) {
        return {
          ok: false,
          stockError: check,
          products,
          suppliers,
          purchases,
          stockEntries: [],
        };
      }
    }
  }

  const stockEntries: StockTransaction[] = [];
  const nextProducts = products.map((prod) => {
    const totalPurchased = totalByProd.get(prod.id) || 0;
    if (totalPurchased === 0) return prod;
    const prevStock = roundStockQty(Number(prod.stock) || 0);
    const delta = roundStockQty(-totalPurchased);
    const nextStock = roundStockQty(prevStock + delta);
    stockEntries.push({
      id: `stk-pdelall-${Date.now()}-${prod.id}`,
      productId: prod.id,
      productName: prod.name,
      barcode: prod.barcode,
      previousStock: prevStock,
      quantityChange: delta,
      newStock: nextStock,
      transactionType: 'Purchase Cancel',
      invoiceNumber: 'ALL-PURCHASES',
      dateTime: timestampStr,
      userName,
      notes: `Reversed all purchases (${totalPurchased} units)`,
    });
    return { ...prod, stock: nextStock };
  });

  const nextSuppliers = suppliers.map((sup) => {
    const delta = balanceBySup.get(sup.id) || 0;
    if (delta === 0) return sup;
    return {
      ...sup,
      payableBalance: Math.max(0, roundMoney((Number(sup.payableBalance) || 0) - delta)),
    };
  });

  return {
    ok: true,
    products: nextProducts,
    suppliers: nextSuppliers,
    purchases: [],
    stockEntries,
  };
}
