using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;
using WholesaleAPI.Services;

namespace WholesaleAPI.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AuthService _auth;
    private readonly UserService _users;
    private readonly ICurrentUser _me;

    public AuthController(AuthService auth, UserService users, ICurrentUser me)
    {
        _auth = auth;
        _users = users;
        _me = me;
    }

    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("login")]
    public Task<AuthResponse> Login(LoginRequest req) => _auth.LoginAsync(req);

    [HttpPost("refresh"), AllowAnonymous]
    public Task<AuthResponse> Refresh(RefreshRequest req) => _auth.RefreshAsync(req.RefreshToken);

    [HttpPost("logout"), AllowAnonymous]
    public async Task<IActionResult> Logout(RefreshRequest req)
    {
        await _auth.LogoutAsync(req.RefreshToken);
        return NoContent();
    }

    [HttpGet("me"), Authorize]
    public Task<UserDto> Me() => _users.GetAsync(_me.Id!.Value);

    [HttpPost("change-password"), Authorize]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest req)
    {
        await _auth.ChangePasswordAsync(_me.Id!.Value, req);
        return NoContent();
    }
}

[ApiController]
[Route("api/users")]
[Authorize(Roles = RoleGroups.AdminUp)]
public class UsersController : ControllerBase
{
    private readonly UserService _users;
    public UsersController(UserService users) => _users = users;

    [HttpGet] public Task<List<UserDto>> List() => _users.ListAsync();
    [HttpGet("{id:guid}")] public Task<UserDto> Get(Guid id) => _users.GetAsync(id);
    [HttpPost] public Task<UserDto> Create(CreateUserRequest req) => _users.CreateAsync(req);
    [HttpPut("{id:guid}")] public Task<UserDto> Update(Guid id, UpdateUserRequest req) => _users.UpdateAsync(id, req);

    [HttpPost("{id:guid}/reset-password")]
    public async Task<IActionResult> ResetPassword(Guid id, ResetPasswordRequest req)
    {
        await _users.ResetPasswordAsync(id, req);
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        await _users.DeleteAsync(id);
        return NoContent();
    }
}

[ApiController]
[Route("api/settings")]
[Authorize]
public class SettingsController : ControllerBase
{
    private readonly SettingsService _settings;
    private readonly AuditService _audit;

    public SettingsController(SettingsService settings, AuditService audit)
    {
        _settings = settings;
        _audit = audit;
    }

    [HttpGet] public Task<Dictionary<string, string>> Get() => _settings.GetAllAsync();

    [HttpPut, Authorize(Roles = RoleGroups.AdminUp)]
    public async Task<Dictionary<string, string>> Update(UpdateSettingsRequest req)
    {
        await _settings.SaveAsync(req.Values);
        await _audit.LogAsync("Update", "Settings", null, newValues: req.Values);
        return await _settings.GetAllAsync();
    }
}
