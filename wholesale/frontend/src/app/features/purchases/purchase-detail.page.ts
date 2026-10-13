import { DatePipe } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Purchase } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { PromptDialog } from '../../shared/dialogs';
import { MoneyPipe } from '../../shared/pipes';

@Component({
  selector: 'app-purchase-detail',
  imports: [DatePipe, RouterLink, MatButtonModule, MoneyPipe],
  template: `
  <div class="page">
    @if (p(); as p) {
      <div class="page-head">
        <div><div class="small muted"><a routerLink="/purchases" class="crumb">Purchases</a> /</div>
          <h1 class="num">{{ p.invoiceNumber }}</h1>
          <div class="sub">{{ p.distributorName }} · {{ p.purchaseDate | date: 'dd MMM yyyy' }}</div></div>
        <div class="actions">
          <button mat-stroked-button (click)="print()"><span class="material-symbols-outlined">print</span> Print</button>
          @if (auth.isManager && p.balance > 0) { <button mat-flat-button (click)="pay(p)">Record payment</button> }
        </div>
      </div>
      <div class="stats">
        <div class="stat"><div class="label">Total</div><div class="value">{{ p.totalAmount | money }}</div></div>
        <div class="stat"><div class="label">Paid</div><div class="value">{{ p.paidAmount | money }}</div></div>
        <div class="stat" [class.alert]="p.balance > 0"><div class="label">Due to distributor</div><div class="value">{{ p.balance | money }}</div></div>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th class="right">Pieces</th><th class="right">Cost/pc</th><th class="right">Amount</th></tr></thead>
          <tbody>
            @for (i of p.items; track $index) {
              <tr><td>{{ i.productName }}</td><td class="num">{{ i.batchNumber }}</td><td>{{ i.expiryDate ? (i.expiryDate | date: 'dd MMM yyyy') : '—' }}</td>
                <td class="right num">{{ i.quantity }}</td><td class="right money">{{ i.unitPrice | money }}</td><td class="right money">{{ i.total | money }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (p.notes) { <p class="muted" style="white-space:pre-line">{{ p.notes }}</p> }
    }
  </div>
  `,
  styles: `.crumb { color: inherit; }`,
})
export class PurchaseDetailPage {
  id = input.required<string>();
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  auth = inject(AuthService);
  p = signal<Purchase | null>(null);

  async ngOnInit() {
    try { this.p.set(await this.api.get<Purchase>(`/purchases/${this.id()}`)); } catch (e) { this.notify.error(e); }
  }

  async pay(p: Purchase) {
    const amount = await firstValueFrom(this.dialog.open(PromptDialog, {
      width: '420px', data: { title: 'Payment to distributor', type: 'number', label: 'Amount', value: p.balance, confirmText: 'Save' },
    }).afterClosed());
    if (!amount) return;
    try {
      this.p.set(await this.api.post<Purchase>(`/purchases/${p.id}/payments`, { amount: Number(amount) }));
      this.notify.success('Payment recorded.');
    } catch (e) { this.notify.error(e); }
  }

  print() { window.print(); }
}
