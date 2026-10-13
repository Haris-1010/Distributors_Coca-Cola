using AutoMapper;
using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public class CustomerService
{
    private readonly AppDbContext _db;
    private readonly IMapper _mapper;
    private readonly SettlementService _settle;
    private readonly AuditService _audit;

    public CustomerService(AppDbContext db, IMapper mapper, SettlementService settle, AuditService audit)
    {
        _db = db;
        _mapper = mapper;
        _settle = settle;
        _audit = audit;
    }

    public async Task<List<CustomerDto>> ListAsync(string? search, bool includeInactive, string? filter)
    {
        var q = _db.Customers.AsNoTracking().AsQueryable();
        if (!includeInactive) q = q.Where(c => c.IsActive);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(c => EF.Functions.ILike(c.Name, $"%{s}%") || (c.BusinessName != null && EF.Functions.ILike(c.BusinessName, $"%{s}%"))
                             || (c.Phone != null && c.Phone.Contains(s)));
        }
        q = filter?.ToLowerInvariant() switch
        {
            "outstanding" => q.Where(c => c.OutstandingBalance > 0),
            "crates" => q.Where(c => c.EmptyCrateBalance > 0),
            _ => q,
        };
        return _mapper.Map<List<CustomerDto>>(await q.OrderBy(c => c.Name).ToListAsync());
    }

    public async Task<CustomerDto> GetAsync(Guid id) =>
        _mapper.Map<CustomerDto>(await _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id)
                                 ?? throw AppException.NotFound("Customer"));

    public async Task<CustomerDto> CreateAsync(SaveCustomerRequest req)
    {
        if (req.Id.HasValue && await _db.Customers.AnyAsync(c => c.Id == req.Id))
            return await GetAsync(req.Id.Value);
        var c = new Customer { Id = req.Id ?? Guid.NewGuid() };
        Apply(c, req);
        _db.Customers.Add(c);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Create", nameof(Customer), c.Id.ToString(), newValues: req);
        return _mapper.Map<CustomerDto>(c);
    }

    public async Task<CustomerDto> UpdateAsync(Guid id, SaveCustomerRequest req)
    {
        var c = await _db.Customers.FindAsync(id) ?? throw AppException.NotFound("Customer");
        Apply(c, req);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Update", nameof(Customer), id.ToString(), newValues: req);
        return _mapper.Map<CustomerDto>(c);
    }

    public async Task DeleteAsync(Guid id)
    {
        var c = await _db.Customers.FindAsync(id) ?? throw AppException.NotFound("Customer");
        if (c.OutstandingBalance != 0 || c.EmptyCrateBalance != 0)
            throw AppException.Conflict($"{c.Name} still has Rs {c.OutstandingBalance:N2} and {c.EmptyCrateBalance} crate(s) open. Clear them or mark the customer inactive.");
        _db.Customers.Remove(c);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Delete", nameof(Customer), id.ToString());
    }

    public async Task<List<PaymentDto>> ReceivePaymentAsync(Guid customerId, CustomerPaymentRequest req)
    {
        if (req.Id.HasValue && await _db.Payments.AnyAsync(p => p.Id == req.Id))
            return _mapper.Map<List<PaymentDto>>(await _db.Payments.AsNoTracking().Where(p => p.Id == req.Id).ToListAsync());

        var payments = await _db.InTransactionAsync(async () =>
        {
            var customer = await _settle.LockCustomerAsync(customerId);
            var list = await _settle.ReceivePaymentAsync(customer, req.Amount, req.PaymentMode, req.SaleId,
                req.PaymentDate ?? DateTime.UtcNow, req.Notes, req.Id);
            await _db.SaveChangesAsync();
            return list;
        });
        return _mapper.Map<List<PaymentDto>>(payments);
    }

    /// <summary>Running statement of money and crates for one customer.</summary>
    public async Task<CustomerLedgerDto> LedgerAsync(Guid customerId, DateTime? from, DateTime? to)
    {
        var customer = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId)
                       ?? throw AppException.NotFound("Customer");

        var sales = await _db.Sales.AsNoTracking().Where(s => s.CustomerId == customerId)
            .Select(s => new { s.Id, s.InvoiceNumber, s.SaleDate, Amount = s.TotalAmount - s.Discount }).ToListAsync();
        var invoiceById = sales.ToDictionary(s => s.Id, s => s.InvoiceNumber);
        var saleIds = sales.Select(s => s.Id).ToList();
        var returns = await _db.SaleReturns.AsNoTracking().Where(r => saleIds.Contains(r.SaleId)).ToListAsync();
        var payments = await _db.Payments.AsNoTracking().Where(p => p.CustomerId == customerId).ToListAsync();
        var crates = await _db.EmptyCrateTransactions.AsNoTracking().Where(t => t.CustomerId == customerId).ToListAsync();

        var entries = new List<LedgerEntryDto>();
        foreach (var s in sales)
        {
            var issued = crates.Where(t => t.SaleId == s.Id && t.TransactionType == CrateTransactionType.Issued).Sum(t => t.Quantity);
            entries.Add(new LedgerEntryDto { Date = s.SaleDate, Type = "Sale", Reference = s.InvoiceNumber, SaleId = s.Id, Debit = s.Amount, CratesIssued = issued });
        }
        foreach (var g in returns.GroupBy(r => new { r.SaleId, r.ReturnDate }))
            entries.Add(new LedgerEntryDto
            {
                Date = g.Key.ReturnDate, Type = "Return", Reference = invoiceById.GetValueOrDefault(g.Key.SaleId, ""), SaleId = g.Key.SaleId,
                Credit = g.Sum(r => r.ReturnValue), Notes = $"{g.Sum(r => r.Quantity)} piece(s) returned",
            });
        foreach (var p in payments)
            entries.Add(new LedgerEntryDto
            {
                Date = p.PaymentDate, Type = p.Direction == PaymentDirection.Refund ? "Refund" : $"Payment ({p.PaymentMode})",
                Reference = p.SaleId.HasValue ? invoiceById.GetValueOrDefault(p.SaleId.Value, "") : "Advance / on account",
                SaleId = p.SaleId, Notes = p.Notes,
                Credit = p.Direction == PaymentDirection.Received ? p.Amount : 0,
                Debit = p.Direction == PaymentDirection.Refund ? p.Amount : 0,
            });
        foreach (var t in crates.Where(t => t.TransactionType != CrateTransactionType.Issued))
            entries.Add(new LedgerEntryDto
            {
                Date = t.Date, Type = t.TransactionType == CrateTransactionType.Returned ? "Crates returned" : "Crate adjustment",
                Reference = t.SaleId.HasValue ? invoiceById.GetValueOrDefault(t.SaleId.Value, "") : "",
                SaleId = t.SaleId, Notes = t.Notes,
                CratesIssued = t.Quantity > 0 ? t.Quantity : 0,
                CratesReturned = t.Quantity < 0 ? -t.Quantity : 0,
            });

        entries = entries.OrderBy(e => e.Date).ThenBy(e => e.Type == "Sale" ? 0 : 1).ToList();
        decimal bal = 0; int crt = 0;
        foreach (var e in entries)
        {
            bal += e.Debit - e.Credit;
            crt += e.CratesIssued - e.CratesReturned;
            e.Balance = Money.R(bal);
            e.CrateBalance = crt;
        }

        var before = entries.Where(e => from.HasValue && e.Date < from).ToList();
        var inRange = entries.Where(e => (!from.HasValue || e.Date >= from) && (!to.HasValue || e.Date < to)).ToList();
        return new CustomerLedgerDto
        {
            Customer = _mapper.Map<CustomerDto>(customer),
            OpeningBalance = before.LastOrDefault()?.Balance ?? 0,
            OpeningCrates = before.LastOrDefault()?.CrateBalance ?? 0,
            Entries = inRange,
            ClosingBalance = inRange.LastOrDefault()?.Balance ?? before.LastOrDefault()?.Balance ?? 0,
            ClosingCrates = inRange.LastOrDefault()?.CrateBalance ?? before.LastOrDefault()?.CrateBalance ?? 0,
        };
    }

    private static void Apply(Customer c, SaveCustomerRequest r)
    {
        c.Name = r.Name.Trim();
        c.Phone = r.Phone?.Trim();
        c.Address = r.Address?.Trim();
        c.BusinessName = r.BusinessName?.Trim();
        c.CustomerType = r.CustomerType;
        c.IsActive = r.IsActive;
    }
}
