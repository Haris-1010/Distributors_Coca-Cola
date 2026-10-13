import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { ChartData } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { ApiService } from '../../core/api.service';
import { NotifyService } from '../../core/notify.service';
import { SettingsService } from '../../core/settings.service';
import { int, money } from '../../core/util';
import { ConnectivityService } from '../../offline/connectivity.service';
import { barDataset, barOptions } from '../../shared/chart-theme';
import { DateRangeComponent, Range } from '../../shared/date-range';
import { ExportColumn, exportExcel, exportPdf } from '../../shared/export';

type Row = Record<string, unknown>;

interface ReportDef {
  id: string;
  label: string;
  /** Uses the date range? */
  dated: boolean;
  columns: ExportColumn[];
  /** Extra toggle options (e.g. group by). */
  options?: { value: string; label: string }[];
  load: (api: ApiService, range: Range, option: string) => Promise<{ rows: Row[]; totals?: Record<string, number> }>;
  /** Optional bar chart: label key + value key. */
  chart?: { label: string; value: string; horizontal?: boolean; money?: boolean; title: string };
  note?: string;
}

type Res = { rows: Row[]; totals?: Record<string, number> };

const REPORTS: ReportDef[] = [
  {
    id: 'sales', label: 'Sales', dated: true,
    options: [{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }],
    columns: [
      { key: 'period', label: 'Period', type: 'date' }, { key: 'salesCount', label: 'Invoices', type: 'int' },
      { key: 'gross', label: 'Gross', type: 'money' }, { key: 'discount', label: 'Discount', type: 'money' },
      { key: 'returns', label: 'Returns', type: 'money' }, { key: 'net', label: 'Net sales', type: 'money' },
      { key: 'paid', label: 'Received', type: 'money' }, { key: 'due', label: 'Due', type: 'money' },
      { key: 'profit', label: 'Profit', type: 'money' }, { key: 'cratesRequired', label: 'Crates out', type: 'int' },
      { key: 'cratesReturned', label: 'Crates back', type: 'int' },
    ],
    chart: { label: 'period', value: 'net', money: true, title: 'Net sales' },
    load: (api, r, o) => api.get<Res>('/reports/sales', { from: r.from, to: r.to, period: o || 'day' }),
  },
  {
    id: 'profit', label: 'Profit', dated: true,
    options: [{ value: 'product', label: 'By product' }, { value: 'customer', label: 'By customer' }],
    columns: [],
    load: (api, r, o) => api.get<Res>('/reports/profit', { from: r.from, to: r.to, groupBy: o || 'product' }),
    chart: { label: 'name', value: 'profit', horizontal: true, money: true, title: 'Profit' },
    note: 'Product profit = net pieces × profit per piece, minus the cost of damaged/expired returns that were written off. Sale discounts are not split across products.',
  },
  {
    id: 'top', label: 'Top sellers', dated: true,
    columns: [
      { key: 'productName', label: 'Product' }, { key: 'quantity', label: 'Pieces sold', type: 'int' },
      { key: 'revenue', label: 'Sales', type: 'money' }, { key: 'profit', label: 'Profit', type: 'money' }, { key: 'customers', label: 'Customers', type: 'int' },
    ],
    chart: { label: 'productName', value: 'quantity', horizontal: true, title: 'Pieces sold' },
    load: (api, r) => api.get<Res>('/reports/top-products', { from: r.from, to: r.to, limit: 20 }),
  },
  {
    id: 'margin', label: 'Margin vs target', dated: true,
    columns: [
      { key: 'productName', label: 'Product' }, { key: 'quantity', label: 'Pieces', type: 'int' },
      { key: 'avgPrice', label: 'Avg price', type: 'money' }, { key: 'avgCost', label: 'Avg cost', type: 'money' },
      { key: 'avgProfitPerPiece', label: 'Avg profit/pc', type: 'money' }, { key: 'targetMinPerPiece', label: 'Target min/pc', type: 'money' },
      { key: 'targetMaxPerPiece', label: 'Target max/pc', type: 'money' }, { key: 'qtyBelowTarget', label: 'Pcs below target', type: 'int' },
      { key: 'priceOverrides', label: 'Price changes', type: 'int' },
    ],
    load: (api, r) => api.get<Res>('/reports/margin', { from: r.from, to: r.to }),
    note: 'Shows whether actual selling prices hit the Rs 50–60 profit target set on each product.',
  },
  {
    id: 'returns', label: 'Returns', dated: true,
    columns: [
      { key: 'reason', label: 'Reason' }, { key: 'lines', label: 'Lines', type: 'int' }, { key: 'quantity', label: 'Pieces', type: 'int' },
      { key: 'value', label: 'Value', type: 'money' }, { key: 'profitLost', label: 'Profit lost', type: 'money' }, { key: 'refunded', label: 'Refunded', type: 'money' },
    ],
    load: async (api, r) => { const x = await api.get<{ byReason: Row[]; totals: Record<string, number> }>('/reports/returns', { from: r.from, to: r.to }); return { rows: x.byReason, totals: x.totals }; },
  },
  {
    id: 'purchases', label: 'Purchases', dated: true,
    columns: [
      { key: 'purchaseDate', label: 'Date', type: 'date' }, { key: 'invoiceNumber', label: 'Invoice' }, { key: 'distributorName', label: 'Distributor' },
      { key: 'pieces', label: 'Pieces', type: 'int' }, { key: 'totalAmount', label: 'Total', type: 'money' },
      { key: 'paidAmount', label: 'Paid', type: 'money' }, { key: 'due', label: 'Due', type: 'money' },
    ],
    load: async (api, r) => {
      const x = await api.get<{ rows: Row[]; totals: Record<string, number> }>('/reports/purchases', { from: r.from, to: r.to });
      return { rows: x.rows, totals: { totalAmount: x.totals['total'] ?? 0, paidAmount: x.totals['paid'] ?? 0, due: x.totals['due'] ?? 0, pieces: x.totals['pieces'] ?? 0 } };
    },
  },
  {
    id: 'stock', label: 'Stock', dated: false,
    columns: [
      { key: 'productName', label: 'Product' }, { key: 'quantity', label: 'Pieces', type: 'int' }, { key: 'crateQuantity', label: 'Full crates', type: 'int' },
      { key: 'loosePieces', label: 'Loose', type: 'int' }, { key: 'stockValue', label: 'Value at cost', type: 'money' },
      { key: 'lowStockThreshold', label: 'Low at', type: 'int' }, { key: 'nearestExpiry', label: 'Nearest expiry', type: 'date' },
    ],
    load: async api => {
      const x = await api.get<{ rows: Row[]; totals: Record<string, number> }>('/reports/stock');
      return { rows: x.rows, totals: { quantity: x.totals['pieces'], crateQuantity: x.totals['crates'], stockValue: x.totals['value'] } };
    },
  },
  {
    id: 'crates', label: 'Empty crates', dated: false,
    columns: [
      { key: 'businessName', label: 'Shop' }, { key: 'customerName', label: 'Customer' }, { key: 'phone', label: 'Phone' },
      { key: 'cratesIssued', label: 'Issued', type: 'int' }, { key: 'cratesReturned', label: 'Returned', type: 'int' },
      { key: 'adjustments', label: 'Adjusted', type: 'int' }, { key: 'pendingCrates', label: 'Pending', type: 'int' },
      { key: 'oldestPendingSaleDate', label: 'Oldest open sale', type: 'date' },
    ],
    load: async api => {
      const rows = (await api.get<Row[]>('/reports/crates', { onlyPending: false })).filter(r => Number(r['cratesIssued']) || Number(r['pendingCrates']));
      return { rows, totals: sum(rows, ['cratesIssued', 'cratesReturned', 'adjustments', 'pendingCrates']) };
    },
  },
  {
    id: 'balances', label: 'Customer balances', dated: false,
    columns: [
      { key: 'businessName', label: 'Shop' }, { key: 'name', label: 'Customer' }, { key: 'phone', label: 'Phone' },
      { key: 'outstandingBalance', label: 'Balance due', type: 'money' }, { key: 'emptyCrateBalance', label: 'Crates owed', type: 'int' },
    ],
    load: async api => {
      const x = await api.get<{ rows: Row[] }>('/reports/customer-balances');
      return { rows: x.rows, totals: sum(x.rows, ['outstandingBalance', 'emptyCrateBalance']) };
    },
    note: 'Open a customer for their full ledger (money and crates, line by line).',
  },
];

