import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/http';
import { UserRole } from './core/models';

const SELLERS: UserRole[] = ['SuperAdmin', 'Admin', 'Manager', 'Salesman'];
const MANAGERS: UserRole[] = ['SuperAdmin', 'Admin', 'Manager'];
const ADMINS: UserRole[] = ['SuperAdmin', 'Admin'];
const REPORTS: UserRole[] = ['SuperAdmin', 'Admin', 'Manager', 'Viewer'];

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/auth/login.page').then(m => m.LoginPage) },
  {
    path: 'change-password', canActivate: [authGuard],
    loadComponent: () => import('./features/auth/change-password.page').then(m => m.ChangePasswordPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/layout/shell').then(m => m.Shell),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./features/dashboard/dashboard.page').then(m => m.DashboardPage) },
      { path: 'pos', canActivate: [roleGuard], data: { roles: SELLERS }, loadComponent: () => import('./features/pos/pos.page').then(m => m.PosPage) },
      { path: 'sales', loadComponent: () => import('./features/sales/sales-list.page').then(m => m.SalesListPage) },
      { path: 'sales/:id', loadComponent: () => import('./features/sales/sale-detail.page').then(m => m.SaleDetailPage) },
      { path: 'sales/:id/print', loadComponent: () => import('./features/sales/invoice-print.page').then(m => m.InvoicePrintPage) },
      { path: 'returns', loadComponent: () => import('./features/returns/returns.page').then(m => m.ReturnsPage) },
      { path: 'customers', loadComponent: () => import('./features/customers/customers.page').then(m => m.CustomersPage) },
      { path: 'customers/:id', loadComponent: () => import('./features/customers/customer-detail.page').then(m => m.CustomerDetailPage) },
      { path: 'crates', loadComponent: () => import('./features/crates/crates.page').then(m => m.CratesPage) },
      { path: 'products', loadComponent: () => import('./features/products/products.page').then(m => m.ProductsPage) },
      { path: 'stock', loadComponent: () => import('./features/stock/stock.page').then(m => m.StockPage) },
      { path: 'purchases', canActivate: [roleGuard], data: { roles: REPORTS }, loadComponent: () => import('./features/purchases/purchases.page').then(m => m.PurchasesPage) },
      { path: 'purchases/new', canActivate: [roleGuard], data: { roles: MANAGERS }, loadComponent: () => import('./features/purchases/purchase-new.page').then(m => m.PurchaseNewPage) },
      { path: 'purchases/:id', canActivate: [roleGuard], data: { roles: REPORTS }, loadComponent: () => import('./features/purchases/purchase-detail.page').then(m => m.PurchaseDetailPage) },
      { path: 'reports', canActivate: [roleGuard], data: { roles: REPORTS }, loadComponent: () => import('./features/reports/reports.page').then(m => m.ReportsPage) },
      { path: 'users', canActivate: [roleGuard], data: { roles: ADMINS }, loadComponent: () => import('./features/users/users.page').then(m => m.UsersPage) },
      { path: 'settings', canActivate: [roleGuard], data: { roles: ADMINS }, loadComponent: () => import('./features/settings/settings.page').then(m => m.SettingsPage) },
      { path: 'sync', loadComponent: () => import('./features/sync/sync.page').then(m => m.SyncPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
