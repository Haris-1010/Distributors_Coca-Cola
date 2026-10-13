import { DatePipe } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Customer, CustomerLedger, SaleListItem } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { addDays, dayStartUtc } from '../../core/util';
import { ConnectivityService } from '../../offline/connectivity.service';
import { DataService } from '../../offline/data.service';
import { db } from '../../offline/db';
import { DateRangeComponent, Range } from '../../shared/date-range';
import { CrateDialog, PaymentDialog, PromptDialog } from '../../shared/dialogs';
import { exportExcel, exportPdf } from '../../shared/export';
import { MoneyPipe } from '../../shared/pipes';
import { CustomerDialog } from './customer.dialog';

@Component({
  selector: 'app-customer-detail',
  imports: [DatePipe, RouterLink, MatButtonModule, MatTabsModule, DateRangeComponent, MoneyPipe],
  template: `
  <div class="page">
    @if (customer(); as c) {
      <div class="page-head">
        <div>
          <div class="small muted"><a routerLink="/customers" class="crumb">Customers</a> /</div>
          <h1>{{ c.businessName || c.name }} @if (!c.isActive) { <span class="chip">inactive</span> }</h1>
          <div class="sub">{{ c.businessName ? c.name + ' · ' : '' }}{{ c.phone }} {{ c.address ? '· ' + c.address : '' }} · {{ c.customerType }}</div>
        </div>
        <div class="actions">
          @if (auth.isManager) { <button mat-stroked-button (click)="edit(c)">Edit</button> }
          @if (auth.isAdmin && net.online()) { <button mat-stroked-button (click)="adjustCrates(c)">Crate adjustment</button> }
          @if (auth.canSell) { <a mat-flat-button routerLink="/pos">New sale</a> }
        </div>
      </div>

      <div class="stats">
        <div class="stat" [class.alert]="c.outstandingBalance > 0">
          <div class="label">{{ c.outstandingBalance < 0 ? 'Advance paid' : 'Balance due' }}</div>
          <div class="value">{{ (c.outstandingBalance < 0 ? -c.outstandingBalance : c.outstandingBalance) | money }}</div>
          @if (auth.canSell && c.outstandingBalance > 0) { <button mat-button class="tile-btn" (click)="pay(c)">Receive payment</button> }
        </div>
        <div class="stat" [class.alert]="c.emptyCrateBalance > 0">
          <div class="label">Empty crates owed</div>
          <div class="value">{{ c.emptyCrateBalance }}</div>
          @if (auth.canSell && c.emptyCrateBalance > 0) { <button mat-button class="tile-btn" (click)="crates(c)">Collect crates</button> }
        </div>
        <div class="stat"><div class="label">Open sales</div><div class="value">{{ openSales().length }}</div></div>
      </div>

      <mat-tab-group animationDuration="0ms">
        <mat-tab label="Open sales">
          <div class="tab">
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>Invoice</th><th>Date</th><th class="right">Total</th><th class="right">Due</th><th class="right">Crates pending</th></tr></thead>
                <tbody>
                  @for (s of openSales(); track s.id) {
                    <tr class="clickable" [routerLink]="['/sales', s.id]">
                      <td class="num">{{ s.invoiceNumber }}</td><td>{{ s.saleDate | date: 'dd MMM yyyy' }}</td>
                      <td class="right money">{{ s.netAmount | money }}</td>
                      <td class="right money" [class.neg]="s.balance > 0">{{ s.balance | money }}</td>
                      <td class="right num" [class.neg]="s.pendingCrates > 0">{{ s.pendingCrates }}</td>
                    </tr>
                  } @empty { <tr><td colspan="5"><div class="empty">Nothing open — all settled.</div></td></tr> }
                </tbody>
              </table>
            </div>
          </div>
        </mat-tab>
        <mat-tab label="Ledger">
          <div class="tab">
            @if (!net.online()) { <p class="muted">The full ledger needs the server.</p> }
            @else {
              <div class="filters">
                <app-date-range (changed)="range.set($event); loadLedger()" />
                <span class="spacer"></span>
                <button mat-stroked-button (click)="exportLedger('xlsx')" [disabled]="!ledger()">Excel</button>
                <button mat-stroked-button (click)="exportLedger('pdf')" [disabled]="!ledger()">PDF</button>
              </div>
              @if (ledger(); as l) {
                <div class="table-wrap">
                  <table class="data">
                    <thead><tr><th>Date</th><th>Type</th><th>Ref</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th>
                      <th class="right">Crates +</th><th class="right">Crates −</th><th class="right">Crates owed</th></tr></thead>
                    <tbody>
                      <tr class="muted"><td colspan="5">Opening balance</td><td class="right money">{{ l.openingBalance | money }}</td><td colspan="2"></td><td class="right num">{{ l.openingCrates }}</td></tr>
                      @for (e of l.entries; track $index) {
                        <tr>
                          <td>{{ e.date | date: 'dd MMM yy, HH:mm' }}</td>
                          <td>{{ e.type }}@if (e.notes) { <div class="small muted">{{ e.notes }}</div> }</td>
                          <td>@if (e.saleId) { <a class="num" [routerLink]="['/sales', e.saleId]">{{ e.reference }}</a> } @else { {{ e.reference }} }</td>
                          <td class="right money">{{ e.debit ? (e.debit | money) : '' }}</td>
                          <td class="right money">{{ e.credit ? (e.credit | money) : '' }}</td>
                          <td class="right money">{{ e.balance | money }}</td>
                          <td class="right num">{{ e.cratesIssued || '' }}</td>
                          <td class="right num">{{ e.cratesReturned || '' }}</td>
                          <td class="right num">{{ e.crateBalance }}</td>
                        </tr>
                      }
                    </tbody>
                    <tfoot><tr><td colspan="5">Closing</td><td class="right money">{{ l.closingBalance | money }}</td><td colspan="2"></td><td class="right num">{{ l.closingCrates }}</td></tr></tfoot>
                  </table>
                </div>
              }
            }
          </div>
        </mat-tab>
      </mat-tab-group>
    } @else {
      <div class="skeleton" style="height:28px;width:260px"></div>
    }
  </div>
  `,
  styles: `
    .crumb { color: inherit; }
    .tab { padding-top: 14px; }
    .tile-btn { margin: 6px 0 -6px -12px; }
  `,
})
export class CustomerDetailPage {
  id = input.required<string>();
  private data = inject(DataService);
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  auth = inject(AuthService);
  net = inject(ConnectivityService);