const PROFIT_COLUMNS: Record<string, ExportColumn[]> = {
  product: [
    { key: 'productName', label: 'Product' }, { key: 'quantity', label: 'Pieces', type: 'int' }, { key: 'revenue', label: 'Sales', type: 'money' },
    { key: 'cost', label: 'Cost', type: 'money' }, { key: 'writeOff', label: 'Written off', type: 'money' },
    { key: 'profit', label: 'Profit', type: 'money' }, { key: 'marginPercent', label: 'Margin', type: 'percent' },
  ],
  customer: [
    { key: 'businessName', label: 'Shop' }, { key: 'customerName', label: 'Customer' }, { key: 'salesCount', label: 'Invoices', type: 'int' },
    { key: 'net', label: 'Net sales', type: 'money' }, { key: 'profit', label: 'Profit', type: 'money' },
    { key: 'marginPercent', label: 'Margin', type: 'percent' }, { key: 'due', label: 'Still due', type: 'money' },
  ],
};

function sum(rows: Row[], keys: string[]): Record<string, number> {
  return Object.fromEntries(keys.map(k => [k, rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)]));
}

@Component({
  selector: 'app-reports',
  imports: [FormsModule, DatePipe, MatButtonModule, MatButtonToggleModule, BaseChartDirective, DateRangeComponent],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Reports</h1><div class="sub">Sales, profit, stock, returns and crates — filter by date and export.</div></div>
      <div class="actions">
        <button mat-stroked-button (click)="export('xlsx')" [disabled]="!rows().length"><span class="material-symbols-outlined">table_view</span> Excel</button>
        <button mat-stroked-button (click)="export('pdf')" [disabled]="!rows().length"><span class="material-symbols-outlined">picture_as_pdf</span> PDF</button>
      </div>
    </div>

    <nav class="tabs" aria-label="Reports">
      @for (r of reports; track r.id) {
        <button [class.on]="r.id === current().id" (click)="select(r)">{{ r.label }}</button>
      }
    </nav>

    @if (!net.online()) { <div class="empty"><span class="material-symbols-outlined">cloud_off</span>Reports need the server. They'll be back when you're online.</div> }
    @else {
      <div class="filters">
        @if (current().dated) { <app-date-range (changed)="range.set($event); load()" /> }
        @if (current().options; as opts) {
          <mat-button-toggle-group [value]="option()" (change)="option.set($event.value); load()" hideSingleSelectionIndicator>
            @for (o of opts; track o.value) { <mat-button-toggle [value]="o.value">{{ o.label }}</mat-button-toggle> }
          </mat-button-toggle-group>
        }
      </div>
      @if (current().note) { <p class="small muted" style="margin-top:-4px">{{ current().note }}</p> }

      @if (chart(); as c) {
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">{{ current().chart!.title }}</div>
          <div class="chart" [style.height.px]="current().chart!.horizontal ? Math.max(200, rows().length * 26 + 40) : 260">
            <canvas baseChart type="bar" [data]="c" [options]="chartOptions()" [attr.aria-label]="current().chart!.title + ' chart'"></canvas>
          </div>
        </div>
      }

      <div class="table-wrap">
        <table class="data">
          <thead><tr>@for (col of columns(); track col.key) { <th [class.right]="isNum(col)">{{ col.label }}</th> }</tr></thead>
          <tbody>
            @if (loading()) { @for (i of [1,2,3,4]; track i) { <tr><td [attr.colspan]="columns().length"><div class="skeleton"></div></td></tr> } }
            @for (r of rows(); track $index) {
              <tr>@for (col of columns(); track col.key) {
                <td [class.right]="isNum(col)" [class.money]="col.type === 'money'" [class.num]="col.type === 'int' || col.type === 'percent'"
                    [class.neg]="col.type === 'money' && toNum(r[col.key]) < 0">
                  @if (col.type === 'date') { {{ r[col.key] ? (asDate(r[col.key]) | date: 'dd MMM yyyy') : '' }} } @else { {{ fmt(r[col.key], col) }} }
                </td>
              }</tr>
            } @empty {
              @if (!loading()) { <tr><td [attr.colspan]="columns().length"><div class="empty">Nothing to show for this range.</div></td></tr> }
            }
          </tbody>
          @if (totals() && rows().length) {
            <tfoot><tr>@for (col of columns(); track col.key; let first = $first) {
              <td [class.right]="isNum(col)" [class.money]="col.type === 'money'">{{ first ? 'Total' : (totals()![col.key] !== undefined && col.type !== 'percent' ? fmt(totals()![col.key], col) : '') }}</td>
            }</tr></tfoot>
          }
        </table>
      </div>
    }
  </div>
  `,
  styles: `
    .tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 14px; border-bottom: 1px solid var(--app-border);
      button { border: none; background: none; padding: 10px 14px; font: inherit; font-weight: 600; color: var(--app-muted); cursor: pointer;
        border-bottom: 2px solid transparent; margin-bottom: -1px;
        &.on { color: var(--app-blue); border-bottom-color: var(--app-blue); } &:hover { color: var(--app-ink); } } }
    .chart { position: relative; }
  `,
})
export class ReportsPage {
  private api = inject(ApiService);
  private notify = inject(NotifyService);
  private settings = inject(SettingsService);
  net = inject(ConnectivityService);
  Math = Math;

  reports = REPORTS;
  current = signal<ReportDef>(REPORTS[0]);
  option = signal('day');
  range = signal<Range | null>(null);
  rows = signal<Row[]>([]);
  totals = signal<Record<string, number> | undefined>(undefined);
  loading = signal(false);

  columns = computed(() => this.current().id === 'profit' ? PROFIT_COLUMNS[this.option()] ?? PROFIT_COLUMNS['product'] : this.current().columns);

  chartOptions = computed(() => barOptions({ horizontal: this.current().chart?.horizontal, money: this.current().chart?.money, symbol: this.settings.currencySymbol() }));

  chart = computed<ChartData<'bar'> | null>(() => {
    const c = this.current().chart;
    const rows = this.rows();
    if (!c || rows.length === 0) return null;
    const labelKey = this.current().id === 'profit' ? (this.option() === 'customer' ? 'customerName' : 'productName') : c.label;
    const labels = rows.map(r => {
      const v = r[labelKey];
      return labelKey === 'period' ? new Date(String(v)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : String(v ?? '');
    });
    return { labels, datasets: [barDataset(c.title, rows.map(r => Number(r[c.value]) || 0))] };
  });

  select(r: ReportDef) {
    this.current.set(r);
    this.option.set(r.options?.[0].value ?? '');
    this.rows.set([]);
    this.totals.set(undefined);
    // Switching between dated reports keeps the chosen range; the first dated report loads when the picker emits.
    if (!r.dated || this.range()) void this.load();
  }

  async load() {
    const def = this.current();
    const r = this.range();
    if (def.dated && !r) return;
    this.loading.set(true);
    try {
      const res = await def.load(this.api, r ?? { from: '', to: '' }, this.option());
      if (this.current() !== def) return;
      this.rows.set(res.rows ?? []);
      this.totals.set(res.totals);
    } catch (e) { this.notify.error(e); } finally { this.loading.set(false); }
  }

  isNum(c: ExportColumn) { return !!c.type && c.type !== 'text' && c.type !== 'date'; }
  toNum(v: unknown) { return Number(v) || 0; }
  asDate(v: unknown) { return String(v); }
  fmt(v: unknown, c: ExportColumn): string {
    if (v === null || v === undefined || v === '') return '';
    if (c.type === 'money') return money(Number(v), this.settings.currencySymbol());
    if (c.type === 'int') return int(Number(v));
    if (c.type === 'percent') return `${Number(v).toFixed(1)}%`;
    return String(v);
  }

  export(kind: 'xlsx' | 'pdf') {
    const def = this.current();
    const title = `${def.label} report`;
    const r = this.range();
    const sub = def.dated && r ? `${r.from} to ${r.to}` : `As of ${new Date().toLocaleDateString('en-GB')}`;
    const rows = [...this.rows()];
    const t = this.totals();
    if (t) rows.push({ ...Object.fromEntries(this.columns().map((c, i) => [c.key, i === 0 ? 'TOTAL' : c.type === 'percent' ? null : t[c.key] ?? null])) });
    if (kind === 'xlsx') void exportExcel(title, this.columns(), rows);
    else void exportPdf(title, sub, this.columns(), rows, this.settings.companyName());
  }
}
