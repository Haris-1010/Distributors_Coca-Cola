import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { UserRole } from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { ConnectivityService } from '../../offline/connectivity.service';
import { SyncService } from '../../offline/sync.service';

interface NavItem { path: string; label: string; icon: string; roles?: UserRole[]; exact?: boolean; }

const ADMINS: UserRole[] = ['SuperAdmin', 'Admin'];
const REPORTS: UserRole[] = ['SuperAdmin', 'Admin', 'Manager', 'Viewer'];

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatSidenavModule, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  template: `
  <mat-sidenav-container class="container">
    <mat-sidenav class="nav" [mode]="mobile() ? 'over' : 'side'" [opened]="!mobile() || navOpen()" (closedStart)="navOpen.set(false)">
      <div class="nav-brand">
        <div class="mark"><span class="material-symbols-outlined">local_shipping</span></div>
        <div class="name">{{ settings.companyName() }}</div>
      </div>

      @if (auth.canSell) {
        <a class="new-sale" routerLink="/pos" (click)="closeOnMobile()">
          <span class="material-symbols-outlined">add_shopping_cart</span> New sale
        </a>
      }

      <nav>
        @for (group of groups(); track group.title) {
          <div class="group-title">{{ group.title }}</div>
          @for (item of group.items; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }" (click)="closeOnMobile()">
              <span class="material-symbols-outlined">{{ item.icon }}</span>
              <span class="label">{{ item.label }}</span>
              @if (item.path === '/sync' && sync.pendingCount() > 0) { <span class="badge">{{ sync.pendingCount() }}</span> }
            </a>
          }
        }
      </nav>
    </mat-sidenav>

    <mat-sidenav-content class="content">
      <header class="topbar no-print">
        @if (mobile()) {
          <button mat-icon-button (click)="navOpen.set(true)" aria-label="Open menu"><mat-icon class="material-symbols-outlined">menu</mat-icon></button>
        }
        <span class="spacer"></span>

        <a class="status" routerLink="/sync" [class.offline]="!net.online()" [class.pending]="sync.pendingCount() > 0"
           [matTooltip]="statusTooltip()">
          <span class="dot"></span>
          @if (!net.online()) { Offline mode }
          @else if (sync.syncing()) { Syncing… }
          @else if (sync.pendingCount() > 0) { {{ sync.pendingCount() }} waiting to sync }
          @else { Online }
        </a>

        <button mat-button [matMenuTriggerFor]="userMenu" class="user">
          <span class="avatar">{{ initials() }}</span>
          <span class="who"><b>{{ auth.user()?.fullName }}</b><small>{{ auth.role() }}</small></span>
        </button>
        <mat-menu #userMenu="matMenu">
          <button mat-menu-item routerLink="/change-password"><mat-icon class="material-symbols-outlined">key</mat-icon> Change password</button>
          <button mat-menu-item (click)="toggleDark()"><mat-icon class="material-symbols-outlined">{{ dark() ? 'light_mode' : 'dark_mode' }}</mat-icon> {{ dark() ? 'Light' : 'Dark' }} mode</button>
          <button mat-menu-item (click)="logout()"><mat-icon class="material-symbols-outlined">logout</mat-icon> Sign out</button>
        </mat-menu>
      </header>

      @if (sync.needsLogin()) {
        <div class="banner warn no-print">
          <span class="material-symbols-outlined">lock</span>
          You're back online. Sign in again so {{ sync.pendingCount() }} offline change(s) can be sent to the server.
          <span class="spacer"></span>
          <button mat-stroked-button (click)="relogin()">Sign in</button>
        </div>
      } @else if (!net.online()) {
        <div class="banner offline no-print">
          <span class="material-symbols-outlined">cloud_off</span>
          Working offline. Sales, returns, payments and crates are saved on this device and will sync automatically.
        </div>
      }
      @if (sync.rejected().length > 0) {
        <a class="banner error no-print" routerLink="/sync">
          <span class="material-symbols-outlined">error</span>
          {{ sync.rejected().length }} offline change(s) were refused by the server. Tap to review.
        </a>
      }

      <main><router-outlet /></main>
    </mat-sidenav-content>
  </mat-sidenav-container>
  `,
  styles: `
    .container { height: 100vh; background: var(--app-bg); }
    .nav { width: 232px; background: var(--app-nav); color: var(--app-nav-ink); border-right: none; border-radius: 0; }
    .nav-brand { display: flex; align-items: center; gap: 10px; padding: 18px 16px 14px; color: #fff;
      .mark { width: 34px; height: 34px; border-radius: 9px; background: rgba(255,255,255,.12); display: grid; place-items: center; }
      .name { font-weight: 700; font-size: 15px; line-height: 1.2; } }
    .new-sale { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 6px 14px 10px; padding: 10px;
      border-radius: 10px; background: var(--app-red); color: #fff; font-weight: 700; text-decoration: none;
      &:hover { filter: brightness(1.08); } }
    nav { padding: 4px 8px 24px; }
    .group-title { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; opacity: .55; padding: 14px 10px 6px; }
    nav a { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 8px; color: var(--app-nav-ink);
      text-decoration: none; font-weight: 500;
      .material-symbols-outlined { font-size: 20px; opacity: .85; }
      &:hover { background: rgba(255,255,255,.06); color: #fff; }
      &.active { background: rgba(255,255,255,.12); color: #fff; .material-symbols-outlined { opacity: 1; } }
      .badge { margin-left: auto; background: var(--app-amber); color: #fff; border-radius: 999px; font-size: 11px; padding: 0 7px; line-height: 18px; } }
    .content { display: flex; flex-direction: column; }
    .topbar { display: flex; align-items: center; gap: 10px; height: 56px; padding: 0 16px; background: var(--app-surface);
      border-bottom: 1px solid var(--app-border); position: sticky; top: 0; z-index: 5; }
    .status { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;
      background: var(--app-green-soft); color: var(--app-green); text-decoration: none;
      .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
      &.pending { background: var(--app-amber-soft); color: var(--app-amber); }
      &.offline { background: var(--app-red-soft); color: var(--app-red); } }
    .user { height: 44px; .who { display: inline-flex; flex-direction: column; align-items: flex-start; line-height: 1.1; margin-left: 8px;
      small { color: var(--app-muted); font-size: 11px; } } }
    .avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--app-blue); color: #fff; display: inline-grid; place-items: center;
      font-size: 12px; font-weight: 700; vertical-align: middle; }
    .banner { display: flex; align-items: center; gap: 10px; padding: 10px 20px; font-size: 13px; font-weight: 500; text-decoration: none; }
    .banner.offline { background: var(--app-amber-soft); color: var(--app-amber); }
    .banner.warn { background: #e6eef9; color: var(--app-blue); }
    .banner.error { background: var(--app-red-soft); color: var(--app-red); }
    main { flex: 1; }
    @media (max-width: 700px) { .who { display: none !important; } }
  `,
})
export class Shell {
  auth = inject(AuthService);
  net = inject(ConnectivityService);
  sync = inject(SyncService);
  settings = inject(SettingsService);
  private router = inject(Router);
  private bp = inject(BreakpointObserver);

