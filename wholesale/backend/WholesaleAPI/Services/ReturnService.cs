using AutoMapper;
using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public class ReturnService
{
    private readonly AppDbContext _db;
    private readonly IMapper _mapper;
    private readonly StockService _stock;
    private readonly SettlementService _settle;
    private readonly SaleService _sales;
    private readonly ICurrentUser _user;

    public ReturnService(AppDbContext db, IMapper mapper, StockService stock, SettlementService settle,
        SaleService sales, ICurrentUser user)
    {
        _db = db;
        _mapper = mapper;
        _stock = stock;
        _settle = settle;
        _sales = sales;
        _user = user;
    }

    /// <summary>Damaged and expired goods are written off; everything else goes back on the shelf.</summary>
    public static bool Restocks(ReturnReason reason) => reason is not (ReturnReason.Damaged or ReturnReason.Expired);

    public async Task<SaleDto> CreateAsync(CreateReturnRequest req)
    {
        if (req.Id.HasValue && await _db.SaleReturns.AnyAsync(r => r.Id == req.Id))
            return await _sales.GetAsync(req.SaleId);

        await _db.InTransactionAsync(async () =>
        {
            var sale = await _settle.LockSaleAsync(req.SaleId);
            var customer = await _settle.LockCustomerAsync(sale.CustomerId);
            var date = req.ReturnDate ?? DateTime.UtcNow;

            var oldBalance = sale.NetAmount - sale.PaidAmount;
            var oldCrates = sale.EmptyCratesRequired;
            var created = new List<SaleReturn>();

            foreach (var line in req.Lines.GroupBy(l => new { l.SaleItemId, l.Reason })
                         .Select(g => new ReturnLineRequest(g.Key.SaleItemId, g.Sum(x => x.Quantity), g.Key.Reason)))
            {
                var item = sale.Items.FirstOrDefault(i => i.Id == line.SaleItemId)
                           ?? throw new AppException("That item is not on this sale.");
                if (line.Quantity > item.NetQuantity)
                    throw new AppException($"{item.ProductName}: only {item.NetQuantity} piece(s) can still be returned.");

                var restock = Restocks(line.Reason);
                var ret = new SaleReturn
                {
                    Id = created.Count == 0 && req.Id.HasValue ? req.Id.Value : Guid.NewGuid(),
                    SaleId = sale.Id,
                    SaleItemId = item.Id,
                    ProductId = item.ProductId,
                    Quantity = line.Quantity,
                    Reason = line.Reason,
                    ReturnDate = date,
                    StockAdjusted = restock,
                    ReturnValue = Money.R(line.Quantity * item.UnitPrice),
                    // Restocked: we only lose the margin. Written off: we lose the sale price (cost is gone too).
                    ProfitReversed = Money.R(line.Quantity * (restock ? item.ProfitPerUnit : item.UnitPrice)),
                    Notes = req.Notes,
                    CreatedByUserId = _user.Id,
                };

                if (restock)
                    await _stock.RestoreAsync(item.ProductId, item.Allocations, line.Quantity, ret.Id, $"Return on {sale.InvoiceNumber} ({line.Reason})");
                else
                    StockService.MarkReturnedWithoutRestock(item.Allocations, line.Quantity);

                var cratesBefore = item.CratesRequired;
                item.ReturnedQuantity += line.Quantity;
                ret.CratesReduced = cratesBefore - item.CratesRequired;

                sale.ReturnedAmount += ret.ReturnValue;
                sale.ProfitAmount -= ret.ProfitReversed;
                created.Add(ret);
                _db.SaleReturns.Add(ret);
            }

            SettlementService.Recalculate(sale);

            // If the customer had already paid more than the new total, the difference is refunded.
            if (sale.PaidAmount > sale.NetAmount)
            {
                var refund = sale.PaidAmount - sale.NetAmount;
                sale.PaidAmount = sale.NetAmount;
                created[^1].RefundAmount = refund;
                _db.Payments.Add(_settle.NewPayment(customer.Id, sale.Id, refund, PaymentMode.Cash, date,
                    $"Refund for return on {sale.InvoiceNumber}", PaymentDirection.Refund));
                SettlementService.Recalculate(sale);
            }

            customer.OutstandingBalance = Money.R(customer.OutstandingBalance + (sale.NetAmount - sale.PaidAmount) - oldBalance);

            var crateDelta = sale.EmptyCratesRequired - oldCrates;
            if (crateDelta != 0)
            {
                customer.EmptyCrateBalance += crateDelta;
                _db.EmptyCrateTransactions.Add(new EmptyCrateTransaction
                {
                    CustomerId = customer.Id, SaleId = sale.Id, TransactionType = CrateTransactionType.Adjustment,
                    Quantity = crateDelta, Date = date, Notes = $"Bottles returned on {sale.InvoiceNumber}", CreatedByUserId = _user.Id,
                });
            }

            _db.AuditLogs.Add(new AuditLog
            {
                UserId = _user.Id, Action = "Return", Entity = nameof(Sale), EntityId = sale.Id.ToString(),
                NewValues = System.Text.Json.JsonSerializer.Serialize(created.Select(r => new { r.ProductId, r.Quantity, r.Reason, r.ReturnValue })),
            });
            await _db.SaveChangesAsync();
            return true;
        });

        return await _sales.GetAsync(req.SaleId);
    }

    public async Task<PagedResult<SaleReturnDto>> ListAsync(DateTime? from, DateTime? to, Guid? customerId, int page, int pageSize)
    {
        var q = from r in _db.SaleReturns.AsNoTracking()
                join s in _db.Sales on r.SaleId equals s.Id
                join c in _db.Customers.IgnoreQueryFilters() on s.CustomerId equals c.Id
                join i in _db.SaleItems on r.SaleItemId equals i.Id
                select new { r, s.InvoiceNumber, s.CustomerId, CustomerName = c.Name, i.ProductName };
        if (from.HasValue) q = q.Where(x => x.r.ReturnDate >= from);
        if (to.HasValue) q = q.Where(x => x.r.ReturnDate < to);
        if (customerId.HasValue) q = q.Where(x => x.CustomerId == customerId);

        var total = await q.CountAsync();
        var rows = await q.OrderByDescending(x => x.r.ReturnDate).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var dtos = rows.Select(x =>
        {
            var d = _mapper.Map<SaleReturnDto>(x.r);
            d.InvoiceNumber = x.InvoiceNumber;
            d.CustomerName = x.CustomerName;
            d.ProductName = x.ProductName;
            return d;
        }).ToList();
        return new PagedResult<SaleReturnDto>(dtos, total, page, pageSize);
    }
}
