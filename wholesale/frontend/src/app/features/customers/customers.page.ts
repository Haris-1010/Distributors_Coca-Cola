import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { Customer } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { DataService } from '../../offline/data.service';
import { MoneyPipe } from '../../shared/pipes';
import { CustomerDialog } from './customer.dialog';

@Component({
  selector: 'app-customers',
  imports: [FormsModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatInputModule, MoneyPipe],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Customers</h1><div class="sub">Shops, restaurants and retailers you supply.</div></div>
      <div class="actions">@if (auth.canSell) { <button mat-flat-button (click)="add()"><span class="material-symbols-outlined">person_add</span> New customer</button> }</div>
    </div>

    <div class="stats">
      <div class="stat"><div class="label">Customers</div><div class="value">{{ all().length }}</div></div>
      <div class="stat" [class.alert]="totalDue() > 0"><div class="label">Money owed to you</div><div class="value">{{ totalDue() | money }}</div></div>
      <div class="stat" [class.alert]="totalCrates() > 0"><div class="label">Empty crates out</div><div class="value">{{ totalCrates() }}</div></div>
    </div>

    <div class="filters">
      <mat-button-toggle-group [value]="filter()" (change)="filter.set($event.value)" hideSingleSelectionIndicator>
        <mat-button-toggle value="all">All</mat-button-toggle>
        <mat-button-toggle value="money">Owe money</mat-button-toggle>
        <mat-button-toggle value="crates">Owe crates</mat-button-toggle>
      </mat-button-toggle-group>
      <mat-form-field class="grow">
        <mat-label>Search name, shop or phone</mat-label>
        <input matInput [ngModel]="search()" (ngModelChange)="search.set($event)">
      </mat-form-field>
    </div>

    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Shop / name</th><th>Phone</th><th>Type</th><th class="right">Balance</th><th class="right">Crates owed</th></tr></thead>
        <tbody>
          @if (loading()) { @for (i of [1,2,3,4]; track i) { <tr><td colspan="5"><div class="skeleton"></div></td></tr> } }
          @for (c of rows(); track c.id) {
            <tr class="clickable" (click)="open(c)">
              <td><b>{{ c.businessName || c.name }}</b>@if (c.businessName) { <div class="small muted">{{ c.name }}</div> }</td>
              <td>{{ c.phone }}</td>
              <td>{{ c.customerType }}</td>
              <td class="right money" [class.neg]="c.outstandingBalance > 0" [class.pos]="c.outstandingBalance < 0">
                {{ c.outstandingBalance < 0 ? 'Advance ' : '' }}{{ (c.outstandingBalance < 0 ? -c.outstandingBalance : c.outstandingBalance) | money }}</td>
              <td class="right num">@if (c.emptyCrateBalance > 0) { <span class="chip red">{{ c.emptyCrateBalance }}</span> } @else { — }</td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="5"><div class="empty"><span class="material-symbols-outlined">storefront</span>No customers found.</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
  </div>
  `,
})
export class CustomersPage {
  private data = inject(DataService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private notify = inject(NotifyService);
  auth = inject(AuthService);

  all = signal<Customer[]>([]);
  loading = signal(true);
  search = signal('');
  filter = signal<'all' | 'money' | 'crates'>('all');

  rows = computed(() => {
    const q = this.search().toLowerCase();
    return this.all().filter(c =>
      (this.filter() !== 'money' || c.outstandingBalance > 0) &&
      (this.filter() !== 'crates' || c.emptyCrateBalance > 0) &&
      (!q || c.name.toLowerCase().includes(q) || (c.businessName ?? '').toLowerCase().includes(q) || (c.phone ?? '').includes(q)));
  });
  totalDue = computed(() => this.all().reduce((s, c) => s + Math.max(0, c.outstandingBalance), 0));
  totalCrates = computed(() => this.all().reduce((s, c) => s + Math.max(0, c.emptyCrateBalance), 0));

  async ngOnInit() {
    try { this.all.set(await this.data.customers()); } catch (e) { this.notify.error(e); } finally { this.loading.set(false); }
  }

  async add() {
    const c = await firstValueFrom(this.dialog.open(CustomerDialog, { width: '560px', data: null }).afterClosed());
    if (c) this.all.set([c, ...this.all()]);
  }

  open(c: Customer) { void this.router.navigate(['/customers', c.id]); }
}
