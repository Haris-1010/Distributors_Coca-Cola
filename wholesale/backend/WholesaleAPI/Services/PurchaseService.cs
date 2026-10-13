using AutoMapper;
using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public class PurchaseService
{
    private readonly AppDbContext _db;
    private readonly IMapper _mapper;
    private readonly StockService _stock;
    private readonly SettingsService _settings;
    private readonly NumberGenerator _numbers;
    private readonly ICurrentUser _user;

    public PurchaseService(AppDbContext db, IMapper mapper, StockService stock, SettingsService settings,
        NumberGenerator numbers, ICurrentUser user)
    {
        _db = db;
        _mapper = mapper;
        _stock = stock;
        _settings = settings;
        _numbers = numbers;
        _user = user;
    }

    public async Task<PagedResult<PurchaseDto>> ListAsync(DateTime? from, DateTime? to, string? search, int page, int pageSize)
    {
        var q = _db.Purchases.AsNoTracking().Include(p => p.Items).AsQueryable();
        if (from.HasValue) q = q.Where(p => p.PurchaseDate >= from);
        if (to.HasValue) q = q.Where(p => p.PurchaseDate < to);
        if (!string.IsNullOrWhiteSpace(search))
            q = q.Where(p => EF.Functions.ILike(p.InvoiceNumber, $"%{search}%") || EF.Functions.ILike(p.DistributorName, $"%{search}%"));
        var total = await q.CountAsync();
        var rows = await q.OrderByDescending(p => p.PurchaseDate).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var dtos = _mapper.Map<List<PurchaseDto>>(rows);
        dtos.ForEach(d => d.Items.Clear()); // list view only needs the header
        return new PagedResult<PurchaseDto>(dtos, total, page, pageSize);
    }

    public async Task<PurchaseDto> GetAsync(Guid id)
    {
        var p = await _db.Purchases.AsNoTracking().Include(x => x.Items).ThenInclude(i => i.Product)
            .FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Purchase");
        return _mapper.Map<PurchaseDto>(p);
    }

    public async Task<PurchaseDto> CreateAsync(CreatePurchaseRequest req)
    {
        // Idempotent: an offline device may send the same purchase twice.
        if (req.Id.HasValue && await _db.Purchases.AnyAsync(p => p.Id == req.Id))
            return await GetAsync(req.Id.Value);

        var purchaseId = await _db.InTransactionAsync(async () =>
        {
            var now = DateTime.UtcNow;
            var purchase = new Purchase
            {
                Id = req.Id ?? Guid.NewGuid(),
                DistributorName = req.DistributorName.Trim(),
                PurchaseDate = req.PurchaseDate ?? now,
                Notes = req.Notes,
                CreatedByUserId = _user.Id,
            };
            purchase.InvoiceNumber = string.IsNullOrWhiteSpace(req.InvoiceNumber)
                ? await _numbers.NextAsync("PUR", purchase.PurchaseDate)
                : req.InvoiceNumber.Trim();

            var productIds = req.Items.Select(i => i.ProductId).Distinct().ToList();
            var products = await _db.Products.Where(p => productIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
            var perCrate = await _settings.ProfitIsPerCrateAsync();

            foreach (var line in req.Items)
            {
                if (!products.TryGetValue(line.ProductId, out var product))
                    throw AppException.NotFound($"Product {line.ProductId}");

                var item = new PurchaseItem
                {
                    PurchaseId = purchase.Id,
                    ProductId = product.Id,
                    Quantity = line.Quantity,
                    UnitPrice = line.UnitPrice,
                    Total = Money.R(line.Quantity * line.UnitPrice),
                    BatchNumber = string.IsNullOrWhiteSpace(line.BatchNumber) ? purchase.InvoiceNumber : line.BatchNumber.Trim(),
                    ExpiryDate = line.ExpiryDate,
                };
                purchase.Items.Add(item);
                _stock.AddBatch(product.Id, item.Quantity, item.UnitPrice, item.BatchNumber, item.ExpiryDate,
                    item.Id, purchase.Id, $"Purchase {purchase.InvoiceNumber}");

                // Keep the catalogue cost current and never leave the selling price below cost + minimum profit.
                product.PurchasePrice = line.UnitPrice;
                var minProfit = perCrate && product.BottlesPerCrate > 0 ? Math.Round(product.MinProfit / product.BottlesPerCrate, 2) : product.MinProfit;
                if (product.SellingPrice < product.PurchasePrice + minProfit)
                    product.SellingPrice = product.PurchasePrice + minProfit;
            }

            purchase.TotalAmount = purchase.Items.Sum(i => i.Total);
            if (req.PaidAmount > purchase.TotalAmount)
                throw new AppException("Paid amount is more than the purchase total.");
            purchase.PaidAmount = req.PaidAmount;
            purchase.PaymentStatus = Money.StatusFor(purchase.TotalAmount, purchase.PaidAmount);

            _db.Purchases.Add(purchase);
            _db.AuditLogs.Add(new AuditLog
            {
                UserId = _user.Id, Action = "Create", Entity = nameof(Purchase), EntityId = purchase.Id.ToString(),
                NewValues = System.Text.Json.JsonSerializer.Serialize(new { purchase.InvoiceNumber, purchase.TotalAmount }),
            });
            await _db.SaveChangesAsync();
            return purchase.Id;
        });

        return await GetAsync(purchaseId);
    }

    public async Task<PurchaseDto> AddPaymentAsync(Guid id, PurchasePaymentRequest req)
    {
        var p = await _db.Purchases.FindAsync(id) ?? throw AppException.NotFound("Purchase");
        if (req.Amount <= 0) throw new AppException("Amount must be more than zero.");
        if (p.PaidAmount + req.Amount > p.TotalAmount)
            throw new AppException($"Only Rs {p.TotalAmount - p.PaidAmount:N2} is still due on this purchase.");
        p.PaidAmount += req.Amount;
        p.PaymentStatus = Money.StatusFor(p.TotalAmount, p.PaidAmount);
        if (!string.IsNullOrWhiteSpace(req.Notes))
            p.Notes = string.IsNullOrWhiteSpace(p.Notes) ? req.Notes : $"{p.Notes}\n{req.Notes}";
        _db.AuditLogs.Add(new AuditLog { UserId = _user.Id, Action = "PurchasePayment", Entity = nameof(Purchase), EntityId = id.ToString(), NewValues = req.Amount.ToString() });
        await _db.SaveChangesAsync();
        return await GetAsync(id);
    }
}