  customer = signal<Customer | null>(null);
  openSales = signal<SaleListItem[]>([]);
  ledger = signal<CustomerLedger | null>(null);
  range = signal<Range | null>(null);

  ngOnInit() { void this.load(); }

  async load() {
    try {
      this.customer.set((await this.data.customer(this.id())) ?? null);
      const res = await this.data.sales({ customerId: this.id(), status: 'open', page: 1, pageSize: 200 });
      this.openSales.set(res.items.filter(s => !s.isSettled));
      if (this.range()) await this.loadLedger();
    } catch (e) { this.notify.error(e); }
  }

  async loadLedger() {
    const r = this.range();
    if (!r || !this.net.online()) return;
    try {
      this.ledger.set(await this.api.get<CustomerLedger>(`/customers/${this.id()}/ledger`, {
        from: dayStartUtc(r.from), to: dayStartUtc(addDays(new Date(r.to + 'T00:00:00'), 1)),
      }));
    } catch (e) { this.notify.error(e); }
  }

  async edit(c: Customer) {
    const res = await firstValueFrom(this.dialog.open(CustomerDialog, { width: '560px', data: c }).afterClosed());
    if (res) this.customer.set(res);
  }

  async pay(c: Customer) {
    const ok = await firstValueFrom(this.dialog.open(PaymentDialog, {
      width: '480px', data: { customerId: c.id, customerName: c.businessName || c.name, due: c.outstandingBalance },
    }).afterClosed());
    if (ok) await this.load();
  }

  async crates(c: Customer) {
    const ok = await firstValueFrom(this.dialog.open(CrateDialog, {
      width: '440px', data: { customerId: c.id, customerName: c.businessName || c.name, pending: c.emptyCrateBalance, customerOwes: c.emptyCrateBalance },
    }).afterClosed());
    if (ok) await this.load();
  }

  async adjustCrates(c: Customer) {
    const qty = await firstValueFrom(this.dialog.open(PromptDialog, {
      width: '460px',
      data: {
        title: 'Crate adjustment', type: 'number', label: 'Crates (+ owes more, − owes fewer)', confirmText: 'Next',
        message: 'Use for an opening balance when starting the software, a crate broken by the shop, or crates collected outside a sale.',
      },
    }).afterClosed());
    const n = Number(qty);
    if (!n) return;
    const reason = await firstValueFrom(this.dialog.open(PromptDialog, { width: '460px', data: { title: 'Reason', label: 'Why?', confirmText: 'Save adjustment' } }).afterClosed());
    if (!reason) return;
    try {
      const updated = await this.api.post<Customer>('/empty-crates/adjust', { customerId: c.id, quantity: n, notes: reason });
      await db.customers.put(updated);
      this.customer.set(updated);
      this.notify.success('Crate balance adjusted.');
      await this.loadLedger();
    } catch (e) { this.notify.error(e); }
  }

  exportLedger(kind: 'xlsx' | 'pdf') {
    const l = this.ledger();
    const c = this.customer();
    if (!l || !c) return;
    const cols = [
      { key: 'date', label: 'Date', type: 'date' as const }, { key: 'type', label: 'Type' }, { key: 'reference', label: 'Ref' },
      { key: 'debit', label: 'Debit', type: 'money' as const }, { key: 'credit', label: 'Credit', type: 'money' as const },
      { key: 'balance', label: 'Balance', type: 'money' as const }, { key: 'cratesIssued', label: 'Crates +', type: 'int' as const },
      { key: 'cratesReturned', label: 'Crates −', type: 'int' as const }, { key: 'crateBalance', label: 'Crates owed', type: 'int' as const },
    ];
    const title = `Ledger — ${c.businessName || c.name}`;
    const rows = l.entries as unknown as Record<string, unknown>[];
    if (kind === 'xlsx') void exportExcel(title, cols, rows);
    else void exportPdf(title, `${this.range()?.from} to ${this.range()?.to}`, cols, rows);
  }
}
