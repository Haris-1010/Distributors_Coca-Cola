import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Paged, Purchase } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { addDays, dayStartUtc } from '../../core/util';
import { ConnectivityService } from '../../offline/connectivity.service';
import { db } from '../../offline/db';
import { DateRangeComponent, Range } from '../../shared/date-range';
import { MoneyPipe } from '../../shared/pipes';

@Component({
  selector: 'app-purchases',
  imports: [DatePipe, RouterLink, MatButtonModule, MatPaginatorModule, DateRangeComponent, MoneyPipe],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Purchases</h1><div class="sub">Stock received from the Pepsi and Coca-Cola distributors.</div></div>
      <div class="actions">@if (auth.isManager) { <a mat-flat-button routerLink="/purchases/new"><span class="material-symbols-outlined">add</span> Receive stock</a> }</div>
    </div>
    <div class="filters"><app-date-range (changed)="range.set($event); page.set(1); load()" /></div>

    @if (offline().length) {
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">Waiting to sync</div>
        @for (p of offline(); track p.id) { <div>{{ p.invoiceNumber }} · {{ p.distributorName }} · <span class="money">{{ p.totalAmount | money }}</span></div> }
      </div>
    }

    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Invoice</th><th>Date</th><th>Distributor</th><th class="right">Items</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Due</th><th>Status</th></tr></thead>
        <tbody>
          @if (loading()) {
            @for (i of [1,2,3,4,5]; track i) { <tr><td colspan="8"><div class="skeleton"></div></td></tr> }
          }
          @for (p of rows(); track p.id) {
            <tr class="clickable" (click)="router.navigate(['/purchases', p.id])">
              <td class="num">{{ p.invoiceNumber }}</td><td>{{ p.purchaseDate | date: 'dd MMM yyyy' }}</td><td>{{ p.distributorName }}</td>
              <td class="right num">{{ p.itemCount }}</td>
              <td class="right money">{{ p.totalAmount | money }}</td>
              <td class="right money">{{ p.paidAmount | money }}</td>
              <td class="right money" [class.neg]="p.balance > 0">{{ p.balance | money }}</td>
              <td><span class="chip" [class.green]="p.paymentStatus === 'Paid'" [class.red]="p.paymentStatus === 'Unpaid'" [class.amber]="p.paymentStatus === 'Partial'">{{ p.paymentStatus }}</span></td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="8"><div class="empty">{{ net.online() ? 'No purchases in this range.' : 'Purchase history needs the server.' }}</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
    @if (net.online()) {
      <mat-paginator [length]="total()" [pageSize]="pageSize" [pageIndex]="page() - 1"
        [pageSizeOptions]="[25, 50, 100]" [disabled]="loading()" (page)="onPage($event)" />
    }
  </div>
  `,
})
export class PurchasesPage {
  private api = inject(ApiService);
  private notify = inject(NotifyService);
  router = inject(Router);
  auth = inject(AuthService);
  net = inject(ConnectivityService);
  range = signal<Range | null>(null);
  rows = signal<Purchase[]>([]);
  total = signal(0);
  page = signal(1);
  pageSize = 25;
  loading = signal(false);
  offline = signal<Purchase[]>([]);
  private requestId = 0;

  async load() {
    const requestId = ++this.requestId;
    this.loading.set(true);
    try { this.offline.set(await db.purchases.toArray()); } catch (e) { this.notify.error(e); }
    const r = this.range();
    if (!r || !this.net.online()) {
      this.rows.set([]);
      this.total.set(0);
      this.loading.set(false);
      return;
    }
    try {
      const res = await this.api.get<Paged<Purchase>>('/purchases', {
        from: dayStartUtc(r.from), to: dayStartUtc(addDays(new Date(r.to + 'T00:00:00'), 1)),
        page: this.page(), pageSize: this.pageSize,
      });
      if (requestId === this.requestId) {
        this.rows.set(res.items);
        this.total.set(res.total);
      }
    } catch (e) { if (requestId === this.requestId) this.notify.error(e); }
    finally { if (requestId === this.requestId) this.loading.set(false); }
  }

  onPage(e: PageEvent) {
    this.pageSize = e.pageSize;
    this.page.set(e.pageIndex + 1);
    void this.load();
  }
}
