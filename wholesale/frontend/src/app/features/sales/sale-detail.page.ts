import { DatePipe } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Sale } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { ConnectivityService } from '../../offline/connectivity.service';
import { DataService } from '../../offline/data.service';
import { db } from '../../offline/db';
import { CrateDialog, PaymentDialog, PromptDialog } from '../../shared/dialogs';
import { CratesPipe, MoneyPipe, WordsPipe } from '../../shared/pipes';

@Component({
  selector: 'app-sale-detail',
  imports: [DatePipe, RouterLink, MatButtonModule, MatMenuModule, MoneyPipe, CratesPipe, WordsPipe],
  template: `
  <div class="page">
    @if (sale(); as s) {
      <div class="page-head">
        <div>
          <div class="crumbs small muted"><a routerLink="/sales">Sales</a> /</div>
          <h1 class="num">{{ s.invoiceNumber }}
            @if (s.offline) { <span class="chip amber">Saved offline — not synced</span> }
            @if (s.isSettled) { <span class="chip green">Settled</span> } @else { <span class="chip red">Open</span> }
          </h1>
          <div class="sub">{{ s.saleDate | date: 'EEEE dd MMM yyyy, HH:mm' }} · by {{ s.createdByName || '—' }}</div>
        </div>
        <div class="actions">
          <a mat-stroked-button [routerLink]="['/sales', s.id, 'print']"><span class="material-symbols-outlined">print</span> Invoice</a>
          @if (auth.canSell && !s.offline) {
            <a mat-stroked-button routerLink="/returns" [queryParams]="{ saleId: s.id }"><span class="material-symbols-outlined">assignment_return</span> Return items</a>
          }
        </div>
      </div>

      <div class="layout">
        <div class="grid">
          <div class="card">
            <div class="card-title">Items</div>
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>Product</th><th class="right">Qty</th><th class="right">Returned</th><th class="right">Price</th>
                  @if (auth.isManager) { <th class="right">Cost</th><th class="right">Profit/pc</th> }
                  <th class="right">Total</th></tr></thead>
                <tbody>
                  @for (i of s.items; track i.id) {
                    <tr>
                      <td>{{ i.productName }} @if (i.isCrateRequired) { <span class="chip red">glass</span> } @if (i.priceOverridden) { <span class="chip amber">price changed</span> }
                        <div class="small muted">{{ i.quantity | crates: i.bottlesPerCrate }}</div></td>
                      <td class="right num">{{ i.quantity }}</td>
                      <td class="right num">{{ i.returnedQuantity || '—' }}</td>
                      <td class="right money">{{ i.unitPrice | money }}</td>
                      @if (auth.isManager) {
                        <td class="right money muted">{{ i.purchasePriceAtSale | money }}</td>
                        <td class="right money" [class.neg]="i.profitPerUnit <= 0">{{ i.profitPerUnit | money }}</td>
                      }
                      <td class="right money">{{ i.total | money }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          @if (s.returns.length) {
            <div class="card">
              <div class="card-title">Returns</div>
              <div class="table-wrap">
                <table class="data">
                  <thead><tr><th>Date</th><th>Product</th><th class="right">Qty</th><th>Reason</th><th>Stock</th><th class="right">Value</th><th class="right">Refund</th></tr></thead>
                  <tbody>
                    @for (r of s.returns; track r.id) {
                      <tr>
                        <td>{{ r.returnDate | date: 'dd MMM, HH:mm' }}</td><td>{{ r.productName }}</td>
                        <td class="right num">{{ r.quantity }}</td><td>{{ r.reason }}</td>
                        <td>@if (r.stockAdjusted) { <span class="chip green">restocked</span> } @else { <span class="chip red">written off</span> }</td>
                        <td class="right money">{{ r.returnValue | money }}</td>
                        <td class="right money">{{ r.refundAmount ? (r.refundAmount | money) : '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }

          @if (s.payments.length) {
            <div class="card">
              <div class="card-title">Payments</div>
              <div class="table-wrap">
                <table class="data">
                  <thead><tr><th>Date</th><th>Mode</th><th>Note</th><th class="right">Amount</th></tr></thead>
                  <tbody>
                    @for (p of s.payments; track p.id) {
                      <tr>
                        <td>{{ p.paymentDate | date: 'dd MMM yyyy, HH:mm' }}</td>
                        <td>{{ p.direction === 'Refund' ? 'Refund' : (p.paymentMode | words) }}</td>
                        <td class="muted">{{ p.notes }}</td>
                        <td class="right money" [class.neg]="p.direction === 'Refund'">{{ p.direction === 'Refund' ? '-' : '' }}{{ p.amount | money }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </div>

        <aside class="grid side">
          <div class="card">
            <div class="card-title">Customer</div>
            <a class="cust" [routerLink]="['/customers', s.customerId]">{{ s.customerBusinessName || s.customerName }}</a>
            <div class="small muted">{{ s.customerBusinessName ? s.customerName : '' }} {{ s.customerPhone }}</div>
          </div>

          <div class="card">
            <div class="card-title">Money</div>
            <div class="kv">
              <span>Items</span><span class="money">{{ s.totalAmount | money }}</span>
              @if (s.discount) { <span>Discount</span><span class="money">-{{ s.discount | money }}</span> }
              @if (s.returnedAmount) { <span>Returned</span><span class="money">-{{ s.returnedAmount | money }}</span> }
              <span class="strong">Total</span><span class="money strong">{{ s.netAmount | money }}</span>
              <span>Paid</span><span class="money">{{ s.paidAmount | money }}</span>
              <span class="strong" [class.neg]="s.balance > 0">Due</span><span class="money strong" [class.neg]="s.balance > 0">{{ s.balance | money }}</span>
              @if (auth.isManager) { <span class="muted">Profit</span><span class="money muted">{{ s.profitAmount | money }}</span> }
            </div>
            @if (s.balance > 0 && auth.canSell) {
              <button mat-flat-button class="full" (click)="pay(s)" style="margin-top:12px">Receive payment</button>
            }
          </div>

          <div class="card" [class.alert]="s.pendingCrates > 0">
            <div class="card-title"><span class="material-symbols-outlined">inventory_2</span> Empty crates</div>
            @if (s.emptyCratesRequired === 0) { <p class="muted small" style="margin:0">No glass bottles on this sale.</p> }
            @else {
              <div class="crate-bar"><div [style.width.%]="100 * s.emptyCratesReturned / s.emptyCratesRequired"></div></div>
              <div class="kv">
                <span>Required</span><span class="num">{{ s.emptyCratesRequired }}</span>
                <span>Returned</span><span class="num">{{ s.emptyCratesReturned }}</span>
                <span class="strong">Pending</span><span class="num strong" [class.neg]="s.pendingCrates > 0">{{ s.pendingCrates }}</span>
              </div>
              @if (s.pendingCrates > 0 && auth.canSell) {
                <button mat-flat-button class="full red" (click)="crates(s)" style="margin-top:12px">Collect crates</button>
              }
            }
          </div>

          <div class="card">
            <div class="card-title">Settlement</div>
            @if (s.isSettled) {
              <p style="margin:0"><span class="chip green">Settled</span> {{ s.settledAt | date: 'dd MMM yyyy' }}</p>
              @if (s.settlementOverridden) { <p class="small muted">Closed by admin override: {{ s.settlementOverrideReason }}</p> }
            } @else {
              <ul class="blockers">@for (b of s.settlementBlockers; track b) { <li>{{ b }}</li> }</ul>
              <p class="small muted">The sale settles by itself once fully paid and every crate is back.</p>
              @if (auth.isAdmin && !s.offline) {
                <button mat-stroked-button class="full" (click)="override(s)">Admin override…</button>
              }
            }
          </div>

          @if (s.notes) { <div class="card"><div class="card-title">Note</div>{{ s.notes }}</div> }
        </aside>
      </div>
    } @else if (notFound()) {
      <div class="empty"><span class="material-symbols-outlined">receipt_long</span>This sale isn't available{{ net.online() ? '' : ' offline' }}.</div>
    } @else {
      <div class="skeleton" style="height:28px;width:240px"></div>
    }
  </div>
  `,
  styles: `
    .crumbs a { color: inherit; }
    h1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    .side .card.alert { border-color: color-mix(in srgb, var(--app-red) 45%, var(--app-border)); background: var(--app-red-soft); }
    .cust { font-weight: 700; font-size: 15px; color: var(--app-blue); text-decoration: none; }
    .kv { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; font-size: 13px; span:nth-child(even) { text-align: right; } }
    .strong { font-weight: 800; }
    .crate-bar { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--app-red) 20%, transparent); overflow: hidden; margin-bottom: 10px;
      div { height: 100%; background: var(--app-green); } }
    .blockers { margin: 0 0 8px; padding-left: 18px; color: var(--app-red); font-weight: 600; }
    .red { --mat-button-filled-container-color: var(--app-red); }
    @media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } }
  `,
})
export class SaleDetailPage {
  id = input.required<string>();
  private data = inject(DataService);
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  private router = inject(Router);
  auth = inject(AuthService);
  net = inject(ConnectivityService);

