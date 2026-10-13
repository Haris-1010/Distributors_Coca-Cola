using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Models;

namespace WholesaleAPI.Data;

public static class DbSeeder
{
    public const string SuperAdminEmail = "admin@gmail.com";
    public const string SuperAdminPassword = "Admin@123";

    public static async Task InitialiseAsync(AppDbContext db, ILogger logger)
    {
        // Use migrations when the project has them; otherwise create the schema directly
        // so the app runs on first launch without any extra commands.
        if (db.Database.GetMigrations().Any())
            await db.Database.MigrateAsync();
        else
            await db.Database.EnsureCreatedAsync();

        await SeedSettingsAsync(db);

        if (!await db.Users.IgnoreQueryFilters().AnyAsync())
        {
            db.Users.Add(new User
            {
                FullName = "Super Admin",
                Email = SuperAdminEmail,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(SuperAdminPassword),
                Role = UserRole.SuperAdmin,
                MustChangePassword = true,
            });
            await db.SaveChangesAsync();
            logger.LogWarning("Seeded SuperAdmin {Email}. Change the password on first login.", SuperAdminEmail);
        }

        if (!await db.Products.IgnoreQueryFilters().AnyAsync())
            await SeedSampleDataAsync(db);
    }

    private static async Task SeedSettingsAsync(AppDbContext db)
    {
        var defaults = new Dictionary<string, string>
        {
            [SettingKeys.CompanyName] = "My Wholesale Traders",
            [SettingKeys.CompanyAddress] = "Lahore, Pakistan",
            [SettingKeys.CompanyPhone] = "",
            [SettingKeys.CurrencyCode] = "PKR",
            [SettingKeys.CurrencySymbol] = "Rs",
            [SettingKeys.DefaultMinProfit] = "50",
            [SettingKeys.DefaultMaxProfit] = "60",
            [SettingKeys.ProfitBasis] = "Piece",
            [SettingKeys.BottlesPerCrate] = "24",
            [SettingKeys.ExpiryAlertDays] = "30",
            [SettingKeys.TimeZone] = "Asia/Karachi",
            [SettingKeys.InvoiceFooter] = "Please return all empty crates. Thank you for your business!",
        };
        var existing = await db.SystemSettings.Select(s => s.Key).ToListAsync();
        foreach (var (k, v) in defaults.Where(d => !existing.Contains(d.Key)))
            db.SystemSettings.Add(new SystemSetting { Key = k, Value = v });
        await db.SaveChangesAsync();
    }

