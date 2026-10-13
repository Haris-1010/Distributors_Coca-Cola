import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { Sale } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes';

@Component({
  selector: 'app-sale-done',
  imports: [MatDialogModule, MatButtonModule, MoneyPipe],
  template: `
    <div class="done">
      <div class="tick"><span class="material-symbols-outlined">check</span></div>
      <h2>{{ sale.offline ? 'Saved offline' : 'Sale complete' }}</h2>
      <p class="inv num">{{ sale.invoiceNumber }}</p>
      @if (sale.offline) { <p class="small muted">Temporary number — the server assigns the final invoice number when this device syncs.</p> }
      <div class="facts">
        <span>Total</span><b class="money">{{ sale.netAmount | money }}</b>
        <span>Received</span><b class="money">{{ sale.paidAmount | money }}</b>
        @if (sale.balance > 0) { <span class="neg">On credit</span><b class="money neg">{{ sale.balance | money }}</b> }
        @if (sale.emptyCratesRequired > 0) { <span class="neg">Crates to come back</span><b class="num neg">{{ sale.pendingCrates }}</b> }
      </div>
    </div>
    <mat-dialog-actions align="center">
      <button mat-button [mat-dialog-close]="'view'">View sale</button>
      <button mat-stroked-button [mat-dialog-close]="'print'"><span class="material-symbols-outlined">print</span> Print invoice</button>
      <button mat-flat-button [mat-dialog-close]="'new'" cdkFocusInitial>New sale</button>
    </mat-dialog-actions>
  `,
  styles: `
    .done { text-align: center; padding: 24px 24px 8px; }
    .tick { width: 56px; height: 56px; border-radius: 50%; background: var(--app-green-soft); color: var(--app-green); display: grid; place-items: center; margin: 0 auto;
      .material-symbols-outlined { font-size: 32px; } }
    h2 { margin: 12px 0 2px; }
    .inv { font-size: 18px; margin: 0 0 8px; }
    .facts { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; text-align: left; max-width: 280px; margin: 16px auto 0; }
    .facts b { text-align: right; }
  `,
})
export class SaleDoneDialog {
  sale = inject<Sale>(MAT_DIALOG_DATA);
}
