import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api.service';
import { StockBatch, StockSummary } from '../../core/models';
import { NotifyService } from '../../core/notify.service';

@Component({
  selector: 'app-adjust-stock',
  imports: [FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatButtonToggleModule],
  template: `
    <h2 mat-dialog-title>Adjust stock</h2>
    <mat-dialog-content>
      <p class="muted small" style="margin-top:0">For breakage, counting corrections or opening stock. Stock bought from a distributor should be entered as a purchase.</p>
      <mat-button-toggle-group [(ngModel)]="direction" hideSingleSelectionIndicator style="margin-bottom:14px">
        <mat-button-toggle value="out">Remove (breakage, loss)</mat-button-toggle>
        <mat-button-toggle value="in">Add (found, opening stock)</mat-button-toggle>
      </mat-button-toggle-group>
      <mat-form-field class="full">
        <mat-label>Product</mat-label>
        <mat-select [(ngModel)]="productId" (ngModelChange)="loadBatches()">
          @for (p of products; track p.productId) { <mat-option [value]="p.productId">{{ p.productName }} ({{ p.quantity }})</mat-option> }
        </mat-select>
      </mat-form-field>
      @if (direction === 'out') {
        <mat-form-field class="full">
          <mat-label>Batch</mat-label>
          <mat-select [(ngModel)]="batchId">
            @for (b of batches(); track b.id) { <mat-option [value]="b.id">{{ b.batchNumber }} · {{ b.quantity }} pcs{{ b.expiryDate ? ' · exp ' + b.expiryDate : '' }}</mat-option> }
          </mat-select>
        </mat-form-field>
      } @else {
        <div class="form-grid">
          <mat-form-field><mat-label>Batch no. (optional)</mat-label><input matInput [(ngModel)]="batchNumber"></mat-form-field>
          <mat-form-field><mat-label>Expiry (optional)</mat-label><input matInput type="date" [(ngModel)]="expiry"></mat-form-field>
        </div>
      }
      <mat-form-field class="full"><mat-label>Pieces</mat-label><input matInput type="number" min="1" [(ngModel)]="qty"></mat-form-field>
      <mat-form-field class="full"><mat-label>Reason</mat-label><input matInput [(ngModel)]="reason" placeholder="e.g. 3 bottles broken while unloading"></mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!valid() || busy()" (click)="save()">Save</button>
    </mat-dialog-actions>
  `,
})
export class AdjustStockDialog {
  products = inject<StockSummary[]>(MAT_DIALOG_DATA);
  private api = inject(ApiService);
  private notify = inject(NotifyService);
  private ref = inject(MatDialogRef<AdjustStockDialog, boolean>);

  direction: 'in' | 'out' = 'out';
  productId = '';
  batchId = '';
  batchNumber = '';
  expiry = '';
  qty = 1;
  reason = '';
  batches = signal<StockBatch[]>([]);
  busy = signal(false);

  async loadBatches() {
    this.batchId = '';
    if (!this.productId) return;
    this.batches.set(await this.api.get<StockBatch[]>('/stock/batches', { productId: this.productId }));
    if (this.batches().length === 1) this.batchId = this.batches()[0].id;
  }

  valid() {
    return !!this.productId && this.qty > 0 && this.reason.trim().length > 0 && (this.direction === 'in' || !!this.batchId);
  }

  async save() {
    this.busy.set(true);
    try {
      await this.api.post('/stock/adjust', {
        productId: this.productId,
        stockBatchId: this.direction === 'out' ? this.batchId : null,
        quantity: this.direction === 'out' ? -this.qty : this.qty,
        reason: this.reason,
        batchNumber: this.batchNumber || null,
        expiryDate: this.expiry || null,
      });
      this.notify.success('Stock adjusted.');
      this.ref.close(true);
    } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }
}
