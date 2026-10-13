namespace WholesaleAPI.Models;

public abstract class BaseEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public bool IsDeleted { get; set; }
}

public class User : BaseEntity
{
    public string FullName { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public UserRole Role { get; set; }
    public bool IsActive { get; set; } = true;
    public bool MustChangePassword { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public int FailedLoginCount { get; set; }
    public DateTime? LockoutEndAt { get; set; }
}

public class RefreshToken : BaseEntity
{
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? ReplacedByTokenHash { get; set; }
    public bool IsActive => RevokedAt == null && ExpiresAt > DateTime.UtcNow;
}

public class Product : BaseEntity
{
    public string Name { get; set; } = "";
    public Brand Brand { get; set; }
    public string Category { get; set; } = "Soft Drink";
    public UnitType UnitType { get; set; }
    public string? PackSize { get; set; }
    public bool IsCrateRequired { get; set; }
    public int BottlesPerCrate { get; set; } = 24;
    public decimal PurchasePrice { get; set; }
    public decimal SellingPrice { get; set; }
    public decimal MinProfit { get; set; } = 50;
    public decimal MaxProfit { get; set; } = 60;
    public string? Barcode { get; set; }
    public string? Sku { get; set; }
    public int LowStockThreshold { get; set; } = 48;
    public bool IsActive { get; set; } = true;
}

/// <summary>One batch of stock for a product. Table: stock_batches.</summary>
public class StockBatch : BaseEntity
{
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public string BatchNumber { get; set; } = "";
    public DateOnly? ExpiryDate { get; set; }
    public int Quantity { get; set; }
    public decimal PurchasePriceAtTime { get; set; }
    public string Location { get; set; } = "Main Shop";
    public Guid? PurchaseItemId { get; set; }
    public DateTime LastUpdated { get; set; } = DateTime.UtcNow;
}

public class StockMovement : BaseEntity
{
    public Guid ProductId { get; set; }
    public Guid? StockBatchId { get; set; }
    public StockMovementType MovementType { get; set; }
    /// <summary>Signed: positive adds stock, negative removes it.</summary>
    public int Quantity { get; set; }
    public Guid? ReferenceId { get; set; }
    public string? Reason { get; set; }
    public Guid? CreatedByUserId { get; set; }
}

public class Purchase : BaseEntity
{
    public string InvoiceNumber { get; set; } = "";
    public string DistributorName { get; set; } = "";
    public DateTime PurchaseDate { get; set; } = DateTime.UtcNow;
    public decimal TotalAmount { get; set; }
    public decimal PaidAmount { get; set; }
    public PaymentStatus PaymentStatus { get; set; }
    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public List<PurchaseItem> Items { get; set; } = new();
}

public class PurchaseItem : BaseEntity
{
    public Guid PurchaseId { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Total { get; set; }
    public string BatchNumber { get; set; } = "";
    public DateOnly? ExpiryDate { get; set; }
}

public class Customer : BaseEntity
{
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public string? BusinessName { get; set; }
    public CustomerType CustomerType { get; set; } = CustomerType.Retailer;
    public decimal OutstandingBalance { get; set; }
    public int EmptyCrateBalance { get; set; }
    public bool IsActive { get; set; } = true;
}

public class Sale : BaseEntity
{
    public string InvoiceNumber { get; set; } = "";
    public Guid CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public DateTime SaleDate { get; set; } = DateTime.UtcNow;
    /// <summary>Gross value of items as originally sold.</summary>
    public decimal TotalAmount { get; set; }
    public decimal Discount { get; set; }
    /// <summary>Value of items returned after the sale.</summary>
    public decimal ReturnedAmount { get; set; }
    /// <summary>TotalAmount - Discount - ReturnedAmount.</summary>
    public decimal NetAmount { get; set; }
    public decimal PaidAmount { get; set; }
    public PaymentMode PaymentMode { get; set; }
    public PaymentStatus PaymentStatus { get; set; }
    public decimal ProfitAmount { get; set; }
    public int EmptyCratesRequired { get; set; }
    public int EmptyCratesReturned { get; set; }
    public bool IsSettled { get; set; }
    public DateTime? SettledAt { get; set; }
    public bool SettlementOverridden { get; set; }
    public Guid? SettlementOverriddenByUserId { get; set; }
    public string? SettlementOverrideReason { get; set; }
    public string? Notes { get; set; }
    /// <summary>Temporary invoice number given by an offline device, kept for traceability.</summary>
    public string? OfflineReference { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public List<SaleItem> Items { get; set; } = new();
    public List<SaleReturn> Returns { get; set; } = new();

    public decimal Balance => NetAmount - PaidAmount;
    public int PendingCrates => Math.Max(0, EmptyCratesRequired - EmptyCratesReturned);
}

public class SaleItem : BaseEntity
{
    public Guid SaleId { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public string ProductName { get; set; } = "";
    public int Quantity { get; set; }
    public int ReturnedQuantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal PurchasePriceAtSale { get; set; }
    public decimal ProfitPerUnit { get; set; }
    public decimal Total { get; set; }
    public bool IsCrateRequired { get; set; }
    public int BottlesPerCrate { get; set; } = 24;
    public bool PriceOverridden { get; set; }
    public List<SaleItemAllocation> Allocations { get; set; } = new();

    public int NetQuantity => Quantity - ReturnedQuantity;
    public int CratesRequired => IsCrateRequired && BottlesPerCrate > 0
        ? (int)Math.Ceiling(NetQuantity / (double)BottlesPerCrate) : 0;
}

/// <summary>Which stock batch each sold unit came from, so returns go back to the right batch.</summary>
public class SaleItemAllocation : BaseEntity
{
    public Guid SaleItemId { get; set; }
    public Guid StockBatchId { get; set; }
    public int Quantity { get; set; }
    public int ReturnedQuantity { get; set; }
    public decimal UnitCost { get; set; }
}

public class SaleReturn : BaseEntity
{
    public Guid SaleId { get; set; }
    public Guid SaleItemId { get; set; }
    public Guid ProductId { get; set; }
    public int Quantity { get; set; }
    public ReturnReason Reason { get; set; }
    public DateTime ReturnDate { get; set; } = DateTime.UtcNow;
    /// <summary>False for damaged / expired goods, which are written off instead of restocked.</summary>
    public bool StockAdjusted { get; set; }
    public decimal ReturnValue { get; set; }
    public decimal ProfitReversed { get; set; }
    public int CratesReduced { get; set; }
    public decimal RefundAmount { get; set; }
    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
}

public class EmptyCrateTransaction : BaseEntity
{
    public Guid CustomerId { get; set; }
    public Guid? SaleId { get; set; }
    public CrateTransactionType TransactionType { get; set; }
    /// <summary>Signed effect on what the customer owes: Issued +, Returned -, Adjustment either.</summary>
    public int Quantity { get; set; }
    public DateTime Date { get; set; } = DateTime.UtcNow;
    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
}

public class Payment : BaseEntity
{
    public Guid CustomerId { get; set; }
    public Guid? SaleId { get; set; }
    public decimal Amount { get; set; }
    public PaymentDirection Direction { get; set; } = PaymentDirection.Received;
    public PaymentMode PaymentMode { get; set; }
    public DateTime PaymentDate { get; set; } = DateTime.UtcNow;
    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
}

public class SystemSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

public class AuditLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public string Action { get; set; } = "";
    public string Entity { get; set; } = "";
    public string? EntityId { get; set; }
    public string? OldValues { get; set; }
    public string? NewValues { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}

public class DocumentCounter
{
    public string Key { get; set; } = "";
    public long Value { get; set; }
}

/// <summary>Record of every offline operation already applied, so retries are idempotent.</summary>
public class SyncOperationLog
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }
    public string OperationType { get; set; } = "";
    public bool Succeeded { get; set; }
    public string? ResultJson { get; set; }
    public DateTime ProcessedAt { get; set; } = DateTime.UtcNow;
}
