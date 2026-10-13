using System.Data;
using Dapper;
using Npgsql;

namespace WholesaleAPI.Repositories;

/// <summary>
/// Read-only reporting queries written in SQL with Dapper for speed.
/// Date ranges are shop-local calendar dates (from inclusive, to inclusive) converted with the shop time zone.
/// </summary>
public class ReportRepository
{
    private readonly string _cs;
    public ReportRepository(IConfiguration config) => _cs = config.GetConnectionString("Default")!;

    private IDbConnection Open() => new NpgsqlConnection(_cs);

    private static object Range(DateOnly from, DateOnly to, string tz, object? extra = null)
    {
        var p = new DynamicParameters(extra);
        p.Add("from", from.ToDateTime(TimeOnly.MinValue), DbType.DateTime2);
        p.Add("to", to.AddDays(1).ToDateTime(TimeOnly.MinValue), DbType.DateTime2);
        p.Add("tz", tz);
        return p;
    }

    // Converts a local calendar boundary into a UTC instant for comparison with timestamptz columns.
    private const string From = "(@from::timestamp AT TIME ZONE @tz)";
    private const string To = "(@to::timestamp AT TIME ZONE @tz)";

    public async Task<IEnumerable<dynamic>> SalesByPeriodAsync(DateOnly from, DateOnly to, string tz, string period)
    {
        period = period is "week" or "month" ? period : "day";
        using var db = Open();
        return await db.QueryAsync($@"
            SELECT date_trunc('{period}', s.sale_date AT TIME ZONE @tz)::date AS period,
                   COUNT(*)                         AS sales_count,
                   SUM(s.total_amount)              AS gross,
                   SUM(s.discount)                  AS discount,
                   SUM(s.returned_amount)           AS returns,
                   SUM(s.net_amount)                AS net,
                   SUM(s.paid_amount)               AS paid,
                   SUM(s.net_amount - s.paid_amount) AS due,
                   SUM(s.profit_amount)             AS profit,
                   SUM(s.empty_crates_required)     AS crates_required,
                   SUM(s.empty_crates_returned)     AS crates_returned
            FROM sales s
            WHERE s.is_deleted = false AND s.sale_date >= {From} AND s.sale_date < {To}
            GROUP BY 1 ORDER BY 1", Range(from, to, tz));
    }

    public async Task<IEnumerable<dynamic>> ProfitByProductAsync(DateOnly from, DateOnly to, string tz)
    {
        using var db = Open();
        return await db.QueryAsync($@"
            WITH lines AS (
                SELECT si.product_id, si.product_name,
                       (si.quantity - si.returned_quantity)                         AS qty,
                       (si.quantity - si.returned_quantity) * si.unit_price          AS revenue,
                       (si.quantity - si.returned_quantity) * si.purchase_price_at_sale AS cost,
                       (si.quantity - si.returned_quantity) * si.profit_per_unit     AS profit,
                       COALESCE((SELECT SUM(r.quantity * si.purchase_price_at_sale) FROM sale_returns r
                                 WHERE r.sale_item_id = si.id AND r.stock_adjusted = false AND r.is_deleted = false), 0) AS write_off
                FROM sale_items si JOIN sales s ON s.id = si.sale_id
                WHERE s.is_deleted = false AND si.is_deleted = false
                  AND s.sale_date >= {From} AND s.sale_date < {To})
            SELECT product_id, MAX(product_name) AS product_name, SUM(qty) AS quantity,
                   SUM(revenue) AS revenue, SUM(cost) AS cost, SUM(write_off) AS write_off,
                   SUM(profit) - SUM(write_off) AS profit,
                   CASE WHEN SUM(revenue) > 0 THEN ROUND((SUM(profit) - SUM(write_off)) / SUM(revenue) * 100, 2) ELSE 0 END AS margin_percent
            FROM lines GROUP BY product_id ORDER BY profit DESC", Range(from, to, tz));
    }

    public async Task<IEnumerable<dynamic>> ProfitByCustomerAsync(DateOnly from, DateOnly to, string tz)
    {
        using var db = Open();
        return await db.QueryAsync($@"
            SELECT c.id AS customer_id, c.name AS customer_name, c.business_name,
                   COUNT(s.id) AS sales_count, SUM(s.net_amount) AS net, SUM(s.profit_amount) AS profit,
                   SUM(s.net_amount - s.paid_amount) AS due,
                   CASE WHEN SUM(s.net_amount) > 0 THEN ROUND(SUM(s.profit_amount) / SUM(s.net_amount) * 100, 2) ELSE 0 END AS margin_percent
            FROM sales s JOIN customers c ON c.id = s.customer_id
            WHERE s.is_deleted = false AND s.sale_date >= {From} AND s.sale_date < {To}
            GROUP BY c.id, c.name, c.business_name ORDER BY profit DESC", Range(from, to, tz));
    }

    public async Task<IEnumerable<dynamic>> TopProductsAsync(DateOnly from, DateOnly to, string tz, int limit)
    {
        using var db = Open();
        return await db.QueryAsync($@"
            SELECT si.product_id, MAX(si.product_name) AS product_name,
                   SUM(si.quantity - si.returned_quantity) AS quantity,
                   SUM((si.quantity - si.returned_quantity) * si.unit_price) AS revenue,
                   SUM((si.quantity - si.returned_quantity) * si.profit_per_unit) AS profit,
                   COUNT(DISTINCT s.customer_id) AS customers
            FROM sale_items si JOIN sales s ON s.id = si.sale_id
            WHERE s.is_deleted = false AND si.is_deleted = false AND s.sale_date >= {From} AND s.sale_date < {To}
            GROUP BY si.product_id ORDER BY quantity DESC LIMIT @limit", Range(from, to, tz, new { limit }));
    }

    /// <summary>How each product's real selling margin compares with its min/max profit target.</summary>
    public async Task<IEnumerable<dynamic>> MarginAnalysisAsync(DateOnly from, DateOnly to, string tz, bool perCrate)
    {
        using var db = Open();
        var target = perCrate ? "p.min_profit / NULLIF(p.bottles_per_crate, 0)" : "p.min_profit";
        var targetMax = perCrate ? "p.max_profit / NULLIF(p.bottles_per_crate, 0)" : "p.max_profit";
        return await db.QueryAsync($@"
            SELECT p.id AS product_id, p.name AS product_name,
                   ROUND({target}, 2) AS target_min_per_piece, ROUND({targetMax}, 2) AS target_max_per_piece,
                   SUM(si.quantity - si.returned_quantity) AS quantity,
                   ROUND(SUM((si.quantity - si.returned_quantity) * si.unit_price) / NULLIF(SUM(si.quantity - si.returned_quantity), 0), 2) AS avg_price,
                   ROUND(SUM((si.quantity - si.returned_quantity) * si.purchase_price_at_sale) / NULLIF(SUM(si.quantity - si.returned_quantity), 0), 2) AS avg_cost,
                   ROUND(SUM((si.quantity - si.returned_quantity) * si.profit_per_unit) / NULLIF(SUM(si.quantity - si.returned_quantity), 0), 2) AS avg_profit_per_piece,
                   SUM(CASE WHEN si.profit_per_unit < {target} THEN si.quantity - si.returned_quantity ELSE 0 END) AS qty_below_target,
                   SUM(CASE WHEN si.price_overridden THEN 1 ELSE 0 END) AS price_overrides
            FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
            WHERE s.is_deleted = false AND si.is_deleted = false AND s.sale_date >= {From} AND s.sale_date < {To}
            GROUP BY p.id, p.name, p.min_profit, p.max_profit, p.bottles_per_crate
            ORDER BY avg_profit_per_piece", Range(from, to, tz));
    }

    public async Task<IEnumerable<dynamic>> ReturnsByReasonAsync(DateOnly from, DateOnly to, string tz)
    {
        using var db = Open();
        return await db.QueryAsync($@"
            SELECT r.reason, COUNT(*) AS lines, SUM(r.quantity) AS quantity, SUM(r.return_value) AS value,
                   SUM(r.profit_reversed) AS profit_lost, SUM(r.refund_amount) AS refunded
            FROM sale_returns r
            WHERE r.is_deleted = false AND r.return_date >= {From} AND r.return_date < {To}
            GROUP BY r.reason ORDER BY value DESC", Range(from, to, tz));
    }

    public async Task<IEnumerable<dynamic>> PurchasesByDistributorAsync(DateOnly from, DateOnly to, string tz)
    {
        using var db = Open();
        return await db.QueryAsync($@"
            SELECT p.distributor_name, COUNT(*) AS purchases, SUM(p.total_amount) AS total,
                   SUM(p.paid_amount) AS paid, SUM(p.total_amount - p.paid_amount) AS due,
                   (SELECT SUM(pi.quantity) FROM purchase_items pi JOIN purchases p2 ON p2.id = pi.purchase_id
                    WHERE p2.distributor_name = p.distributor_name AND p2.is_deleted = false
                      AND p2.purchase_date >= {From} AND p2.purchase_date < {To}) AS pieces
            FROM purchases p
            WHERE p.is_deleted = false AND p.purchase_date >= {From} AND p.purchase_date < {To}
            GROUP BY p.distributor_name ORDER BY total DESC", Range(from, to, tz));
    }

    public async Task<IEnumerable<dynamic>> PurchasesListAsync(DateOnly from, DateOnly to, string tz)
    {
        using var db = Open();
        return await db.QueryAsync($@"
            SELECT p.id, p.invoice_number, p.distributor_name, p.purchase_date, p.total_amount, p.paid_amount,
                   p.total_amount - p.paid_amount AS due, p.payment_status,
                   (SELECT SUM(quantity) FROM purchase_items WHERE purchase_id = p.id) AS pieces
            FROM purchases p
            WHERE p.is_deleted = false AND p.purchase_date >= {From} AND p.purchase_date < {To}
            ORDER BY p.purchase_date DESC", Range(from, to, tz));
    }

    public async Task<dynamic> DashboardTotalsAsync(DateOnly today, DateOnly monthStart, string tz)
    {
        using var db = Open();
        var p = new DynamicParameters();
        p.Add("today", today.ToDateTime(TimeOnly.MinValue), DbType.DateTime2);
        p.Add("tomorrow", today.AddDays(1).ToDateTime(TimeOnly.MinValue), DbType.DateTime2);
        p.Add("month", monthStart.ToDateTime(TimeOnly.MinValue), DbType.DateTime2);
        p.Add("tz", tz);
        return await db.QuerySingleAsync(@"
            SELECT
              COALESCE(SUM(net_amount)    FILTER (WHERE sale_date >= (@today::timestamp AT TIME ZONE @tz) AND sale_date < (@tomorrow::timestamp AT TIME ZONE @tz)), 0) AS today_sales,
              COALESCE(SUM(profit_amount) FILTER (WHERE sale_date >= (@today::timestamp AT TIME ZONE @tz) AND sale_date < (@tomorrow::timestamp AT TIME ZONE @tz)), 0) AS today_profit,
              COUNT(*)                    FILTER (WHERE sale_date >= (@today::timestamp AT TIME ZONE @tz) AND sale_date < (@tomorrow::timestamp AT TIME ZONE @tz))       AS today_count,
              COALESCE(SUM(net_amount)    FILTER (WHERE sale_date >= (@month::timestamp AT TIME ZONE @tz)), 0) AS month_sales,
              COALESCE(SUM(profit_amount) FILTER (WHERE sale_date >= (@month::timestamp AT TIME ZONE @tz)), 0) AS month_profit,
              COUNT(*) FILTER (WHERE NOT is_settled) AS open_sales,
              (SELECT COALESCE(SUM(GREATEST(outstanding_balance, 0)), 0) FROM customers WHERE is_deleted = false) AS total_outstanding,
              (SELECT COALESCE(SUM(GREATEST(empty_crate_balance, 0)), 0) FROM customers WHERE is_deleted = false) AS pending_crates,
              (SELECT COUNT(*) FROM customers WHERE is_deleted = false AND empty_crate_balance > 0) AS customers_with_crates
            FROM sales WHERE is_deleted = false", p);
    }
}
