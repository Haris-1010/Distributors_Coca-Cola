using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;
using WholesaleAPI.Services;

namespace WholesaleAPI.Controllers;

[ApiController]
[Route("api/customers")]
[Authorize(Roles = RoleGroups.Everyone)]
public class CustomersController : ControllerBase
{
    private readonly CustomerService _customers;
    public CustomersController(CustomerService customers) => _customers = customers;

    /// <param name="filter">"outstanding" or "crates" to show only customers who owe money / crates.</param>
    [HttpGet]
    public Task<List<CustomerDto>> List(string? search, bool includeInactive = false, string? filter = null)
        => _customers.ListAsync(search, includeInactive, filter);

    [HttpGet("paged")]
    public Task<CustomerPageDto> ListPaged(string? search, bool includeInactive = false, string? filter = null, int page = 1, int pageSize = 25)
        => _customers.ListPagedAsync(search, includeInactive, filter, Math.Max(1, page), Math.Clamp(pageSize, 1, 100));

    [HttpGet("{id:guid}")] public Task<CustomerDto> Get(Guid id) => _customers.GetAsync(id);

    [HttpGet("{id:guid}/ledger"), Authorize(Roles = "SuperAdmin,Admin,Manager,Salesman,Viewer")]
    public Task<CustomerLedgerDto> Ledger(Guid id, DateTime? from, DateTime? to) => _customers.LedgerAsync(id, from, to);

    [HttpPost, Authorize(Roles = RoleGroups.Sellers)]
    public Task<CustomerDto> Create(SaveCustomerRequest req) => _customers.CreateAsync(req);

    [HttpPut("{id:guid}"), Authorize(Roles = RoleGroups.ManagerUp)]
    public Task<CustomerDto> Update(Guid id, SaveCustomerRequest req) => _customers.UpdateAsync(id, req);

    [HttpDelete("{id:guid}"), Authorize(Roles = RoleGroups.AdminUp)]
    public async Task<IActionResult> Delete(Guid id)
    {
        await _customers.DeleteAsync(id);
        return NoContent();
    }

    /// <summary>Money received from a customer. Pays the given sale, or the oldest dues first.</summary>
    [HttpPost("{id:guid}/payments"), Authorize(Roles = RoleGroups.Sellers)]
    public Task<List<PaymentDto>> Pay(Guid id, CustomerPaymentRequest req) => _customers.ReceivePaymentAsync(id, req);
}

[ApiController]
[Route("api/sales")]
[Authorize(Roles = RoleGroups.Everyone)]
public class SalesController : ControllerBase
{
    private readonly SaleService _sales;
    public SalesController(SaleService sales) => _sales = sales;

    /// <param name="status">settled | open | unpaid | pending-crates</param>
    [HttpGet]
    public Task<PagedResult<SaleListItemDto>> List(DateTime? from, DateTime? to, Guid? customerId, string? status,
        string? search, int page = 1, int pageSize = 25)
        => _sales.ListAsync(from, to, customerId, status, search, Math.Max(1, page), Math.Clamp(pageSize, 1, 200));

    [HttpGet("{id:guid}")] public Task<SaleDto> Get(Guid id) => _sales.GetAsync(id);

    [HttpPost, Authorize(Roles = RoleGroups.Sellers)]
    public Task<SaleDto> Create(CreateSaleRequest req) => _sales.CreateAsync(req);

    [HttpPut("{id:guid}"), Authorize(Roles = RoleGroups.Sellers)]
    public Task<SaleDto> Update(Guid id, CreateSaleRequest req) => _sales.UpdateAsync(id, req);

    [HttpPost("{id:guid}/payments"), Authorize(Roles = RoleGroups.Sellers)]
    public Task<SaleDto> Pay(Guid id, CustomerPaymentRequest req) => _sales.AddPaymentAsync(id, req);

    [HttpPost("{id:guid}/crates"), Authorize(Roles = RoleGroups.Sellers)]
    public Task<SaleDto> ReturnCrates(Guid id, SaleCrateReturnRequest req) => _sales.ReturnCratesAsync(id, req.Quantity, req.Notes);

    /// <summary>Settle a sale. Blocked while money or crates are pending unless an Admin overrides with a reason.</summary>
    [HttpPost("{id:guid}/settle"), Authorize(Roles = RoleGroups.Sellers)]
    public Task<SaleDto> Settle(Guid id, SettleSaleRequest req) => _sales.SettleAsync(id, req);
}

[ApiController]
[Route("api/returns")]
[Authorize(Roles = RoleGroups.Everyone)]
public class ReturnsController : ControllerBase
{
    private readonly ReturnService _returns;
    public ReturnsController(ReturnService returns) => _returns = returns;

