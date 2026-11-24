import { Product, SaleReturn, SaleTransaction } from '../types/pos';

export interface SaleInvoiceMetrics {
  invoiceNumber: string;
  itemCount: number;
  grossTotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
  paidAmount: number;
  remainingCredit: number;
  cogs: number;
  profit: number;
  hasCostData: boolean;
  isoDate: string;
}

export interface ChartPoint {
  key: string;
  label: string;
  totalSales: number;
  invoices: number;
  profit: number;
}

export interface TopSellingProductPoint {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
  profit: number;
}

export interface SaleSummaryMetricsResult {
  dedupedTransactions: SaleTransaction[];
  filteredTransactions: SaleTransaction[];
  perInvoice: Record<string, SaleInvoiceMetrics>;
  kpis: {
    totalSales: number;
    grossSales: number;
    cashSales: number;
    digitalSales: number;
    creditSales: number;
    totalDiscounts: number;
    totalInvoices: number;
    totalItemsSold: number;
    salesReturns: number;
    cashRefunds: number;
    digitalRefunds: number;
    creditRefunds: number;
    netSales: number;
    netCash: number;
    netDigital: number;
    netCredit: number;
    actualGrossProfit: number;
    totalCogs: number;
    hasCompleteCostData: boolean;
    outstandingCreditDue: number;
  };
  dailySeries: ChartPoint[];
  weeklySeries: ChartPoint[];
  monthlySeries: ChartPoint[];
  paymentMix: {
    cash: number;
    digital: number;
    credit: number;
    total: number;
  };
  topProducts: TopSellingProductPoint[];
}

export function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateToIso(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const dd = slashMatch[1].padStart(2, '0');
    const mm = slashMatch[2].padStart(2, '0');
    const yyyy = slashMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return toLocalIsoDate(parsed);
  }
  return '';
}

export function deduplicateSalesTransactions(transactions: SaleTransaction[]): SaleTransaction[] {
  const seen = new Set<string>();
  const out: SaleTransaction[] = [];
  for (const tx of transactions || []) {
    if (!tx) continue;
    const key = String(tx.invoiceNumber || '').trim();
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(tx);
  }
  return out;
}

function getIsoWeekKey(isoDate: string): { key: string; label: string } {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return { key: isoDate, label: isoDate };
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = d.getDay() || 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  const key = toLocalIsoDate(monday);
  const label = monday.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  return { key, label: `Wk ${label}` };
}

