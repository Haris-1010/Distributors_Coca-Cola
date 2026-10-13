import { DatePipe } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { Sale } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { SettingsService } from '../../core/settings.service';
import { DataService } from '../../offline/data.service';
import { CratesPipe, MoneyPipe, WordsPipe } from '../../shared/pipes';

/** Printable invoice. "Save as PDF" in the print dialog gives the PDF copy. Works offline. */
@Component({
  selector: 'app-invoice-print',
  imports: [DatePipe, RouterLink, MatButtonModule, MoneyPipe, CratesPipe, WordsPipe],
  template: `
  <div class="toolbar no-print">
    <a mat-button [routerLink]="['/sales', id()]"><span class="material-symbols-outlined">arrow_back</span> Back</a>
    <span class="spacer"></span>
    <label class="small"><input type="checkbox" [checked]="compact()" (change)="compact.set(!compact())"> Small paper (A5 / thermal)</label>
    <button mat-flat-button (click)="print()"><span class="material-symbols-outlined">print</span> Print / Save PDF</button>
  </div>

  @if (sale(); as s) {
    <article class="invoice" [class.compact]="compact()">
      <header>
        <div>
          <div class="company">{{ settings.companyName() }}</div>
          <div class="muted">{{ settings.get('CompanyAddress') }}</div>
          @if (settings.get('CompanyPhone')) { <div class="muted">Phone: {{ settings.get('CompanyPhone') }}</div> }
        </div>
        <div class="meta">
          <div class="doc">SALE INVOICE</div>
          <div class="num">{{ s.invoiceNumber }}</div>
          <div>{{ s.saleDate | date: 'dd/MM/yyyy HH:mm' }}</div>
          @if (s.offline) { <div class="tag">Provisional (offline)</div> }
        </div>
      </header>

      <section class="bill-to">
        <div class="label">Bill to</div>
        <div class="strong">{{ s.customerBusinessName || s.customerName }}</div>
        @if (s.customerBusinessName) { <div>{{ s.customerName }}</div> }
        @if (s.customerPhone) { <div>{{ s.customerPhone }}</div> }
      </section>

      <table>
        <thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
        <tbody>
          @for (i of s.items; track i.id; let n = $index) {
            <tr>
              <td>{{ n + 1 }}</td>
              <td>{{ i.productName }}<div class="sub">{{ i.quantity | crates: i.bottlesPerCrate }}{{ i.isCrateRequired ? ' · glass' : '' }}</div></td>
              <td class="r num">{{ i.quantity }}</td>
              <td class="r num">{{ i.unitPrice | money }}</td>
              <td class="r num">{{ i.total | money }}</td>
            </tr>
            @if (i.returnedQuantity) {
              <tr class="ret"><td></td><td>Returned: {{ i.productName }}</td><td class="r num">-{{ i.returnedQuantity }}</td>
                <td class="r num">{{ i.unitPrice | money }}</td><td class="r num">-{{ i.returnedQuantity * i.unitPrice | money }}</td></tr>
            }
          }
        </tbody>
      </table>

      <div class="bottom">
        <div class="crates" [class.owed]="s.pendingCrates > 0">
          @if (s.emptyCratesRequired > 0) {
            <div class="label">Empty crates</div>
            <div class="crate-row"><span>Required</span><b>{{ s.emptyCratesRequired }}</b></div>
            <div class="crate-row"><span>Returned</span><b>{{ s.emptyCratesReturned }}</b></div>
            <div class="crate-row big"><span>Still to return</span><b>{{ s.pendingCrates }}</b></div>
          }
        </div>
        <div class="sums">
          <div><span>Subtotal</span><b class="num">{{ s.totalAmount | money }}</b></div>
          @if (s.discount) { <div><span>Discount</span><b class="num">-{{ s.discount | money }}</b></div> }
          @if (s.returnedAmount) { <div><span>Returns</span><b class="num">-{{ s.returnedAmount | money }}</b></div> }
          <div class="grand"><span>Total</span><b class="num">{{ s.netAmount | money }}</b></div>
          <div><span>Paid ({{ s.paymentMode | words }})</span><b class="num">{{ s.paidAmount | money }}</b></div>
          <div class="due"><span>Balance due</span><b class="num">{{ s.balance | money }}</b></div>
        </div>
      </div>

      <footer>
        <div>{{ settings.get('InvoiceFooter') }}</div>
        <div class="sign"><span>Customer signature</span><span>Authorised signature</span></div>
      </footer>
    </article>
  } @else {
    <p class="page muted">Loading invoice…</p>
  }
  `,
  styles: `
    :host { display: block; background: var(--app-bg); min-height: 100%; padding-bottom: 32px; }
    .toolbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; max-width: 840px; margin: 0 auto; }
    .invoice { background: #fff; color: #111; max-width: 800px; margin: 0 auto; padding: 40px 44px; border: 1px solid var(--app-border); border-radius: 6px;
      font-size: 13px; }
    header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #0b4a8f; padding-bottom: 16px; }
    .company { font-size: 22px; font-weight: 800; color: #0b4a8f; }
    .meta { text-align: right; .doc { font-weight: 800; letter-spacing: .12em; color: #c8102e; } .num { font-size: 16px; font-weight: 600; } }
    .tag { display: inline-block; margin-top: 4px; padding: 1px 6px; border: 1px solid #a15c07; color: #a15c07; font-size: 11px; }
    .muted { color: #555; }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #666; margin-bottom: 4px; }
    .bill-to { margin: 18px 0; .strong { font-weight: 700; font-size: 15px; } }
    table { width: 100%; border-collapse: collapse;
      th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 1px solid #999; padding: 6px; }
      td { padding: 7px 6px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
      .r { text-align: right; } .sub { font-size: 11px; color: #666; }
      tr.ret td { color: #c8102e; font-size: 12px; } }
    .num { font-family: var(--app-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .bottom { display: flex; justify-content: space-between; gap: 24px; margin-top: 18px; }
    .crates { min-width: 200px; padding: 10px 12px; border: 1px dashed #999; border-radius: 6px; align-self: flex-start;
      &:empty { border: none; }
      &.owed { border: 2px solid #c8102e; .big b { color: #c8102e; } } }
    .crate-row { display: flex; justify-content: space-between; gap: 16px; &.big { font-weight: 800; font-size: 15px; margin-top: 4px; } }
    .sums { min-width: 260px; div { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; }
      .grand { font-size: 17px; font-weight: 800; border-top: 1px solid #333; margin-top: 4px; padding-top: 6px; }
      .due { font-weight: 800; color: #c8102e; } }
    footer { margin-top: 36px; color: #444;
      .sign { display: flex; justify-content: space-between; margin-top: 48px; span { border-top: 1px solid #555; padding-top: 4px; width: 200px; text-align: center; font-size: 11px; } } }

    .invoice.compact { max-width: 380px; padding: 16px; font-size: 12px;
      header { flex-direction: column; gap: 8px; } .meta { text-align: left; }
      .bottom { flex-direction: column; } .sign { display: none; } }

    @media print {
      :host { background: #fff; padding: 0; }
      .invoice { border: none; padding: 0; max-width: none; }
      @page { margin: 12mm; }
    }
  `,
})
export class InvoicePrintPage {
  id = input.required<string>();
  private data = inject(DataService);
  private notify = inject(NotifyService);
  settings = inject(SettingsService);
  sale = signal<Sale | null>(null);
  compact = signal(localStorage.getItem('wh.invoiceCompact') === '1');

  async ngOnInit() {
    try {
      this.sale.set((await this.data.sale(this.id())) ?? null);
      if (!this.sale()) this.notify.error('Invoice not available.');
    } catch (e) { this.notify.error(e); }
  }

  print() {
    localStorage.setItem('wh.invoiceCompact', this.compact() ? '1' : '0');
    window.print();
  }
}
