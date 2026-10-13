import { Injectable, inject } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import {
  CreatePurchaseRequest, CreateReturnRequest, CreateSaleRequest, CrateReturnRequest, Customer, CustomerPaymentRequest,
  Paged, Product, Purchase, RETURN_REASONS, Sale, SaleItem, SaleListItem, SaveCustomerRequest,
} from '../core/models';
import { SettingsService } from '../core/settings.service';
import { cratesFor, isNetworkError, round2, uuid } from '../core/util';
import { ConnectivityService } from './connectivity.service';
import { db } from './db';
import { SyncService } from './sync.service';

/**
 * One place for every read/write that must keep working offline (selling, customers,
 * payments, crates, returns, receiving stock). Online it calls the API and refreshes the cache;
 * offline it works on the cache and queues the change for the server.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private net = inject(ConnectivityService);
  private sync = inject(SyncService);
  private settings = inject(SettingsService);

  /** Use the server when it's reachable and nothing local is waiting to be sent. */
  private async canUseServer(): Promise<boolean> {
    if (!this.net.online() || !this.auth.hasServerSession()) return false;
    if (this.sync.pendingCount() > 0) {
      await this.sync.syncNow();
      return this.sync.pendingCount() === 0;
    }
    return true;
  }

  private get canWriteToServer(): boolean { return this.net.online() && this.auth.hasServerSession(); }

  // ---------------- Reads ----------------

  async products(includeInactive = false): Promise<Product[]> {
    if (await this.canUseServer()) {
      try {
        const list = await this.api.get<Product[]>('/products', { includeInactive });
        if (!includeInactive) { await db.products.clear(); await db.products.bulkPut(list); }
        return list;
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    const cached = await db.products.orderBy('name').toArray();
    return includeInactive ? cached : cached.filter(p => p.isActive);
  }

  async customers(search?: string): Promise<Customer[]> {
    if (await this.canUseServer()) {
      try {
        const list = await this.api.get<Customer[]>('/customers', { search });
        if (!search) { await db.customers.clear(); await db.customers.bulkPut(list); }
        return list;
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    const s = (search ?? '').toLowerCase();
    return (await db.customers.orderBy('name').toArray())
      .filter(c => c.isActive && (!s || c.name.toLowerCase().includes(s) || (c.businessName ?? '').toLowerCase().includes(s) || (c.phone ?? '').includes(s)));
  }

  async customer(id: string): Promise<Customer | undefined> {
    if (await this.canUseServer()) {
      try {
        const c = await this.api.get<Customer>(`/customers/${id}`);
        await db.customers.put(c);
        return c;
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    return db.customers.get(id);
  }

  async sale(id: string): Promise<Sale | undefined> {
    const local = await db.sales.get(id);
    if (local?.offline) return local;
    if (this.net.online() && this.auth.hasServerSession()) {
      try {
        const s = await this.api.get<Sale>(`/sales/${id}`);
        await db.sales.put(s);
        return s;
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    return local;
  }

  /** Sales list. Offline sales that haven't synced yet are shown first. */
  async sales(params: { from?: string; to?: string; customerId?: string; status?: string; search?: string; page: number; pageSize: number }): Promise<Paged<SaleListItem> & { fromCache: boolean }> {
    const offlineSales = (await db.sales.filter(s => !!s.offline).toArray())
      .filter(s => !params.customerId || s.customerId === params.customerId)
      .map(toListItem);

    if (this.net.online() && this.auth.hasServerSession()) {
      try {
        const page = await this.api.get<Paged<SaleListItem>>('/sales', params);
        return { ...page, items: params.page === 1 ? [...offlineSales, ...page.items] : page.items, fromCache: false };
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }

    // Offline: what we have locally — offline sales, recently viewed sales and unsettled sales.
    const viewed = (await db.sales.filter(s => !s.offline).toArray()).map(toListItem);
    const open = await db.openSales.toArray();
    const byId = new Map<string, SaleListItem>();
    for (const s of [...open, ...viewed, ...offlineSales]) byId.set(s.id, s);
    let items = [...byId.values()];
    if (params.customerId) items = items.filter(s => s.customerId === params.customerId);
    if (params.status === 'open') items = items.filter(s => !s.isSettled);
    if (params.status === 'pending-crates') items = items.filter(s => s.pendingCrates > 0);
    if (params.status === 'unpaid') items = items.filter(s => s.balance > 0);
    if (params.status === 'settled') items = items.filter(s => s.isSettled);
    if (params.search) {
      const q = params.search.toLowerCase();
      items = items.filter(s => s.invoiceNumber.toLowerCase().includes(q) || s.customerName.toLowerCase().includes(q));
    }
    items.sort((a, b) => b.saleDate.localeCompare(a.saleDate));
    return { items, total: items.length, page: 1, pageSize: items.length, fromCache: true };
  }

  // ---------------- Writes ----------------

  async saveCustomer(req: SaveCustomerRequest): Promise<Customer> {
    const isNew = !req.id;
    const body = { ...req, id: req.id ?? uuid() };
    if (this.canWriteToServer) {
      try {
        const c = isNew ? await this.api.post<Customer>('/customers', body) : await this.api.put<Customer>(`/customers/${body.id}`, body);
        await db.customers.put(c);
        return c;
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    const existing = await db.customers.get(body.id);
    const c: Customer = {
      outstandingBalance: 0, emptyCrateBalance: 0, createdAt: new Date().toISOString(), ...existing,
      id: body.id, name: body.name, phone: body.phone, address: body.address, businessName: body.businessName,
      customerType: body.customerType, isActive: body.isActive,
    };
    await db.customers.put(c);
    await this.sync.enqueue(isNew ? 'customer.create' : 'customer.update', body, `${isNew ? 'New' : 'Edit'} customer ${c.name}`);
    return c;
  }

  /**
   * Creates a sale. Offline it is checked against cached stock and prices, saved locally with a
   * temporary invoice number (OFF-…), and the customer's money and crate balances are updated locally.
   */
  async createSale(req: CreateSaleRequest): Promise<Sale> {
    if (this.canWriteToServer) {
      try {
        const sale = await this.api.post<Sale>('/sales', req);
        await db.sales.put(sale);
        void this.refreshAfterSale(sale);
        return sale;
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    return this.createSaleOffline(req);
  }

  private async createSaleOffline(req: CreateSaleRequest): Promise<Sale> {
    const customer = await db.customers.get(req.customerId);
    if (!customer) throw new Error('Customer is not available offline. Sync once while online.');
    const products = new Map((await db.products.bulkGet(req.items.map(i => i.productId))).filter((p): p is Product => !!p).map(p => [p.id, p]));
    const perCrate = this.settings.profitPerCrate();
    const isManager = this.auth.isManager;
    if (req.discount > 0 && !isManager) throw new Error('Only a Manager or Admin can give a discount.');

    // Same product at the same price → one line (matches the server).
    const merged = new Map<string, { productId: string; unitPrice?: number | null; quantity: number }>();
    for (const i of req.items) {
      const k = `${i.productId}|${i.unitPrice ?? ''}`;
      const m = merged.get(k);
      if (m) m.quantity += i.quantity; else merged.set(k, { ...i });
    }

    const need = new Map<string, number>();
    for (const l of merged.values()) need.set(l.productId, (need.get(l.productId) ?? 0) + l.quantity);

    const items: SaleItem[] = [];
    let profit = 0;
    for (const l of merged.values()) {
      const p = products.get(l.productId);
      if (!p) throw new Error('A product on this sale is not available offline.');
      if ((need.get(p.id) ?? 0) > p.stockQuantity) throw new Error(`Not enough stock for ${p.name}: ${p.stockQuantity} available.`);
      const price = l.unitPrice ?? p.sellingPrice;
      const minProfit = perCrate && p.bottlesPerCrate > 0 ? round2(p.minProfit / p.bottlesPerCrate) : p.minProfit;
      if (price < p.purchasePrice + minProfit && !isManager)
        throw new Error(`${p.name}: price is below the minimum. Ask a Manager.`);
      const item: SaleItem = {
        id: uuid(), productId: p.id, productName: p.name, quantity: l.quantity, returnedQuantity: 0, netQuantity: l.quantity,
        unitPrice: price, purchasePriceAtSale: p.purchasePrice, profitPerUnit: round2(price - p.purchasePrice),
        total: round2(price * l.quantity), isCrateRequired: p.isCrateRequired, bottlesPerCrate: p.bottlesPerCrate,
        cratesRequired: p.isCrateRequired ? cratesFor(l.quantity, p.bottlesPerCrate) : 0, priceOverridden: price !== p.sellingPrice,
      };
      profit += (price - p.purchasePrice) * l.quantity;
      items.push(item);
    }

    const total = round2(items.reduce((s, i) => s + i.total, 0));
    if (req.discount > total) throw new Error('Discount is more than the sale total.');
    const net = round2(total - req.discount);
    const paidHere = Math.min(req.paidAmount, net);
    const crates = items.reduce((s, i) => s + i.cratesRequired, 0);
    const invoice = await this.sync.nextOfflineNumber('OFF');

    const sale: Sale = {
      id: req.id, invoiceNumber: invoice, offlineReference: invoice, offline: true,
      customerId: customer.id, customerName: customer.name, customerBusinessName: customer.businessName, customerPhone: customer.phone,
      saleDate: req.saleDate ?? new Date().toISOString(), totalAmount: total, discount: req.discount, returnedAmount: 0,
      netAmount: net, paidAmount: paidHere, balance: round2(net - paidHere), paymentMode: req.paymentMode,
      paymentStatus: paidHere <= 0 ? (net <= 0 ? 'Paid' : 'Unpaid') : paidHere >= net ? 'Paid' : 'Partial',
      profitAmount: round2(profit - req.discount), emptyCratesRequired: crates, emptyCratesReturned: 0, pendingCrates: crates,
      isSettled: false, settlementOverridden: false, notes: req.notes, createdByName: this.auth.user()?.fullName,
      items, returns: [], payments: [], settlementBlockers: [],
    };
    // Crates brought now count against older sales first on the server; locally we just reduce the customer's total.
    sale.isSettled = sale.balance <= 0 && crates === 0;
    sale.settlementBlockers = blockers(sale, this.settings.currencySymbol());

    const newCrateBalance = customer.emptyCrateBalance + crates - req.cratesReturnedNow;
    if (req.cratesReturnedNow > customer.emptyCrateBalance + crates)
      throw new Error(`${customer.name} only owes ${customer.emptyCrateBalance + crates} crate(s).`);

    await db.transaction('rw', [db.sales, db.products, db.customers], async () => {
      await db.sales.put(sale);
      for (const [pid, qty] of need) await db.products.update(pid, { stockQuantity: (products.get(pid)!.stockQuantity) - qty });
      await db.customers.update(customer.id, {
        outstandingBalance: round2(customer.outstandingBalance + net - req.paidAmount),
        emptyCrateBalance: newCrateBalance,
      });
    });
    await this.sync.enqueue('sale.create', { ...req, offlineReference: invoice },
      `Sale ${invoice} to ${customer.businessName || customer.name}`, sale.id);
    return sale;
  }

  private async refreshAfterSale(sale: Sale): Promise<void> {
    // Keep the offline cache close to the server between full refreshes.
    for (const i of sale.items) {
      const p = await db.products.get(i.productId);
      if (p) await db.products.update(p.id, { stockQuantity: Math.max(0, p.stockQuantity - i.quantity) });
    }
    try { await db.customers.put(await this.api.get<Customer>(`/customers/${sale.customerId}`)); } catch { /* not critical */ }
  }

  /** Money from a customer — against a sale or "on account" (oldest dues first). */
  async receivePayment(customerId: string, req: CustomerPaymentRequest): Promise<void> {
    if (this.canWriteToServer) {
      try {
        if (req.saleId) await db.sales.put(await this.api.post<Sale>(`/sales/${req.saleId}/payments`, req));
        else await this.api.post(`/customers/${customerId}/payments`, req);
        const c = await this.api.get<Customer>(`/customers/${customerId}`);
        await db.customers.put(c);
        return;
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    const c = await db.customers.get(customerId);
    if (!c) throw new Error('Customer is not available offline.');
    await db.customers.update(customerId, { outstandingBalance: round2(c.outstandingBalance - req.amount) });
    if (req.saleId) {
      const s = await db.sales.get(req.saleId);
      if (s) {
        const paid = round2(Math.min(s.netAmount, s.paidAmount + req.amount));
        const upd = { ...s, paidAmount: paid, balance: round2(s.netAmount - paid) };
        upd.settlementBlockers = blockers(upd, this.settings.currencySymbol());
        await db.sales.put(upd);
      }
    }
    await this.sync.enqueue(req.saleId ? 'sale.payment' : 'customer.payment', { ...req, customerId },
      `Payment ${this.settings.currencySymbol()} ${req.amount} from ${c.name}`);
  }

  async returnCrates(req: CrateReturnRequest): Promise<void> {
    if (this.canWriteToServer) {
      try {
        await this.api.post('/empty-crates/return', req);
        await db.customers.put(await this.api.get<Customer>(`/customers/${req.customerId}`));
        if (req.saleId) await db.sales.put(await this.api.get<Sale>(`/sales/${req.saleId}`));
        return;
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    const c = await db.customers.get(req.customerId);
    if (!c) throw new Error('Customer is not available offline.');
    if (req.quantity > c.emptyCrateBalance) throw new Error(`${c.name} only owes ${c.emptyCrateBalance} crate(s).`);
    await db.customers.update(c.id, { emptyCrateBalance: c.emptyCrateBalance - req.quantity });
    if (req.saleId) {
      const s = await db.sales.get(req.saleId);
      if (s) {
        const returned = s.emptyCratesReturned + Math.min(req.quantity, s.pendingCrates);
        const upd = { ...s, emptyCratesReturned: returned, pendingCrates: Math.max(0, s.emptyCratesRequired - returned) };
        upd.settlementBlockers = blockers(upd, this.settings.currencySymbol());
        await db.sales.put(upd);
      }
    }
    await this.sync.enqueue('crate.return', req, `${req.quantity} empty crate(s) from ${c.name}`);
  }

  async createReturn(req: CreateReturnRequest): Promise<Sale> {
    if (this.canWriteToServer) {
      try {
        const sale = await this.api.post<Sale>('/returns', req);
        await db.sales.put(sale);
        return sale;
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    const s = await db.sales.get(req.saleId);
    if (!s) throw new Error('This sale is not available offline. Open it once while online.');
    const items = s.items.map(i => ({ ...i }));
    let value = 0;
    for (const l of req.lines) {
      const it = items.find(i => i.id === l.saleItemId);
      if (!it) throw new Error('Item not on this sale.');
      if (l.quantity > it.netQuantity) throw new Error(`${it.productName}: only ${it.netQuantity} can be returned.`);
      it.returnedQuantity += l.quantity;
      it.netQuantity -= l.quantity;
      it.cratesRequired = it.isCrateRequired ? cratesFor(it.netQuantity, it.bottlesPerCrate) : 0;
      value += l.quantity * it.unitPrice;
      if (RETURN_REASONS.find(r => r.value === l.reason)?.restock) {
        const p = await db.products.get(it.productId);
        if (p) await db.products.update(p.id, { stockQuantity: p.stockQuantity + l.quantity });
      }
    }
    const crates = items.reduce((a, i) => a + i.cratesRequired, 0);
    const net = round2(s.netAmount - value);
    const paid = Math.min(s.paidAmount, net);
    const upd: Sale = {
      ...s, items, returnedAmount: round2(s.returnedAmount + value), netAmount: net, paidAmount: paid, balance: round2(net - paid),
      emptyCratesRequired: crates, pendingCrates: Math.max(0, crates - s.emptyCratesReturned),
    };
    upd.settlementBlockers = blockers(upd, this.settings.currencySymbol());
    await db.sales.put(upd);
    const c = await db.customers.get(s.customerId);
    if (c) await db.customers.update(c.id, {
      outstandingBalance: round2(c.outstandingBalance - (s.balance - upd.balance)),
      emptyCrateBalance: c.emptyCrateBalance + (crates - s.emptyCratesRequired),
    });
    await this.sync.enqueue('return.create', req, `Return on ${s.invoiceNumber}`);
    return upd;
  }

  /** Receiving stock from the distributor. Offline it raises cached stock and queues the purchase. */
  async createPurchase(req: CreatePurchaseRequest): Promise<Purchase> {
    if (this.canWriteToServer) {
      try {
        const p = await this.api.post<Purchase>('/purchases', req);
        for (const i of req.items) {
          const prod = await db.products.get(i.productId);
          if (prod) await db.products.update(prod.id, { stockQuantity: prod.stockQuantity + i.quantity, purchasePrice: i.unitPrice });
        }
        return p;
      } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    const products = await db.products.bulkGet(req.items.map(i => i.productId));
    const total = round2(req.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
    const invoice = req.invoiceNumber || await this.sync.nextOfflineNumber('PUR-OFF');
    const purchase: Purchase = {
      id: req.id, invoiceNumber: invoice, distributorName: req.distributorName, purchaseDate: req.purchaseDate ?? new Date().toISOString(),
      totalAmount: total, paidAmount: req.paidAmount, balance: round2(total - req.paidAmount),
      paymentStatus: req.paidAmount <= 0 ? 'Unpaid' : req.paidAmount >= total ? 'Paid' : 'Partial',
      notes: req.notes, itemCount: req.items.length, offline: true,
      items: req.items.map((i, idx) => ({ ...i, productName: products[idx]?.name, total: round2(i.quantity * i.unitPrice) })),
    };
    await db.purchases.put(purchase);
    for (const i of req.items) {
      const p = await db.products.get(i.productId);
      if (p) await db.products.update(p.id, { stockQuantity: p.stockQuantity + i.quantity, purchasePrice: i.unitPrice });
    }
    await this.sync.enqueue('purchase.create', { ...req, invoiceNumber: req.invoiceNumber || null }, `Purchase ${invoice} from ${req.distributorName}`, purchase.id);
    return purchase;
  }
}

export function toListItem(s: Sale): SaleListItem {
  return {
    id: s.id, invoiceNumber: s.invoiceNumber, customerId: s.customerId, customerName: s.customerName, saleDate: s.saleDate,
    netAmount: s.netAmount, paidAmount: s.paidAmount, balance: s.balance, profitAmount: s.profitAmount,
    paymentStatus: s.paymentStatus, emptyCratesRequired: s.emptyCratesRequired, emptyCratesReturned: s.emptyCratesReturned,
    pendingCrates: s.pendingCrates, isSettled: s.isSettled, offline: s.offline,
  };
}

function blockers(s: Sale, symbol: string): string[] {
  const out: string[] = [];
  if (s.balance > 0) out.push(`${symbol} ${s.balance.toFixed(2)} payment still due.`);
  if (s.pendingCrates > 0) out.push(`${s.pendingCrates} empty crate(s) not returned yet.`);
  return out;
}
