using System.Globalization;
using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public class SettingsService
{
    private readonly AppDbContext _db;
    private Dictionary<string, string>? _cache;

    public SettingsService(AppDbContext db) => _db = db;

    public async Task<Dictionary<string, string>> GetAllAsync()
        => _cache ??= await _db.SystemSettings.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Value);

    public async Task<string> GetAsync(string key, string fallback = "")
        => (await GetAllAsync()).TryGetValue(key, out var v) ? v : fallback;

    public async Task<decimal> GetDecimalAsync(string key, decimal fallback)
        => decimal.TryParse(await GetAsync(key), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : fallback;

    public async Task<int> GetIntAsync(string key, int fallback)
        => int.TryParse(await GetAsync(key), out var i) ? i : fallback;

    public async Task<bool> ProfitIsPerCrateAsync()
        => string.Equals(await GetAsync(SettingKeys.ProfitBasis, "Piece"), "Crate", StringComparison.OrdinalIgnoreCase);

    public async Task<string> TimeZoneAsync() => await GetAsync(SettingKeys.TimeZone, "Asia/Karachi");

    public async Task SaveAsync(Dictionary<string, string> values)
    {
        foreach (var (key, value) in values)
        {
            var row = await _db.SystemSettings.FindAsync(key);
            if (row is null) _db.SystemSettings.Add(new SystemSetting { Key = key, Value = value ?? "" });
            else row.Value = value ?? "";
        }
        await _db.SaveChangesAsync();
        _cache = null;
    }

    /// <summary>
    /// Minimum profit per single piece for a product. When the profit basis is "Crate",
    /// the product's min profit applies to a whole crate/pack and is spread over its pieces.
    /// </summary>
    public async Task<decimal> MinProfitPerPieceAsync(Product p)
    {
        if (await ProfitIsPerCrateAsync() && p.BottlesPerCrate > 0)
            return Math.Round(p.MinProfit / p.BottlesPerCrate, 2);
        return p.MinProfit;
    }
}
