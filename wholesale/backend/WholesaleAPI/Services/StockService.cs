using AutoMapper;
using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public class StockService
{
    private readonly AppDbContext _db;
    private readonly IMapper _mapper;
    private readonly ICurrentUser _user;
    private readonly SettingsService _settings;

    public StockService(AppDbContext db, IMapper mapper, ICurrentUser user, SettingsService settings)
    {
        _db = db;
        _mapper = mapper;
        _user = user;
        _settings = settings;
    }

    public async Task<Dictionary<Guid, int>> QuantitiesAsync(IEnumerable<Guid>? productIds = null)
    {
        var q = _db.StockBatches.AsNoTracking().Where(b => b.Quantity > 0);
        if (productIds != null)
        {
            var ids = productIds.ToList();
            q = q.Where(b => ids.Contains(b.ProductId));
        }
        return await q.GroupBy(b => b.ProductId)
            .Select(g => new { g.Key, Qty = g.Sum(b => b.Quantity) })
            .ToDictionaryAsync(x => x.Key, x => x.Qty);
    }

    public async Task<List<StockSummaryDto>> GetSummaryAsync(string? search = null, bool onlyLow = false)
    {
        var products = await _db.Products.AsNoTracking()
            .Where(p => p.IsActive && (search == null || EF.Functions.ILike(p.Name, $"%{search}%")))
            .OrderBy(p => p.Name).ToListAsync();

        var batchStats = await _db.StockBatches.AsNoTracking().Where(b => b.Quantity > 0)
            .GroupBy(b => b.ProductId)
            .Select(g => new
            {
                ProductId = g.Key,
                Quantity = g.Sum(b => b.Quantity),
                StockValue = g.Sum(b => b.Quantity * b.PurchasePriceAtTime),
                NearestExpiry = g.Where(b => b.ExpiryDate.HasValue).Min(b => b.ExpiryDate),
                BatchCount = g.Count(),
            }).ToDictionaryAsync(x => x.ProductId);

        var result = products.Select(p =>
        {
            var stats = batchStats.GetValueOrDefault(p.Id);
            var qty = stats?.Quantity ?? 0;
            var per = Math.Max(1, p.BottlesPerCrate);
            return new StockSummaryDto
            {
                ProductId = p.Id,
                ProductName = p.Name,
                Brand = p.Brand,
                UnitType = p.UnitType,
                BottlesPerCrate = p.BottlesPerCrate,
                Quantity = qty,
                CrateQuantity = qty / per,
                LoosePieces = qty % per,
                StockValue = Money.R(stats?.StockValue ?? 0),
                LowStockThreshold = p.LowStockThreshold,
                IsLowStock = qty <= p.LowStockThreshold,
                NearestExpiry = stats?.NearestExpiry,
                BatchCount = stats?.BatchCount ?? 0,
            };
        }).ToList();

        return onlyLow ? result.Where(r => r.IsLowStock).ToList() : result;
    }

    public async Task<List<StockBatchDto>> GetBatchesAsync(Guid? productId, bool includeEmpty)
    {
        var q = _db.StockBatches.AsNoTracking().Include(b => b.Product).AsQueryable();
        if (productId.HasValue) q = q.Where(b => b.ProductId == productId);
        if (!includeEmpty) q = q.Where(b => b.Quantity > 0);
        var list = await q.OrderBy(b => b.Product!.Name).ThenBy(b => b.ExpiryDate).ToListAsync();
        return _mapper.Map<List<StockBatchDto>>(list);
    }

    public async Task<PagedResult<StockBatchDto>> GetBatchesPageAsync(Guid? productId, bool includeEmpty, int page, int pageSize)
    {
        var q = _db.StockBatches.AsNoTracking().AsQueryable();
        if (productId.HasValue) q = q.Where(b => b.ProductId == productId);
        if (!includeEmpty) q = q.Where(b => b.Quantity > 0);

        var total = await q.CountAsync();
        var rows = await q.OrderBy(b => b.Product!.Name).ThenBy(b => b.ExpiryDate).ThenBy(b => b.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).Include(b => b.Product).ToListAsync();
        return new PagedResult<StockBatchDto>(_mapper.Map<List<StockBatchDto>>(rows), total, page, pageSize);
    }

    public async Task<StockAlertsDto> GetAlertsAsync()
    {
        var days = await _settings.GetIntAsync(SettingKeys.ExpiryAlertDays, 30);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var expiringBatches = _db.StockBatches.AsNoTracking().Where(b => b.Quantity > 0 && b.ExpiryDate.HasValue);
        var expiredCount = await expiringBatches.CountAsync(b => b.ExpiryDate < today);
        var nearExpiryCount = await expiringBatches.CountAsync(b => b.ExpiryDate >= today && b.ExpiryDate <= today.AddDays(days));
        return new StockAlertsDto
        {
            LowStockCount = (await GetSummaryAsync(onlyLow: true)).Count,
            ExpiredCount = expiredCount,
            NearExpiryCount = nearExpiryCount,
        };
    }

    public async Task<List<object>> GetMovementsAsync(Guid? productId, DateTime? from, DateTime? to, int take = 200)
    {
        var q = _db.StockMovements.AsNoTracking().AsQueryable();
        if (productId.HasValue) q = q.Where(m => m.ProductId == productId);
        if (from.HasValue) q = q.Where(m => m.CreatedAt >= from);
        if (to.HasValue) q = q.Where(m => m.CreatedAt < to);
        var rows = await q.OrderByDescending(m => m.CreatedAt).Take(take)
            .Join(_db.Products, m => m.ProductId, p => p.Id, (m, p) => new
            {
                m.Id, m.ProductId, ProductName = p.Name, m.StockBatchId, m.MovementType,
                m.Quantity, m.ReferenceId, m.Reason, m.CreatedAt,
            }).ToListAsync();
        return rows.Cast<object>().ToList();
    }

    public async Task<PagedResult<object>> GetMovementsPageAsync(Guid? productId, DateTime? from, DateTime? to, int page, int pageSize)
    {
        var q = _db.StockMovements.AsNoTracking().AsQueryable();
        if (productId.HasValue) q = q.Where(m => m.ProductId == productId);
        if (from.HasValue) q = q.Where(m => m.CreatedAt >= from);
        if (to.HasValue) q = q.Where(m => m.CreatedAt < to);

        var total = await q.CountAsync();
        var rows = await q.OrderByDescending(m => m.CreatedAt).ThenByDescending(m => m.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Join(_db.Products, m => m.ProductId, p => p.Id, (m, p) => new
            {
                m.Id, m.ProductId, ProductName = p.Name, m.StockBatchId, m.MovementType,
                m.Quantity, m.ReferenceId, m.Reason, m.CreatedAt,
            }).ToListAsync();
        return new PagedResult<object>(rows.Cast<object>().ToList(), total, page, pageSize);
    }

    /// <summary>Manual stock correction. Positive quantity adds stock, negative removes from a chosen batch.</summary>
    public async Task<StockBatchDto> AdjustAsync(StockAdjustmentRequest req)
    {
        await using var tx = await _db.Database.BeginTransactionAsync();
        var product = await _db.Products.FindAsync(req.ProductId) ?? throw AppException.NotFound("Product");
        StockBatch batch;

        if (req.Quantity > 0)
        {
            batch = req.StockBatchId.HasValue
                ? await LockBatchAsync(req.StockBatchId.Value)
                : new StockBatch
                {
                    ProductId = product.Id,
                    BatchNumber = string.IsNullOrWhiteSpace(req.BatchNumber) ? $"ADJ-{DateTime.UtcNow:yyMMddHHmm}" : req.BatchNumber!,
                    ExpiryDate = req.ExpiryDate,
                    PurchasePriceAtTime = req.UnitCost ?? product.PurchasePrice,
                };
            if (batch.ProductId != product.Id) throw new AppException("That batch belongs to another product.");
            if (!req.StockBatchId.HasValue) _db.StockBatches.Add(batch);
            batch.Quantity += req.Quantity;
        }
        else
        {
            batch = await LockBatchAsync(req.StockBatchId!.Value);
            if (batch.ProductId != product.Id) throw new AppException("That batch belongs to another product.");
            if (batch.Quantity + req.Quantity < 0)
                throw new AppException($"Batch {batch.BatchNumber} only has {batch.Quantity} pieces.", 409, "stock");
            batch.Quantity += req.Quantity;
        }
        batch.LastUpdated = DateTime.UtcNow;

        _db.StockMovements.Add(new StockMovement
        {
            ProductId = product.Id, StockBatchId = batch.Id,
            MovementType = req.Quantity > 0 ? StockMovementType.AdjustmentIn : StockMovementType.AdjustmentOut,
            Quantity = req.Quantity, Reason = req.Reason, CreatedByUserId = _user.Id,
        });
        _db.AuditLogs.Add(new AuditLog
        {
            UserId = _user.Id, Action = "StockAdjust", Entity = nameof(StockBatch), EntityId = batch.Id.ToString(),
            NewValues = System.Text.Json.JsonSerializer.Serialize(new
            {
                RequestedQuantity = req.Quantity,
                req.Reason,
                NewQuantity = batch.Quantity,
            }),
        });
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        batch.Product = product;
        return _mapper.Map<StockBatchDto>(batch);
    }

    /// <summary>Adds a new batch of stock. Caller owns the transaction and SaveChanges.</summary>
    public StockBatch AddBatch(Guid productId, int qty, decimal unitCost, string batchNumber, DateOnly? expiry,
        Guid? purchaseItemId, Guid referenceId, string reason)
    {
        var batch = new StockBatch
        {
            ProductId = productId, Quantity = qty, PurchasePriceAtTime = unitCost,
            BatchNumber = batchNumber, ExpiryDate = expiry, PurchaseItemId = purchaseItemId,
        };
        _db.StockBatches.Add(batch);
        _db.StockMovements.Add(new StockMovement
        {
            ProductId = productId, StockBatchId = batch.Id, MovementType = StockMovementType.Purchase,
            Quantity = qty, ReferenceId = referenceId, Reason = reason, CreatedByUserId = _user.Id,
        });
        return batch;
    }

    /// <summary>
    /// Takes stock FIFO (earliest expiry first, then oldest batch). Rows are locked so two
    /// counters can't sell the same bottles. Caller must be inside a transaction.
    /// </summary>
    public async Task<List<SaleItemAllocation>> DeductFifoAsync(Product product, int qty, Guid saleId, string reference)
    {
        var batches = await _db.StockBatches
            .FromSqlInterpolated($@"SELECT * FROM stock_batches
                WHERE product_id = {product.Id} AND quantity > 0 AND is_deleted = false
                ORDER BY expiry_date NULLS LAST, created_at
                FOR UPDATE")
            .IgnoreQueryFilters()
            .ToListAsync();

        var available = batches.Sum(b => b.Quantity);
        if (available < qty)
            throw new AppException($"Not enough stock for {product.Name}: {available} available, {qty} requested.", 409, "stock");

        var allocations = new List<SaleItemAllocation>();
        var remaining = qty;
        foreach (var b in batches)
        {
            if (remaining == 0) break;
            var take = Math.Min(b.Quantity, remaining);
            b.Quantity -= take;
            b.LastUpdated = DateTime.UtcNow;
            remaining -= take;
            allocations.Add(new SaleItemAllocation { StockBatchId = b.Id, Quantity = take, UnitCost = b.PurchasePriceAtTime });
            _db.StockMovements.Add(new StockMovement
            {
                ProductId = product.Id, StockBatchId = b.Id, MovementType = StockMovementType.Sale,
                Quantity = -take, ReferenceId = saleId, Reason = reference, CreatedByUserId = _user.Id,
            });
        }
        return allocations;
    }

    public async Task RestoreForSaleEditAsync(Guid saleId, List<SaleItemAllocation> allocations, Guid productId)
    {
        foreach (var allocation in allocations)
        {
            var batch = await LockBatchAsync(allocation.StockBatchId);
            batch.Quantity += allocation.Quantity;
            batch.LastUpdated = DateTime.UtcNow;
            _db.StockMovements.Add(new StockMovement
            {
                ProductId = productId, StockBatchId = batch.Id, MovementType = StockMovementType.AdjustmentIn,
                Quantity = allocation.Quantity, ReferenceId = saleId, Reason = "Restored while editing sale",
                CreatedByUserId = _user.Id,
            });
        }
    }

    /// <summary>Puts returned pieces back into the batches they came from (latest allocation first).</summary>
    public async Task RestoreAsync(Guid productId, List<SaleItemAllocation> allocations, int qty, Guid returnId, string reason)
    {
        var remaining = qty;
        foreach (var a in allocations.OrderByDescending(a => a.CreatedAt))
        {
            if (remaining == 0) break;
            var canReturn = a.Quantity - a.ReturnedQuantity;
            if (canReturn <= 0) continue;
            var put = Math.Min(canReturn, remaining);
            a.ReturnedQuantity += put;
            remaining -= put;
            var batch = await LockBatchAsync(a.StockBatchId);
            batch.Quantity += put;
            batch.LastUpdated = DateTime.UtcNow;
            _db.StockMovements.Add(new StockMovement
            {
                ProductId = productId, StockBatchId = batch.Id, MovementType = StockMovementType.SaleReturn,
                Quantity = put, ReferenceId = returnId, Reason = reason, CreatedByUserId = _user.Id,
            });
        }
    }

    /// <summary>Marks allocations as returned without restocking (damaged / expired goods are written off).</summary>
    public static void MarkReturnedWithoutRestock(List<SaleItemAllocation> allocations, int qty)
    {
        var remaining = qty;
        foreach (var a in allocations.OrderByDescending(a => a.CreatedAt))
        {
            if (remaining == 0) break;
            var put = Math.Min(a.Quantity - a.ReturnedQuantity, remaining);
            if (put <= 0) continue;
            a.ReturnedQuantity += put;
            remaining -= put;
        }
    }

    private async Task<StockBatch> LockBatchAsync(Guid id)
    {
        var tracked = _db.ChangeTracker.Entries<StockBatch>().FirstOrDefault(e => e.Entity.Id == id)?.Entity;
        if (tracked != null) return tracked;
        var rows = await _db.StockBatches
            .FromSqlInterpolated($"SELECT * FROM stock_batches WHERE id = {id} FOR UPDATE")
            .IgnoreQueryFilters()
            .ToListAsync();
        return rows.FirstOrDefault() ?? throw AppException.NotFound("Stock batch");
    }

    public async Task<StockBatch> LockPurchaseBatchAsync(Guid purchaseItemId)
    {
        var rows = await _db.StockBatches
            .FromSqlInterpolated($"SELECT * FROM stock_batches WHERE purchase_item_id = {purchaseItemId} FOR UPDATE")
            .IgnoreQueryFilters()
            .ToListAsync();
        return rows.FirstOrDefault() ?? throw AppException.NotFound("Purchase stock batch");
    }
}
