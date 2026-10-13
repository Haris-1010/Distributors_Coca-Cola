import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { PAYMENT_MODES, PaymentMode } from '../core/models';
import { NotifyService } from '../core/notify.service';
import { uuid } from '../core/util';
import { DataService } from '../offline/data.service';
import { MoneyPipe } from './pipes';

// ---------------- Receive payment ----------------
export interface PaymentDialogData {
  customerId: string;
  customerName: string;
  saleId?: string | null;
  invoiceNumber?: string | null;
  due: number;
}

@Component({
  selector: 'app-payment-dialog',
  imports: [FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MoneyPipe],
  template: `
    <h2 mat-dialog-title>Receive payment</h2>
    <mat-dialog-content>
      <p class="muted" style="margin-top:0">
        From <b>{{ d.customerName }}</b>{{ d.invoiceNumber ? ' for ' + d.invoiceNumber : ' — applied to the oldest dues first' }}.
        Due: <b class="money">{{ d.due | money }}</b>
      </p>
      <form id="payForm" (ngSubmit)="save()" class="form-grid">
        <mat-form-field>
          <mat-label>Amount</mat-label>
          <input matInput type="number" min="1" name="amount" [(ngModel)]="amount" required cdkFocusInitial>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Received by</mat-label>
          <mat-select name="mode" [(ngModel)]="mode">
            @for (m of modes; track m.value) { <mat-option [value]="m.value">{{ m.label }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field class="span-2">
          <mat-label>Note / reference (optional)</mat-label>
          <input matInput name="notes" [(ngModel)]="notes">
        </mat-form-field>
      </form>
      @if (amount > d.due && d.due > 0) { <p class="small muted">Extra {{ (amount - d.due) | money }} will clear older dues or stay as advance.</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button form="payForm" [disabled]="!(amount > 0) || busy()">Save payment</button>
    </mat-dialog-actions>
  `,
})
export class PaymentDialog {
  d = inject<PaymentDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<PaymentDialog, boolean>);
  private data = inject(DataService);
  private notify = inject(NotifyService);
  modes = PAYMENT_MODES.filter(m => m.value !== 'Credit');
  amount = Math.max(0, this.d.due);
  mode: PaymentMode = 'Cash';
  notes = '';
  busy = signal(false);

  async save() {
    this.busy.set(true);
    try {
      await this.data.receivePayment(this.d.customerId, {
        id: uuid(), amount: this.amount, paymentMode: this.mode, saleId: this.d.saleId ?? null, notes: this.notes || null,
      });
      this.notify.success('Payment saved.');
      this.ref.close(true);
    } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }
}

// ---------------- Collect empty crates ----------------
export interface CrateDialogData {
  customerId: string;
  customerName: string;
  saleId?: string | null;
  invoiceNumber?: string | null;
  pending: number;
  customerOwes: number;
}

@Component({
  selector: 'app-crate-dialog',
  imports: [FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Collect empty crates</h2>
    <mat-dialog-content>
      <p class="muted" style="margin-top:0">
        <b>{{ d.customerName }}</b> owes <b class="neg">{{ d.customerOwes }}</b> crate(s) in total
        @if (d.invoiceNumber) { — {{ d.pending }} on {{ d.invoiceNumber }} }.
        @if (!d.invoiceNumber) { Crates are applied to the oldest open sales first. }
      </p>
      <form id="crateForm" (ngSubmit)="save()">
        <mat-form-field class="full">
          <mat-label>Empty crates received</mat-label>
          <input matInput type="number" min="1" [max]="d.customerOwes" name="qty" [(ngModel)]="qty" required cdkFocusInitial>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Note (optional)</mat-label>
          <input matInput name="notes" [(ngModel)]="notes">
        </mat-form-field>
      </form>
      @if (qty > d.customerOwes) { <p class="small neg">That's more than the customer owes. Use a crate adjustment instead.</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button form="crateForm" [disabled]="!(qty > 0) || qty > d.customerOwes || busy()">Save</button>
    </mat-dialog-actions>
  `,
})
export class CrateDialog {
  d = inject<CrateDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<CrateDialog, boolean>);
  private data = inject(DataService);
  private notify = inject(NotifyService);
  qty = Math.max(0, this.d.saleId ? this.d.pending : this.d.customerOwes);
  notes = '';
  busy = signal(false);

  async save() {
    this.busy.set(true);
    try {
      await this.data.returnCrates({ id: uuid(), customerId: this.d.customerId, quantity: this.qty, saleId: this.d.saleId ?? null, notes: this.notes || null });
      this.notify.success(`${this.qty} crate(s) received.`);
      this.ref.close(true);
    } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }
}

// ---------------- Free text prompt ----------------
export interface PromptData { title: string; message?: string; label: string; confirmText?: string; type?: 'text' | 'number'; value?: string | number; }

@Component({
  selector: 'app-prompt-dialog',
  imports: [FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ d.title }}</h2>
    <mat-dialog-content>
      @if (d.message) { <p class="muted" style="margin-top:0; white-space: pre-line">{{ d.message }}</p> }
      <mat-form-field class="full">
        <mat-label>{{ d.label }}</mat-label>
        <input matInput [type]="d.type ?? 'text'" [(ngModel)]="value" (keyup.enter)="value && ref.close(value)" cdkFocusInitial>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!value && value !== 0" (click)="ref.close(value)">{{ d.confirmText ?? 'OK' }}</button>
    </mat-dialog-actions>
  `,
})
export class PromptDialog {
  d = inject<PromptData>(MAT_DIALOG_DATA);
  ref = inject(MatDialogRef<PromptDialog, string | number>);
  value: string | number = this.d.value ?? '';
}
