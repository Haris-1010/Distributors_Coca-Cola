import Dexie, { Table } from 'dexie';
import {
  CrateTransaction, Customer, Product, Purchase, Sale, SaleListItem, SaleReturn, StockSummary, UserRole,
} from '../core/models';

export type QueueStatus = 'pending' | 'syncing' | 'rejected' | 'error';

export interface QueuedOperation {
  /** Also the idempotency key the server stores. */
  id: string;
  type: string;
  payload: unknown;
  createdAt: string;
  status: QueueStatus;
  attempts: number;
  lastError?: string | null;
  /** Short human description, e.g. "Sale OFF-7K2-0003 to Al-Madina Store". */
  label: string;
  /** Local record this operation created (e.g. offline sale id), so it can be replaced after sync. */
  localRef?: string | null;
  seq?: number;
}

export interface CachedUser {
  email: string; userId: string; fullName: string; role: UserRole;
  salt: string; hash: string; iterations: number; cachedAt: string;
}

export interface MetaRow { key: string; value: unknown; }

/**
 * IndexedDB, via Dexie. Holds a copy of the reference data needed to keep selling offline,
 * plus everything done offline that is waiting to reach the server.
 */
export class WholesaleDb extends Dexie {
  products!: Table<Product, string>;
  stock!: Table<StockSummary, string>;
  customers!: Table<Customer, string>;
  sales!: Table<Sale, string>;
  openSales!: Table<SaleListItem, string>;
  purchases!: Table<Purchase, string>;
  returns!: Table<SaleReturn, string>;
  crateTransactions!: Table<CrateTransaction, string>;
  queue!: Table<QueuedOperation, number>;
  users!: Table<CachedUser, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('wholesale-db');
    this.version(1).stores({
      products: 'id, name, barcode, sku, brand',
      stock: 'productId',
      customers: 'id, name, phone',
      sales: 'id, invoiceNumber, customerId, saleDate, offline',
      openSales: 'id, customerId, saleDate',
      purchases: 'id, purchaseDate',
      returns: 'id, saleId',
      crateTransactions: 'id, customerId',
      queue: '++seq, &id, status, createdAt',
      users: 'email',
      meta: 'key',
    });
  }
}

export const db = new WholesaleDb();

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return (row?.value as T) ?? fallback;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
