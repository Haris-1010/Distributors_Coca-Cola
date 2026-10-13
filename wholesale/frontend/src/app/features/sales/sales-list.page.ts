import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { SaleListItem } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { addDays, dayStartUtc } from '../../core/util';
import { DataService } from '../../offline/data.service';
import { DateRangeComponent, Range } from '../../shared/date-range';
import { MoneyPipe } from '../../shared/pipes';

@Component({
  selector: 'app-sales-list',
  imports: [FormsModule, RouterLink, DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatPaginatorModule, DateRangeComponent, MoneyPipe],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Sales</h1><div class="sub">Invoices, what's still owed, and crates still out.</div></div>
      <div class="actions">@if (auth.canSell) { <a mat-flat-button routerLink="/pos"><span class="material-symbols-outlined">add</span> New sale</a> }</div>
    </div>

    <div class="filters">
      <app-date-range (changed)="range.set($event); page.set(1); load()" />
      <mat-form-field>
        <mat-label>Status</mat-label>
        <mat-select [ngModel]="status()" (ngModelChange)="status.set($event); page.set(1); load()">
          <mat-option value="">All</mat-option>
          <mat-option value="open">Open (not settled)</mat-option>
          <mat-option value="unpaid">Money due</mat-option>
          <mat-option value="pending-crates">Crates pending</mat-option>
          <mat-option value="settled">Settled</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field class="grow">
        <mat-label>Search invoice or customer</mat-label>
        <input matInput [ngModel]="search()" (ngModelChange)="search.set($event)" (keyup.enter)="page.set(1); load()">
      </mat-form-field>
    </div>

    @if (fromCache()) { <p class="chip amber" style="margin-bottom:10px">Offline — showing sales saved on this device</p> }

    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>Invoice</th><th>Date</th><th>Customer</th><th class="right">Total</th><th class="right">Due</th>
          @if (auth.isManager) { <th class="right">Profit</th> }
          <th class="right">Crates</th><th>Status</th>
        </tr></thead>
        <tbody>
          @if (loading()) {
            @for (i of [1,2,3,4,5]; track i) { <tr><td colspan="8"><div class="skeleton"></div></td></tr> }
          }
          @for (s of rows(); track s.id) {
            <tr class="clickable" (click)="open(s)">
              <td class="num">{{ s.invoiceNumber }} @if (s.offline) { <span class="chip amber">offline</span> }</td>
              <td>{{ s.saleDate | date: 'dd MMM, HH:mm' }}</td>
              <td>{{ s.customerName }}</td>
              <td class="right money">{{ s.netAmount | money }}</td>
              <td class="right money" [class.neg]="s.balance > 0">{{ s.balance > 0 ? (s.balance | money) : '—' }}</td>
              @if (auth.isManager) { <td class="right money">{{ s.profitAmount | money }}</td> }
              <td class="right num" [class.neg]="s.pendingCrates > 0">
                {{ s.emptyCratesRequired ? s.emptyCratesReturned + ' / ' + s.emptyCratesRequired : '—' }}
              </td>
              <td>
                @if (s.isSettled) { <span class="chip green">Settled</span> }
                @else {
                  @if (s.balance > 0) { <span class="chip red">Payment due</span> }
                  @if (s.pendingCrates > 0) { <span class="chip red">{{ s.pendingCrates }} crates out</span> }
                }
              </td>
            </tr>
          }
          @if (!loading() && rows().length === 0) {
            <tr><td colspan="8"><div class="empty"><span class="material-symbols-outlined">receipt_long</span>No sales in this range.</div></td></tr>
          }
        </tbody>
        @if (rows().length) {
          <tfoot><tr>
            <td colspan="3">Page total</td>
            <td class="right money">{{ totals().net | money }}</td>
            <td class="right money">{{ totals().due | money }}</td>
            @if (auth.isManager) { <td class="right money">{{ totals().profit | money }}</td> }
            <td class="right num">{{ totals().crates }}</td><td></td>
          </tr></tfoot>
        }
      </table>
    </div>
    @if (!fromCache()) {
      <mat-paginator [length]="total()" [pageSize]="pageSize" [pageIndex]="page() - 1" [pageSizeOptions]="[25, 50, 100]" (page)="onPage($event)" />
    }
  </div>
  `,
})
export class SalesListPage {
  private data = inject(DataService);
  private notify = inject(NotifyService);
  private router = inject(Router);
  auth = inject(AuthService);

  range = signal<Range | null>(null);
  status = signal('');
  search = signal('');
  page = signal(1);
  pageSize = 25;
  rows = signal<SaleListItem[]>([]);
  total = signal(0);
  loading = signal(false);
  fromCache = signal(false);

  totals = computed(() => this.rows().reduce((t, s) => ({
    net: t.net + s.netAmount, due: t.due + Math.max(0, s.balance), profit: t.profit + s.profitAmount, crates: t.crates + s.pendingCrates,
  }), { net: 0, due: 0, profit: 0, crates: 0 }));

  async load() {
    const r = this.range();
    if (!r) return;
    this.loading.set(true);
    try {
      const res = await this.data.sales({
        from: dayStartUtc(r.from), to: dayStartUtc(addDays(new Date(r.to + 'T00:00:00'), 1)),
        status: this.status() || undefined, search: this.search() || undefined, page: this.page(), pageSize: this.pageSize,
      });
      this.rows.set(res.items);
      this.total.set(res.total);
      this.fromCache.set(res.fromCache);
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  onPage(e: PageEvent) {
    this.pageSize = e.pageSize;
    this.page.set(e.pageIndex + 1);
    void this.load();
  }

  open(s: SaleListItem) { void this.router.navigate(['/sales', s.id]); }
}
