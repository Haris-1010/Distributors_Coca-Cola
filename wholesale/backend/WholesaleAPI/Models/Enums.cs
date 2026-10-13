namespace WholesaleAPI.Models;

public enum UserRole { SuperAdmin, Admin, Manager, Salesman, Viewer }

public enum Brand { Pepsi, CocaCola, Other }

public enum UnitType { Bottle, Can, PET, Glass }

public enum CustomerType { Retailer, Restaurant, Shop, Other }

public enum PaymentStatus { Unpaid, Partial, Paid }

public enum PaymentMode { Cash, Credit, JazzCash, Easypaisa, BankTransfer, Cheque }

public enum ReturnReason { Damaged, Extra, Unsold, Expired, Other }

public enum CrateTransactionType { Issued, Returned, Adjustment }

public enum StockMovementType { Purchase, Sale, SaleReturn, AdjustmentIn, AdjustmentOut }

public enum PaymentDirection { Received, Refund }

/// <summary>Role groups used in [Authorize(Roles = ...)] attributes.</summary>
public static class RoleGroups
{
    public const string AdminUp = "SuperAdmin,Admin";
    public const string ManagerUp = "SuperAdmin,Admin,Manager";
    public const string Sellers = "SuperAdmin,Admin,Manager,Salesman";
    public const string ReportViewers = "SuperAdmin,Admin,Manager,Viewer";
    public const string Everyone = "SuperAdmin,Admin,Manager,Salesman,Viewer";
}
