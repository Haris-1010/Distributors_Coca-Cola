using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using AutoMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using WholesaleAPI.Data;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public class JwtOptions
{
    public string Issuer { get; set; } = "WholesaleAPI";
    public string Audience { get; set; } = "WholesaleApp";
    public string Key { get; set; } = "";
    public int AccessTokenMinutes { get; set; } = 30;
    public int RefreshTokenDays { get; set; } = 30;
    public int MaxFailedLogins { get; set; } = 5;
    public int LockoutMinutes { get; set; } = 15;
}

public class AuthService
{
    private readonly AppDbContext _db;
    private readonly JwtOptions _opt;
    private readonly IMapper _mapper;
    private readonly AuditService _audit;

    public AuthService(AppDbContext db, IOptions<JwtOptions> opt, IMapper mapper, AuditService audit)
    {
        _db = db;
        _opt = opt.Value;
        _mapper = mapper;
        _audit = audit;
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest req)
    {
        var email = req.Email.Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email);
        const string bad = "Email or password is incorrect.";
        if (user is null) throw new AppException(bad, 401, "bad_credentials");

        if (user.LockoutEndAt > DateTime.UtcNow)
            throw new AppException($"Account locked after too many failed attempts. Try again after {user.LockoutEndAt:HH:mm} UTC.", 423, "locked");
        if (!user.IsActive) throw new AppException("This account is disabled. Ask an admin.", 403, "inactive");

        if (!BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
        {
            user.FailedLoginCount++;
            if (user.FailedLoginCount >= _opt.MaxFailedLogins)
            {
                user.LockoutEndAt = DateTime.UtcNow.AddMinutes(_opt.LockoutMinutes);
                user.FailedLoginCount = 0;
            }
            await _db.SaveChangesAsync();
            throw new AppException(bad, 401, "bad_credentials");
        }

        user.FailedLoginCount = 0;
        user.LockoutEndAt = null;
        user.LastLoginAt = DateTime.UtcNow;
        var response = await IssueTokensAsync(user);
        await _audit.LogAsync("Login", nameof(User), user.Id.ToString(), userId: user.Id);
        return response;
    }

    public async Task<AuthResponse> RefreshAsync(string refreshToken)
    {
        var hash = Hash(refreshToken);
        var token = await _db.RefreshTokens.Include(t => t.User).FirstOrDefaultAsync(t => t.TokenHash == hash);
        if (token is null || token.User is null)
            throw new AppException("Session expired. Please log in again.", 401, "invalid_refresh");

        if (!token.IsActive)
        {
            // A revoked token being reused means it may have been stolen: end every session for this user.
            if (token.RevokedAt != null && token.ReplacedByTokenHash != null)
                await RevokeAllAsync(token.UserId);
            throw new AppException("Session expired. Please log in again.", 401, "invalid_refresh");
        }
        if (!token.User.IsActive) throw new AppException("This account is disabled.", 403, "inactive");

        var response = await IssueTokensAsync(token.User, token);
        return response;
    }

    public async Task LogoutAsync(string? refreshToken)
    {
        if (string.IsNullOrWhiteSpace(refreshToken)) return;
        var hash = Hash(refreshToken);
        var token = await _db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash);
        if (token is { RevokedAt: null })
        {
            token.RevokedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }
    }

    public async Task ChangePasswordAsync(Guid userId, ChangePasswordRequest req)
    {
        var user = await _db.Users.FindAsync(userId) ?? throw AppException.NotFound("User");
        if (!BCrypt.Net.BCrypt.Verify(req.CurrentPassword, user.PasswordHash))
            throw new AppException("Current password is incorrect.", 400, "bad_password");
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword);
        user.MustChangePassword = false;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("ChangePassword", nameof(User), user.Id.ToString(), userId: user.Id);
    }

    public async Task RevokeAllAsync(Guid userId)
    {
        var tokens = await _db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null).ToListAsync();
        foreach (var t in tokens) t.RevokedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    private async Task<AuthResponse> IssueTokensAsync(User user, RefreshToken? replacing = null)
    {
        var now = DateTime.UtcNow;
        var accessExpires = now.AddMinutes(_opt.AccessTokenMinutes);
        var claims = new[]
        {
            new Claim("sub", user.Id.ToString()),
            new Claim("email", user.Email),
            new Claim("name", user.FullName),
            new Claim("role", user.Role.ToString()),
            new Claim("jti", Guid.NewGuid().ToString()),
        };
        var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_opt.Key)), SecurityAlgorithms.HmacSha256);
        var jwt = new JwtSecurityToken(_opt.Issuer, _opt.Audience, claims, now, accessExpires, creds);
        var access = new JwtSecurityTokenHandler().WriteToken(jwt);

        var refreshRaw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
        var refresh = new RefreshToken
        {
            UserId = user.Id,
            TokenHash = Hash(refreshRaw),
            ExpiresAt = now.AddDays(_opt.RefreshTokenDays),
        };
        if (replacing != null)
        {
            replacing.RevokedAt = now;
            replacing.ReplacedByTokenHash = refresh.TokenHash;
        }
        _db.RefreshTokens.Add(refresh);
        await _db.SaveChangesAsync();

        return new AuthResponse
        {
            AccessToken = access,
            AccessTokenExpiresAt = accessExpires,
            RefreshToken = refreshRaw,
            RefreshTokenExpiresAt = refresh.ExpiresAt,
            User = _mapper.Map<UserDto>(user),
        };
    }

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}

public class AuditService
{
    private readonly AppDbContext _db;
    private readonly ICurrentUser _user;

    public AuditService(AppDbContext db, ICurrentUser user)
    {
        _db = db;
        _user = user;
    }

    /// <summary>Adds an audit row. Saved with the caller's next SaveChanges, or immediately when save is true.</summary>
    public async Task LogAsync(string action, string entity, string? entityId, object? oldValues = null,
        object? newValues = null, Guid? userId = null, bool save = true)
    {
        _db.AuditLogs.Add(new AuditLog
        {
            UserId = userId ?? _user.Id,
            Action = action,
            Entity = entity,
            EntityId = entityId,
            OldValues = oldValues is null ? null : System.Text.Json.JsonSerializer.Serialize(oldValues),
            NewValues = newValues is null ? null : System.Text.Json.JsonSerializer.Serialize(newValues),
        });
        if (save) await _db.SaveChangesAsync();
    }
}
