import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { BRANDS, Product, UNIT_TYPES } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { SettingsService } from '../../core/settings.service';
import { round2 } from '../../core/util';
import { MoneyPipe } from '../../shared/pipes';
import { map } from 'rxjs';

@Component({
  selector: 'app-product-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, MatButtonModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>{{ p ? 'Edit product' : 'New product' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" id="productForm" (ngSubmit)="save()" class="form-grid">
        <mat-form-field class="span-2"><mat-label>Name</mat-label><input matInput formControlName="name" placeholder="e.g. Pepsi 250ml Glass"></mat-form-field>
        <mat-form-field><mat-label>Brand</mat-label>
          <mat-select formControlName="brand">@for (b of brands; track b.value) { <mat-option [value]="b.value">{{ b.label }}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field><mat-label>Category</mat-label><input matInput formControlName="category"></mat-form-field>
        <mat-form-field><mat-label>Unit type</mat-label>
          <mat-select formControlName="unitType">@for (u of units; track u) { <mat-option [value]="u">{{ u }}</mat-option> }</mat-select></mat-form-field>
        <mat-form-field><mat-label>Pieces per crate / pack</mat-label><input matInput type="number" formControlName="bottlesPerCrate"></mat-form-field>
        <mat-slide-toggle formControlName="isCrateRequired" class="span-2 toggle">Empty crate must be returned (glass bottles)</mat-slide-toggle>
        <mat-form-field><mat-label>Pack description</mat-label><input matInput formControlName="packSize" placeholder="24 bottles / crate"></mat-form-field>
        <mat-form-field><mat-label>Low stock alert at (pieces)</mat-label><input matInput type="number" formControlName="lowStockThreshold"></mat-form-field>

        <div class="span-2 section">Pricing (per piece)</div>
        <mat-form-field><mat-label>Purchase price</mat-label><input matInput type="number" formControlName="purchasePrice"></mat-form-field>
        <mat-form-field><mat-label>Selling price</mat-label><input matInput type="number" formControlName="sellingPrice">
          <button mat-button matSuffix type="button" (click)="suggest()">Suggest</button></mat-form-field>
        <mat-form-field><mat-label>Min profit {{ perCrate() ? '(per crate)' : '(per piece)' }}</mat-label><input matInput type="number" formControlName="minProfit"></mat-form-field>
        <mat-form-field><mat-label>Max profit {{ perCrate() ? '(per crate)' : '(per piece)' }}</mat-label><input matInput type="number" formControlName="maxProfit"></mat-form-field>
        <div class="span-2 preview" [class.bad]="profit() < minPerPiece()">
          Profit per piece <b class="money">{{ profit() | money }}</b> · per {{ v().bottlesPerCrate }} <b class="money">{{ profit() * (v().bottlesPerCrate || 1) | money }}</b>
          · lowest allowed price <b class="money">{{ v().purchasePrice + minPerPiece() | money }}</b>
        </div>

        <div class="span-2 section">Codes</div>
        <mat-form-field><mat-label>Barcode</mat-label><input matInput formControlName="barcode"></mat-form-field>
        <mat-form-field><mat-label>SKU</mat-label><input matInput formControlName="sku"></mat-form-field>
        <mat-slide-toggle formControlName="isActive" class="toggle">Active (shown on the sale screen)</mat-slide-toggle>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions>
      @if (p && auth.isAdmin) { <button mat-button class="danger" type="button" (click)="remove()">Delete</button> }
      <span class="spacer"></span>
      <button mat-button mat-dialog-close type="button">Cancel</button>
      <button mat-flat-button form="productForm" [disabled]="form.invalid || busy()">Save</button>
    </mat-dialog-actions>
  `,
  styles: `
    .section { font-weight: 700; margin: 8px 0 4px; color: var(--app-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
    .toggle { margin: 4px 0 12px; }
    .preview { background: var(--app-green-soft); padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; font-size: 13px;
      &.bad { background: var(--app-red-soft); color: var(--app-red); } }
    .danger { color: var(--app-red); }
  `,
})
export class ProductDialog {
  p = inject<Product | null>(MAT_DIALOG_DATA, { optional: true });
  private ref = inject(MatDialogRef<ProductDialog, boolean>);
  private api = inject(ApiService);
  private notify = inject(NotifyService);
  private settings = inject(SettingsService);
  auth = inject(AuthService);
  private fb = inject(FormBuilder);
  brands = BRANDS;
  units = UNIT_TYPES;
  busy = signal(false);
  perCrate = this.settings.profitPerCrate;

  form = this.fb.nonNullable.group({
    name: [this.p?.name ?? '', [Validators.required, Validators.maxLength(150)]],
    brand: [this.p?.brand ?? 'Pepsi'],
    category: [this.p?.category ?? 'Soft Drink', Validators.required],
    unitType: [this.p?.unitType ?? 'Glass'],
    packSize: [this.p?.packSize ?? '24 bottles / crate'],
    isCrateRequired: [this.p?.isCrateRequired ?? true],
    bottlesPerCrate: [this.p?.bottlesPerCrate ?? Number(this.settings.get('BottlesPerCrate', '24')), [Validators.required, Validators.min(1)]],
    purchasePrice: [this.p?.purchasePrice ?? 0, [Validators.required, Validators.min(0)]],
    sellingPrice: [this.p?.sellingPrice ?? 0, [Validators.required, Validators.min(0)]],
    minProfit: [this.p?.minProfit ?? Number(this.settings.get('DefaultMinProfit', '50')), [Validators.min(0)]],
    maxProfit: [this.p?.maxProfit ?? Number(this.settings.get('DefaultMaxProfit', '60')), [Validators.min(0)]],
    barcode: [this.p?.barcode ?? ''],
    sku: [this.p?.sku ?? ''],
    lowStockThreshold: [this.p?.lowStockThreshold ?? 48, Validators.min(0)],
    isActive: [this.p?.isActive ?? true],
  });

  v = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())), { initialValue: this.form.getRawValue() });
  private per = (x: number) => this.perCrate() && (this.v().bottlesPerCrate ?? 0) > 0 ? round2(x / this.v().bottlesPerCrate) : x;
  minPerPiece = computed(() => this.per(Number(this.v().minProfit) || 0));
  profit = computed(() => round2((Number(this.v().sellingPrice) || 0) - (Number(this.v().purchasePrice) || 0)));

  constructor() {
    // Glass bottles need crates back by default.
    this.form.controls.unitType.valueChanges.subscribe(u => { if (!this.p) this.form.controls.isCrateRequired.setValue(u === 'Glass'); });
  }

  suggest() {
    const v = this.form.getRawValue();
    const target = this.per(Number(v.maxProfit) || 0);
    this.form.controls.sellingPrice.setValue(round2(Number(v.purchasePrice) + target));
  }

  async save() {
    this.busy.set(true);
    try {
      const body = this.form.getRawValue();
      if (this.p) await this.api.put(`/products/${this.p.id}`, body);
      else await this.api.post('/products', body);
      this.notify.success('Product saved.');
      this.ref.close(true);
    } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }

  async remove() {
    if (!this.p || !(await this.notify.confirm({ title: `Delete ${this.p.name}?`, message: 'Only possible when it has no stock left. Marking it inactive is usually better.', confirmText: 'Delete', danger: true }))) return;
    try {
      await this.api.delete(`/products/${this.p.id}`);
      this.notify.success('Product deleted.');
      this.ref.close(true);
    } catch (e) { this.notify.error(e); }
  }
}
