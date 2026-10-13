import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Paged, RETURN_REASONS, ReturnReason, Sale, SaleItem, SaleListItem, SaleReturn } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { addDays, cratesFor, dayStartUtc, uuid } from '../../core/util';
import { ConnectivityService } from '../../offline/connectivity.service';
import { DataService } from '../../offline/data.service';
import { DateRangeComponent, Range } from '../../shared/date-range';
import { MoneyPipe } from '../../shared/pipes';

interface Line { item: SaleItem; qty: number; reason: ReturnReason; }

@Component({
  selector: 'app-returns',
  imports: [FormsModule, DatePipe, RouterLink, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatAutocompleteModule, MatPaginatorModule, DateRangeComponent, MoneyPipe],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Returns</h1><div class="sub">Customer brings goods back. Unsold / extra items go back into stock; damaged and expired are written off.</div></div>
    </div>

    @if (auth.canSell) {
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Process a return</div>
        @if (!sale()) {
          <mat-form-field class="full" style="max-width:520px">
            <mat-label>Find the sale (invoice number or customer)</mat-label>
            <input matInput [ngModel]="query()" (ngModelChange)="onQuery($event)" [matAutocomplete]="auto">
            <mat-autocomplete #auto="matAutocomplete" (optionSelected)="pick($event.option.value)">
              @for (s of matches(); track s.id) {
                <mat-option [value]="s.id">{{ s.invoiceNumber }} — {{ s.customerName }} · {{ s.saleDate | date: 'dd MMM' }} · {{ s.netAmount | money }}</mat-option>
              }
            </mat-autocomplete>
          </mat-form-field>
        } @else {
          @let s = sale()!;
          <div class="row" style="margin-bottom:10px">
            <div><b class="num">{{ s.invoiceNumber }}</b> · {{ s.customerBusinessName || s.customerName }} · {{ s.saleDate | date: 'dd MMM yyyy' }}</div>
            <span class="spacer"></span>
            <button mat-button (click)="clear()">Choose another sale</button>
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Product</th><th class="right">Sold</th><th class="right">Can return</th><th class="right">Return qty</th><th>Reason</th><th class="right">Value</th></tr></thead>
              <tbody>
                @for (l of lines(); track l.item.id) {
                  <tr>
                    <td>{{ l.item.productName }}</td>
                    <td class="right num">{{ l.item.quantity }}</td>
                    <td class="right num">{{ l.item.netQuantity }}</td>
                    <td class="right"><input class="qty" type="number" min="0" [max]="l.item.netQuantity" [ngModel]="l.qty" (ngModelChange)="setQty(l, $event)" [disabled]="l.item.netQuantity === 0" aria-label="Quantity to return"></td>
                    <td>
                      <select class="reason" [ngModel]="l.reason" (ngModelChange)="l.reason = $event; touch()" aria-label="Reason">
                        @for (r of reasons; track r.value) { <option [value]="r.value">{{ r.label }}</option> }
                      </select>
                    </td>
                    <td class="right money">{{ l.qty * l.item.unitPrice | money }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="summary">
            <div>Refund / credit value: <b class="money">{{ totalValue() | money }}</b></div>
            @if (cratesFreed() > 0) { <div>Crates needed on this sale go down by <b>{{ cratesFreed() }}</b></div> }
            <div class="small muted">If the customer already paid more than the new total, the difference is recorded as a cash refund.</div>
          </div>
          <mat-form-field class="full" style="max-width:520px">
            <mat-label>Note (optional)</mat-label>
            <input matInput [ngModel]="notes()" (ngModelChange)="notes.set($event)">
          </mat-form-field>
          <div class="row">
            <button mat-flat-button [disabled]="!canSubmit() || busy()" (click)="submit()">Save return</button>
          </div>
        }
      </div>
    }

    <div class="card">
      <div class="card-title">Recent returns</div>
      @if (!net.online()) { <p class="muted">Return history needs the server. Returns made offline are listed under Sync status until they upload.</p> }
      @else {
        <div class="filters"><app-date-range (changed)="range.set($event); listPage.set(1); loadList()" /></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Product</th><th class="right">Qty</th><th>Reason</th><th class="right">Value</th></tr></thead>
            <tbody>
              @if (listLoading()) {
                @for (i of [1,2,3,4,5]; track i) { <tr><td colspan="7"><div class="skeleton"></div></td></tr> }
              }
              @for (r of list(); track r.id) {
                <tr>
                  <td>{{ r.returnDate | date: 'dd MMM, HH:mm' }}</td>
                  <td><a [routerLink]="['/sales', r.saleId]" class="num">{{ r.invoiceNumber }}</a></td>
                  <td>{{ r.customerName }}</td><td>{{ r.productName }}</td>
                  <td class="right num">{{ r.quantity }}</td>
                  <td>{{ r.reason }} @if (!r.stockAdjusted) { <span class="chip red">written off</span> }</td>
                  <td class="right money">{{ r.returnValue | money }}</td>
                </tr>
              } @empty {
                @if (!listLoading()) { <tr><td colspan="7"><div class="empty">No returns in this range.</div></td></tr> }
              }
            </tbody>
          </table>
        </div>
        <mat-paginator [length]="listTotal()" [pageSize]="listPageSize" [pageIndex]="listPage() - 1"
          [pageSizeOptions]="[25, 50, 100]" [disabled]="listLoading()" (page)="onListPage($event)" />
      }
    </div>
  </div>
  `,
  styles: `
    .qty { width: 72px; height: 30px; text-align: right; font-family: var(--app-mono); border: 1px solid var(--app-border); border-radius: 6px; padding: 0 6px; }
    .reason { height: 30px; border: 1px solid var(--app-border); border-radius: 6px; padding: 0 6px; font: inherit; background: var(--app-surface); color: var(--app-ink); }
    .summary { margin: 12px 0; display: grid; gap: 4px; }
  `,
})
export class ReturnsPage {
  private api = inject(ApiService);
  private data = inject(DataService);
  private notify = inject(NotifyService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  auth = inject(AuthService);
  net = inject(ConnectivityService);

  reasons = RETURN_REASONS;
  query = signal('');
  matches = signal<SaleListItem[]>([]);
  sale = signal<Sale | null>(null);
  lines = signal<Line[]>([]);
  notes = signal('');
  busy = signal(false);
  range = signal<Range | null>(null);
  list = signal<SaleReturn[]>([]);
  listTotal = signal(0);
  listPage = signal(1);
  listPageSize = 25;
  listLoading = signal(false);
  private listRequestId = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  totalValue = computed(() => this.lines().reduce((s, l) => s + l.qty * l.item.unitPrice, 0));
  cratesFreed = computed(() => this.lines().reduce((s, l) => {
    if (!l.item.isCrateRequired || !l.qty) return s;
    return s + l.item.cratesRequired - cratesFor(l.item.netQuantity - l.qty, l.item.bottlesPerCrate);
  }, 0));
  canSubmit = computed(() => this.lines().some(l => l.qty > 0) && this.lines().every(l => l.qty >= 0 && l.qty <= l.item.netQuantity));

  ngOnInit() {
    const saleId = this.route.snapshot.queryParamMap.get('saleId');
    if (saleId) void this.pick(saleId);
  }

  onQuery(q: string) {
    this.query.set(q);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(async () => {
      if (!q || q.length < 2) { this.matches.set([]); return; }
      const res = await this.data.sales({ search: q, page: 1, pageSize: 15 }).catch(() => null);
      this.matches.set(res?.items ?? []);
    }, 250);
  }

  async pick(id: string) {
    const s = await this.data.sale(id).catch(e => { this.notify.error(e); return undefined; });
    if (!s) { this.notify.error('Sale not available.'); return; }
    if (s.offline) { this.notify.error('This sale is still waiting to sync. Returns can be made once it reaches the server.'); return; }
    this.sale.set(s);
    this.lines.set(s.items.map(item => ({ item, qty: 0, reason: 'Unsold' as ReturnReason })));
  }

  setQty(l: Line, v: number | string) {
    l.qty = Math.max(0, Math.min(l.item.netQuantity, Math.floor(Number(v) || 0)));
    this.touch();
  }
  touch() { this.lines.set([...this.lines()]); }

  clear() {
    this.sale.set(null);
    this.lines.set([]);
    this.query.set('');
    void this.router.navigate([], { queryParams: {} });
  }

  async submit() {
    const s = this.sale();
    if (!s) return;
    const lines = this.lines().filter(l => l.qty > 0);
    const ok = await this.notify.confirm({
      title: 'Save return?',
      message: lines.map(l => `${l.qty} × ${l.item.productName} (${l.reason})`).join('\n'),
      confirmText: 'Save return',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.data.createReturn({
        id: uuid(), saleId: s.id, notes: this.notes() || null,
        lines: lines.map(l => ({ saleItemId: l.item.id, quantity: l.qty, reason: l.reason })),
      });
      this.notify.success('Return saved.');
      await this.router.navigate(['/sales', s.id]);
    } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }

  async loadList() {
    const r = this.range();
    if (!r || !this.net.online()) return;
    const requestId = ++this.listRequestId;
    this.listLoading.set(true);
    try {
      const res = await this.api.get<Paged<SaleReturn>>('/returns', {
        from: dayStartUtc(r.from), to: dayStartUtc(addDays(new Date(r.to + 'T00:00:00'), 1)),
        page: this.listPage(), pageSize: this.listPageSize,
      });
      if (requestId === this.listRequestId) {
        this.list.set(res.items);
        this.listTotal.set(res.total);
      }
    } catch (e) { if (requestId === this.listRequestId) this.notify.error(e); }
    finally { if (requestId === this.listRequestId) this.listLoading.set(false); }
  }

  onListPage(e: PageEvent) {
    this.listPageSize = e.pageSize;
    this.listPage.set(e.pageIndex + 1);
    void this.loadList();
  }
}