export function computeSaleSummaryMetrics(params: {
  transactions: SaleTransaction[];
  saleReturns?: SaleReturn[];
  products?: Product[];
  fromDate: string;
  toDate: string;
  paymentFilter?: 'All' | 'Cash' | 'Card' | 'Digital' | 'Credit';
  searchQuery?: string;
}): SaleSummaryMetricsResult {
  const {
    transactions,
    saleReturns = [],
    products = [],
    fromDate,
    toDate,
    paymentFilter = 'All',
    searchQuery = '',
  } = params;

  const dedupedTransactions = deduplicateSalesTransactions(transactions);
  const productMap = new Map<string, Product>();
  for (const p of products) {
    if (p?.id) productMap.set(p.id, p);
    if (p?.barcode) productMap.set(`bc:${p.barcode}`, p);
  }

  const perInvoice: Record<string, SaleInvoiceMetrics> = {};
  const filteredTransactions: SaleTransaction[] = [];

  for (const tx of dedupedTransactions) {
    const isoDate = parseDateToIso(tx.dateTime);
    if (isoDate) {
      if (fromDate && isoDate < fromDate) continue;
      if (toDate && isoDate > toDate) continue;
    }

    if (paymentFilter !== 'All') {
      const pm = (tx.paymentMethod || '').toLowerCase();
      if (paymentFilter === 'Digital') {
        if (pm !== 'digital' && pm !== 'card') continue;
      } else if (pm !== paymentFilter.toLowerCase()) {
        continue;
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const invMatch = (tx.invoiceNumber || '').toLowerCase().includes(q);
      const custMatch = tx.customerName
        ? tx.customerName.toLowerCase().includes(q)
        : 'pos cash sales walk-in customer'.includes(q);
      const itemMatch = (tx.items || []).some((it) =>
        (it.product?.name || '').toLowerCase().includes(q)
      );
      if (!invMatch && !custMatch && !itemMatch) continue;
    }

    filteredTransactions.push(tx);
  }

  let totalSales = 0;
  let grossSales = 0;
  let cashSales = 0;
  let digitalSales = 0;
  let creditSales = 0;
  let totalDiscounts = 0;
  let totalItemsSold = 0;
  let totalCogs = 0;
  let outstandingCreditDue = 0;
  let hasCompleteCostData = true;

  const dailyMap = new Map<string, ChartPoint>();
  const weeklyMap = new Map<string, ChartPoint>();
  const monthlyMap = new Map<string, ChartPoint>();
  const topProductsMap = new Map<string, TopSellingProductPoint>();

  for (const tx of filteredTransactions) {
    const isoDate = parseDateToIso(tx.dateTime) || fromDate || toLocalIsoDate(new Date());
    const txGrand = Number(tx.grandTotal) || 0;
    const txGross = Number(tx.subtotal) || txGrand;
    const txDisc = Number(tx.discount) || 0;
    const txTax = Number(tx.taxAmount) || 0;
    const paidAmount =
      tx.paymentMethod === 'credit'
        ? Math.min(txGrand, Math.max(0, Number(tx.cashTendered) || 0))
        : txGrand;
    const remainingCredit = Math.max(0, txGrand - paidAmount);

    let itemCount = 0;
    let txCogs = 0;
    let txHasCost = (tx.items || []).length > 0;

    for (const it of tx.items || []) {
      const qty = Number(it.quantity) || 1;
      const sellPrice = Number(it.product?.price) || 0;
      const lineRevenue = sellPrice * qty;
      const liveProd =
        (it.product?.id ? productMap.get(it.product.id) : undefined) ||
        (it.product?.barcode ? productMap.get(`bc:${it.product.barcode}`) : undefined);
      const unitCost =
        Number(it.product?.costPrice) > 0
          ? Number(it.product?.costPrice)
          : Number(liveProd?.costPrice) > 0
          ? Number(liveProd?.costPrice)
          : 0;
      if (unitCost <= 0) txHasCost = false;
      const lineCogs = unitCost * qty;

      itemCount += qty;
      txCogs += lineCogs;

      const pKey = it.product?.id || it.product?.name || 'unknown';
      const existingTop = topProductsMap.get(pKey) || {
        productId: pKey,
        name: it.product?.name || 'Unnamed Item',
        quantity: 0,
        revenue: 0,
        profit: 0,
      };
      existingTop.quantity += qty;
      existingTop.revenue += lineRevenue;
      existingTop.profit += unitCost > 0 ? lineRevenue - lineCogs : 0;
      topProductsMap.set(pKey, existingTop);
    }

    if (!txHasCost) hasCompleteCostData = false;
    const txProfit = txGrand - txCogs;

    totalSales += txGrand;
    grossSales += txGross;
    totalDiscounts += txDisc;
    totalItemsSold += itemCount;
    totalCogs += txCogs;

    const pm = (tx.paymentMethod || 'cash').toLowerCase();
    if (pm === 'cash') cashSales += txGrand;
    else if (pm === 'card' || pm === 'digital') digitalSales += txGrand;
    else if (pm === 'credit') {
      creditSales += txGrand;
      outstandingCreditDue += remainingCredit;
    }

    perInvoice[tx.invoiceNumber] = {
      invoiceNumber: tx.invoiceNumber,
      itemCount,
      grossTotal: txGross,
      discount: txDisc,
      tax: txTax,
      grandTotal: txGrand,
      paidAmount,
      remainingCredit,
      cogs: txCogs,
      profit: txProfit,
      hasCostData: txHasCost,
      isoDate,
    };

    // Chart buckets
    const dLabel = isoDate.slice(5); // MM-DD
    const dPrev = dailyMap.get(isoDate) || {
      key: isoDate,
      label: dLabel,
      totalSales: 0,
      invoices: 0,
      profit: 0,
    };
    dPrev.totalSales += txGrand;
    dPrev.invoices += 1;
    dPrev.profit += txProfit;
    dailyMap.set(isoDate, dPrev);

    const wk = getIsoWeekKey(isoDate);
    const wPrev = weeklyMap.get(wk.key) || {
      key: wk.key,
      label: wk.label,
      totalSales: 0,
      invoices: 0,
      profit: 0,
    };
    wPrev.totalSales += txGrand;
    wPrev.invoices += 1;
    wPrev.profit += txProfit;
    weeklyMap.set(wk.key, wPrev);

    const mKey = isoDate.slice(0, 7);
    const [mY, mM] = mKey.split('-').map(Number);
    const mDate = !isNaN(mY) && !isNaN(mM) ? new Date(mY, mM - 1, 1) : new Date();
    const mLabel = mDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const mPrev = monthlyMap.get(mKey) || {
      key: mKey,
      label: mLabel,
      totalSales: 0,
      invoices: 0,
      profit: 0,
    };
    mPrev.totalSales += txGrand;
    mPrev.invoices += 1;
    mPrev.profit += txProfit;
    monthlyMap.set(mKey, mPrev);
  }

  let salesReturns = 0;
  let cashRefunds = 0;
  let digitalRefunds = 0;
  let creditRefunds = 0;

  for (const r of saleReturns || []) {
    const rIso = parseDateToIso(r.date);
    const inRange = !rIso || ((!fromDate || rIso >= fromDate) && (!toDate || rIso <= toDate));
    if (!inRange) continue;
    const refundAmt = Number(r.totalRefund) || 0;
    salesReturns += refundAmt;
    const rm = (r.refundMethod || 'cash').toLowerCase();
    if (rm === 'cash') cashRefunds += refundAmt;
    else if (rm === 'card' || rm === 'digital') digitalRefunds += refundAmt;
    else if (rm === 'credit') creditRefunds += refundAmt;
  }

  const netSales = Math.max(0, totalSales - salesReturns);
  const netCash = Math.max(0, cashSales - cashRefunds);
  const netDigital = Math.max(0, digitalSales - digitalRefunds);
  const netCredit = Math.max(0, creditSales - creditRefunds);
  const actualGrossProfit = netSales - totalCogs;

  const dailySeries = Array.from(dailyMap.values()).sort((a, b) => a.key.localeCompare(b.key)).slice(-14);
  const weeklySeries = Array.from(weeklyMap.values()).sort((a, b) => a.key.localeCompare(b.key)).slice(-8);
  const monthlySeries = Array.from(monthlyMap.values()).sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
  const topProducts = Array.from(topProductsMap.values())
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
    .slice(0, 8);

  return {
    dedupedTransactions,
    filteredTransactions,
    perInvoice,
    kpis: {
      totalSales,
      grossSales,
      cashSales,
      digitalSales,
      creditSales,
      totalDiscounts,
      totalInvoices: filteredTransactions.length,
      totalItemsSold,
      salesReturns,
      cashRefunds,
      digitalRefunds,
      creditRefunds,
      netSales,
      netCash,
      netDigital,
      netCredit,
      actualGrossProfit,
      totalCogs,
      hasCompleteCostData,
      outstandingCreditDue,
    },
    dailySeries,
    weeklySeries,
    monthlySeries,
    paymentMix: {
      cash: cashSales,
      digital: digitalSales,
      credit: creditSales,
      total: cashSales + digitalSales + creditSales,
    },
    topProducts,
  };
}

export interface TodaySaleSnapshot {
  totalSales: number;
  invoicesCount: number;
  cashSales: number;
  creditSales: number;
  digitalSales: number;
}

export function computeTodaySaleSnapshot(
  transactions: SaleTransaction[],
  saleReturns: SaleReturn[] = [],
  referenceDate: Date = new Date()
): TodaySaleSnapshot {
  const todayIso = toLocalIsoDate(referenceDate);
  const summary = computeSaleSummaryMetrics({
    transactions,
    saleReturns,
    fromDate: todayIso,
    toDate: todayIso,
    paymentFilter: 'All',
  });
  return {
    totalSales: summary.kpis.totalSales,
    invoicesCount: summary.kpis.totalInvoices,
    cashSales: summary.kpis.cashSales,
    creditSales: summary.kpis.creditSales,
    digitalSales: summary.kpis.digitalSales,
  };
}
