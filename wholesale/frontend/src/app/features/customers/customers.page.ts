import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Customer } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { isNetworkError } from '../../core/util';
import { ConnectivityService } from '../../offline/connectivity.service';
import { DataService } from '../../offline/data.service';
import { MoneyPipe } from '../../shared/pipes';
import { CustomerDialog } from './customer.dialog';

@Component({
  selector: 'app-customers',
  imports: [FormsModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatInputModule, MatPaginatorModule, MoneyPipe],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Customers</h1><div class="sub">Shops, restaurants and retailers you supply.</div></div>
      <div class="actions">@if (auth.canSell) { <button mat-flat-button (click)="add()"><span class="material-symbols-outlined">person_add</span> New customer</button> }</div>
    </div>

    <div class="stats">
      <div class="stat"><div class="label">Customers</div><div class="value">{{ customerCount() }}</div></div>
      <div class="stat" [class.alert]="totalDue() > 0"><div class="label">Money owed to you</div><div class="value">{{ totalDue() | money }}</div></div>
      <div class="stat" [class.alert]="totalCrates() > 0"><div class="label">Empty crates out</div><div class="value">{{ totalCrates() }}</div></div>
    </div>

    <div class="filters">
      <mat-button-toggle-group [value]="filter()" (change)="filter.set($event.value); page.set(1); load()" hideSingleSelectionIndicator>
        <mat-button-toggle value="all">All</mat-button-toggle>
        <mat-button-toggle value="money">Owe money</mat-button-toggle>
        <mat-button-toggle value="crates">Owe crates</mat-button-toggle>
      </mat-button-toggle-group>
      <mat-form-field class="grow">
        <mat-label>Search name, shop or phone</mat-label>
        <input matInput [ngModel]="search()" (ngModelChange)="onSearch($event)" (keyup.enter)="searchNow()">
      </mat-form-field>
    </div>

    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Shop / name</th><th>Phone</th><th>Type</th><th class="right">Balance</th><th class="right">Crates owed</th></tr></thead>
        <tbody>
          @if (loading()) { @for (i of [1,2,3,4]; track i) { <tr><td colspan="5"><div class="skeleton"></div></td></tr> } }
          @for (c of rows(); track c.id) {
            <tr class="clickable" (click)="open(c)">
              <td><b>{{ c.businessName || c.name }}</b>@if (c.businessName) { <div class="small muted">{{ c.name }}</div> }</td>
              <td>{{ c.phone }}</td>
              <td>{{ c.customerType }}</td>
              <td class="right money" [class.neg]="c.outstandingBalance > 0" [class.pos]="c.outstandingBalance < 0">
                {{ c.outstandingBalance < 0 ? 'Advance ' : '' }}{{ (c.outstandingBalance < 0 ? -c.outstandingBalance : c.outstandingBalance) | money }}</td>
              <td class="right num">@if (c.emptyCrateBalance > 0) { <span class="chip red">{{ c.emptyCrateBalance }}</span> } @else { — }</td>
            </tr>
          }
          @if (!loading() && rows().length === 0) { <tr><td colspan="5"><div class="empty"><span class="material-symbols-outlined">storefront</span>No customers found.</div></td></tr> }
        </tbody>
      </table>
    </div>
    <mat-paginator [length]="filteredTotal()" [pageSize]="pageSize" [pageIndex]="page() - 1"
      [pageSizeOptions]="[25, 50, 100]" [disabled]="loading()" (page)="onPage($event)" />
  </div>
  `,
})
export class CustomersPage {
  private api = inject(ApiService);
  private data = inject(DataService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private notify = inject(NotifyService);
  net = inject(ConnectivityService);
  auth = inject(AuthService);

  all = signal<Customer[]>([]);
  loading = signal(true);
  search = signal('');
  filter = signal<'all' | 'money' | 'crates'>('all');
  customerCount = signal(0);
  filteredTotal = signal(0);
  fromCache = signal(false);
  totalDue = signal(0);
  totalCrates = signal(0);
  page = signal(1);
  pageSize = 25;
  private requestId = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  rows = computed(() => {
    const q = this.search().toLowerCase();
    const filtered = this.all().filter(c =>
      (this.filter() !== 'money' || c.outstandingBalance > 0) &&
      (this.filter() !== 'crates' || c.emptyCrateBalance > 0) &&
      (!q || c.name.toLowerCase().includes(q) || (c.businessName ?? '').toLowerCase().includes(q) || (c.phone ?? '').includes(q)));
    return this.fromCache() ? filtered.slice((this.page() - 1) * this.pageSize, this.page() * this.pageSize) : filtered;
  });

  ngOnInit() { void this.load(); }

  async load() {
    const requestId = ++this.requestId;
    this.loading.set(true);
    try {
      if (this.net.online()) {
        const res = await this.api.get<{
          items: Customer[];
          total: number;
          customerCount: number;
          totalDue: number;
          totalCrates: number;
        }>('/customers/paged', {
          search: this.search(),
          filter: this.filter() === 'money' ? 'outstanding' : this.filter() === 'crates' ? 'crates' : undefined,
          page: this.page(),
          pageSize: this.pageSize,
        });
        if (requestId === this.requestId) {
          this.all.set(res.items);
          this.filteredTotal.set(res.total);
          this.customerCount.set(res.customerCount);
          this.totalDue.set(res.totalDue);
          this.totalCrates.set(res.totalCrates);
          this.fromCache.set(false);
        }
      } else {
        const customers = await this.data.customers();
        const q = this.search().toLowerCase();
        const filtered = customers.filter(c =>
          (this.filter() !== 'money' || c.outstandingBalance > 0) &&
          (this.filter() !== 'crates' || c.emptyCrateBalance > 0) &&
          (!q || c.name.toLowerCase().includes(q) || (c.businessName ?? '').toLowerCase().includes(q) || (c.phone ?? '').includes(q)));
        if (requestId === this.requestId) {
          this.all.set(customers);
          this.filteredTotal.set(filtered.length);
          this.customerCount.set(customers.length);
          this.totalDue.set(customers.reduce((s, c) => s + Math.max(0, c.outstandingBalance), 0));
          this.totalCrates.set(customers.reduce((s, c) => s + Math.max(0, c.emptyCrateBalance), 0));
          this.fromCache.set(true);
        }
      }
    } catch (e) {
      if (requestId === this.requestId && isNetworkError(e)) {
        try {
          const customers = await this.data.customers();
          const q = this.search().toLowerCase();
          const filtered = customers.filter(c =>
            (this.filter() !== 'money' || c.outstandingBalance > 0) &&
            (this.filter() !== 'crates' || c.emptyCrateBalance > 0) &&
            (!q || c.name.toLowerCase().includes(q) || (c.businessName ?? '').toLowerCase().includes(q) || (c.phone ?? '').includes(q)));
          if (requestId === this.requestId) {
            this.all.set(customers);
            this.filteredTotal.set(filtered.length);
            this.customerCount.set(customers.length);
            this.totalDue.set(customers.reduce((s, c) => s + Math.max(0, c.outstandingBalance), 0));
            this.totalCrates.set(customers.reduce((s, c) => s + Math.max(0, c.emptyCrateBalance), 0));
            this.fromCache.set(true);
          }
        } catch (cacheError) { this.notify.error(cacheError); }
      } else if (requestId === this.requestId) this.notify.error(e);
    }
    finally { if (requestId === this.requestId) this.loading.set(false); }
  }

  onSearch(value: string) {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      void this.load();
    }, 250);
  }

  onPage(e: PageEvent) {
    this.pageSize = e.pageSize;
    this.page.set(e.pageIndex + 1);
    void this.load();
  }

  searchNow() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.page.set(1);
    void this.load();
  }

  async add() {
    const c = await firstValueFrom(this.dialog.open(CustomerDialog, { width: '560px', data: null }).afterClosed());
    if (c) { this.page.set(1); await this.load(); }
  }

  open(c: Customer) { void this.router.navigate(['/customers', c.id]); }
}
