using AutoMapper;
using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public class ProductService
{
    private readonly AppDbContext _db;
    private readonly IMapper _mapper;
    private readonly StockService _stock;
    private readonly SettingsService _settings;
    private readonly AuditService _audit;

    public ProductService(AppDbContext db, IMapper mapper, StockService stock, SettingsService settings, AuditService audit)
    {
        _db = db;
        _mapper = mapper;
        _stock = stock;
        _settings = settings;
        _audit = audit;
    }

    public async Task<List<ProductDto>> ListAsync(string? search, bool includeInactive, string? brand)
    {
        var q = FilterProducts(search, includeInactive, brand);
        var products = await q.OrderBy(p => p.Name).ToListAsync();
        return await ToDtosAsync(products);
    }

    public async Task<PagedResult<ProductDto>> ListPagedAsync(string? search, bool includeInactive, string? brand, int page, int pageSize)
    {
        var q = FilterProducts(search, includeInactive, brand);
        var total = await q.CountAsync();
        var products = await q.OrderBy(p => p.Name).ThenBy(p => p.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return new PagedResult<ProductDto>(await ToDtosAsync(products), total, page, pageSize);
    }

    public async Task<ProductDto> GetAsync(Guid id)
    {
        var p = await _db.Products.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Product");
        return (await ToDtosAsync(new List<Product> { p }))[0];
    }

    public async Task<ProductDto?> FindByCodeAsync(string code)
    {
        var p = await _db.Products.AsNoTracking().FirstOrDefaultAsync(x => x.IsActive && (x.Barcode == code || x.Sku == code));
        return p is null ? null : (await ToDtosAsync(new List<Product> { p }))[0];
    }

    public async Task<ProductDto> CreateAsync(SaveProductRequest req)
    {
        var p = new Product();
        Apply(p, req);
        await EnsureUniqueCodesAsync(p);
        _db.Products.Add(p);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Create", nameof(Product), p.Id.ToString(), newValues: req);
        return await GetAsync(p.Id);
    }

    public async Task<ProductDto> UpdateAsync(Guid id, SaveProductRequest req)
    {
        var p = await _db.Products.FindAsync(id) ?? throw AppException.NotFound("Product");
        var old = _mapper.Map<ProductDto>(p);
        Apply(p, req);
        await EnsureUniqueCodesAsync(p);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Update", nameof(Product), p.Id.ToString(), old, req);
        return await GetAsync(p.Id);
    }

    public async Task DeleteAsync(Guid id)
    {
        var p = await _db.Products.FindAsync(id) ?? throw AppException.NotFound("Product");
        var qty = (await _stock.QuantitiesAsync(new[] { id })).GetValueOrDefault(id);
        if (qty > 0) throw AppException.Conflict($"{p.Name} still has {qty} pieces in stock. Adjust stock to zero or mark it inactive instead.");
        _db.Products.Remove(p); // soft delete via SaveChanges
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Delete", nameof(Product), id.ToString());
    }

    private static void Apply(Product p, SaveProductRequest r)
    {
        p.Name = r.Name.Trim();
        p.Brand = r.Brand;
        p.Category = r.Category.Trim();
        p.UnitType = r.UnitType;
        p.PackSize = r.PackSize;
        p.IsCrateRequired = r.IsCrateRequired;
        p.BottlesPerCrate = r.BottlesPerCrate;
        p.PurchasePrice = r.PurchasePrice;
        p.SellingPrice = r.SellingPrice;
        p.MinProfit = r.MinProfit;
        p.MaxProfit = r.MaxProfit;
        p.Barcode = string.IsNullOrWhiteSpace(r.Barcode) ? null : r.Barcode.Trim();
        p.Sku = string.IsNullOrWhiteSpace(r.Sku) ? null : r.Sku.Trim();
        p.LowStockThreshold = r.LowStockThreshold;
        p.IsActive = r.IsActive;
    }

    private async Task EnsureUniqueCodesAsync(Product p)
    {
        if (p.Barcode != null && await _db.Products.AnyAsync(x => x.Id != p.Id && x.Barcode == p.Barcode))
            throw AppException.Conflict($"Barcode {p.Barcode} is already used by another product.");
        if (p.Sku != null && await _db.Products.AnyAsync(x => x.Id != p.Id && x.Sku == p.Sku))
            throw AppException.Conflict($"SKU {p.Sku} is already used by another product.");
    }

    private async Task<List<ProductDto>> ToDtosAsync(List<Product> products)
    {
        var qty = await _stock.QuantitiesAsync(products.Select(p => p.Id));
        var perCrate = await _settings.ProfitIsPerCrateAsync();
        return products.Select(p =>
        {
            var dto = _mapper.Map<ProductDto>(p);
            dto.StockQuantity = qty.GetValueOrDefault(p.Id);
            var minProfit = perCrate && p.BottlesPerCrate > 0 ? Math.Round(p.MinProfit / p.BottlesPerCrate, 2) : p.MinProfit;
            dto.MinSellingPrice = p.PurchasePrice + minProfit;
            return dto;
        }).ToList();
    }

    private IQueryable<Product> FilterProducts(string? search, bool includeInactive, string? brand)
    {
        var q = _db.Products.AsNoTracking().AsQueryable();
        if (!includeInactive) q = q.Where(p => p.IsActive);
        if (!string.IsNullOrWhiteSpace(brand)) q = q.Where(p => p.Brand == brand);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(p => EF.Functions.ILike(p.Name, $"%{s}%") || p.Barcode == s || p.Sku == s);
        }
        return q;
    }
}
