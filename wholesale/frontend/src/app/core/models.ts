// Mirrors the API DTOs. Enums travel as strings.

export type UserRole = 'SuperAdmin' | 'Admin' | 'Manager' | 'Salesman' | 'Viewer';
export type Brand = string;
export type UnitType = 'Bottle' | 'Can' | 'PET' | 'Glass';
export type CustomerType = 'Retailer' | 'Restaurant' | 'Shop' | 'Other';
export type PaymentStatus = 'Unpaid' | 'Partial' | 'Paid';
export type PaymentMode = 'Cash' | 'Credit' | 'JazzCash' | 'Easypaisa' | 'BankTransfer' | 'Cheque';
export type ReturnReason = 'Damaged' | 'Extra' | 'Unsold' | 'Expired' | 'Other';
export type CrateTransactionType = 'Issued' | 'Returned' | 'Adjustment';

export const ROLES: UserRole[] = ['SuperAdmin', 'Admin', 'Manager', 'Salesman', 'Viewer'];
export const UNIT_TYPES: UnitType[] = ['Glass', 'PET', 'Can', 'Bottle'];
export const CUSTOMER_TYPES: CustomerType[] = ['Retailer', 'Shop', 'Restaurant', 'Other'];
export const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'Cash', label: 'Cash' }, { value: 'Credit', label: 'Credit (pay later)' },
  { value: 'JazzCash', label: 'JazzCash' }, { value: 'Easypaisa', label: 'Easypaisa' },
  { value: 'BankTransfer', label: 'Bank transfer' }, { value: 'Cheque', label: 'Cheque' },
];
export const RETURN_REASONS: { value: ReturnReason; label: string; restock: boolean }[] = [
  { value: 'Unsold', label: 'Unsold', restock: true },
  { value: 'Extra', label: 'Extra / wrong item', restock: true },
  { value: 'Damaged', label: 'Damaged (written off)', restock: false },
  { value: 'Expired', label: 'Expired (written off)', restock: false },
  { value: 'Other', label: 'Other', restock: true },
];

export interface User {
  id: string; fullName: string; email: string; role: UserRole; isActive: boolean;
  mustChangePassword: boolean; lastLoginAt?: string | null; createdAt: string;
}

export interface AuthResponse {
  accessToken: string; accessTokenExpiresAt: string; refreshToken: string; refreshTokenExpiresAt: string; user: User;
}

export interface Product {
  id: string; name: string; brand: Brand; category: string; unitType: UnitType; packSize?: string | null;
  isCrateRequired: boolean; bottlesPerCrate: number; purchasePrice: number; sellingPrice: number;
  minProfit: number; maxProfit: number; barcode?: string | null; sku?: string | null;
  lowStockThreshold: number; isActive: boolean; stockQuantity: number; minSellingPrice: number; updatedAt?: string | null;
}

export interface StockSummary {
  productId: string; productName: string; brand: Brand; unitType: UnitType; bottlesPerCrate: number;
  quantity: number; crateQuantity: number; loosePieces: number; stockValue: number;
  lowStockThreshold: number; isLowStock: boolean; nearestExpiry?: string | null; batchCount: number;
}

export interface StockBatch {
  id: string; productId: string; productName: string; batchNumber: string; expiryDate?: string | null;
  quantity: number; crateQuantity: number; loosePieces: number; purchasePriceAtTime: number;
  location: string; lastUpdated: string; daysToExpiry?: number | null;
}

export interface StockAlerts { lowStockCount: number; nearExpiryCount: number; expiredCount: number; }

export interface PurchaseItem {
  id?: string; productId: string; productName?: string; quantity: number; unitPrice: number; total?: number;
  batchNumber?: string | null; expiryDate?: string | null;
}

export interface Purchase {
  id: string; invoiceNumber: string; distributorName: string; purchaseDate: string; totalAmount: number;
  paidAmount: number; balance: number; paymentStatus: PaymentStatus; notes?: string | null; itemCount: number;
  items: PurchaseItem[]; offline?: boolean;
}

export interface Customer {
  id: string; name: string; phone?: string | null; address?: string | null; businessName?: string | null;
  customerType: CustomerType; outstandingBalance: number; emptyCrateBalance: number; isActive: boolean;
  createdAt: string; updatedAt?: string | null;
}

export interface SaleItem {
  id: string; productId: string; productName: string; quantity: number; returnedQuantity: number; netQuantity: number;
  unitPrice: number; purchasePriceAtSale: number; profitPerUnit: number; total: number;
  isCrateRequired: boolean; bottlesPerCrate: number; cratesRequired: number; priceOverridden: boolean;
}

