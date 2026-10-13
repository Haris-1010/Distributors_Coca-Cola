import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { Brand, Customer, PAYMENT_MODES, PaymentMode, Product, Sale } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { SettingsService } from '../../core/settings.service';
import { cratesFor, round2, uuid } from '../../core/util';
import { ConnectivityService } from '../../offline/connectivity.service';
import { DataService } from '../../offline/data.service';
import { BrandPipe, CratesPipe, IntPipe, MoneyPipe } from '../../shared/pipes';
import { CustomerDialog } from '../customers/customer.dialog';
import { SaleDoneDialog } from './sale-done.dialog';

interface CartLine {
  key: string;
  product: Product;
  quantity: number;
  unitPrice: number;
}

@Component({
  selector: 'app-pos',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatAutocompleteModule, MatButtonModule, MatButtonToggleModule,
    MatIconModule, MatSelectModule, MatTooltipModule, MatProgressSpinnerModule, MoneyPipe, IntPipe, CratesPipe, BrandPipe],
  templateUrl: './pos.page.html',
  styleUrl: './pos.page.scss',
})
export class PosPage {
  private data = inject(DataService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  private router = inject(Router);
  auth = inject(AuthService);
  settings = inject(SettingsService);
  conn = inject(ConnectivityService);

  searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  readonly paymentModes = PAYMENT_MODES;
  readonly isManager = this.auth.isManager;

  products = signal<Product[]>([]);
  customers = signal<Customer[]>([]);
  loading = signal(true);
  saving = signal(false);

  search = signal('');
  brand = signal<Brand | 'All'>('All');
  customerQuery = signal<string | Customer>('');
  customer = signal<Customer | null>(null);
  cart = signal<CartLine[]>([]);
  discount = signal(0);
  paymentMode = signal<PaymentMode>('Cash');
  paid = signal<number | null>(null); // null = "pay in full" for cash-like modes
  cratesReturnedNow = signal(0);
  notes = signal('');

  // ---------- Derived ----------
  filteredProducts = computed(() => {
    const q = this.search().trim().toLowerCase();
    const b = this.brand();
    return this.products().filter(p =>
      (b === 'All' || p.brand === b) &&
      (!q || p.name.toLowerCase().includes(q) || p.barcode === q || (p.sku ?? '').toLowerCase() === q));
  });

  filteredCustomers = computed(() => {
    const raw = this.customerQuery();
    if (typeof raw !== 'string') return this.customers().slice(0, 30);
    const q = raw.toLowerCase();
    return this.customers()
      .filter(c => !q || c.name.toLowerCase().includes(q) || (c.businessName ?? '').toLowerCase().includes(q) || (c.phone ?? '').includes(q))
      .slice(0, 30);
  });

  inCart = computed(() => {
    const m = new Map<string, number>();
    for (const l of this.cart()) m.set(l.product.id, (m.get(l.product.id) ?? 0) + l.quantity);
    return m;
  });

  subtotal = computed(() => round2(this.cart().reduce((s, l) => s + l.quantity * l.unitPrice, 0)));
  netAmount = computed(() => round2(Math.max(0, this.subtotal() - (this.discount() || 0))));
  profit = computed(() => round2(this.cart().reduce((s, l) => s + l.quantity * (l.unitPrice - l.product.purchasePrice), 0) - (this.discount() || 0)));
  cratesRequired = computed(() => this.cart().reduce((s, l) => s + (l.product.isCrateRequired ? cratesFor(l.quantity, l.product.bottlesPerCrate) : 0), 0));
  glassBottles = computed(() => this.cart().filter(l => l.product.isCrateRequired).reduce((s, l) => s + l.quantity, 0));
  cratesOwedBefore = computed(() => this.customer()?.emptyCrateBalance ?? 0);
  cratesOwedAfter = computed(() => this.cratesOwedBefore() + this.cratesRequired() - (this.cratesReturnedNow() || 0));
  paidAmount = computed(() => this.paymentMode() === 'Credit' ? 0 : (this.paid() ?? this.netAmount()));
  balanceDue = computed(() => round2(Math.max(0, this.netAmount() - this.paidAmount())));
  totalPieces = computed(() => this.cart().reduce((s, l) => s + l.quantity, 0));

  /** Lines priced below cost + minimum profit. */
  belowMin = computed(() => this.cart().filter(l => l.unitPrice < this.minPrice(l.product)));

  canComplete = computed(() =>
    !!this.customer() && this.cart().length > 0 && !this.saving() &&
    this.cart().every(l => l.quantity > 0 && l.quantity <= this.stockLeft(l.product, l)) &&
    (this.isManager || this.belowMin().length === 0) &&
    (this.cratesReturnedNow() || 0) <= this.cratesOwedBefore() + this.cratesRequired());

  constructor() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      const [p, c] = await Promise.all([this.data.products(), this.data.customers()]);
      this.products.set(p);
      this.customers.set(c);
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  minPrice(p: Product): number {
    const min = this.settings.profitPerCrate() && p.bottlesPerCrate > 0 ? round2(p.minProfit / p.bottlesPerCrate) : p.minProfit;
    return round2(p.purchasePrice + min);
  }

  /** Stock still free for this line (other lines of the same product count too). */
  stockLeft(p: Product, line?: CartLine): number {
    const used = this.cart().filter(l => l.product.id === p.id && l !== line).reduce((s, l) => s + l.quantity, 0);
    return p.stockQuantity - used;
  }

  available(p: Product): number { return p.stockQuantity - (this.inCart().get(p.id) ?? 0); }

  // ---------- Cart actions ----------

  /** Tap a product: adds a full crate / pack. Shift-tap: adds one piece. */
  add(p: Product, pieces?: number) {
    const step = pieces ?? Math.max(1, p.bottlesPerCrate);
    const free = this.available(p);
    if (free <= 0) { this.notify.error(`${p.name} is out of stock.`); return; }
    const qty = Math.min(step, free);
    const lines = [...this.cart()];
    const existing = lines.find(l => l.product.id === p.id && l.unitPrice === p.sellingPrice);
    if (existing) existing.quantity += qty;
    else lines.unshift({ key: uuid(), product: p, quantity: qty, unitPrice: p.sellingPrice });
    this.cart.set(lines);
    if (qty < step) this.notify.info(`Only ${qty} ${p.name} left in stock.`);
  }

  changeQty(line: CartLine, delta: number) {
    const max = this.stockLeft(line.product, line);
    line.quantity = Math.max(0, Math.min(max, line.quantity + delta));
    this.cart.set(line.quantity === 0 ? this.cart().filter(l => l !== line) : [...this.cart()]);
  }

  setQty(line: CartLine, value: number | string) {
    const n = Math.floor(Number(value) || 0);
    line.quantity = Math.max(0, n);
    this.cart.set([...this.cart()]);
  }

  setPrice(line: CartLine, value: number | string) {
    line.unitPrice = round2(Math.max(0, Number(value) || 0));
    this.cart.set([...this.cart()]);
  }

  remove(line: CartLine) { this.cart.set(this.cart().filter(l => l !== line)); }

  onSearchEnter() {
    const q = this.search().trim();
    if (!q) return;
    // Barcode scanners type the code and press Enter.
    const exact = this.products().find(p => p.barcode === q || p.sku?.toLowerCase() === q.toLowerCase());
    const target = exact ?? (this.filteredProducts().length === 1 ? this.filteredProducts()[0] : null);
    if (target) { this.add(target); this.search.set(''); }
  }

  // ---------- Customer ----------
  customerLabel = (c: Customer | string | null) => typeof c === 'string' ? c : c ? (c.businessName ? `${c.businessName} — ${c.name}` : c.name) : '';

  pickCustomer(c: Customer) {
    this.customer.set(c);
    this.cratesReturnedNow.set(0);
  }

  clearCustomer() {
    this.customer.set(null);
    this.customerQuery.set('');
  }

  async quickAddCustomer() {
    const c = await firstValueFrom(this.dialog.open(CustomerDialog, { width: '560px', data: null }).afterClosed());
    if (c) {
      this.customers.set([c, ...this.customers()]);
      this.pickCustomer(c);
    }
  }

  setMode(m: PaymentMode) {
    this.paymentMode.set(m);
    this.paid.set(m === 'Credit' ? 0 : null);
  }

  // ---------- Complete ----------
  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (e.key === 'F9' || (e.ctrlKey && e.key === 'Enter')) { e.preventDefault(); void this.complete(); }
    if (e.key === '/' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); this.searchBox()?.nativeElement.focus(); }
  }

  async complete() {
    if (!this.canComplete()) return;
    const customer = this.customer()!;
    this.saving.set(true);
    try {
      const sale: Sale = await this.data.createSale({
        id: uuid(),
        customerId: customer.id,
        items: this.cart().map(l => ({ productId: l.product.id, quantity: l.quantity, unitPrice: l.unitPrice })),
        discount: this.discount() || 0,
        paidAmount: this.paidAmount(),
        paymentMode: this.paymentMode(),
        cratesReturnedNow: this.cratesReturnedNow() || 0,
        notes: this.notes() || null,
      });
      const next = await firstValueFrom(this.dialog.open(SaleDoneDialog, { data: sale, width: '440px', disableClose: true }).afterClosed());
      this.reset();
      void this.load();
      if (next === 'view') await this.router.navigate(['/sales', sale.id]);
      if (next === 'print') await this.router.navigate(['/sales', sale.id, 'print']);
    } catch (e) {
      this.notify.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async clearCart() {
    if (this.cart().length && !(await this.notify.confirm({ title: 'Clear this sale?', message: 'All items will be removed.', confirmText: 'Clear' }))) return;
    this.reset();
  }

  private reset() {
    this.cart.set([]);
    this.discount.set(0);
    this.paid.set(null);
    this.paymentMode.set('Cash');
    this.cratesReturnedNow.set(0);
    this.notes.set('');
    this.clearCustomer();
    setTimeout(() => this.searchBox()?.nativeElement.focus());
  }
}
