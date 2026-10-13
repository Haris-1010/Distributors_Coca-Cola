using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public record SyncOperation(Guid Id, string Type, JsonElement Payload, DateTime? ClientTimestamp);
public record SyncRequest(List<SyncOperation> Operations);
public record SyncResult(Guid Id, string Type, string Status, string? Message, object? Data);

/// <summary>
/// Applies operations queued by an offline device, in the order they were made.
/// Each operation is idempotent (keyed by its Id), so a device can safely resend after a dropped connection.
///   applied   – done now
///   duplicate – already done earlier; stored result returned
///   rejected  – a business rule failed (e.g. not enough stock); will never succeed, client should show it
///   error     – unexpected server problem; client should retry later
/// </summary>
public class SyncService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    // Which roles may queue which operation offline.
    private static readonly Dictionary<string, UserRole[]> Allowed = new()
    {
        ["customer.create"] = new[] { UserRole.SuperAdmin, UserRole.Admin, UserRole.Manager, UserRole.Salesman },
        ["customer.update"] = new[] { UserRole.SuperAdmin, UserRole.Admin, UserRole.Manager },
        ["sale.create"] = new[] { UserRole.SuperAdmin, UserRole.Admin, UserRole.Manager, UserRole.Salesman },
        ["sale.payment"] = new[] { UserRole.SuperAdmin, UserRole.Admin, UserRole.Manager, UserRole.Salesman },
        ["customer.payment"] = new[] { UserRole.SuperAdmin, UserRole.Admin, UserRole.Manager, UserRole.Salesman },
        ["return.create"] = new[] { UserRole.SuperAdmin, UserRole.Admin, UserRole.Manager, UserRole.Salesman },
        ["crate.return"] = new[] { UserRole.SuperAdmin, UserRole.Admin, UserRole.Manager, UserRole.Salesman },
        ["purchase.create"] = new[] { UserRole.SuperAdmin, UserRole.Admin, UserRole.Manager },
        ["stock.adjust"] = new[] { UserRole.SuperAdmin, UserRole.Admin, UserRole.Manager },
    };

    private readonly AppDbContext _db;
    private readonly IServiceProvider _sp;
    private readonly ICurrentUser _user;
    private readonly ILogger<SyncService> _log;

    public SyncService(AppDbContext db, IServiceProvider sp, ICurrentUser user, ILogger<SyncService> log)
    {
        _db = db;
        _sp = sp;
        _user = user;
        _log = log;
    }

    public async Task<List<SyncResult>> ApplyAsync(SyncRequest req)
    {
        var results = new List<SyncResult>();
        foreach (var op in req.Operations)
        {
            var done = await _db.SyncOperationLogs.AsNoTracking().FirstOrDefaultAsync(l => l.Id == op.Id);
            if (done != null)
            {
                results.Add(new SyncResult(op.Id, op.Type, done.Succeeded ? "duplicate" : "rejected",
                    done.Succeeded ? null : done.ResultJson, done.Succeeded ? JsonSerializer.Deserialize<JsonElement>(done.ResultJson ?? "null") : null));
                continue;
            }

            try
            {
                if (!Allowed.TryGetValue(op.Type, out var roles))
                    throw new AppException($"Unknown operation type '{op.Type}'.");
                if (!_user.IsInRole(roles))
                    throw AppException.Forbidden($"Your role can't do '{op.Type}'.");

                var data = await ExecuteAsync(op);
                _db.ChangeTracker.Clear();
                _db.SyncOperationLogs.Add(new SyncOperationLog
                {
                    Id = op.Id, UserId = _user.Id, OperationType = op.Type, Succeeded = true,
                    ResultJson = JsonSerializer.Serialize(data, Json),
                });
                await _db.SaveChangesAsync();
                results.Add(new SyncResult(op.Id, op.Type, "applied", null, data));
            }
            catch (Exception ex) when (ex is AppException or FluentValidation.ValidationException or JsonException)
            {
                // Permanent failure — remember it so the device stops retrying, and report it.
                _db.ChangeTracker.Clear();
                var message = ex is FluentValidation.ValidationException ve
                    ? string.Join(" ", ve.Errors.Select(e => e.ErrorMessage)) : ex.Message;
                _db.SyncOperationLogs.Add(new SyncOperationLog
                {
                    Id = op.Id, UserId = _user.Id, OperationType = op.Type, Succeeded = false, ResultJson = message,
                });
                await _db.SaveChangesAsync();
                results.Add(new SyncResult(op.Id, op.Type, "rejected", message, null));
            }
            catch (Exception ex)
            {
                _db.ChangeTracker.Clear();
                _log.LogError(ex, "Sync operation {Id} ({Type}) failed", op.Id, op.Type);
                results.Add(new SyncResult(op.Id, op.Type, "error", "Server error — will retry.", null));
                break; // keep order: later operations may depend on this one
            }
        }
        return results;
    }

    private async Task<object> ExecuteAsync(SyncOperation op)
    {
        T Read<T>() => op.Payload.Deserialize<T>(Json) ?? throw new AppException("Empty payload.");
        async Task Validate<T>(T value)
        {
            var v = _sp.GetService<FluentValidation.IValidator<T>>();
            if (v != null) await FluentValidation.DefaultValidatorExtensions.ValidateAndThrowAsync(v, value);
        }

        switch (op.Type)
        {
            case "customer.create":
            {
                var r = Read<SaveCustomerRequest>(); await Validate(r);
                return await _sp.GetRequiredService<CustomerService>().CreateAsync(r);
            }
            case "customer.update":
            {
                var r = Read<SaveCustomerRequest>(); await Validate(r);
                if (r.Id is null) throw new AppException("Customer id missing.");
                return await _sp.GetRequiredService<CustomerService>().UpdateAsync(r.Id.Value, r);
            }
            case "sale.create":
            {
                var r = Read<CreateSaleRequest>(); await Validate(r);
                return await _sp.GetRequiredService<SaleService>().CreateAsync(r with { Id = r.Id ?? op.Id });
            }
            case "sale.payment":
            case "customer.payment":
            {
                var r = Read<CustomerPaymentRequest>(); await Validate(r);
                var customerId = op.Payload.TryGetProperty("customerId", out var c) ? c.GetGuid() : Guid.Empty;
                if (r.SaleId.HasValue)
                    return await _sp.GetRequiredService<SaleService>().AddPaymentAsync(r.SaleId.Value, r with { Id = r.Id ?? op.Id });
                return await _sp.GetRequiredService<CustomerService>().ReceivePaymentAsync(customerId, r with { Id = r.Id ?? op.Id });
            }
            case "return.create":
            {
                var r = Read<CreateReturnRequest>(); await Validate(r);
                return await _sp.GetRequiredService<ReturnService>().CreateAsync(r with { Id = r.Id ?? op.Id });
            }
            case "crate.return":
            {
                var r = Read<CrateReturnRequest>(); await Validate(r);
                return await _sp.GetRequiredService<CrateService>().ReturnAsync(r with { Id = r.Id ?? op.Id });
            }
            case "purchase.create":
            {
                var r = Read<CreatePurchaseRequest>(); await Validate(r);
                return await _sp.GetRequiredService<PurchaseService>().CreateAsync(r with { Id = r.Id ?? op.Id });
            }
            case "stock.adjust":
            {
                var r = Read<StockAdjustmentRequest>(); await Validate(r);
                return await _sp.GetRequiredService<StockService>().AdjustAsync(r);
            }
            default:
                throw new AppException($"Unknown operation type '{op.Type}'.");
        }
    }

    /// <summary>Everything a device needs to keep selling while offline.</summary>
    public async Task<object> BootstrapAsync()
    {
        var products = await _sp.GetRequiredService<ProductService>().ListAsync(null, includeInactive: false, brand: null);
        var customers = await _sp.GetRequiredService<CustomerService>().ListAsync(null, includeInactive: false, filter: null);
        var settings = await _sp.GetRequiredService<SettingsService>().GetAllAsync();
        var openSales = await _db.Sales.AsNoTracking().Include(s => s.Customer)
            .Where(s => !s.IsSettled).OrderByDescending(s => s.SaleDate).Take(500).ToListAsync();
        var mapper = _sp.GetRequiredService<AutoMapper.IMapper>();
        return new
        {
            serverTime = DateTime.UtcNow,
            products,
            customers,
            settings,
            openSales = mapper.Map<List<SaleListItemDto>>(openSales),
        };
    }
}
