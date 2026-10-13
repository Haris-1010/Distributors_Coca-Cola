using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

/// <summary>
/// The money + crate rules shared by sales, returns, payments and crate collection.
/// Every method expects to run inside the caller's transaction; none call SaveChanges.
/// </summary>
public class SettlementService
{
    private readonly AppDbContext _db;
    private readonly ICurrentUser _user;

    public SettlementService(AppDbContext db, ICurrentUser user)
    {
        _db = db;
        _user = user;
    }

    /// <summary>Recomputes derived sale totals, crate requirement and settled flag from its items.</summary>
    public static void Recalculate(Sale sale)
    {
        sale.NetAmount = Money.R(sale.TotalAmount - sale.Discount - sale.ReturnedAmount);
        sale.PaymentStatus = Money.StatusFor(sale.NetAmount, sale.PaidAmount);
        sale.EmptyCratesRequired = sale.Items.Sum(i => i.CratesRequired);

        if (sale.SettlementOverridden) return;
        var settled = sale.NetAmount - sale.PaidAmount <= 0 && sale.EmptyCratesReturned >= sale.EmptyCratesRequired;
        if (settled && !sale.IsSettled) sale.SettledAt = DateTime.UtcNow;
        if (!settled) sale.SettledAt = null;
        sale.IsSettled = settled;
    }

    /// <summary>Why a sale can't be settled yet, in words a shopkeeper understands.</summary>
    public static List<string> Blockers(Sale sale)
    {
        var list = new List<string>();
        if (sale.IsSettled) return list;
        var due = sale.NetAmount - sale.PaidAmount;
        if (due > 0) list.Add($"Rs {due:N2} payment still due.");
        if (sale.PendingCrates > 0) list.Add($"{sale.PendingCrates} empty crate(s) not returned yet.");
        return list;
    }

    public async Task<Sale> LockSaleAsync(Guid saleId)
    {
        var tracked = _db.ChangeTracker.Entries<Sale>().FirstOrDefault(e => e.Entity.Id == saleId)?.Entity;
        if (tracked == null)
        {
            var rows = await _db.Sales.FromSqlInterpolated($"SELECT * FROM sales WHERE id = {saleId} AND is_deleted = false FOR UPDATE")
                .IgnoreQueryFilters().ToListAsync();
            tracked = rows.FirstOrDefault() ?? throw AppException.NotFound("Sale");
        }
        var entry = _db.Entry(tracked);
        if (entry.State == EntityState.Added) return tracked; // created in this request; items already in memory
        if (!entry.Collection(s => s.Items).IsLoaded) await entry.Collection(s => s.Items).LoadAsync();
        foreach (var item in tracked.Items)
        {
            var itemEntry = _db.Entry(item);
            if (itemEntry.State != EntityState.Added && !itemEntry.Collection(i => i.Allocations).IsLoaded)
                await itemEntry.Collection(i => i.Allocations).LoadAsync();
        }
        return tracked;
    }

    public async Task<Customer> LockCustomerAsync(Guid customerId)
    {
        var tracked = _db.ChangeTracker.Entries<Customer>().FirstOrDefault(e => e.Entity.Id == customerId)?.Entity;
        if (tracked != null) return tracked;
        var rows = await _db.Customers.FromSqlInterpolated($"SELECT * FROM customers WHERE id = {customerId} AND is_deleted = false FOR UPDATE")
            .IgnoreQueryFilters().ToListAsync();
        return rows.FirstOrDefault() ?? throw AppException.NotFound("Customer");
    }

