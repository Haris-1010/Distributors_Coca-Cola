import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { StockAlerts, StockBatch, StockSummary } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { SettingsService } from '../../core/settings.service';
import { ConnectivityService } from '../../offline/connectivity.service';
import { db } from '../../offline/db';
import { exportExcel, exportPdf } from '../../shared/export';
import { BrandPipe, CratesPipe, MoneyPipe, WordsPipe } from '../../shared/pipes';
import { AdjustStockDialog } from './adjust-stock.dialog';

interface Movement { id: string; productName: string; movementType: string; quantity: number; reason?: string; createdAt: string; }

@Component({
  selector: 'app-stock',
  imports: [FormsModule, DatePipe, RouterLink, MatButtonModule, MatTabsModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MoneyPipe, CratesPipe, BrandPipe, WordsPipe],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Stock</h1><div class="sub">What's on the shelf, batch by batch, with expiry.</div></div>
      <div class="actions">
        <button mat-stroked-button (click)="export('xlsx')">Excel</button>
        <button mat-stroked-button (click)="export('pdf')">PDF</button>
        @if (auth.isManager) {
          <a mat-stroked-button routerLink="/purchases/new"><span class="material-symbols-outlined">local_shipping</span> Receive stock</a>
          <button mat-flat-button (click)="adjust()" [disabled]="!net.online()">Adjust stock</button>
        }
      </div>
    </div>

    <div class="stats">
      <div class="stat"><div class="label">Stock value (at cost)</div><div class="value">{{ totalValue() | money }}</div></div>
      <div class="stat"><div class="label">Full crates / packs</div><div class="value">{{ totalCrates() }}</div></div>
      <div class="stat" [class.alert]="(alerts()?.lowStockCount ?? 0) > 0"><div class="label">Low stock</div><div class="value">{{ alerts()?.lowStockCount ?? '—' }}</div></div>
      <div class="stat" [class.alert]="(alerts()?.nearExpiryCount ?? 0) + (alerts()?.expiredCount ?? 0) > 0">
        <div class="label">Expiring / expired batches</div><div class="value">{{ alerts() ? alerts()!.nearExpiryCount + ' / ' + alerts()!.expiredCount : '—' }}</div></div>
    </div>

    <mat-tab-group animationDuration="0ms" (selectedTabChange)="onTab($event.index)">
      <mat-tab label="By product">
        <div class="tab">
          <mat-form-field class="full" style="max-width:360px"><mat-label>Search</mat-label><input matInput [ngModel]="search()" (ngModelChange)="search.set($event)"></mat-form-field>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Product</th><th>Brand</th><th class="right">Pieces</th><th class="right">Crates + loose</th><th class="right">Value</th><th>Nearest expiry</th><th>Status</th></tr></thead>
              <tbody>
                @for (s of filtered(); track s.productId) {
                  <tr>
                    <td><b>{{ s.productName }}</b></td><td>{{ s.brand | brand }}</td>
                    <td class="right num">{{ s.quantity }}</td>
                    <td class="right">{{ s.quantity | crates: s.bottlesPerCrate }}</td>
                    <td class="right money">{{ s.stockValue | money }}</td>
                    <td>{{ s.nearestExpiry ? (s.nearestExpiry | date: 'dd MMM yyyy') : '—' }}</td>
                    <td>@if (s.quantity === 0) { <span class="chip red">Out</span> } @else if (s.isLowStock) { <span class="chip amber">Low</span> } @else { <span class="chip green">OK</span> }</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </mat-tab>
      <mat-tab label="Batches & expiry" [disabled]="!net.online()">
        <div class="tab">
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th class="right">Pieces</th><th class="right">Cost/pc</th><th>Location</th></tr></thead>
              <tbody>
                @if (batchesLoading()) {
                  @for (i of [1,2,3,4,5]; track i) { <tr><td colspan="6"><div class="skeleton"></div></td></tr> }
                }
                @for (b of batches(); track b.id) {
                  <tr>
                    <td>{{ b.productName }}</td><td class="num">{{ b.batchNumber }}</td>
                    <td>
                      {{ b.expiryDate ? (b.expiryDate | date: 'dd MMM yyyy') : '—' }}
                      @if (b.daysToExpiry !== null && b.daysToExpiry !== undefined) {
                        @if (b.daysToExpiry < 0) { <span class="chip red">expired</span> }
                        @else if (b.daysToExpiry <= expiryDays()) { <span class="chip amber">{{ b.daysToExpiry }} days</span> }
                      }
                    </td>
                    <td class="right num">{{ b.quantity }}</td>
                    <td class="right money">{{ b.purchasePriceAtTime | money }}</td>
                    <td>{{ b.location }}</td>
                  </tr>
                }
                @if (!batchesLoading() && batches().length === 0) {
                  <tr><td colspan="6"><div class="empty">No stock batches found.</div></td></tr>
                }
              </tbody>
            </table>
          </div>
          <mat-paginator [length]="batchTotal()" [pageSize]="batchPageSize" [pageIndex]="batchPage() - 1"
            [pageSizeOptions]="[25, 50, 100]" [disabled]="batchesLoading()" (page)="onBatchPage($event)" />
        </div>
      </mat-tab>
      @if (auth.isManager) {
        <mat-tab label="Movements" [disabled]="!net.online()">
          <div class="tab">
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>When</th><th>Product</th><th>Type</th><th class="right">Qty</th><th>Reason / ref</th></tr></thead>
                <tbody>
                  @if (movementsLoading()) {
                    @for (i of [1,2,3,4,5]; track i) { <tr><td colspan="5"><div class="skeleton"></div></td></tr> }
                  }
                  @for (m of movements(); track m.id) {
                    <tr>
                      <td>{{ m.createdAt | date: 'dd MMM, HH:mm' }}</td><td>{{ m.productName }}</td><td>{{ m.movementType | words }}</td>
                      <td class="right num" [class.pos]="m.quantity > 0" [class.neg]="m.quantity < 0">{{ m.quantity > 0 ? '+' : '' }}{{ m.quantity }}</td>
                      <td class="muted">{{ m.reason }}</td>
                    </tr>
                  }
                  @if (!movementsLoading() && movements().length === 0) {
                    <tr><td colspan="5"><div class="empty">No stock movements found.</div></td></tr>
                  }
                </tbody>
              </table>
            </div>
            <mat-paginator [length]="movementTotal()" [pageSize]="movementPageSize" [pageIndex]="movementPage() - 1"
              [pageSizeOptions]="[25, 50, 100]" [disabled]="movementsLoading()" (page)="onMovementPage($event)" />
          </div>
        </mat-tab>
      }
    </mat-tab-group>
  </div>
  `,
  styles: `.tab { padding-top: 14px; }`,
})
export class StockPage {
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  auth = inject(AuthService);
  net = inject(ConnectivityService);

  summary = signal<StockSummary[]>([]);
  batches = signal<StockBatch[]>([]);
  alerts = signal<StockAlerts | null>(null);
  movements = signal<Movement[]>([]);
  batchTotal = signal(0);
  batchPage = signal(1);
  batchPageSize = 25;
  batchesLoading = signal(false);
  movementTotal = signal(0);
  movementPage = signal(1);
  movementPageSize = 25;
  movementsLoading = signal(false);
  search = signal('');
  private activeTabIndex = 0;
  private batchRequestId = 0;
  private movementRequestId = 0;
  private settings = inject(SettingsService);
  expiryDays = computed(() => Number(this.settings.get('ExpiryAlertDays', '30')) || 30);

  filtered = computed(() => { const q = this.search().toLowerCase(); return this.summary().filter(s => !q || s.productName.toLowerCase().includes(q)); });
  totalValue = computed(() => this.summary().reduce((s, x) => s + x.stockValue, 0));
  totalCrates = computed(() => this.summary().reduce((s, x) => s + x.crateQuantity, 0));

  ngOnInit() { void this.load(); }

  async load() {
    try {
      if (this.net.online()) {
        const [summary, alerts] = await Promise.all([
          this.api.get<StockSummary[]>('/stock'), this.api.get<StockAlerts>('/stock/alerts'),
        ]);
        this.summary.set(summary); this.alerts.set(alerts);
      } else {
        // Offline: product cache already includes stock changes made on this device.
        const products = await db.products.orderBy('name').toArray();
        this.summary.set(products.map(p => ({
          productId: p.id, productName: p.name, brand: p.brand, unitType: p.unitType, bottlesPerCrate: p.bottlesPerCrate,
          quantity: p.stockQuantity, crateQuantity: Math.floor(p.stockQuantity / Math.max(1, p.bottlesPerCrate)),
          loosePieces: p.stockQuantity % Math.max(1, p.bottlesPerCrate), stockValue: p.stockQuantity * p.purchasePrice,
          lowStockThreshold: p.lowStockThreshold, isLowStock: p.stockQuantity <= p.lowStockThreshold, nearestExpiry: null, batchCount: 0,
        })));
      }
    } catch (e) { this.notify.error(e); }
  }

  onTab(index: number) {
    this.activeTabIndex = index;
    if (index === 1 && this.net.online()) void this.loadBatches();
    if (index === 2 && this.net.online() && this.auth.isManager) void this.loadMovements();
  }

  async loadBatches() {
    const requestId = ++this.batchRequestId;
    this.batchesLoading.set(true);
    try {
      const res = await this.api.get<{ items: StockBatch[]; total: number }>('/stock/batches/paged', {
        page: this.batchPage(), pageSize: this.batchPageSize,
      });
      if (requestId === this.batchRequestId) {
        this.batches.set(res.items);
        this.batchTotal.set(res.total);
      }
    } catch (e) { if (requestId === this.batchRequestId) this.notify.error(e); }
    finally { if (requestId === this.batchRequestId) this.batchesLoading.set(false); }
  }

  onBatchPage(e: PageEvent) {
    this.batchPageSize = e.pageSize;
    this.batchPage.set(e.pageIndex + 1);
    void this.loadBatches();
  }

  async loadMovements() {
    const requestId = ++this.movementRequestId;
    this.movementsLoading.set(true);
    try {
      const res = await this.api.get<{ items: Movement[]; total: number }>('/stock/movements/paged', {
        page: this.movementPage(), pageSize: this.movementPageSize,
      });
      if (requestId === this.movementRequestId) {
        this.movements.set(res.items);
        this.movementTotal.set(res.total);
      }
    } catch (e) { if (requestId === this.movementRequestId) this.notify.error(e); }
    finally { if (requestId === this.movementRequestId) this.movementsLoading.set(false); }
  }

  onMovementPage(e: PageEvent) {
    this.movementPageSize = e.pageSize;
    this.movementPage.set(e.pageIndex + 1);
    void this.loadMovements();
  }

  async adjust() {
    const ok = await firstValueFrom(this.dialog.open(AdjustStockDialog, { width: '520px', data: this.summary() }).afterClosed());
    if (ok) {
      await this.load();
      if (this.activeTabIndex === 1 && this.net.online()) void this.loadBatches();
      if (this.activeTabIndex === 2 && this.net.online() && this.auth.isManager) void this.loadMovements();
    }
  }

  export(kind: 'xlsx' | 'pdf') {
    const cols = [
      { key: 'productName', label: 'Product' }, { key: 'quantity', label: 'Pieces', type: 'int' as const },
      { key: 'crateQuantity', label: 'Full crates', type: 'int' as const }, { key: 'loosePieces', label: 'Loose', type: 'int' as const },
      { key: 'stockValue', label: 'Value', type: 'money' as const }, { key: 'nearestExpiry', label: 'Nearest expiry', type: 'date' as const },
    ];
    const rows = this.summary() as unknown as Record<string, unknown>[];
    if (kind === 'xlsx') void exportExcel('Stock report', cols, rows);
    else void exportPdf('Stock report', `Value at cost: Rs ${this.totalValue().toFixed(2)}`, cols, rows);
  }
}
