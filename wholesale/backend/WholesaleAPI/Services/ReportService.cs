using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.Repositories;

namespace WholesaleAPI.Services;

public record DateRange(DateOnly From, DateOnly To);

public class ReportService
{
    private readonly ReportRepository _repo;
    private readonly SettingsService _settings;
    private readonly StockService _stock;
    private readonly CrateService _crates;
    private readonly AppDbContext _db;

    public ReportService(ReportRepository repo, SettingsService settings, StockService stock, CrateService crates, AppDbContext db)
    {
        _repo = repo;
        _settings = settings;
        _stock = stock;
        _crates = crates;
        _db = db;
    }

    public async Task<DateOnly> TodayAsync()
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(await _settings.TimeZoneAsync());
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz));
    }

    /// <summary>Defaults to the current month when no dates are given.</summary>
    public async Task<DateRange> RangeAsync(DateOnly? from, DateOnly? to)
    {
        var today = await TodayAsync();
        var f = from ?? new DateOnly(today.Year, today.Month, 1);
        var t = to ?? today;
        if (t < f) (f, t) = (t, f);
        return new DateRange(f, t);
    }

    public async Task<object> DashboardAsync()
    {
        var tz = await _settings.TimeZoneAsync();
        var today = await TodayAsync();
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        object totalsRow = await _repo.DashboardTotalsAsync(today, monthStart, tz);
        var totals = CamelRow(totalsRow);
        var trend = await _repo.SalesByPeriodAsync(today.AddDays(-29), today, tz, "day");
        var top = await _repo.TopProductsAsync(monthStart, today, tz, 5);
        var alerts = await _stock.GetAlertsAsync();
        var crateDebtors = (await _crates.SummaryAsync(onlyPending: true)).Take(5).ToList();
        return new
        {
            today,
            totals,
            salesTrend = Camel(trend),
            topProducts = Camel(top),
            lowStock = alerts.LowStock,
            nearExpiryCount = alerts.NearExpiry.Count,
            expiredCount = alerts.Expired.Count,
            topCrateDebtors = crateDebtors,
        };
    }

    public async Task<object> SalesAsync(DateOnly? from, DateOnly? to, string period)
    {
        var r = await RangeAsync(from, to);
        var rows = Camel(await _repo.SalesByPeriodAsync(r.From, r.To, await _settings.TimeZoneAsync(), period));
        return new { r.From, r.To, period, rows, totals = Totals(rows, "salesCount", "gross", "discount", "returns", "net", "paid", "due", "profit", "cratesRequired", "cratesReturned") };
    }

    public async Task<object> ProfitAsync(DateOnly? from, DateOnly? to, string groupBy)
    {
        var r = await RangeAsync(from, to);
        var tz = await _settings.TimeZoneAsync();
        List<Dictionary<string, object?>> rows = groupBy switch
        {
            "customer" => Camel(await _repo.ProfitByCustomerAsync(r.From, r.To, tz)),
            "date" => Camel(await _repo.SalesByPeriodAsync(r.From, r.To, tz, "day")),
            _ => Camel(await _repo.ProfitByProductAsync(r.From, r.To, tz)),
        };
        return new { r.From, r.To, groupBy, rows, totals = Totals(rows, "revenue", "cost", "writeOff", "net", "profit", "quantity") };
    }

    public async Task<object> TopProductsAsync(DateOnly? from, DateOnly? to, int limit)
    {
        var r = await RangeAsync(from, to);
        return new { r.From, r.To, rows = Camel(await _repo.TopProductsAsync(r.From, r.To, await _settings.TimeZoneAsync(), Math.Clamp(limit, 1, 100))) };
    }

    public async Task<object> MarginAsync(DateOnly? from, DateOnly? to)
    {
        var r = await RangeAsync(from, to);
        var rows = Camel(await _repo.MarginAnalysisAsync(r.From, r.To, await _settings.TimeZoneAsync(), await _settings.ProfitIsPerCrateAsync()));
        return new { r.From, r.To, profitBasis = await _settings.GetAsync(SettingKeys.ProfitBasis, "Piece"), rows };
    }

    public async Task<object> ReturnsAsync(DateOnly? from, DateOnly? to)
    {
        var r = await RangeAsync(from, to);
        var rows = Camel(await _repo.ReturnsByReasonAsync(r.From, r.To, await _settings.TimeZoneAsync()));
        return new { r.From, r.To, byReason = rows, totals = Totals(rows, "lines", "quantity", "value", "profitLost", "refunded") };
    }

    public async Task<object> PurchasesAsync(DateOnly? from, DateOnly? to)
    {
        var r = await RangeAsync(from, to);
        var tz = await _settings.TimeZoneAsync();
        var byDistributor = Camel(await _repo.PurchasesByDistributorAsync(r.From, r.To, tz));
        return new
        {
            r.From, r.To, byDistributor,
            rows = Camel(await _repo.PurchasesListAsync(r.From, r.To, tz)),
            totals = Totals(byDistributor, "purchases", "total", "paid", "due", "pieces"),
        };
    }

    public async Task<object> StockAsync()
    {
        var summary = await _stock.GetSummaryAsync();
        var alerts = await _stock.GetAlertsAsync();
        return new
        {
            rows = summary,
            totals = new
            {
                products = summary.Count,
                pieces = summary.Sum(s => s.Quantity),
                crates = summary.Sum(s => s.CrateQuantity),
                value = summary.Sum(s => s.StockValue),
                lowStock = alerts.LowStock.Count,
            },
            alerts.NearExpiry,
            alerts.Expired,
        };
    }

    public async Task<object> CustomerBalancesAsync()
    {
        var rows = await _db.Customers.AsNoTracking()
            .Where(c => c.OutstandingBalance != 0 || c.EmptyCrateBalance != 0)
            .OrderByDescending(c => c.OutstandingBalance)
            .Select(c => new { c.Id, c.Name, c.BusinessName, c.Phone, c.OutstandingBalance, c.EmptyCrateBalance })
            .ToListAsync();
        return new
        {
            rows,
            totals = new
            {
                outstanding = rows.Where(r => r.OutstandingBalance > 0).Sum(r => r.OutstandingBalance),
                advances = -rows.Where(r => r.OutstandingBalance < 0).Sum(r => r.OutstandingBalance),
                crates = rows.Where(r => r.EmptyCrateBalance > 0).Sum(r => r.EmptyCrateBalance),
            },
        };
    }

    // ---- helpers: Dapper rows → camelCase JSON ----
    private static List<Dictionary<string, object?>> Camel(IEnumerable<dynamic> rows) =>
        rows.Select(r => CamelRow((object)r)).ToList();

    private static Dictionary<string, object?> CamelRow(object row) =>
        ((IDictionary<string, object?>)row).ToDictionary(kv => ToCamel(kv.Key), kv => kv.Value);

    private static string ToCamel(string snake)
    {
        var parts = snake.Split('_', StringSplitOptions.RemoveEmptyEntries);
        return string.Concat(parts.Select((p, i) => i == 0 ? p : char.ToUpperInvariant(p[0]) + p[1..]));
    }

    private static Dictionary<string, decimal> Totals(List<Dictionary<string, object?>> rows, params string[] keys) =>
        keys.Where(k => rows.Any(r => r.ContainsKey(k)))
            .ToDictionary(k => k, k => rows.Sum(r => r.TryGetValue(k, out var v) && v != null ? Convert.ToDecimal(v) : 0m));
}
