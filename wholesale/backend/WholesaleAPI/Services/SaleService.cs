using AutoMapper;
using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public class SaleService
{
    private readonly AppDbContext _db;
    private readonly IMapper _mapper;
    private readonly StockService _stock;
    private readonly SettlementService _settle;
    private readonly SettingsService _settings;
    private readonly NumberGenerator _numbers;
    private readonly ICurrentUser _user;

    public SaleService(AppDbContext db, IMapper mapper, StockService stock, SettlementService settle,
        SettingsService settings, NumberGenerator numbers, ICurrentUser user)
    {
        _db = db;
        _mapper = mapper;
        _stock = stock;
        _settle = settle;
        _settings = settings;
        _numbers = numbers;
        _user = user;
    }

    public async Task<PagedResult<SaleListItemDto>> ListAsync(DateTime? from, DateTime? to, Guid? customerId,
        string? status, string? search, int page, int pageSize)
    {
        var q = _db.Sales.AsNoTracking().Include(s => s.Customer).AsQueryable();
        if (from.HasValue) q = q.Where(s => s.SaleDate >= from);
        if (to.HasValue) q = q.Where(s => s.SaleDate < to);
        if (customerId.HasValue) q = q.Where(s => s.CustomerId == customerId);
        q = status?.ToLowerInvariant() switch
        {
            "settled" => q.Where(s => s.IsSettled),
            "open" => q.Where(s => !s.IsSettled),
            "unpaid" => q.Where(s => s.NetAmount > s.PaidAmount),
            "pending-crates" => q.Where(s => s.EmptyCratesRequired > s.EmptyCratesReturned),
            _ => q,
        };
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(x => EF.Functions.ILike(x.InvoiceNumber, $"%{s}%")
                             || EF.Functions.ILike(x.Customer!.Name, $"%{s}%")
                             || (x.Customer.BusinessName != null && EF.Functions.ILike(x.Customer.BusinessName, $"%{s}%")));
        }
        var total = await q.CountAsync();
        var rows = await q.OrderByDescending(s => s.SaleDate).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return new PagedResult<SaleListItemDto>(_mapper.Map<List<SaleListItemDto>>(rows), total, page, pageSize);
    }

    public async Task<SaleDto> GetAsync(Guid id)
    {
        var sale = await _db.Sales.AsNoTracking()
            .Include(s => s.Customer).Include(s => s.Items).Include(s => s.Returns)
            .AsSplitQuery()
            .FirstOrDefaultAsync(s => s.Id == id) ?? throw AppException.NotFound("Sale");

        var dto = _mapper.Map<SaleDto>(sale);
        var names = sale.Items.ToDictionary(i => i.Id, i => i.ProductName);
        foreach (var r in dto.Returns)
        {
            r.ProductName = names.GetValueOrDefault(r.SaleItemId, "");
            r.InvoiceNumber = sale.InvoiceNumber;
            r.CustomerName = sale.Customer?.Name;
        }
        dto.Payments = _mapper.Map<List<PaymentDto>>(await _db.Payments.AsNoTracking()
            .Where(p => p.SaleId == id).OrderBy(p => p.PaymentDate).ToListAsync());
        dto.SettlementBlockers = SettlementService.Blockers(sale);
        if (sale.CreatedByUserId.HasValue)
            dto.CreatedByName = await _db.Users.IgnoreQueryFilters().Where(u => u.Id == sale.CreatedByUserId)
                .Select(u => u.FullName).FirstOrDefaultAsync();
        return dto;
    }

    public async Task<SaleDto> CreateAsync(CreateSaleRequest req)
    {
        // Idempotent: the offline queue may resend a sale that already reached the server.
        if (req.Id.HasValue && await _db.Sales.AnyAsync(s => s.Id == req.Id))
            return await GetAsync(req.Id.Value);

        var isManager = _user.IsInRole(UserRole.SuperAdmin, UserRole.Admin, UserRole.Manager);
        if (req.Discount > 0 && !isManager)
            throw AppException.Forbidden("Only a Manager or Admin can give a discount.");
        if (req.PaymentMode == PaymentMode.Credit && req.PaidAmount > 0)
            throw new AppException("Choose how the paid amount was received (Cash, JazzCash, …) instead of Credit.");

        var saleId = await _db.InTransactionAsync(async () =>
        {
            var customer = await _settle.LockCustomerAsync(req.CustomerId);
            if (!customer.IsActive) throw new AppException($"{customer.Name} is marked inactive.");

            var date = req.SaleDate ?? DateTime.UtcNow;
            var sale = new Sale
            {
                Id = req.Id ?? Guid.NewGuid(),
                CustomerId = customer.Id,
                SaleDate = date,
                Discount = Money.R(req.Discount),
                PaymentMode = req.PaymentMode,
                Notes = req.Notes,
                OfflineReference = req.OfflineReference,
                CreatedByUserId = _user.Id,
            };
            sale.InvoiceNumber = await _numbers.NextAsync("INV", date);

            var productIds = req.Items.Select(i => i.ProductId).Distinct().ToList();
            var products = await _db.Products.Where(p => productIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
            var perCrate = await _settings.ProfitIsPerCrateAsync();

            // Same product at the same price on two lines → one line.
            var lines = req.Items
                .GroupBy(i => new { i.ProductId, i.UnitPrice })
                .Select(g => new { g.Key.ProductId, g.Key.UnitPrice, Quantity = g.Sum(x => x.Quantity) });

            foreach (var line in lines)
            {
                if (!products.TryGetValue(line.ProductId, out var product) || !product.IsActive)
                    throw new AppException("A product on this sale no longer exists or is inactive.");

                var price = line.UnitPrice ?? product.SellingPrice;
                var minProfit = perCrate && product.BottlesPerCrate > 0 ? Math.Round(product.MinProfit / product.BottlesPerCrate, 2) : product.MinProfit;
                var minPrice = product.PurchasePrice + minProfit;
                if (price < minPrice && !isManager)
                    throw AppException.Forbidden($"{product.Name}: Rs {price:N2} is below the minimum Rs {minPrice:N2}. Ask a Manager to approve a lower price.");

                var item = new SaleItem
                {
                    SaleId = sale.Id,
                    ProductId = product.Id,
                    ProductName = product.Name,
                    Quantity = line.Quantity,
                    UnitPrice = price,
                    Total = Money.R(price * line.Quantity),
                    IsCrateRequired = product.IsCrateRequired,
                    BottlesPerCrate = product.BottlesPerCrate,
                    PriceOverridden = price != product.SellingPrice,
                };
                item.Allocations = await _stock.DeductFifoAsync(product, line.Quantity, sale.Id, $"Sale {sale.InvoiceNumber}");
                foreach (var a in item.Allocations) a.SaleItemId = item.Id;

                var cost = item.Allocations.Sum(a => a.Quantity * a.UnitCost);
                item.PurchasePriceAtSale = Money.R(cost / line.Quantity);
                item.ProfitPerUnit = Money.R(price - cost / line.Quantity);
                sale.Items.Add(item);
                sale.ProfitAmount += item.Total - cost;
            }

            sale.TotalAmount = sale.Items.Sum(i => i.Total);
            if (sale.Discount > sale.TotalAmount) throw new AppException("Discount is more than the sale total.");
            sale.ProfitAmount = Money.R(sale.ProfitAmount - sale.Discount);
            SettlementService.Recalculate(sale);

            // The customer now owes the sale value and its crates.
            customer.OutstandingBalance = Money.R(customer.OutstandingBalance + sale.NetAmount);
            if (sale.EmptyCratesRequired > 0)
            {
                customer.EmptyCrateBalance += sale.EmptyCratesRequired;
                _db.EmptyCrateTransactions.Add(new EmptyCrateTransaction
                {
                    CustomerId = customer.Id, SaleId = sale.Id, TransactionType = CrateTransactionType.Issued,
                    Quantity = sale.EmptyCratesRequired, Date = date, Notes = $"Sale {sale.InvoiceNumber}", CreatedByUserId = _user.Id,
                });
            }

            _db.Sales.Add(sale);
            await _db.SaveChangesAsync();

            // Money received now pays this sale first, any extra clears older dues.
            if (req.PaidAmount > 0)
                await _settle.ReceivePaymentAsync(customer, req.PaidAmount, req.PaymentMode, sale.Id, date, $"With sale {sale.InvoiceNumber}");

            // Empties brought along usually belong to earlier deliveries, so they clear the oldest sales first.
            if (req.CratesReturnedNow > 0)
                await _settle.ReceiveCratesAsync(customer, req.CratesReturnedNow, null, date, $"Returned with sale {sale.InvoiceNumber}");

            _db.AuditLogs.Add(new AuditLog
            {
                UserId = _user.Id, Action = "Create", Entity = nameof(Sale), EntityId = sale.Id.ToString(),
                NewValues = System.Text.Json.JsonSerializer.Serialize(new { sale.InvoiceNumber, sale.NetAmount, sale.ProfitAmount, sale.EmptyCratesRequired }),
            });
            await _db.SaveChangesAsync();
            return sale.Id;
        });

        return await GetAsync(saleId);
    }

    public async Task<SaleDto> AddPaymentAsync(Guid saleId, CustomerPaymentRequest req)
    {
        await _db.InTransactionAsync(async () =>
        {
            var sale = await _settle.LockSaleAsync(saleId);
            var customer = await _settle.LockCustomerAsync(sale.CustomerId);
            await _settle.ReceivePaymentAsync(customer, req.Amount, req.PaymentMode, saleId, req.PaymentDate ?? DateTime.UtcNow, req.Notes, req.Id);
            await _db.SaveChangesAsync();
            return true;
        });
        return await GetAsync(saleId);
    }

    public async Task<SaleDto> ReturnCratesAsync(Guid saleId, int quantity, string? notes)
    {
        await _db.InTransactionAsync(async () =>
        {
            var sale = await _settle.LockSaleAsync(saleId);
            var customer = await _settle.LockCustomerAsync(sale.CustomerId);
            await _settle.ReceiveCratesAsync(customer, quantity, saleId, DateTime.UtcNow, notes);
            await _db.SaveChangesAsync();
            return true;
        });
        return await GetAsync(saleId);
    }

    /// <summary>
    /// Marks a sale settled. Normally automatic once paid and all crates are back; this endpoint
    /// lets an Admin close it early (override) with a recorded reason. Balances stay on the customer's ledger.
    /// </summary>
    public async Task<SaleDto> SettleAsync(Guid saleId, SettleSaleRequest req)
    {
        await _db.InTransactionAsync(async () =>
        {
            var sale = await _settle.LockSaleAsync(saleId);
            SettlementService.Recalculate(sale);
            if (sale.IsSettled) return true;

            var blockers = SettlementService.Blockers(sale);
            if (!req.Override)
                throw new AppException("Cannot settle yet: " + string.Join(" ", blockers), 409, "settlement_blocked");
            if (!_user.IsInRole(UserRole.SuperAdmin, UserRole.Admin))
                throw AppException.Forbidden("Only an Admin can override settlement.");
            if (string.IsNullOrWhiteSpace(req.Reason))
                throw new AppException("Give a reason for overriding settlement.");

            sale.IsSettled = true;
            sale.SettledAt = DateTime.UtcNow;
            sale.SettlementOverridden = true;
            sale.SettlementOverriddenByUserId = _user.Id;
            sale.SettlementOverrideReason = req.Reason;
            _db.AuditLogs.Add(new AuditLog
            {
                UserId = _user.Id, Action = "SettlementOverride", Entity = nameof(Sale), EntityId = sale.Id.ToString(),
                NewValues = System.Text.Json.JsonSerializer.Serialize(new { req.Reason, blockers }),
            });
            await _db.SaveChangesAsync();
            return true;
        });
        return await GetAsync(saleId);
    }
}