    [HttpGet]
    public Task<PagedResult<SaleReturnDto>> List(DateTime? from, DateTime? to, Guid? customerId, int page = 1, int pageSize = 25)
        => _returns.ListAsync(from, to, customerId, Math.Max(1, page), Math.Clamp(pageSize, 1, 200));

    /// <summary>Returns items from a sale. Damaged/expired goods are written off; others go back into stock.</summary>
    [HttpPost, Authorize(Roles = RoleGroups.Sellers)]
    public Task<SaleDto> Create(CreateReturnRequest req) => _returns.CreateAsync(req);
}

[ApiController]
[Route("api/empty-crates")]
[Authorize(Roles = RoleGroups.Everyone)]
public class EmptyCratesController : ControllerBase
{
    private readonly CrateService _crates;
    public EmptyCratesController(CrateService crates) => _crates = crates;

    [HttpGet("summary")]
    public Task<List<CustomerCrateSummaryDto>> Summary(bool onlyPending = true) => _crates.SummaryAsync(onlyPending);

    [HttpGet("transactions")]
    public Task<PagedResult<CrateTransactionDto>> Transactions(Guid? customerId, DateTime? from, DateTime? to, int page = 1, int pageSize = 50)
        => _crates.TransactionsAsync(customerId, from, to, Math.Max(1, page), Math.Clamp(pageSize, 1, 200));

    /// <summary>Customer brings back empties. Applied to the given sale, else to the oldest sales waiting for crates.</summary>
    [HttpPost("return"), Authorize(Roles = RoleGroups.Sellers)]
    public Task<CrateReturnResultDto> Return(CrateReturnRequest req) => _crates.ReturnAsync(req);

    [HttpPost("adjust"), Authorize(Roles = RoleGroups.AdminUp)]
    public Task<CustomerDto> Adjust(CrateAdjustmentRequest req) => _crates.AdjustAsync(req);
}

[ApiController]
[Route("api/reports")]
[Authorize(Roles = RoleGroups.ReportViewers)]
public class ReportsController : ControllerBase
{
    private readonly ReportService _reports;
    private readonly CustomerService _customers;
    private readonly CrateService _crates;

    public ReportsController(ReportService reports, CustomerService customers, CrateService crates)
    {
        _reports = reports;
        _customers = customers;
        _crates = crates;
    }

    // Report dates are shop-local calendar days, e.g. ?from=2026-10-01&to=2026-10-31 (both inclusive).

    [HttpGet("dashboard"), Authorize(Roles = RoleGroups.Everyone)]
    public Task<object> Dashboard() => _reports.DashboardAsync();

    /// <param name="period">day | week | month</param>
    [HttpGet("sales")] public Task<object> Sales(DateOnly? from, DateOnly? to, string period = "day") => _reports.SalesAsync(from, to, period);

    /// <param name="groupBy">product | customer | date</param>
    [HttpGet("profit")] public Task<object> Profit(DateOnly? from, DateOnly? to, string groupBy = "product") => _reports.ProfitAsync(from, to, groupBy);

    [HttpGet("top-products")] public Task<object> TopProducts(DateOnly? from, DateOnly? to, int limit = 10) => _reports.TopProductsAsync(from, to, limit);
    [HttpGet("margin")] public Task<object> Margin(DateOnly? from, DateOnly? to) => _reports.MarginAsync(from, to);
    [HttpGet("returns")] public Task<object> Returns(DateOnly? from, DateOnly? to) => _reports.ReturnsAsync(from, to);
    [HttpGet("purchases")] public Task<object> Purchases(DateOnly? from, DateOnly? to) => _reports.PurchasesAsync(from, to);
    [HttpGet("stock")] public Task<object> Stock() => _reports.StockAsync();
    [HttpGet("crates")] public Task<List<CustomerCrateSummaryDto>> Crates(bool onlyPending = false) => _crates.SummaryAsync(onlyPending);
    [HttpGet("customer-balances")] public Task<object> CustomerBalances() => _reports.CustomerBalancesAsync();

    [HttpGet("customer-ledger/{customerId:guid}")]
    public Task<CustomerLedgerDto> CustomerLedger(Guid customerId, DateTime? from, DateTime? to) => _customers.LedgerAsync(customerId, from, to);
}

[ApiController]
[Route("api/sync")]
[Authorize(Roles = RoleGroups.Everyone)]
public class SyncController : ControllerBase
{
    private readonly SyncService _sync;
    public SyncController(SyncService sync) => _sync = sync;

    /// <summary>Apply a batch of operations queued while offline. Safe to resend.</summary>
    [HttpPost] public Task<List<SyncResult>> Push(SyncRequest req) => _sync.ApplyAsync(req);

    /// <summary>Products, stock, customers and settings for the offline cache.</summary>
    [HttpGet("bootstrap")] public Task<object> Bootstrap() => _sync.BootstrapAsync();
}
