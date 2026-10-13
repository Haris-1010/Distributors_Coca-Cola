using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using WholesaleAPI.Helpers;

namespace WholesaleAPI.Middleware;

/// <summary>Turns exceptions into a consistent JSON shape: { message, code, errors? }.</summary>
public class ErrorHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ErrorHandlingMiddleware> _log;

    public ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> log)
    {
        _next = next;
        _log = log;
    }

    public async Task Invoke(HttpContext ctx)
    {
        try
        {
            await _next(ctx);
        }
        catch (AppException ex)
        {
            await Write(ctx, ex.StatusCode, ex.Message, ex.Code);
        }
        catch (ValidationException ex)
        {
            var errors = ex.Errors.GroupBy(e => e.PropertyName)
                .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray());
            await Write(ctx, 400, "Some fields are invalid.", "validation", errors);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: "23505" })
        {
            await Write(ctx, 409, "A record with the same unique value already exists.", "duplicate");
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: "23514" })
        {
            await Write(ctx, 409, "Not enough stock — another user may have just sold it. Please refresh.", "stock");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Unhandled error on {Path}", ctx.Request.Path);
            await Write(ctx, 500, "Something went wrong on the server.", "server_error");
        }
    }

    private static Task Write(HttpContext ctx, int status, string message, string? code, object? errors = null)
    {
        if (ctx.Response.HasStarted) return Task.CompletedTask;
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsJsonAsync(new { message, code, errors });
    }
}

/// <summary>Runs the FluentValidation validator for every action argument that has one.</summary>
public class ValidationFilter : IAsyncActionFilter
{
    private readonly IServiceProvider _sp;
    public ValidationFilter(IServiceProvider sp) => _sp = sp;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        foreach (var arg in context.ActionArguments.Values)
        {
            if (arg is null) continue;
            var validatorType = typeof(IValidator<>).MakeGenericType(arg.GetType());
            if (_sp.GetService(validatorType) is IValidator validator)
            {
                var result = await validator.ValidateAsync(new ValidationContext<object>(arg));
                if (!result.IsValid) throw new ValidationException(result.Errors);
            }
        }
        await next();
    }
}
