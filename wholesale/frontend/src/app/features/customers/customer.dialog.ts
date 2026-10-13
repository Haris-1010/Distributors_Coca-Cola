import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { CUSTOMER_TYPES, Customer } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { DataService } from '../../offline/data.service';

@Component({
  selector: 'app-customer-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatSlideToggleModule],
  template: `
    <h2 mat-dialog-title>{{ data?.id ? 'Edit customer' : 'New customer' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" (ngSubmit)="save()" id="customerForm">
        <mat-form-field class="span-2">
          <mat-label>Shop / business name</mat-label>
          <input matInput formControlName="businessName" cdkFocusInitial>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Owner / contact name</mat-label>
          <input matInput formControlName="name" required>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Phone</mat-label>
          <input matInput formControlName="phone" placeholder="03xx-xxxxxxx">
        </mat-form-field>
        <mat-form-field class="span-2">
          <mat-label>Address</mat-label>
          <input matInput formControlName="address">
        </mat-form-field>
        <mat-form-field>
          <mat-label>Type</mat-label>
          <mat-select formControlName="customerType">
            @for (t of types; track t) { <mat-option [value]="t">{{ t }}</mat-option> }
          </mat-select>
        </mat-form-field>
        @if (data?.id) {
          <mat-slide-toggle formControlName="isActive" style="align-self:center">Active</mat-slide-toggle>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancel</button>
      <button mat-flat-button form="customerForm" [disabled]="form.invalid || busy()">Save</button>
    </mat-dialog-actions>
  `,
})
export class CustomerDialog {
  data = inject<Customer | null>(MAT_DIALOG_DATA, { optional: true });
  private ref = inject(MatDialogRef<CustomerDialog, Customer>);
  private dataSvc = inject(DataService);
  private notify = inject(NotifyService);
  private fb = inject(FormBuilder);
  types = CUSTOMER_TYPES;
  busy = signal(false);

  form = this.fb.nonNullable.group({
    name: [this.data?.name ?? '', [Validators.required, Validators.maxLength(150)]],
    businessName: [this.data?.businessName ?? ''],
    phone: [this.data?.phone ?? '', Validators.maxLength(30)],
    address: [this.data?.address ?? ''],
    customerType: [this.data?.customerType ?? 'Retailer'],
    isActive: [this.data?.isActive ?? true],
  });

  async save() {
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      const c = await this.dataSvc.saveCustomer({ id: this.data?.id, ...v, customerType: v.customerType as Customer['customerType'] });
      this.notify.success(`Saved ${c.businessName || c.name}.`);
      this.ref.close(c);
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