export interface SaleReturn {
  id: string; saleId: string; invoiceNumber?: string | null; customerName?: string | null; saleItemId: string;
  productId: string; productName: string; quantity: number; reason: ReturnReason; returnDate: string;
  stockAdjusted: boolean; returnValue: number; profitReversed: number; cratesReduced: number; refundAmount: number; notes?: string | null;
}

export interface Payment {
  id: string; customerId: string; saleId?: string | null; amount: number; direction: 'Received' | 'Refund';
  paymentMode: PaymentMode; paymentDate: string; notes?: string | null;
}

export interface Sale {
  id: string; invoiceNumber: string; customerId: string; customerName: string; customerBusinessName?: string | null;
  customerPhone?: string | null; saleDate: string; totalAmount: number; discount: number; returnedAmount: number;
  netAmount: number; paidAmount: number; balance: number; paymentMode: PaymentMode; paymentStatus: PaymentStatus;
  profitAmount: number; emptyCratesRequired: number; emptyCratesReturned: number; pendingCrates: number;
  isSettled: boolean; settledAt?: string | null; settlementOverridden: boolean; settlementOverrideReason?: string | null;
  notes?: string | null; offlineReference?: string | null; createdByName?: string | null;
  items: SaleItem[]; returns: SaleReturn[]; payments: Payment[]; settlementBlockers: string[];
  /** Set on sales made offline that have not reached the server yet. */
  offline?: boolean;
}

export interface SaleListItem {
  id: string; invoiceNumber: string; customerId: string; customerName: string; saleDate: string;
  netAmount: number; paidAmount: number; balance: number; profitAmount: number; paymentStatus: PaymentStatus;
  emptyCratesRequired: number; emptyCratesReturned: number; pendingCrates: number; isSettled: boolean;
  offline?: boolean;
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; }

export interface LedgerEntry {
  date: string; type: string; reference: string; saleId?: string | null; debit: number; credit: number;
  balance: number; cratesIssued: number; cratesReturned: number; crateBalance: number; notes?: string | null;
}
export interface CustomerLedger {
  customer: Customer; openingBalance: number; openingCrates: number; entries: LedgerEntry[];
  closingBalance: number; closingCrates: number;
}

export interface CrateTransaction {
  id: string; customerId: string; customerName?: string | null; saleId?: string | null; invoiceNumber?: string | null;
  transactionType: CrateTransactionType; quantity: number; date: string; notes?: string | null;
}
export interface CustomerCrateSummary {
  customerId: string; customerName: string; businessName?: string | null; phone?: string | null;
  cratesIssued: number; cratesReturned: number; adjustments: number; pendingCrates: number;
  openSales: number; oldestPendingSaleDate?: string | null;
}

export type Settings = Record<string, string>;

// ---------- Requests ----------
export interface SaleItemRequest { productId: string; quantity: number; unitPrice?: number | null; }
export interface CreateSaleRequest {
  id: string; customerId: string; saleDate?: string; items: SaleItemRequest[]; discount: number;
  paidAmount: number; paymentMode: PaymentMode; cratesReturnedNow: number; notes?: string | null; offlineReference?: string | null;
}
export interface CreatePurchaseRequest {
  id: string; invoiceNumber?: string | null; distributorName: string; purchaseDate?: string | null;
  paidAmount: number; notes?: string | null; items: PurchaseItem[];
}
export interface UpdatePurchaseRequest {
  invoiceNumber: string; distributorName: string; purchaseDate: string;
  notes?: string | null; items: PurchaseItem[];
}
export interface CreateReturnRequest {
  id: string; saleId: string; lines: { saleItemId: string; quantity: number; reason: ReturnReason }[];
  returnDate?: string | null; notes?: string | null;
}
export interface CustomerPaymentRequest {
  id: string; amount: number; paymentMode: PaymentMode; saleId?: string | null; paymentDate?: string | null; notes?: string | null;
}
export interface CrateReturnRequest {
  id: string; customerId: string; quantity: number; saleId?: string | null; date?: string | null; notes?: string | null;
}
export interface SaveCustomerRequest {
  id?: string; name: string; phone?: string | null; address?: string | null; businessName?: string | null;
  customerType: CustomerType; isActive: boolean;
}
export interface StockAdjustmentRequest {
  productId: string; stockBatchId?: string | null; quantity: number; reason: string;
  batchNumber?: string | null; expiryDate?: string | null; unitCost?: number | null;
}
