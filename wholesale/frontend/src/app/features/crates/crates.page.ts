import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CrateTransaction, CustomerCrateSummary, Paged } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { ConnectivityService } from '../../offline/connectivity.service';
import { db } from '../../offline/db';
import { CrateDialog } from '../../shared/dialogs';
import { exportExcel, exportPdf } from '../../shared/export';

@Component({
  selector: 'app-crates',
  imports: [FormsModule, DatePipe, RouterLink, MatButtonModule, MatTabsModule, MatFormFieldModule, MatInputModule],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Empty crates</h1><div class="sub">Glass bottles go out 24 to a crate — every crate must come back before a sale can settle.</div></div>
      <div class="actions">
        <button mat-stroked-button (click)="export('xlsx')">Excel</button>
        <button mat-stroked-button (click)="export('pdf')">PDF</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat" [class.alert]="totalPending() > 0"><div class="label">Crates out with customers</div><div class="value">{{ totalPending() }}</div></div>
      <div class="stat"><div class="label">Customers owing crates</div><div class="value">{{ owing().length }}</div></div>
      <div class="stat" [class.alert]="overdue() > 0"><div class="label">Owing for 7+ days</div><div class="value">{{ overdue() }}</div><div class="hint">customers</div></div>
    </div>

    <mat-tab-group animationDuration="0ms">
      <mat-tab label="Who owes crates">
        <div class="tab">
          <mat-form-field class="full" style="max-width:360px">
            <mat-label>Search customer</mat-label>
            <input matInput [ngModel]="search()" (ngModelChange)="search.set($event)">
          </mat-form-field>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Customer</th><th>Phone</th><th class="right">Issued</th><th class="right">Returned</th><th class="right">Adjusted</th>
                <th class="right">Pending</th><th>Oldest open sale</th><th></th></tr></thead>
              <tbody>
                @if (loading()) { @for (i of [1,2,3]; track i) { <tr><td colspan="8"><div class="skeleton"></div></td></tr> } }
                @for (r of filtered(); track r.customerId) {
                  <tr>
                    <td><a [routerLink]="['/customers', r.customerId]"><b>{{ r.businessName || r.customerName }}</b></a></td>
                    <td>{{ r.phone }}</td>
                    <td class="right num">{{ r.cratesIssued }}</td>
                    <td class="right num">{{ r.cratesReturned }}</td>
                    <td class="right num">{{ r.adjustments || '—' }}</td>
                    <td class="right"><span class="chip red">{{ r.pendingCrates }}</span></td>
                    <td>
                      @if (r.oldestPendingSaleDate) {
                        {{ r.oldestPendingSaleDate | date: 'dd MMM' }}
                        <span class="small" [class.neg]="age(r) >= 7">({{ age(r) }} days)</span>
                      }
                    </td>
                    <td class="right">@if (auth.canSell) { <button mat-stroked-button (click)="collect(r)">Collect</button> }</td>
                  </tr>
                } @empty {
                  @if (!loading()) { <tr><td colspan="8"><div class="empty"><span class="material-symbols-outlined">task_alt</span>All crates are back. 🎉</div></td></tr> }
                }
              </tbody>
            </table>
          </div>
        </div>
      </mat-tab>
      <mat-tab label="History">
        <div class="tab">
          @if (!net.online()) { <p class="muted">History needs the server.</p> }
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Date</th><th>Customer</th><th>Type</th><th>Invoice</th><th class="right">Crates</th><th>Note</th></tr></thead>
              <tbody>
                @for (t of history(); track t.id) {
                  <tr>
                    <td>{{ t.date | date: 'dd MMM yy, HH:mm' }}</td>
                    <td>{{ t.customerName }}</td>
                    <td><span class="chip" [class.red]="t.transactionType === 'Issued'" [class.green]="t.transactionType === 'Returned'">{{ t.transactionType }}</span></td>
                    <td>@if (t.saleId) { <a class="num" [routerLink]="['/sales', t.saleId]">{{ t.invoiceNumber }}</a> }</td>
                    <td class="right num">{{ t.quantity > 0 ? '+' : '' }}{{ t.quantity }}</td>
                    <td class="muted">{{ t.notes }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </mat-tab>
    </mat-tab-group>
  </div>
  `,
  styles: `.tab { padding-top: 14px; } a { color: var(--app-blue); text-decoration: none; }`,
})
export class CratesPage {
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  auth = inject(AuthService);
  net = inject(ConnectivityService);

  rows = signal<CustomerCrateSummary[]>([]);
  history = signal<CrateTransaction[]>([]);
  loading = signal(true);
  search = signal('');

  owing = computed(() => this.rows().filter(r => r.pendingCrates > 0));
  filtered = computed(() => {
    const q = this.search().toLowerCase();
    return this.owing().filter(r => !q || r.customerName.toLowerCase().includes(q) || (r.businessName ?? '').toLowerCase().includes(q));
  });
  totalPending = computed(() => this.owing().reduce((s, r) => s + r.pendingCrates, 0));
  overdue = computed(() => this.owing().filter(r => this.age(r) >= 7).length);

  ngOnInit() { void this.load(); }

  age(r: CustomerCrateSummary): number {
    return r.oldestPendingSaleDate ? Math.floor((Date.now() - new Date(r.oldestPendingSaleDate).getTime()) / 86_400_000) : 0;
  }

  async load() {
    this.loading.set(true);
    try {
      if (this.net.online()) {
        this.rows.set(await this.api.get<CustomerCrateSummary[]>('/empty-crates/summary', { onlyPending: true }));
        this.history.set((await this.api.get<Paged<CrateTransaction>>('/empty-crates/transactions', { pageSize: 100 })).items);
      } else {
        // Offline: build from cached customer balances.
        const cs = await db.customers.toArray();
        this.rows.set(cs.filter(c => c.emptyCrateBalance > 0).map(c => ({
          customerId: c.id, customerName: c.name, businessName: c.businessName, phone: c.phone,
          cratesIssued: 0, cratesReturned: 0, adjustments: 0, pendingCrates: c.emptyCrateBalance, openSales: 0, oldestPendingSaleDate: null,
        })));
      }
    } catch (e) { this.notify.error(e); } finally { this.loading.set(false); }
  }

  async collect(r: CustomerCrateSummary) {
    const ok = await firstValueFrom(this.dialog.open(CrateDialog, {
      width: '440px', data: { customerId: r.customerId, customerName: r.businessName || r.customerName, pending: r.pendingCrates, customerOwes: r.pendingCrates },
    }).afterClosed());
    if (ok) await this.load();
  }

  export(kind: 'xlsx' | 'pdf') {
    const cols = [
      { key: 'businessName', label: 'Shop' }, { key: 'customerName', label: 'Customer' }, { key: 'phone', label: 'Phone' },
      { key: 'cratesIssued', label: 'Issued', type: 'int' as const }, { key: 'cratesReturned', label: 'Returned', type: 'int' as const },
      { key: 'pendingCrates', label: 'Pending', type: 'int' as const }, { key: 'oldestPendingSaleDate', label: 'Oldest open sale', type: 'date' as const },
    ];
    const rows = this.owing() as unknown as Record<string, unknown>[];
    if (kind === 'xlsx') void exportExcel('Empty crates pending', cols, rows);
    else void exportPdf('Empty crates pending', `${this.totalPending()} crates with ${this.owing().length} customers`, cols, rows);
  }
}
