using WholesaleAPI.Models;

namespace WholesaleAPI.DTOs;

// ---------- Auth & users ----------
public record LoginRequest(string Email, string Password);
public record RefreshRequest(string RefreshToken);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public class AuthResponse
{
    public string AccessToken { get; set; } = "";
    public DateTime AccessTokenExpiresAt { get; set; }
    public string RefreshToken { get; set; } = "";
    public DateTime RefreshTokenExpiresAt { get; set; }
    public UserDto User { get; set; } = new();
}

public class UserDto
{
    public Guid Id { get; set; }
    public string FullName { get; set; } = "";
    public string Email { get; set; } = "";
    public UserRole Role { get; set; }
    public bool IsActive { get; set; }
    public bool MustChangePassword { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

public record CreateUserRequest(string FullName, string Email, string Password, UserRole Role);
public record UpdateUserRequest(string FullName, string Email, UserRole Role, bool IsActive);
public record ResetPasswordRequest(string NewPassword);

// ---------- Products ----------
public class ProductDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public Brand Brand { get; set; }
    public string Category { get; set; } = "";
    public UnitType UnitType { get; set; }
    public string? PackSize { get; set; }
    public bool IsCrateRequired { get; set; }
    public int BottlesPerCrate { get; set; }
    public decimal PurchasePrice { get; set; }
    public decimal SellingPrice { get; set; }
    public decimal MinProfit { get; set; }
    public decimal MaxProfit { get; set; }
    public string? Barcode { get; set; }
    public string? Sku { get; set; }
    public int LowStockThreshold { get; set; }
    public bool IsActive { get; set; }
    public int StockQuantity { get; set; }
    /// <summary>Lowest price a Salesman may sell at: cost + minimum profit.</summary>
    public decimal MinSellingPrice { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

public record SaveProductRequest(
    string Name, Brand Brand, string Category, UnitType UnitType, string? PackSize,
    bool IsCrateRequired, int BottlesPerCrate, decimal PurchasePrice, decimal SellingPrice,
    decimal MinProfit, decimal MaxProfit, string? Barcode, string? Sku, int LowStockThreshold, bool IsActive);

// ---------- Stock ----------
public class StockBatchDto
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public string BatchNumber { get; set; } = "";
    public DateOnly? ExpiryDate { get; set; }
    public int Quantity { get; set; }
    public int CrateQuantity { get; set; }
    public int LoosePieces { get; set; }
    public decimal PurchasePriceAtTime { get; set; }
    public string Location { get; set; } = "";
    public DateTime LastUpdated { get; set; }
    public int? DaysToExpiry { get; set; }
}

public class StockSummaryDto
{
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public Brand Brand { get; set; }
    public UnitType UnitType { get; set; }
    public int BottlesPerCrate { get; set; }
    public int Quantity { get; set; }
    public int CrateQuantity { get; set; }
    public int LoosePieces { get; set; }
    public decimal StockValue { get; set; }
    public int LowStockThreshold { get; set; }
    public bool IsLowStock { get; set; }
    public DateOnly? NearestExpiry { get; set; }
    public int BatchCount { get; set; }
}

public record StockAdjustmentRequest(
    Guid ProductId, Guid? StockBatchId, int Quantity, string Reason,
    string? BatchNumber, DateOnly? ExpiryDate, decimal? UnitCost);

public class StockAlertsDto
{
    public List<StockSummaryDto> LowStock { get; set; } = new();
    public List<StockBatchDto> NearExpiry { get; set; } = new();
    public List<StockBatchDto> Expired { get; set; } = new();
}

// ---------- Purchases ----------
public record PurchaseItemRequest(Guid ProductId, int Quantity, decimal UnitPrice, string? BatchNumber, DateOnly? ExpiryDate);

public record CreatePurchaseRequest(
    Guid? Id, string? InvoiceNumber, string DistributorName, DateTime? PurchaseDate,
    decimal PaidAmount, string? Notes, List<PurchaseItemRequest> Items);

public record PurchasePaymentRequest(decimal Amount, string? Notes);

public class PurchaseItemDto
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Total { get; set; }
    public string BatchNumber { get; set; } = "";
    public DateOnly? ExpiryDate { get; set; }
}

public class PurchaseDto
{
    public Guid Id { get; set; }
    public string InvoiceNumber { get; set; } = "";
    public string DistributorName { get; set; } = "";
    public DateTime PurchaseDate { get; set; }
    public decimal TotalAmount { get; set; }
    public decimal PaidAmount { get; set; }
    public decimal Balance { get; set; }
    public PaymentStatus PaymentStatus { get; set; }
    public string? Notes { get; set; }
    public int ItemCount { get; set; }
    public List<PurchaseItemDto> Items { get; set; } = new();
}

// ---------- Customers ----------
public class CustomerDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public string? BusinessName { get; set; }
    public CustomerType CustomerType { get; set; }
    public decimal OutstandingBalance { get; set; }
    public int EmptyCrateBalance { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

public record SaveCustomerRequest(Guid? Id, string Name, string? Phone, string? Address, string? BusinessName,
    CustomerType CustomerType, bool IsActive = true);

public record CustomerPaymentRequest(Guid? Id, decimal Amount, PaymentMode PaymentMode, Guid? SaleId, DateTime? PaymentDate, string? Notes);

public class LedgerEntryDto
{
    public DateTime Date { get; set; }
    public string Type { get; set; } = "";
    public string Reference { get; set; } = "";
    public Guid? SaleId { get; set; }
    public decimal Debit { get; set; }
    public decimal Credit { get; set; }
    public decimal Balance { get; set; }
    public int CratesIssued { get; set; }
    public int CratesReturned { get; set; }
    public int CrateBalance { get; set; }
    public string? Notes { get; set; }
}

public class CustomerLedgerDto
{
    public CustomerDto Customer { get; set; } = new();
    public decimal OpeningBalance { get; set; }
    public int OpeningCrates { get; set; }
    public List<LedgerEntryDto> Entries { get; set; } = new();
    public decimal ClosingBalance { get; set; }
    public int ClosingCrates { get; set; }
}

// ---------- Sales ----------
public record SaleItemRequest(Guid ProductId, int Quantity, decimal? UnitPrice);

public record CreateSaleRequest(
    Guid? Id, Guid CustomerId, DateTime? SaleDate, List<SaleItemRequest> Items, decimal Discount,
    decimal PaidAmount, PaymentMode PaymentMode, int CratesReturnedNow, string? Notes, string? OfflineReference);

public record SettleSaleRequest(bool Override, string? Reason);

public class SaleItemDto
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public int Quantity { get; set; }
    public int ReturnedQuantity { get; set; }
    public int NetQuantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal PurchasePriceAtSale { get; set; }
    public decimal ProfitPerUnit { get; set; }
    public decimal Total { get; set; }
    public bool IsCrateRequired { get; set; }
    public int BottlesPerCrate { get; set; }
    public int CratesRequired { get; set; }
    public bool PriceOverridden { get; set; }
}

public class SaleReturnDto
{
    public Guid Id { get; set; }
    public Guid SaleId { get; set; }
    public string? InvoiceNumber { get; set; }
    public string? CustomerName { get; set; }
    public Guid SaleItemId { get; set; }
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public int Quantity { get; set; }
    public ReturnReason Reason { get; set; }
    public DateTime ReturnDate { get; set; }
    public bool StockAdjusted { get; set; }
    public decimal ReturnValue { get; set; }
    public decimal ProfitReversed { get; set; }
    public int CratesReduced { get; set; }
    public decimal RefundAmount { get; set; }
    public string? Notes { get; set; }
}

public class SaleDto
{
    public Guid Id { get; set; }
    public string InvoiceNumber { get; set; } = "";
    public Guid CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public string? CustomerBusinessName { get; set; }
    public string? CustomerPhone { get; set; }
    public DateTime SaleDate { get; set; }
    public decimal TotalAmount { get; set; }
    public decimal Discount { get; set; }
    public decimal ReturnedAmount { get; set; }
    public decimal NetAmount { get; set; }
    public decimal PaidAmount { get; set; }
    public decimal Balance { get; set; }
    public PaymentMode PaymentMode { get; set; }
    public PaymentStatus PaymentStatus { get; set; }
    public decimal ProfitAmount { get; set; }
    public int EmptyCratesRequired { get; set; }
    public int EmptyCratesReturned { get; set; }
    public int PendingCrates { get; set; }
    public bool IsSettled { get; set; }
    public DateTime? SettledAt { get; set; }
    public bool SettlementOverridden { get; set; }
    public string? SettlementOverrideReason { get; set; }
    public string? Notes { get; set; }
    public string? OfflineReference { get; set; }
    public string? CreatedByName { get; set; }
    public List<SaleItemDto> Items { get; set; } = new();
    public List<SaleReturnDto> Returns { get; set; } = new();
    public List<PaymentDto> Payments { get; set; } = new();
    /// <summary>Human-readable reasons the sale cannot be settled yet (empty when it can).</summary>
    public List<string> SettlementBlockers { get; set; } = new();
}

public class SaleListItemDto
{
    public Guid Id { get; set; }
    public string InvoiceNumber { get; set; } = "";
    public Guid CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public DateTime SaleDate { get; set; }
    public decimal NetAmount { get; set; }
    public decimal PaidAmount { get; set; }
    public decimal Balance { get; set; }
    public decimal ProfitAmount { get; set; }
    public PaymentStatus PaymentStatus { get; set; }
    public int EmptyCratesRequired { get; set; }
    public int EmptyCratesReturned { get; set; }
    public int PendingCrates { get; set; }
    public bool IsSettled { get; set; }
}

public class PaymentDto
{
    public Guid Id { get; set; }
    public Guid CustomerId { get; set; }
    public Guid? SaleId { get; set; }
    public decimal Amount { get; set; }
    public PaymentDirection Direction { get; set; }
    public PaymentMode PaymentMode { get; set; }
    public DateTime PaymentDate { get; set; }
    public string? Notes { get; set; }
}

// ---------- Returns ----------
public record ReturnLineRequest(Guid SaleItemId, int Quantity, ReturnReason Reason);
public record CreateReturnRequest(Guid? Id, Guid SaleId, List<ReturnLineRequest> Lines, DateTime? ReturnDate, string? Notes);

// ---------- Empty crates ----------
public record CrateReturnRequest(Guid? Id, Guid CustomerId, int Quantity, Guid? SaleId, DateTime? Date, string? Notes);
public record SaleCrateReturnRequest(int Quantity, string? Notes);
public record CrateAdjustmentRequest(Guid CustomerId, int Quantity, string Notes);

public class CrateTransactionDto
{
    public Guid Id { get; set; }
    public Guid CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public Guid? SaleId { get; set; }
    public string? InvoiceNumber { get; set; }
    public CrateTransactionType TransactionType { get; set; }
    public int Quantity { get; set; }
    public DateTime Date { get; set; }
    public string? Notes { get; set; }
}

public class CustomerCrateSummaryDto
{
    public Guid CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public string? BusinessName { get; set; }
    public string? Phone { get; set; }
    public int CratesIssued { get; set; }
    public int CratesReturned { get; set; }
    public int Adjustments { get; set; }
    public int PendingCrates { get; set; }
    public int OpenSales { get; set; }
    public DateTime? OldestPendingSaleDate { get; set; }
}

public class CrateReturnResultDto
{
    public int Accepted { get; set; }
    public int CustomerCrateBalance { get; set; }
    public List<SaleListItemDto> AffectedSales { get; set; } = new();
}

// ---------- Settings ----------
public record UpdateSettingsRequest(Dictionary<string, string> Values);
