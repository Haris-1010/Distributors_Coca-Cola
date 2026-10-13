using System.Security.Claims;
using Dapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using WholesaleAPI.Data;
using WholesaleAPI.Models;

namespace WholesaleAPI.Helpers;

/// <summary>Business-rule failure. Turned into a JSON error with the given status by the middleware.</summary>
public class AppException : Exception
{
    public int StatusCode { get; }
    public string? Code { get; }
    public AppException(string message, int statusCode = 400, string? code = null) : base(message)
    {
        StatusCode = statusCode;
        Code = code;
    }

    public static AppException NotFound(string what) => new($"{what} not found.", 404, "not_found");
    public static AppException Forbidden(string message) => new(message, 403, "forbidden");
    public static AppException Conflict(string message, string code = "conflict") => new(message, 409, code);
}

public interface ICurrentUser
{
    Guid? Id { get; }
    UserRole? Role { get; }
    bool IsInRole(params UserRole[] roles);
}

public class CurrentUser : ICurrentUser
{
    private readonly IHttpContextAccessor _http;
    public CurrentUser(IHttpContextAccessor http) => _http = http;

    private ClaimsPrincipal? Principal => _http.HttpContext?.User;

    public Guid? Id => Guid.TryParse(Principal?.FindFirst("sub")?.Value, out var id) ? id : null;

    public UserRole? Role => Enum.TryParse<UserRole>(Principal?.FindFirst("role")?.Value, out var r) ? r : null;

    public bool IsInRole(params UserRole[] roles) => Role is { } r && roles.Contains(r);
}

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

/// <summary>Gap-free, concurrency-safe document numbers such as INV-2610-0001.</summary>
public class NumberGenerator
{
    private readonly AppDbContext _db;
    public NumberGenerator(AppDbContext db) => _db = db;

    public async Task<string> NextAsync(string prefix, DateTime utcNow)
    {
        var period = utcNow.ToString("yyMM");
        var key = $"{prefix}-{period}";
        var conn = _db.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await _db.Database.OpenConnectionAsync();
        var tx = _db.Database.CurrentTransaction?.GetDbTransaction();
        var next = await conn.ExecuteScalarAsync<long>(
            @"INSERT INTO document_counters (key, value) VALUES (@key, 1)
              ON CONFLICT (key) DO UPDATE SET value = document_counters.value + 1
              RETURNING value", new { key }, tx);
        return $"{key}-{next:D4}";
    }
}

public static class DbExtensions
{
    /// <summary>Runs work in a transaction, or joins the caller's transaction if one is already open.</summary>
    public static async Task<T> InTransactionAsync<T>(this AppDbContext db, Func<Task<T>> work)
    {
        if (db.Database.CurrentTransaction != null) return await work();
        await using var tx = await db.Database.BeginTransactionAsync();
        var result = await work();
        await tx.CommitAsync();
        return result;
    }
}

public static class Money
{
    public static decimal R(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    public static PaymentStatus StatusFor(decimal net, decimal paid) =>
        paid <= 0 ? (net <= 0 ? PaymentStatus.Paid : PaymentStatus.Unpaid)
        : paid >= net ? PaymentStatus.Paid : PaymentStatus.Partial;
}
