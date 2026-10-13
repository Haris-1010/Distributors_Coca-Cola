using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;
using WholesaleAPI.Services;

namespace WholesaleAPI.Controllers;

[ApiController]
[Route("api/products")]
[Authorize(Roles = RoleGroups.Everyone)]
public class ProductsController : ControllerBase
{
    private readonly ProductService _products;
    public ProductsController(ProductService products) => _products = products;

    [HttpGet]
    public Task<List<ProductDto>> List(string? search, bool includeInactive = false, string? brand = null)
        => _products.ListAsync(search, includeInactive, brand);

    [HttpGet("paged")]
    public Task<PagedResult<ProductDto>> ListPaged(string? search, bool includeInactive = false, string? brand = null, int page = 1, int pageSize = 25)
        => _products.ListPagedAsync(search, includeInactive, brand, Math.Max(1, page), Math.Clamp(pageSize, 1, 100));

    [HttpGet("{id:guid}")] public Task<ProductDto> Get(Guid id) => _products.GetAsync(id);

    [HttpGet("by-code/{code}")]
    public async Task<ActionResult<ProductDto>> ByCode(string code)
    {
        var p = await _products.FindByCodeAsync(code);
        if (p is null) return NotFound(new { message = $"No product with barcode/SKU {code}." });
        return p;
    }

    [HttpPost, Authorize(Roles = RoleGroups.ManagerUp)]
    public Task<ProductDto> Create(SaveProductRequest req) => _products.CreateAsync(req);

    [HttpPut("{id:guid}"), Authorize(Roles = RoleGroups.ManagerUp)]
    public Task<ProductDto> Update(Guid id, SaveProductRequest req) => _products.UpdateAsync(id, req);

    [HttpDelete("{id:guid}"), Authorize(Roles = RoleGroups.AdminUp)]
    public async Task<IActionResult> Delete(Guid id)
    {
        await _products.DeleteAsync(id);
        return NoContent();
    }
}

[ApiController]
[Route("api/stock")]
[Authorize(Roles = RoleGroups.Everyone)]
public class StockController : ControllerBase
{
    private readonly StockService _stock;
    public StockController(StockService stock) => _stock = stock;

    [HttpGet] public Task<List<StockSummaryDto>> Summary(string? search, bool onlyLow = false) => _stock.GetSummaryAsync(search, onlyLow);

    [HttpGet("batches")]
    public Task<List<StockBatchDto>> Batches(Guid? productId, bool includeEmpty = false) => _stock.GetBatchesAsync(productId, includeEmpty);

    [HttpGet("batches/paged")]
    public Task<PagedResult<StockBatchDto>> BatchesPaged(Guid? productId, bool includeEmpty = false, int page = 1, int pageSize = 25)
        => _stock.GetBatchesPageAsync(productId, includeEmpty, Math.Max(1, page), Math.Clamp(pageSize, 1, 100));

    [HttpGet("alerts")] public Task<StockAlertsDto> Alerts() => _stock.GetAlertsAsync();

    [HttpGet("movements"), Authorize(Roles = RoleGroups.ManagerUp)]
    public Task<List<object>> Movements(Guid? productId, DateTime? from, DateTime? to, int take = 200)
        => _stock.GetMovementsAsync(productId, from, to, Math.Clamp(take, 1, 1000));

    [HttpGet("movements/paged"), Authorize(Roles = RoleGroups.ManagerUp)]
    public Task<PagedResult<object>> MovementsPaged(Guid? productId, DateTime? from, DateTime? to, int page = 1, int pageSize = 25)
        => _stock.GetMovementsPageAsync(productId, from, to, Math.Max(1, page), Math.Clamp(pageSize, 1, 100));

    [HttpPost("adjust"), Authorize(Roles = RoleGroups.ManagerUp)]
    public Task<StockBatchDto> Adjust(StockAdjustmentRequest req) => _stock.AdjustAsync(req);
}

[ApiController]
[Route("api/purchases")]
[Authorize(Roles = RoleGroups.ManagerUp)]
public class PurchasesController : ControllerBase
{
    private readonly PurchaseService _purchases;
    public PurchasesController(PurchaseService purchases) => _purchases = purchases;

    [HttpGet, Authorize(Roles = RoleGroups.ReportViewers)]
    public Task<PagedResult<PurchaseDto>> List(DateTime? from, DateTime? to, string? search, int page = 1, int pageSize = 25)
        => _purchases.ListAsync(from, to, search, Math.Max(1, page), Math.Clamp(pageSize, 1, 200));

    [HttpGet("{id:guid}"), Authorize(Roles = RoleGroups.ReportViewers)]
    public Task<PurchaseDto> Get(Guid id) => _purchases.GetAsync(id);

    [HttpPost] public Task<PurchaseDto> Create(CreatePurchaseRequest req) => _purchases.CreateAsync(req);

    [HttpPut("{id:guid}")]
    public Task<PurchaseDto> Update(Guid id, UpdatePurchaseRequest req) => _purchases.UpdateAsync(id, req);

    [HttpPost("{id:guid}/payments")]
    public Task<PurchaseDto> Pay(Guid id, PurchasePaymentRequest req) => _purchases.AddPaymentAsync(id, req);
}
