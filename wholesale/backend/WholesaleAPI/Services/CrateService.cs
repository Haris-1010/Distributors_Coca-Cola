using AutoMapper;
using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public class CrateService
{
    private readonly AppDbContext _db;
    private readonly IMapper _mapper;
    private readonly SettlementService _settle;
    private readonly ICurrentUser _user;

    public CrateService(AppDbContext db, IMapper mapper, SettlementService settle, ICurrentUser user)
    {
        _db = db;
        _mapper = mapper;
        _settle = settle;
        _user = user;
    }

    public async Task<List<CustomerCrateSummaryDto>> SummaryAsync(bool onlyPending)
    {
        var totals = await _db.EmptyCrateTransactions.AsNoTracking()
            .GroupBy(t => t.CustomerId)
            .Select(g => new
            {
                CustomerId = g.Key,
                Issued = g.Sum(t => t.TransactionType == CrateTransactionType.Issued ? t.Quantity : 0),
                Returned = -g.Sum(t => t.TransactionType == CrateTransactionType.Returned ? t.Quantity : 0),
                Adjust = g.Sum(t => t.TransactionType == CrateTransactionType.Adjustment ? t.Quantity : 0),
            }).ToDictionaryAsync(x => x.CustomerId);

        var open = await _db.Sales.AsNoTracking().Where(s => s.EmptyCratesRequired > s.EmptyCratesReturned)
            .GroupBy(s => s.CustomerId)
            .Select(g => new { CustomerId = g.Key, Count = g.Count(), Oldest = g.Min(s => s.SaleDate) })
            .ToDictionaryAsync(x => x.CustomerId);

        var customers = await _db.Customers.AsNoTracking()
            .Where(c => !onlyPending || c.EmptyCrateBalance > 0)
            .OrderByDescending(c => c.EmptyCrateBalance).ThenBy(c => c.Name).ToListAsync();

        return customers.Select(c =>
        {
            var t = totals.GetValueOrDefault(c.Id);
            var o = open.GetValueOrDefault(c.Id);
            return new CustomerCrateSummaryDto
            {
                CustomerId = c.Id, CustomerName = c.Name, BusinessName = c.BusinessName, Phone = c.Phone,
                CratesIssued = t?.Issued ?? 0, CratesReturned = t?.Returned ?? 0, Adjustments = t?.Adjust ?? 0,
                PendingCrates = c.EmptyCrateBalance, OpenSales = o?.Count ?? 0, OldestPendingSaleDate = o?.Oldest,
            };
        }).ToList();
    }

    public async Task<PagedResult<CrateTransactionDto>> TransactionsAsync(Guid? customerId, DateTime? from, DateTime? to, int page, int pageSize)
    {
        var q = from t in _db.EmptyCrateTransactions.AsNoTracking()
                join c in _db.Customers.IgnoreQueryFilters() on t.CustomerId equals c.Id
                join s in _db.Sales on t.SaleId equals (Guid?)s.Id into sj
                from s in sj.DefaultIfEmpty()
                select new { t, CustomerName = c.Name, InvoiceNumber = s != null ? s.InvoiceNumber : null };
        if (customerId.HasValue) q = q.Where(x => x.t.CustomerId == customerId);
        if (from.HasValue) q = q.Where(x => x.t.Date >= from);
        if (to.HasValue) q = q.Where(x => x.t.Date < to);
        var total = await q.CountAsync();
        var rows = await q.OrderByDescending(x => x.t.Date).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var dtos = rows.Select(x =>
        {
            var d = _mapper.Map<CrateTransactionDto>(x.t);
            d.CustomerName = x.CustomerName;
            d.InvoiceNumber = x.InvoiceNumber;
            return d;
        }).ToList();
        return new PagedResult<CrateTransactionDto>(dtos, total, page, pageSize);
    }

    public async Task<CrateReturnResultDto> ReturnAsync(CrateReturnRequest req)
    {
        if (req.Id.HasValue && await _db.EmptyCrateTransactions.AnyAsync(t => t.Id == req.Id))
        {
            var c = await _db.Customers.AsNoTracking().FirstAsync(x => x.Id == req.CustomerId);
            return new CrateReturnResultDto { Accepted = req.Quantity, CustomerCrateBalance = c.EmptyCrateBalance };
        }

        return await _db.InTransactionAsync(async () =>
        {
            var customer = await _settle.LockCustomerAsync(req.CustomerId);
            var (accepted, affected) = await _settle.ReceiveCratesAsync(customer, req.Quantity, req.SaleId,
                req.Date ?? DateTime.UtcNow, req.Notes, req.Id);
            await _db.SaveChangesAsync();
            foreach (var s in affected) s.Customer = customer;
            return new CrateReturnResultDto
            {
                Accepted = accepted,
                CustomerCrateBalance = customer.EmptyCrateBalance,
                AffectedSales = _mapper.Map<List<SaleListItemDto>>(affected),
            };
        });
    }

    /// <summary>
    /// Admin correction of what a customer owes in crates — e.g. opening balance when starting
    /// the software, a crate broken by the shop, or extra crates collected. Positive = customer owes more.
    /// </summary>
    public async Task<CustomerDto> AdjustAsync(CrateAdjustmentRequest req)
    {
        return await _db.InTransactionAsync(async () =>
        {
            var customer = await _settle.LockCustomerAsync(req.CustomerId);
            customer.EmptyCrateBalance += req.Quantity;
            _db.EmptyCrateTransactions.Add(new EmptyCrateTransaction
            {
                CustomerId = customer.Id, TransactionType = CrateTransactionType.Adjustment,
                Quantity = req.Quantity, Notes = req.Notes, CreatedByUserId = _user.Id,
            });
            _db.AuditLogs.Add(new AuditLog
            {
                UserId = _user.Id, Action = "CrateAdjustment", Entity = nameof(Customer), EntityId = customer.Id.ToString(),
                NewValues = System.Text.Json.JsonSerializer.Serialize(new { req.Quantity, req.Notes, customer.EmptyCrateBalance }),
            });
            await _db.SaveChangesAsync();
            return _mapper.Map<CustomerDto>(customer);
        });
    }
}