    /// <summary>
    /// Records money received from a customer. With a sale it pays that sale; any extra (or a
    /// payment with no sale) clears the oldest unpaid sales first. Anything left becomes an advance.
    /// </summary>
    public async Task<List<Payment>> ReceivePaymentAsync(Customer customer, decimal amount, PaymentMode mode,
        Guid? saleId, DateTime date, string? notes, Guid? firstPaymentId = null)
    {
        var payments = new List<Payment>();
        var remaining = Money.R(amount);

        async Task Pay(Sale s)
        {
            var due = s.NetAmount - s.PaidAmount;
            if (due <= 0 || remaining <= 0) return;
            var part = Math.Min(due, remaining);
            s.PaidAmount += part;
            Recalculate(s);
            remaining -= part;
            payments.Add(NewPayment(customer.Id, s.Id, part, mode, date, notes));
        }

        if (saleId.HasValue)
        {
            var sale = await LockSaleAsync(saleId.Value);
            if (sale.CustomerId != customer.Id) throw new AppException("That sale belongs to another customer.");
            await Pay(sale);
        }

        if (remaining > 0)
        {
            var openIds = await _db.Sales.Where(s => s.CustomerId == customer.Id && s.NetAmount > s.PaidAmount && s.Id != saleId)
                .OrderBy(s => s.SaleDate).Select(s => s.Id).ToListAsync();
            foreach (var id in openIds)
            {
                if (remaining <= 0) break;
                await Pay(await LockSaleAsync(id));
            }
        }

        if (remaining > 0)
            payments.Add(NewPayment(customer.Id, null, remaining, mode, date, (notes + " (advance)").Trim()));

        if (firstPaymentId.HasValue && payments.Count > 0) payments[0].Id = firstPaymentId.Value;
        customer.OutstandingBalance = Money.R(customer.OutstandingBalance - amount);
        _db.Payments.AddRange(payments);
        return payments;
    }

    /// <summary>
    /// Records empty crates brought back. With a sale they go to that sale first; the rest clear the
    /// oldest sales still waiting for crates. Crates owed from opening balances / adjustments are cleared last.
    /// </summary>
    public async Task<(int accepted, List<Sale> affected)> ReceiveCratesAsync(Customer customer, int quantity,
        Guid? saleId, DateTime date, string? notes, Guid? firstTransactionId = null)
    {
        if (quantity > customer.EmptyCrateBalance)
            throw new AppException($"{customer.Name} only owes {Math.Max(0, customer.EmptyCrateBalance)} crate(s). " +
                                   "Use a crate adjustment if more were collected.", 400, "crates_exceed");

        var remaining = quantity;
        var affected = new List<Sale>();
        var txns = new List<EmptyCrateTransaction>();

        void Apply(Sale s)
        {
            var pending = s.PendingCrates;
            if (pending <= 0 || remaining <= 0) return;
            var part = Math.Min(pending, remaining);
            s.EmptyCratesReturned += part;
            Recalculate(s);
            remaining -= part;
            affected.Add(s);
            txns.Add(new EmptyCrateTransaction
            {
                CustomerId = customer.Id, SaleId = s.Id, TransactionType = CrateTransactionType.Returned,
                Quantity = -part, Date = date, Notes = notes, CreatedByUserId = _user.Id,
            });
        }

        if (saleId.HasValue)
        {
            var sale = await LockSaleAsync(saleId.Value);
            if (sale.CustomerId != customer.Id) throw new AppException("That sale belongs to another customer.");
            Apply(sale);
        }

        if (remaining > 0)
        {
            var ids = await _db.Sales.Where(s => s.CustomerId == customer.Id && s.EmptyCratesRequired > s.EmptyCratesReturned && s.Id != saleId)
                .OrderBy(s => s.SaleDate).Select(s => s.Id).ToListAsync();
            foreach (var id in ids)
            {
                if (remaining <= 0) break;
                Apply(await LockSaleAsync(id));
            }
        }

        if (remaining > 0)
        {
            // Against crates owed from adjustments / opening balance, not tied to a sale.
            txns.Add(new EmptyCrateTransaction
            {
                CustomerId = customer.Id, TransactionType = CrateTransactionType.Returned,
                Quantity = -remaining, Date = date, Notes = notes, CreatedByUserId = _user.Id,
            });
        }

        if (firstTransactionId.HasValue && txns.Count > 0) txns[0].Id = firstTransactionId.Value;
        customer.EmptyCrateBalance -= quantity;
        _db.EmptyCrateTransactions.AddRange(txns);
        return (quantity, affected);
    }

    public Payment NewPayment(Guid customerId, Guid? saleId, decimal amount, PaymentMode mode, DateTime date,
        string? notes, PaymentDirection direction = PaymentDirection.Received) => new()
    {
        CustomerId = customerId, SaleId = saleId, Amount = Money.R(amount), PaymentMode = mode,
        PaymentDate = date, Notes = notes, Direction = direction, CreatedByUserId = _user.Id,
    };
}