  sale = signal<Sale | null>(null);
  notFound = signal(false);

  ngOnInit() { void this.load(); }

  async load() {
    try {
      const s = await this.data.sale(this.id());
      this.sale.set(s ?? null);
      this.notFound.set(!s);
    } catch (e) {
      this.notify.error(e);
      this.notFound.set(true);
    }
  }

  async pay(s: Sale) {
    const ok = await firstValueFrom(this.dialog.open(PaymentDialog, {
      width: '480px',
      data: { customerId: s.customerId, customerName: s.customerName, saleId: s.id, invoiceNumber: s.invoiceNumber, due: s.balance },
    }).afterClosed());
    if (ok) await this.load();
  }

  async crates(s: Sale) {
    const c = await db.customers.get(s.customerId);
    const ok = await firstValueFrom(this.dialog.open(CrateDialog, {
      width: '440px',
      data: {
        customerId: s.customerId, customerName: s.customerName, saleId: s.id, invoiceNumber: s.invoiceNumber,
        pending: s.pendingCrates, customerOwes: Math.max(c?.emptyCrateBalance ?? s.pendingCrates, s.pendingCrates),
      },
    }).afterClosed());
    if (ok) await this.load();
  }

  async override(s: Sale) {
    const reason = await firstValueFrom(this.dialog.open(PromptDialog, {
      width: '460px',
      data: {
        title: 'Override settlement', label: 'Reason (kept in the audit log)', confirmText: 'Mark settled',
        message: `This closes ${s.invoiceNumber} even though:\n• ${s.settlementBlockers.join('\n• ')}\nThe customer's balance and crates still stay on their ledger.`,
      },
    }).afterClosed());
    if (!reason) return;
    try {
      this.sale.set(await this.api.post<Sale>(`/sales/${s.id}/settle`, { override: true, reason }));
      this.notify.success('Sale marked settled.');
    } catch (e) { this.notify.error(e); }
  }
}
