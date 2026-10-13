import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Paged, Product } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { SettingsService } from '../../core/settings.service';
import { ConnectivityService } from '../../offline/connectivity.service';
import { DataService } from '../../offline/data.service';
import { BrandPipe, CratesPipe, MoneyPipe } from '../../shared/pipes';
import { ProductDialog } from './product.dialog';
import { isNetworkError } from '../../core/util';

@Component({
  selector: 'app-products',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule, MatPaginatorModule, MoneyPipe, CratesPipe, BrandPipe],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Products</h1><div class="sub">Catalogue, prices and profit targets.</div></div>
      <div class="actions">
        @if (auth.isManager) { <button mat-flat-button (click)="edit(null)" [disabled]="!net.online()"><span class="material-symbols-outlined">add</span> New product</button> }
      </div>
    </div>
    <div class="filters">
      <mat-form-field class="grow"><mat-label>Search name, barcode or SKU</mat-label><input matInput [ngModel]="search()" (ngModelChange)="onSearch($event)" (keyup.enter)="searchNow()"></mat-form-field>
      <mat-slide-toggle [ngModel]="showInactive()" (ngModelChange)="showInactive.set($event); page.set(1); load()">Show inactive</mat-slide-toggle>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Product</th><th>Brand</th><th>Type</th><th class="right">Cost</th><th class="right">Selling</th><th class="right">Profit/pc</th>
          <th class="right">Min price</th><th class="right">Stock</th><th>Code</th></tr></thead>
        <tbody>
          @if (loading()) { @for (i of [1,2,3,4]; track i) { <tr><td colspan="9"><div class="skeleton"></div></td></tr> } }
          @for (p of rows(); track p.id) {
            <tr [class.clickable]="auth.isManager" (click)="auth.isManager && edit(p)" [class.inactive]="!p.isActive">
              <td><b>{{ p.name }}</b><div class="small muted">{{ p.category }}{{ p.packSize ? ' · ' + p.packSize : '' }}</div></td>
              <td>{{ p.brand | brand }}</td>
              <td>{{ p.unitType }} @if (p.isCrateRequired) { <span class="chip red">crate</span> }</td>
              <td class="right money">{{ p.purchasePrice | money }}</td>
              <td class="right money">{{ p.sellingPrice | money }}</td>
              <td class="right money" [class.neg]="p.sellingPrice < p.minSellingPrice">{{ p.sellingPrice - p.purchasePrice | money }}</td>
              <td class="right money muted">{{ p.minSellingPrice | money }}</td>
              <td class="right" [class.neg]="p.stockQuantity <= p.lowStockThreshold">{{ p.stockQuantity | crates: p.bottlesPerCrate }}</td>
              <td class="small muted">{{ p.barcode || p.sku }}</td>
            </tr>
          }
          @if (!loading() && rows().length === 0) {
            <tr><td colspan="9"><div class="empty">No products found.</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <mat-paginator [length]="total()" [pageSize]="pageSize" [pageIndex]="page() - 1"
      [pageSizeOptions]="[25, 50, 100]" [disabled]="loading()" (page)="onPage($event)" />
    <p class="small muted">Profit target is {{ basis() }}. Salesmen cannot sell below the min price; Managers can.</p>
  </div>
  `,
  styles: `tr.inactive td { opacity: .5; }`,
})
export class ProductsPage {
  private api = inject(ApiService);
  private data = inject(DataService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  auth = inject(AuthService);
  net = inject(ConnectivityService);

  all = signal<Product[]>([]);
  loading = signal(true);
  search = signal('');
  showInactive = signal(false);
  total = signal(0);
  page = signal(1);
  pageSize = 25;
  private requestId = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private settings = inject(SettingsService);
  basis = computed(() => this.settings.profitPerCrate() ? 'per full crate / pack' : 'per piece');

  rows = computed(() => this.all());

  ngOnInit() { void this.load(); }

  async load() {
    const requestId = ++this.requestId;
    this.loading.set(true);
    try {
      if (this.net.online()) {
        const res = await this.api.get<Paged<Product>>('/products/paged', {
          search: this.search(), includeInactive: this.showInactive(), page: this.page(), pageSize: this.pageSize,
        });
        if (requestId === this.requestId) {
          this.all.set(res.items);
          this.total.set(res.total);
        }
      } else {
        const q = this.search().toLowerCase();
        const products = (await this.data.products(this.showInactive())).filter(p =>
          !q || p.name.toLowerCase().includes(q) || p.barcode === q || (p.sku ?? '').toLowerCase().includes(q));
        if (requestId === this.requestId) {
          this.total.set(products.length);
          this.all.set(products.slice((this.page() - 1) * this.pageSize, this.page() * this.pageSize));
        }
      }
    }
    catch (e) {
      if (isNetworkError(e)) {
        try {
          const q = this.search().toLowerCase();
          const products = (await this.data.products(this.showInactive())).filter(p =>
            !q || p.name.toLowerCase().includes(q) || p.barcode === q || (p.sku ?? '').toLowerCase().includes(q));
          if (requestId === this.requestId) {
            this.total.set(products.length);
            this.all.set(products.slice((this.page() - 1) * this.pageSize, this.page() * this.pageSize));
          }
        } catch (cacheError) { if (requestId === this.requestId) this.notify.error(cacheError); }
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

  async edit(p: Product | null) {
    if (!this.net.online()) { this.notify.info('Editing products needs the server.'); return; }
    const res = await firstValueFrom(this.dialog.open(ProductDialog, { width: '680px', data: p }).afterClosed());
    if (res) await this.load();
  }
}
