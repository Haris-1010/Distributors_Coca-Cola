import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api.service';
import { Settings } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { SettingsService } from '../../core/settings.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
  <div class="page" style="max-width:860px">
    <div class="page-head">
      <div><h1>Settings</h1><div class="sub">Shop details printed on invoices and the default business rules.</div></div>
      <div class="actions"><button mat-flat-button (click)="save()" [disabled]="busy()">Save settings</button></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Shop</div>
      <div class="form-grid">
        <mat-form-field class="span-2"><mat-label>Company name</mat-label><input matInput [(ngModel)]="v['CompanyName']"></mat-form-field>
        <mat-form-field class="span-2"><mat-label>Address</mat-label><input matInput [(ngModel)]="v['CompanyAddress']"></mat-form-field>
        <mat-form-field><mat-label>Phone</mat-label><input matInput [(ngModel)]="v['CompanyPhone']"></mat-form-field>
        <mat-form-field><mat-label>Currency symbol</mat-label><input matInput [(ngModel)]="v['CurrencySymbol']"></mat-form-field>
        <mat-form-field class="span-2"><mat-label>Invoice footer</mat-label><input matInput [(ngModel)]="v['InvoiceFooter']"></mat-form-field>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Business rules</div>
      <div class="form-grid">
        <mat-form-field><mat-label>Default min profit</mat-label><input matInput type="number" [(ngModel)]="v['DefaultMinProfit']"></mat-form-field>
        <mat-form-field><mat-label>Default max profit</mat-label><input matInput type="number" [(ngModel)]="v['DefaultMaxProfit']"></mat-form-field>
        <mat-form-field class="span-2">
          <mat-label>Profit target applies</mat-label>
          <mat-select [(ngModel)]="v['ProfitBasis']">
            <mat-option value="Piece">Per piece (each bottle)</mat-option>
            <mat-option value="Crate">Per full crate / pack (spread over its pieces)</mat-option>
          </mat-select>
          <mat-hint>Example: min profit 50 per crate of 24 → about 2.08 per bottle.</mat-hint>
        </mat-form-field>
        <mat-form-field style="margin-top:8px"><mat-label>Bottles per crate (default)</mat-label><input matInput type="number" [(ngModel)]="v['BottlesPerCrate']"></mat-form-field>
        <mat-form-field style="margin-top:8px"><mat-label>Warn about expiry (days before)</mat-label><input matInput type="number" [(ngModel)]="v['ExpiryAlertDays']"></mat-form-field>
        <mat-form-field class="span-2"><mat-label>Time zone</mat-label><input matInput [(ngModel)]="v['TimeZone']"><mat-hint>Used for daily reports, e.g. Asia/Karachi</mat-hint></mat-form-field>
      </div>
    </div>
  </div>
  `,
})
export class SettingsPage {
  private api = inject(ApiService);
  private notify = inject(NotifyService);
  private settings = inject(SettingsService);
  v: Settings = {};
  busy = signal(false);

  async ngOnInit() {
    try { this.v = { ...(await this.api.get<Settings>('/settings')) }; } catch (e) { this.v = { ...this.settings.values() }; this.notify.error(e); }
  }

  async save() {
    this.busy.set(true);
    try {
      const saved = await this.api.put<Settings>('/settings', { values: this.v });
      await this.settings.set(saved);
      this.notify.success('Settings saved.');
    } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }
}
