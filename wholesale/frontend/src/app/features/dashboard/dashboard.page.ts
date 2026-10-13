import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { ChartData } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CustomerCrateSummary, StockSummary } from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { ConnectivityService } from '../../offline/connectivity.service';
import { db } from '../../offline/db';
import { SyncService } from '../../offline/sync.service';
import { barDataset, barOptions } from '../../shared/chart-theme';
import { CratesPipe, MoneyPipe } from '../../shared/pipes';

interface Dashboard {
  today: string;
  totals: { todaySales: number; todayProfit: number; todayCount: number; monthSales: number; monthProfit: number; openSales: number;
    totalOutstanding: number; pendingCrates: number; customersWithCrates: number; };
  salesTrend: { period: string; net: number; profit: number; salesCount: number }[];
  topProducts: { productName: string; quantity: number; revenue: number; profit: number }[];
  lowStock: StockSummary[];
  nearExpiryCount: number;
  expiredCount: number;
  topCrateDebtors: CustomerCrateSummary[];
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, MatButtonModule, BaseChartDirective, MoneyPipe, CratesPipe],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>{{ greeting() }}, {{ firstName() }}</h1><div class="sub">{{ now | date: 'EEEE, d MMMM yyyy' }}</div></div>
      <div class="actions">
        @if (auth.canSell) { <a mat-flat-button routerLink="/pos" class="red"><span class="material-symbols-outlined">add_shopping_cart</span> New sale</a> }
        @if (auth.isManager) { <a mat-stroked-button routerLink="/purchases/new"><span class="material-symbols-outlined">local_shipping</span> Receive stock</a> }
        <a mat-stroked-button routerLink="/stock"><span class="material-symbols-outlined">warehouse</span> Stock check</a>
      </div>
    </div>

    @if (d(); as d) {
      <div class="stats">
        <div class="stat"><div class="label">Today's sales</div><div class="value">{{ d.totals.todaySales | money }}</div><div class="hint">{{ d.totals.todayCount }} invoice(s)</div></div>
        @if (showProfit()) {
          <div class="stat"><div class="label">Today's profit</div><div class="value">{{ d.totals.todayProfit | money }}</div><div class="hint">Month: {{ d.totals.monthProfit | money }}</div></div>
        }
        <div class="stat"><div class="label">This month</div><div class="value">{{ d.totals.monthSales | money }}</div></div>
        <a class="stat link" routerLink="/crates" [class.alert]="d.totals.pendingCrates > 0">
          <div class="label">Empty crates out</div><div class="value">{{ d.totals.pendingCrates }}</div><div class="hint">with {{ d.totals.customersWithCrates }} customer(s)</div></a>
        <a class="stat link" routerLink="/customers" [class.alert]="d.totals.totalOutstanding > 0">
          <div class="label">Owed by customers</div><div class="value">{{ d.totals.totalOutstanding | money }}</div><div class="hint">{{ d.totals.openSales }} open sale(s)</div></a>
      </div>

      <div class="cols">
        <div class="card chart-card">
          <div class="card-title">Net sales — last 30 days</div>
          <div class="chart"><canvas baseChart type="bar" [data]="trend()" [options]="moneyBars" aria-label="Net sales per day, last 30 days"></canvas></div>
        </div>

        <div class="card">
          <div class="card-title"><span class="material-symbols-outlined neg">inventory_2</span> Crates to collect</div>
          @for (c of d.topCrateDebtors; track c.customerId) {
            <a class="list-row" [routerLink]="['/customers', c.customerId]">
              <span>{{ c.businessName || c.customerName }}</span><span class="chip red">{{ c.pendingCrates }}</span>
            </a>
          } @empty { <p class="muted small">All crates are back.</p> }
        </div>
      </div>

      <div class="cols">
        <div class="card">
          <div class="card-title">Top products this month</div>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Product</th><th class="right">Sold</th><th class="right">Sales</th>@if (showProfit()) { <th class="right">Profit</th> }</tr></thead>
              <tbody>
                @for (p of d.topProducts; track p.productName) {
                  <tr><td>{{ p.productName }}</td><td class="right num">{{ p.quantity }}</td><td class="right money">{{ p.revenue | money }}</td>
                    @if (showProfit()) { <td class="right money">{{ p.profit | money }}</td> }</tr>
                } @empty { <tr><td colspan="4" class="muted">No sales yet this month.</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-title"><span class="material-symbols-outlined" [class.neg]="d.lowStock.length">warning</span> Stock alerts</div>
          @if (d.expiredCount || d.nearExpiryCount) {
            <a class="list-row" routerLink="/stock"><span>Batches expired / expiring soon</span><span class="chip red">{{ d.expiredCount }} / {{ d.nearExpiryCount }}</span></a>
          }
          @for (s of d.lowStock.slice(0, 8); track s.productId) {
            <a class="list-row" routerLink="/stock"><span>{{ s.productName }}</span><span class="chip" [class.red]="s.quantity === 0" [class.amber]="s.quantity > 0">{{ s.quantity | crates: s.bottlesPerCrate }}</span></a>
          } @empty { @if (!d.expiredCount && !d.nearExpiryCount) { <p class="muted small">Stock levels look fine.</p> } }
        </div>
      </div>
    } @else if (offlineSummary(); as o) {
      <div class="card">
        <div class="card-title">Offline summary (this device)</div>
        <div class="stats">
          <div class="stat"><div class="label">Sales waiting to sync</div><div class="value">{{ o.offlineSales }}</div></div>
          <div class="stat" [class.alert]="o.crates > 0"><div class="label">Crates out (cached)</div><div class="value">{{ o.crates }}</div></div>
          <div class="stat"><div class="label">Owed by customers (cached)</div><div class="value">{{ o.owed | money }}</div></div>
        </div>
        <p class="muted small">Full figures return when the server is reachable.</p>
      </div>
    } @else {
      <div class="stats">@for (i of [1,2,3,4]; track i) { <div class="stat"><div class="skeleton" style="width:50%"></div><div class="skeleton" style="height:24px;margin-top:10px"></div></div> }</div>
    }
  </div>
  `,
  styles: `
    .cols { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; margin-bottom: 16px; }
    .chart { height: 260px; }
    .stat.link { text-decoration: none; color: inherit; &:hover { border-color: var(--app-blue); } }
    .list-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--app-border);
      color: inherit; text-decoration: none; &:last-child { border-bottom: none; } &:hover { color: var(--app-blue); } }
    .red { --mat-button-filled-container-color: var(--app-red); }
    @media (max-width: 1000px) { .cols { grid-template-columns: 1fr; } }
  `,
})
export class DashboardPage {
  private api = inject(ApiService);
  private settings = inject(SettingsService);
  auth = inject(AuthService);
  net = inject(ConnectivityService);
  sync = inject(SyncService);

  now = new Date();
  d = signal<Dashboard | null>(null);
  offlineSummary = signal<{ offlineSales: number; crates: number; owed: number } | null>(null);
  moneyBars = barOptions({ money: true, symbol: this.settings.currencySymbol() });

  showProfit = computed(() => this.auth.hasRole('SuperAdmin', 'Admin', 'Manager', 'Viewer'));
  firstName = computed(() => (this.auth.user()?.fullName ?? '').split(' ')[0]);
  greeting = computed(() => { const h = this.now.getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; });

  trend = computed<ChartData<'bar'>>(() => {
    const rows = this.d()?.salesTrend ?? [];
    // Fill missing days so gaps show as zero rather than being skipped.
    const byDay = new Map(rows.map(r => [String(r.period).slice(0, 10), Number(r.net)]));
    const labels: string[] = [], values: number[] = [];
    const end = new Date(this.d()?.today ?? new Date());
    for (let i = 29; i >= 0; i--) {
      const day = new Date(end); day.setDate(end.getDate() - i);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      labels.push(day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
      values.push(byDay.get(key) ?? 0);
    }
    return { labels, datasets: [barDataset('Net sales', values)] };
  });

  async ngOnInit() {
    try {
      if (this.net.online() && this.auth.hasServerSession()) {
        this.d.set(await this.api.get<Dashboard>('/reports/dashboard'));
        return;
      }
    } catch { /* fall through to offline summary */ }
    const customers = await db.customers.toArray();
    this.offlineSummary.set({
      offlineSales: (await db.sales.filter(s => !!s.offline).count()),
      crates: customers.reduce((s, c) => s + Math.max(0, c.emptyCrateBalance), 0),
      owed: customers.reduce((s, c) => s + Math.max(0, c.outstandingBalance), 0),
    });
  }
}
