import { Injectable, NgZone, computed, effect, inject, signal } from '@angular/core';
import { liveQuery } from 'dexie';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Customer, Product, Purchase, Sale, SaleListItem, Settings } from '../core/models';
import { NotifyService } from '../core/notify.service';
import { SettingsService } from '../core/settings.service';
import { errorMessage, isNetworkError, uuid } from '../core/util';
import { ConnectivityService } from './connectivity.service';
import { QueuedOperation, db, getMeta, setMeta } from './db';

interface SyncResult { id: string; type: string; status: 'applied' | 'duplicate' | 'rejected' | 'error'; message?: string; data?: unknown; }
interface Bootstrap { serverTime: string; products: Product[]; customers: Customer[]; settings: Settings; openSales: SaleListItem[]; }

const BATCH = 20;

/**
 * Offline queue + background sync.
 * Work done offline is stored in IndexedDB and pushed to /api/sync in the order it happened.
 * Every operation carries its own id, so a resend after a dropped connection is harmless.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private net = inject(ConnectivityService);
  private notify = inject(NotifyService);
  private settings = inject(SettingsService);
  private zone = inject(NgZone);
  private running: Promise<void> | null = null;
  private backoffMs = 5000;

  readonly queue = signal<QueuedOperation[]>([]);
  readonly pendingCount = computed(() => this.queue().filter(q => q.status !== 'rejected').length);
  readonly rejected = computed(() => this.queue().filter(q => q.status === 'rejected'));
  readonly syncing = signal(false);
  readonly lastSyncAt = signal<string | null>(null);
  readonly lastError = signal<string | null>(null);
  /** Online, but signed in offline: the user must sign in again before the queue can be sent. */
  readonly needsLogin = computed(() => this.net.online() && this.auth.isLoggedIn() && !this.auth.hasServerSession() && this.pendingCount() > 0);

  constructor() {
    liveQuery(() => db.queue.orderBy('seq').toArray()).subscribe(rows => this.zone.run(() => this.queue.set(rows)));
    void getMeta<string | null>('lastSyncAt', null).then(v => this.lastSyncAt.set(v));

    // Sync as soon as we're back online with a usable session.
    effect(() => {
      if (this.net.online() && this.auth.hasServerSession()) void this.syncNow();
    });
    this.zone.runOutsideAngular(() => setInterval(() => this.zone.run(() => {
      if (this.net.online() && this.auth.hasServerSession() && this.pendingCount() > 0) void this.syncNow();
    }), 30000));
  }

  async enqueue(type: string, payload: unknown, label: string, localRef?: string): Promise<QueuedOperation> {
    const op: QueuedOperation = {
      id: uuid(), type, payload, label, localRef: localRef ?? null,
      createdAt: new Date().toISOString(), status: 'pending', attempts: 0,
    };
    await db.queue.add(op);
    if (this.net.online() && this.auth.hasServerSession()) setTimeout(() => void this.syncNow(), 300);
    return op;
  }

  /** Pushes queued work, then refreshes the offline cache. Safe to call any time. */
  syncNow(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = null; this.syncing.set(false); });
    return this.running;
  }

  async discard(op: QueuedOperation): Promise<void> {
    await db.queue.where('id').equals(op.id).delete();
    if (op.type === 'sale.create' && op.localRef) await db.sales.delete(op.localRef);
    await this.refreshCache().catch(() => undefined);
  }

  /** A rejected operation can be tried again (e.g. after stock arrives). It gets a new id. */
  async retry(op: QueuedOperation): Promise<void> {
    await db.queue.where('id').equals(op.id).modify({ id: uuid(), status: 'pending', lastError: null, attempts: 0 });
    void this.syncNow();
  }

  private async run(): Promise<void> {
    if (!this.net.online() || !this.auth.hasServerSession()) return;
    this.syncing.set(true);
    try {
      let pushedAny = false;
      while (true) {
        const ops = (await db.queue.orderBy('seq').toArray()).filter(o => o.status !== 'rejected').slice(0, BATCH);
        if (ops.length === 0) break;
        const results = await this.api.post<SyncResult[]>('/sync', {
          operations: ops.map(o => ({ id: o.id, type: o.type, payload: o.payload, clientTimestamp: o.createdAt })),
        });
        let stop = false;
        for (const r of results) {
          const op = ops.find(o => o.id === r.id);
          if (!op) continue;
          if (r.status === 'applied' || r.status === 'duplicate') {
            await this.afterApplied(op, r.data);
            await db.queue.where('id').equals(op.id).delete();
            pushedAny = true;
          } else if (r.status === 'rejected') {
            await db.queue.where('id').equals(op.id).modify({ status: 'rejected', lastError: r.message ?? 'Rejected by server' });
            this.notify.error(`Not saved: ${op.label} — ${r.message}`);
          } else {
            await db.queue.where('id').equals(op.id).modify({ status: 'error', lastError: r.message ?? 'Server error', attempts: op.attempts + 1 });
            stop = true;
          }
        }
        // The server stops at the first unexpected error to keep order; anything after it was not attempted.
        if (stop || results.length < ops.length) break;
      }

      if (await this.outstanding() === 0) await this.refreshCache();
      const now = new Date().toISOString();
      this.lastSyncAt.set(now);
      await setMeta('lastSyncAt', now);
      this.lastError.set(null);
      this.backoffMs = 5000;
      if (pushedAny) this.notify.success('Offline work synced to the server.');
    } catch (err) {
      this.lastError.set(errorMessage(err));
      if (!isNetworkError(err)) {
        // Try again later with growing delay.
        const wait = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, 5 * 60_000);
        setTimeout(() => void this.syncNow(), wait);
      }
    }
  }

  private async outstanding(): Promise<number> {
    return (await db.queue.toArray()).filter(o => o.status !== 'rejected').length;
  }

  /** Swap temporary offline records for the server's version once they're saved. */
  private async afterApplied(op: QueuedOperation, data: unknown): Promise<void> {
    if (op.type === 'sale.create' && data) {
      if (op.localRef) await db.sales.delete(op.localRef);
      await db.sales.put(data as Sale);
    } else if (op.type === 'purchase.create' && data) {
      if (op.localRef) await db.purchases.delete(op.localRef);
    } else if ((op.type === 'return.create' || op.type === 'sale.payment') && data && (data as Sale).id) {
      await db.sales.put(data as Sale);
    }
  }

  /** Re-downloads products, stock, customers and settings for offline use. */
  async refreshCache(): Promise<void> {
    if (!this.net.online() || !this.auth.hasServerSession()) return;
    if (await this.outstanding() > 0) return; // local numbers include unsynced work; don't overwrite them
    const b = await this.api.get<Bootstrap>('/sync/bootstrap');
    await db.transaction('rw', [db.products, db.customers, db.openSales, db.meta], async () => {
      await db.products.clear();
      await db.products.bulkPut(b.products);
      await db.customers.clear();
      await db.customers.bulkPut(b.customers);
      await db.openSales.clear();
      await db.openSales.bulkPut(b.openSales);
    });
    await this.settings.set(b.settings);
    await setMeta('cacheAt', b.serverTime);
  }

  /** Short device code used in temporary offline invoice numbers. */
  async nextOfflineNumber(prefix: string): Promise<string> {
    let device = await getMeta<string | null>('deviceCode', null);
    if (!device) {
      device = Math.random().toString(36).slice(2, 5).toUpperCase();
      await setMeta('deviceCode', device);
    }
    const n = (await getMeta<number>(`counter.${prefix}`, 0)) + 1;
    await setMeta(`counter.${prefix}`, n);
    return `${prefix}-${device}-${String(n).padStart(4, '0')}`;
  }

  /** Offline purchases kept locally until synced. */
  async localPurchases(): Promise<Purchase[]> { return db.purchases.toArray(); }
}
