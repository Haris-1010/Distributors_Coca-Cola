import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { Product } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { SettingsService } from '../../core/settings.service';
import { ConnectivityService } from '../../offline/connectivity.service';
import { DataService } from '../../offline/data.service';
import { BrandPipe, CratesPipe, MoneyPipe } from '../../shared/pipes';
import { ProductDialog } from './product.dialog';

@Component({
  selector: 'app-products',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule, MoneyPipe, CratesPipe, BrandPipe],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Products</h1><div class="sub">Catalogue, prices and profit targets.</div></div>
      <div class="actions">
        @if (auth.isManager) { <button mat-flat-button (click)="edit(null)" [disabled]="!net.online()"><span class="material-symbols-outlined">add</span> New product</button> }
      </div>
    </div>
    <div class="filters">
      <mat-form-field class="grow"><mat-label>Search name, barcode or SKU</mat-label><input matInput [ngModel]="search()" (ngModelChange)="search.set($event)"></mat-form-field>
      <mat-slide-toggle [ngModel]="showInactive()" (ngModelChange)="showInactive.set($event); load()">Show inactive</mat-slide-toggle>
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
        </tbody>
      </table>
    </div>
    <p class="small muted">Profit target is {{ basis() }}. Salesmen cannot sell below the min price; Managers can.</p>
  </div>
  `,
  styles: `tr.inactive td { opacity: .5; }`,
})
export class ProductsPage {
  private data = inject(DataService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  auth = inject(AuthService);
  net = inject(ConnectivityService);

  all = signal<Product[]>([]);
  loading = signal(true);
  search = signal('');
  showInactive = signal(false);
  private settings = inject(SettingsService);
  basis = computed(() => this.settings.profitPerCrate() ? 'per full crate / pack' : 'per piece');

  rows = computed(() => {
    const q = this.search().toLowerCase();
    return this.all().filter(p => !q || p.name.toLowerCase().includes(q) || p.barcode === q || (p.sku ?? '').toLowerCase().includes(q));
  });

  ngOnInit() { void this.load(); }

  async load() {
    this.loading.set(true);
    try { this.all.set(await this.data.products(this.showInactive())); }
    catch (e) { this.notify.error(e); }
    finally { this.loading.set(false); }
  }

  async edit(p: Product | null) {
    if (!this.net.online()) { this.notify.info('Editing products needs the server.'); return; }
    const res = await firstValueFrom(this.dialog.open(ProductDialog, { width: '680px', data: p }).afterClosed());
    if (res) await this.load();
  }
}
