import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { Product, Purchase, UpdatePurchaseRequest } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { isoDate, round2, uuid } from '../../core/util';
import { ConnectivityService } from '../../offline/connectivity.service';
import { DataService } from '../../offline/data.service';
import { DateInputComponent } from '../../shared/date-input';
import { MoneyPipe } from '../../shared/pipes';

interface Line { key: string; itemId?: string; product: Product | null; crates: number; pieces: number; unitPrice: number; batchNumber: string; expiryDate: string; }

const DISTRIBUTORS = ['Pepsi Official Distributor', 'Coca-Cola Official Distributor'];

@Component({
  selector: 'app-purchase-new',
  imports: [FormsModule, RouterLink, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatAutocompleteModule, DateInputComponent, MoneyPipe],
  template: `
  <div class="page">
    <div class="page-head">
      <div><div class="small muted"><a routerLink="/purchases" class="crumb">Purchases</a> /</div><h1>{{ editMode() ? 'Edit purchase' : 'Receive stock' }}</h1>
        <div class="sub">{{ editMode() ? 'Correct the received invoice and its stock batches.' : 'Enter the distributor\\'s bill. Stock goes up as soon as you save' + (net.online() ? '' : ' (offline — it will sync later)') }}.</div></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="form-grid">
        <mat-form-field>
          <mat-label>Distributor</mat-label>
          <input matInput [(ngModel)]="distributor" [matAutocomplete]="dist">
          <mat-autocomplete #dist="matAutocomplete">@for (d of distributors; track d) { <mat-option [value]="d">{{ d }}</mat-option> }</mat-autocomplete>
        </mat-form-field>
        <mat-form-field><mat-label>Distributor bill no. (optional)</mat-label><input matInput [(ngModel)]="invoiceNumber"></mat-form-field>
        <app-date-input label="Date" [(ngModel)]="date" />
        <mat-form-field><mat-label>Note</mat-label><input matInput [(ngModel)]="notes"></mat-form-field>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data">
        <thead><tr><th style="min-width:220px">Product</th><th class="right">Crates/packs</th><th class="right">+ Pieces</th><th class="right">Total pcs</th>
          <th class="right">Cost / pc</th><th>Batch</th><th>Expiry</th><th class="right">Amount</th><th></th></tr></thead>
        <tbody>
          @for (l of lines(); track l.key) {
            <tr>
              <td>
                <select class="in wide" [ngModel]="l.product?.id ?? ''" (ngModelChange)="setProduct(l, $event)" aria-label="Product">
                  <option value="" disabled>Choose product…</option>
                  @for (p of products(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
                </select>
              </td>
              <td class="right"><input class="in" type="number" min="0" [ngModel]="l.crates" (ngModelChange)="l.crates = +$event || 0; touch()" aria-label="Crates"></td>
              <td class="right"><input class="in" type="number" min="0" [ngModel]="l.pieces" (ngModelChange)="l.pieces = +$event || 0; touch()" aria-label="Loose pieces"></td>
              <td class="right num">{{ qty(l) }}</td>
              <td class="right"><input class="in" type="number" min="0" step="0.01" [ngModel]="l.unitPrice" (ngModelChange)="l.unitPrice = +$event || 0; touch()" aria-label="Cost per piece"></td>
              <td><input class="in mid" [ngModel]="l.batchNumber" (ngModelChange)="l.batchNumber = $event" aria-label="Batch number"></td>
              <td><app-date-input [compact]="true" [ngModel]="l.expiryDate" (ngModelChange)="l.expiryDate = $event" ariaLabel="Expiry date" /></td>
              <td class="right money">{{ qty(l) * l.unitPrice | money }}</td>
              <td><button mat-icon-button (click)="remove(l)" aria-label="Remove"><span class="material-symbols-outlined">delete</span></button></td>
            </tr>
          }
        </tbody>
        <tfoot><tr><td colspan="3"><button mat-button (click)="addLine()"><span class="material-symbols-outlined">add</span> Add product</button></td>
          <td class="right num">{{ totalPieces() }}</td><td colspan="3"></td><td class="right money">{{ total() | money }}</td><td></td></tr></tfoot>
      </table>
    </div>

    <div class="card pay">
      <mat-form-field><mat-label>{{ editMode() ? 'Already paid' : 'Paid to distributor now' }}</mat-label><input matInput type="number" min="0" [ngModel]="paid()" (ngModelChange)="paid.set(+$event || 0)" [disabled]="editMode()"></mat-form-field>
      @if (!editMode()) { <button mat-button (click)="paid.set(total())">Paid in full</button> }
      <span class="spacer"></span>
      <div>Due to distributor: <b class="money" [class.neg]="total() - paid() > 0">{{ total() - paid() | money }}</b></div>
      @if (editMode()) {
        <div class="small muted">Recorded payments stay unchanged ({{ paid() | money }} paid).</div>
      }
      <button mat-flat-button [disabled]="!valid() || busy() || (editMode() && !net.online())" (click)="save()">{{ editMode() ? 'Save changes' : 'Save purchase' }}</button>
    </div>
  </div>
  `,
  styles: `
    .crumb { color: inherit; }
    .in { height: 32px; width: 80px; border: 1px solid var(--app-border); border-radius: 6px; padding: 0 6px; font: inherit; text-align: right;
      background: var(--app-surface); color: var(--app-ink); &.wide { width: 100%; text-align: left; } &.mid { width: 130px; text-align: left; } }
    .pay { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
  `,
})
export class PurchaseNewPage {
  private api = inject(ApiService);
  private data = inject(DataService);
  private notify = inject(NotifyService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  net = inject(ConnectivityService);

  distributors = DISTRIBUTORS;
  distributor = DISTRIBUTORS[0];
  invoiceNumber = '';
  date = isoDate();
  notes = '';
  products = signal<Product[]>([]);
  lines = signal<Line[]>([]);
  paid = signal(0);
  busy = signal(false);
  editMode = signal(false);
  purchaseId = '';

  total = computed(() => round2(this.lines().reduce((s, l) => s + this.qty(l) * l.unitPrice, 0)));
  totalPieces = computed(() => this.lines().reduce((s, l) => s + this.qty(l), 0));
  valid = computed(() => !!this.distributor && this.lines().length > 0 && this.lines().every(l => l.product && this.qty(l) > 0 && l.unitPrice >= 0) && this.paid() <= this.total());

  async ngOnInit() {
    this.products.set(await this.data.products(true).catch(e => { this.notify.error(e); return []; }));
    this.purchaseId = this.route.snapshot.paramMap.get('id') ?? '';
    if (this.purchaseId) {
      this.editMode.set(true);
      try {
        const purchase = await this.api.get<Purchase>(`/purchases/${this.purchaseId}`);
        this.distributor = purchase.distributorName;
        this.invoiceNumber = purchase.invoiceNumber;
        this.date = purchase.purchaseDate.slice(0, 10);
        this.notes = purchase.notes ?? '';
        this.paid.set(purchase.paidAmount);
        this.lines.set(purchase.items.map(item => {
          const product = this.products().find(p => p.id === item.productId) ?? null;
          const perPack = Math.max(1, product?.bottlesPerCrate ?? 1);
          return {
            key: uuid(), itemId: item.id, product,
            crates: Math.floor(item.quantity / perPack), pieces: item.quantity % perPack,
            unitPrice: item.unitPrice, batchNumber: item.batchNumber ?? '',
            expiryDate: item.expiryDate ?? '',
          };
        }));
      } catch (e) { this.notify.error(e); }
    } else {
      this.addLine();
    }
  }

  qty(l: Line) { return (l.product ? l.crates * Math.max(1, l.product.bottlesPerCrate) : 0) + l.pieces; }
  touch() { this.lines.set([...this.lines()]); }
  addLine() { this.lines.set([...this.lines(), { key: uuid(), product: null, crates: 0, pieces: 0, unitPrice: 0, batchNumber: '', expiryDate: '' }]); }
  remove(l: Line) { this.lines.set(this.lines().filter(x => x !== l)); }

  setProduct(l: Line, id: string) {
    l.product = this.products().find(p => p.id === id) ?? null;
    if (l.product) {
      l.unitPrice = l.product.purchasePrice;
      if (!l.crates && !l.pieces) l.crates = 10;
      // Default the distributor to the product's brand.
      if (l.product.brand === 'CocaCola' && this.lines().length === 1) this.distributor = DISTRIBUTORS[1];
    }
    this.touch();
  }

  async save() {
    this.busy.set(true);
    try {
      if (this.editMode()) {
        const body: UpdatePurchaseRequest = {
          distributorName: this.distributor,
          invoiceNumber: this.invoiceNumber.trim(),
          purchaseDate: new Date(this.date + 'T12:00:00').toISOString(),
          notes: this.notes || null,
          items: this.lines().map(l => ({
            id: l.itemId, productId: l.product!.id, quantity: this.qty(l), unitPrice: l.unitPrice,
            batchNumber: l.batchNumber || null, expiryDate: l.expiryDate || null,
          })),
        };
        const updated = await this.api.put<Purchase>(`/purchases/${this.purchaseId}`, body);
        this.notify.success(`Purchase ${updated.invoiceNumber} updated.`);
        await this.router.navigate(['/purchases', updated.id]);
        return;
      }
      const p = await this.data.createPurchase({
        id: uuid(), distributorName: this.distributor, invoiceNumber: this.invoiceNumber || null,
        purchaseDate: new Date(this.date + 'T12:00:00').toISOString(), paidAmount: this.paid(), notes: this.notes || null,
        items: this.lines().map(l => ({ productId: l.product!.id, quantity: this.qty(l), unitPrice: l.unitPrice, batchNumber: l.batchNumber || null, expiryDate: l.expiryDate || null })),
      });
      this.notify.success(`Purchase ${p.invoiceNumber} saved — stock updated.`);
      await this.router.navigate(p.offline ? ['/purchases'] : ['/purchases', p.id]);
    } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }
}