    private static async Task SeedSampleDataAsync(AppDbContext db)
    {
        // Sample catalogue for a Pakistani Pepsi / Coca-Cola wholesaler.
        // Prices are placeholders per piece — edit them to match your distributor's rate list.
        Product P(string name, Brand brand, string category, UnitType unit, bool crate, int perCrate,
                  decimal cost, string sku, string pack) => new()
        {
            Name = name, Brand = brand, Category = category, UnitType = unit,
            IsCrateRequired = crate, BottlesPerCrate = perCrate, PackSize = pack,
            PurchasePrice = cost, SellingPrice = cost + 50, MinProfit = 50, MaxProfit = 60,
            Sku = sku, LowStockThreshold = perCrate * 2,
        };

        var products = new List<Product>
        {
            P("Coca-Cola 250ml Glass", Brand.CocaCola, "Soft Drink", UnitType.Glass, true, 24, 55, "CC-250-G", "24 bottles / crate"),
            P("Coca-Cola 300ml Glass", Brand.CocaCola, "Soft Drink", UnitType.Glass, true, 24, 65, "CC-300-G", "24 bottles / crate"),
            P("Sprite 250ml Glass", Brand.CocaCola, "Soft Drink", UnitType.Glass, true, 24, 55, "SP-250-G", "24 bottles / crate"),
            P("Fanta 250ml Glass", Brand.CocaCola, "Soft Drink", UnitType.Glass, true, 24, 55, "FA-250-G", "24 bottles / crate"),
            P("Pepsi 250ml Glass", Brand.Pepsi, "Soft Drink", UnitType.Glass, true, 24, 55, "PE-250-G", "24 bottles / crate"),
            P("7Up 250ml Glass", Brand.Pepsi, "Soft Drink", UnitType.Glass, true, 24, 55, "7U-250-G", "24 bottles / crate"),
            P("Mirinda 250ml Glass", Brand.Pepsi, "Soft Drink", UnitType.Glass, true, 24, 55, "MI-250-G", "24 bottles / crate"),
            P("Pepsi 1.5L PET", Brand.Pepsi, "Soft Drink", UnitType.PET, false, 6, 190, "PE-1500-P", "6 bottles / pack"),
            P("Coca-Cola 1.5L PET", Brand.CocaCola, "Soft Drink", UnitType.PET, false, 6, 190, "CC-1500-P", "6 bottles / pack"),
            P("Sting 500ml PET", Brand.Pepsi, "Energy Drink", UnitType.PET, false, 12, 95, "ST-500-P", "12 bottles / pack"),
            P("Aquafina 1.5L Water", Brand.Pepsi, "Water", UnitType.PET, false, 6, 80, "AQ-1500-P", "6 bottles / pack"),
            P("Kinley 1.5L Water", Brand.CocaCola, "Water", UnitType.PET, false, 6, 80, "KI-1500-P", "6 bottles / pack"),
        };
        db.Products.AddRange(products);

        db.Customers.Add(new Customer
        {
            Name = "Muhammad Ali",
            BusinessName = "Al-Madina General Store",
            Phone = "0300-0000000",
            Address = "Main Bazaar, Lahore",
            CustomerType = CustomerType.Retailer,
        });

        // One opening purchase so there is stock to sell straight away.
        var purchase = new Purchase
        {
            InvoiceNumber = "PUR-SEED-0001",
            DistributorName = "Pepsi Official Distributor",
            Notes = "Opening stock (sample data)",
        };
        var expiry = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(6));
        foreach (var p in products.Where(p => p.Brand == Brand.Pepsi))
        {
            var qty = p.BottlesPerCrate * 10;
            var item = new PurchaseItem
            {
                PurchaseId = purchase.Id, ProductId = p.Id, Quantity = qty, UnitPrice = p.PurchasePrice,
                Total = qty * p.PurchasePrice, BatchNumber = "SEED-001", ExpiryDate = expiry,
            };
            purchase.Items.Add(item);
            var batch = new StockBatch
            {
                ProductId = p.Id, BatchNumber = item.BatchNumber, ExpiryDate = expiry, Quantity = qty,
                PurchasePriceAtTime = p.PurchasePrice, PurchaseItemId = item.Id,
            };
            db.StockBatches.Add(batch);
            db.StockMovements.Add(new StockMovement
            {
                ProductId = p.Id, StockBatchId = batch.Id, MovementType = StockMovementType.Purchase,
                Quantity = qty, ReferenceId = purchase.Id, Reason = "Opening stock",
            });
        }
        purchase.TotalAmount = purchase.Items.Sum(i => i.Total);
        purchase.PaidAmount = purchase.TotalAmount;
        purchase.PaymentStatus = PaymentStatus.Paid;
        db.Purchases.Add(purchase);

        await db.SaveChangesAsync();
    }
}

public static class SettingKeys
{
    public const string CompanyName = "CompanyName";
    public const string CompanyAddress = "CompanyAddress";
    public const string CompanyPhone = "CompanyPhone";
    public const string CurrencyCode = "CurrencyCode";
    public const string CurrencySymbol = "CurrencySymbol";
    public const string DefaultMinProfit = "DefaultMinProfit";
    public const string DefaultMaxProfit = "DefaultMaxProfit";
    /// <summary>"Piece" or "Crate": whether Min/Max profit targets are per bottle or per full crate/pack.</summary>
    public const string ProfitBasis = "ProfitBasis";
    public const string BottlesPerCrate = "BottlesPerCrate";
    public const string ExpiryAlertDays = "ExpiryAlertDays";
    public const string TimeZone = "TimeZone";
    public const string InvoiceFooter = "InvoiceFooter";
}