  mobile = toSignal(this.bp.observe('(max-width: 960px)').pipe(map(r => r.matches)), { initialValue: false });
  navOpen = signal(false);
  dark = signal(document.documentElement.classList.contains('dark'));

  private all: { title: string; items: NavItem[] }[] = [
    { title: 'Selling', items: [
      { path: '/', label: 'Dashboard', icon: 'space_dashboard', exact: true },
      { path: '/sales', label: 'Sales', icon: 'receipt_long' },
      { path: '/returns', label: 'Returns', icon: 'assignment_return' },
      { path: '/crates', label: 'Empty crates', icon: 'inventory_2' },
      { path: '/customers', label: 'Customers', icon: 'storefront' },
    ]},
    { title: 'Stock', items: [
      { path: '/stock', label: 'Stock', icon: 'warehouse' },
      { path: '/products', label: 'Products', icon: 'liquor' },
      { path: '/purchases', label: 'Purchases', icon: 'local_shipping', roles: REPORTS },
    ]},
    { title: 'Business', items: [
      { path: '/reports', label: 'Reports', icon: 'monitoring', roles: REPORTS },
      { path: '/sync', label: 'Sync status', icon: 'sync' },
      { path: '/users', label: 'Users', icon: 'group', roles: ADMINS },
      { path: '/settings', label: 'Settings', icon: 'settings', roles: ADMINS },
    ]},
  ];

  groups = computed(() => {
    const role = this.auth.role();
    return this.all
      .map(g => ({ ...g, items: g.items.filter(i => !i.roles || (role && i.roles.includes(role))) }))
      .filter(g => g.items.length);
  });

  initials = computed(() => (this.auth.user()?.fullName ?? '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase());

  statusTooltip = computed(() => {
    const last = this.sync.lastSyncAt();
    return last ? `Last synced ${new Date(last).toLocaleString()}` : 'Not synced yet';
  });

  constructor() {
    if (localStorage.getItem('wh.dark') === '1') { document.documentElement.classList.add('dark'); this.dark.set(true); }
    void this.sync.refreshCache().catch(() => undefined);
  }

  closeOnMobile() { if (this.mobile()) this.navOpen.set(false); }

  toggleDark() {
    const on = !this.dark();
    this.dark.set(on);
    document.documentElement.classList.toggle('dark', on);
    localStorage.setItem('wh.dark', on ? '1' : '0');
  }

  /** Offline work stays queued on this device and syncs after the next sign-in. */
  async logout() { await this.auth.logout(); }

  relogin() {
    void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
  }
}
