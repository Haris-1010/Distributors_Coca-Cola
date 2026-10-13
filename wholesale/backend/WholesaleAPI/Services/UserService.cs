using AutoMapper;
using Microsoft.EntityFrameworkCore;
using WholesaleAPI.Data;
using WholesaleAPI.DTOs;
using WholesaleAPI.Helpers;
using WholesaleAPI.Models;

namespace WholesaleAPI.Services;

public class UserService
{
    private readonly AppDbContext _db;
    private readonly IMapper _mapper;
    private readonly ICurrentUser _me;
    private readonly AuditService _audit;
    private readonly AuthService _auth;

    public UserService(AppDbContext db, IMapper mapper, ICurrentUser me, AuditService audit, AuthService auth)
    {
        _db = db;
        _mapper = mapper;
        _me = me;
        _audit = audit;
        _auth = auth;
    }

    public async Task<List<UserDto>> ListAsync() =>
        _mapper.Map<List<UserDto>>(await _db.Users.AsNoTracking().OrderBy(u => u.FullName).ToListAsync());

    public async Task<UserDto> GetAsync(Guid id) =>
        _mapper.Map<UserDto>(await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id) ?? throw AppException.NotFound("User"));

    public async Task<UserDto> CreateAsync(CreateUserRequest req)
    {
        GuardRoleChange(null, req.Role);
        var email = req.Email.Trim().ToLowerInvariant();
        if (await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email == email))
            throw AppException.Conflict("A user with this email already exists.");
        var user = new User
        {
            FullName = req.FullName.Trim(),
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            Role = req.Role,
            MustChangePassword = true,
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Create", nameof(User), user.Id.ToString(), newValues: new { user.Email, user.Role });
        return _mapper.Map<UserDto>(user);
    }

    public async Task<UserDto> UpdateAsync(Guid id, UpdateUserRequest req)
    {
        var user = await _db.Users.FindAsync(id) ?? throw AppException.NotFound("User");
        GuardRoleChange(user, req.Role);
        if (id == _me.Id && (!req.IsActive || req.Role != user.Role))
            throw new AppException("You can't change your own role or disable your own account.");
        if (user.Role == UserRole.SuperAdmin && (req.Role != UserRole.SuperAdmin || !req.IsActive))
            await EnsureAnotherSuperAdminAsync(id);

        var email = req.Email.Trim().ToLowerInvariant();
        if (await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Id != id && u.Email == email))
            throw AppException.Conflict("A user with this email already exists.");

        var old = new { user.FullName, user.Email, user.Role, user.IsActive };
        user.FullName = req.FullName.Trim();
        user.Email = email;
        user.Role = req.Role;
        user.IsActive = req.IsActive;
        await _db.SaveChangesAsync();
        if (!user.IsActive) await _auth.RevokeAllAsync(user.Id);
        await _audit.LogAsync("Update", nameof(User), id.ToString(), old, new { user.FullName, user.Email, user.Role, user.IsActive });
        return _mapper.Map<UserDto>(user);
    }

    public async Task ResetPasswordAsync(Guid id, ResetPasswordRequest req)
    {
        var user = await _db.Users.FindAsync(id) ?? throw AppException.NotFound("User");
        GuardRoleChange(user, user.Role);
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword);
        user.MustChangePassword = true;
        user.FailedLoginCount = 0;
        user.LockoutEndAt = null;
        await _db.SaveChangesAsync();
        await _auth.RevokeAllAsync(id);
        await _audit.LogAsync("ResetPassword", nameof(User), id.ToString());
    }

    public async Task DeleteAsync(Guid id)
    {
        var user = await _db.Users.FindAsync(id) ?? throw AppException.NotFound("User");
        if (id == _me.Id) throw new AppException("You can't delete your own account.");
        if (user.Role == UserRole.SuperAdmin)
        {
            if (!_me.IsInRole(UserRole.SuperAdmin)) throw AppException.Forbidden("Only a SuperAdmin can delete a SuperAdmin.");
            await EnsureAnotherSuperAdminAsync(id);
        }
        user.IsActive = false;
        _db.Users.Remove(user); // soft delete
        await _db.SaveChangesAsync();
        await _auth.RevokeAllAsync(id);
        await _audit.LogAsync("Delete", nameof(User), id.ToString());
    }

    /// <summary>Admins manage everyone except SuperAdmins; only a SuperAdmin can create or edit one.</summary>
    private void GuardRoleChange(User? target, UserRole newRole)
    {
        if (_me.IsInRole(UserRole.SuperAdmin)) return;
        if (newRole == UserRole.SuperAdmin || target?.Role == UserRole.SuperAdmin)
            throw AppException.Forbidden("Only a SuperAdmin can manage SuperAdmin accounts.");
    }

    private async Task EnsureAnotherSuperAdminAsync(Guid exceptId)
    {
        if (!await _db.Users.AnyAsync(u => u.Id != exceptId && u.Role == UserRole.SuperAdmin && u.IsActive))
            throw new AppException("There must always be at least one active SuperAdmin.");
    }
}
