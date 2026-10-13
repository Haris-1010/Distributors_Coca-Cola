using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using WholesaleAPI.Models;

namespace WholesaleAPI.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<StockBatch> StockBatches => Set<StockBatch>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<Purchase> Purchases => Set<Purchase>();
    public DbSet<PurchaseItem> PurchaseItems => Set<PurchaseItem>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Sale> Sales => Set<Sale>();
    public DbSet<SaleItem> SaleItems => Set<SaleItem>();
    public DbSet<SaleItemAllocation> SaleItemAllocations => Set<SaleItemAllocation>();
    public DbSet<SaleReturn> SaleReturns => Set<SaleReturn>();
    public DbSet<EmptyCrateTransaction> EmptyCrateTransactions => Set<EmptyCrateTransaction>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<DocumentCounter> DocumentCounters => Set<DocumentCounter>();
    public DbSet<SyncOperationLog> SyncOperationLogs => Set<SyncOperationLog>();

    protected override void ConfigureConventions(ModelConfigurationBuilder b)
    {
        // All money is decimal(18,2); all enums are stored as readable text.
        b.Properties<decimal>().HavePrecision(18, 2);
        b.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
        b.Properties<UserRole>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<UnitType>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<CustomerType>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<PaymentStatus>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<PaymentMode>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<ReturnReason>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<CrateTransactionType>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<StockMovementType>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<PaymentDirection>().HaveConversion<string>().HaveMaxLength(20);
    }

    protected override void OnModelCreating(ModelBuilder mb)
    {
        // Soft delete: hide deleted rows everywhere unless IgnoreQueryFilters() is used.
        foreach (var et in mb.Model.GetEntityTypes())
        {
            if (!typeof(BaseEntity).IsAssignableFrom(et.ClrType)) continue;
            var p = Expression.Parameter(et.ClrType, "e");
            var body = Expression.Equal(Expression.Property(p, nameof(BaseEntity.IsDeleted)), Expression.Constant(false));
            mb.Entity(et.ClrType).HasQueryFilter(Expression.Lambda(body, p));
        }

        mb.Entity<User>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(200);
            e.Property(x => x.FullName).HasMaxLength(150);
        });

        mb.Entity<RefreshToken>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId);
        });

        mb.Entity<Product>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(150);
            e.Property(x => x.Brand).HasMaxLength(20);
            e.HasIndex(x => x.Barcode);
            e.HasIndex(x => x.Sku);
        });

        mb.Entity<StockBatch>(e =>
        {
            e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId);
            e.HasIndex(x => new { x.ProductId, x.ExpiryDate });
            e.ToTable(t => t.HasCheckConstraint("ck_stock_batches_quantity", "quantity >= 0"));
        });

        mb.Entity<StockMovement>(e => e.HasIndex(x => new { x.ProductId, x.CreatedAt }));

        mb.Entity<Purchase>(e =>
        {
            e.HasIndex(x => x.InvoiceNumber);
            e.HasMany(x => x.Items).WithOne().HasForeignKey(x => x.PurchaseId);
        });
        mb.Entity<PurchaseItem>(e => e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId));

        mb.Entity<Customer>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(150);
            e.HasIndex(x => x.Phone);
        });

        mb.Entity<Sale>(e =>
        {
            e.HasIndex(x => x.InvoiceNumber).IsUnique();
            e.HasIndex(x => x.SaleDate);
            e.HasIndex(x => new { x.CustomerId, x.IsSettled });
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.HasMany(x => x.Items).WithOne().HasForeignKey(x => x.SaleId);
            e.HasMany(x => x.Returns).WithOne().HasForeignKey(x => x.SaleId);
        });

        mb.Entity<SaleItem>(e =>
        {
            e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId);
            e.HasMany(x => x.Allocations).WithOne().HasForeignKey(x => x.SaleItemId);
        });

        mb.Entity<SaleReturn>(e => e.HasIndex(x => x.ReturnDate));
        mb.Entity<EmptyCrateTransaction>(e => e.HasIndex(x => new { x.CustomerId, x.Date }));
        mb.Entity<Payment>(e => e.HasIndex(x => new { x.CustomerId, x.PaymentDate }));

        mb.Entity<SystemSetting>(e => e.HasKey(x => x.Key));
        mb.Entity<DocumentCounter>(e => e.HasKey(x => x.Key));
        mb.Entity<AuditLog>(e => e.HasIndex(x => x.Timestamp));
        mb.Entity<SyncOperationLog>(e => e.HasKey(x => x.Id));
    }

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        foreach (var entry in ChangeTracker.Entries<BaseEntity>())
        {
            if (entry.State == EntityState.Modified) entry.Entity.UpdatedAt = DateTime.UtcNow;
            if (entry.State == EntityState.Deleted)
            {
                // Never hard-delete business rows.
                entry.State = EntityState.Modified;
                entry.Entity.IsDeleted = true;
                entry.Entity.UpdatedAt = DateTime.UtcNow;
            }
        }
        return base.SaveChangesAsync(ct);
    }
}

/// <summary>Postgres timestamptz needs UTC. Unspecified kinds are treated as already UTC.</summary>
public class UtcDateTimeConverter : ValueConverter<DateTime, DateTime>
{
    public UtcDateTimeConverter() : base(
        v => v.Kind == DateTimeKind.Utc ? v : v.Kind == DateTimeKind.Local ? v.ToUniversalTime() : DateTime.SpecifyKind(v, DateTimeKind.Utc),
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc)) { }
}
