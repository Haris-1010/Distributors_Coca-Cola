using FluentValidation;

namespace WholesaleAPI.DTOs;

public class LoginValidator : AbstractValidator<LoginRequest>
{
    public LoginValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
        RuleFor(x => x.Password).NotEmpty();
    }
}

public static class PasswordRules
{
    public static IRuleBuilderOptions<T, string> StrongPassword<T>(this IRuleBuilder<T, string> rule) =>
        rule.NotEmpty().MinimumLength(8)
            .Matches("[A-Z]").WithMessage("Password needs at least one capital letter.")
            .Matches("[a-z]").WithMessage("Password needs at least one small letter.")
            .Matches("[0-9]").WithMessage("Password needs at least one number.");
}

public class ChangePasswordValidator : AbstractValidator<ChangePasswordRequest>
{
    public ChangePasswordValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty();
        RuleFor(x => x.NewPassword).StrongPassword().NotEqual(x => x.CurrentPassword)
            .WithMessage("New password must be different from the current one.");
    }
}

public class CreateUserValidator : AbstractValidator<CreateUserRequest>
{
    public CreateUserValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(200);
        RuleFor(x => x.Password).StrongPassword();
        RuleFor(x => x.Role).IsInEnum();
    }
}

public class UpdateUserValidator : AbstractValidator<UpdateUserRequest>
{
    public UpdateUserValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(200);
        RuleFor(x => x.Role).IsInEnum();
    }
}

public class ResetPasswordValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordValidator() => RuleFor(x => x.NewPassword).StrongPassword();
}

public class SaveProductValidator : AbstractValidator<SaveProductRequest>
{
    public SaveProductValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Category).NotEmpty().MaximumLength(60);
        RuleFor(x => x.Brand).IsInEnum();
        RuleFor(x => x.UnitType).IsInEnum();
        RuleFor(x => x.BottlesPerCrate).GreaterThan(0).LessThanOrEqualTo(100);
        RuleFor(x => x.PurchasePrice).GreaterThanOrEqualTo(0);
        RuleFor(x => x.SellingPrice).GreaterThanOrEqualTo(0);
        RuleFor(x => x.MinProfit).GreaterThanOrEqualTo(0);
        RuleFor(x => x.MaxProfit).GreaterThanOrEqualTo(x => x.MinProfit)
            .WithMessage("Max profit must be at least the min profit.");
        RuleFor(x => x.LowStockThreshold).GreaterThanOrEqualTo(0);
    }
}

public class StockAdjustmentValidator : AbstractValidator<StockAdjustmentRequest>
{
    public StockAdjustmentValidator()
    {
        RuleFor(x => x.ProductId).NotEmpty();
        RuleFor(x => x.Quantity).NotEqual(0).WithMessage("Quantity must be positive (add) or negative (remove).");
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(300);
        RuleFor(x => x.StockBatchId).NotEmpty().When(x => x.Quantity < 0)
            .WithMessage("Choose the batch to remove stock from.");
    }
}

public class CreatePurchaseValidator : AbstractValidator<CreatePurchaseRequest>
{
    public CreatePurchaseValidator()
    {
        RuleFor(x => x.DistributorName).NotEmpty().MaximumLength(150);
        RuleFor(x => x.PaidAmount).GreaterThanOrEqualTo(0);
        RuleFor(x => x.Items).NotEmpty().WithMessage("Add at least one product.");
        RuleForEach(x => x.Items).ChildRules(i =>
        {
            i.RuleFor(x => x.ProductId).NotEmpty();
            i.RuleFor(x => x.Quantity).GreaterThan(0);
            i.RuleFor(x => x.UnitPrice).GreaterThanOrEqualTo(0);
        });
    }
}

public class SaveCustomerValidator : AbstractValidator<SaveCustomerRequest>
{
    public SaveCustomerValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(150);
        RuleFor(x => x.Phone).MaximumLength(30);
        RuleFor(x => x.CustomerType).IsInEnum();
    }
}

public class CustomerPaymentValidator : AbstractValidator<CustomerPaymentRequest>
{
    public CustomerPaymentValidator()
    {
        RuleFor(x => x.Amount).GreaterThan(0);
        RuleFor(x => x.PaymentMode).IsInEnum()
            .NotEqual(Models.PaymentMode.Credit).WithMessage("A payment cannot be made on credit.");
    }
}

public class CreateSaleValidator : AbstractValidator<CreateSaleRequest>
{
    public CreateSaleValidator()
    {
        RuleFor(x => x.CustomerId).NotEmpty().WithMessage("Choose a customer.");
        RuleFor(x => x.Items).NotEmpty().WithMessage("Add at least one product.");
        RuleFor(x => x.Discount).GreaterThanOrEqualTo(0);
        RuleFor(x => x.PaidAmount).GreaterThanOrEqualTo(0);
        RuleFor(x => x.CratesReturnedNow).GreaterThanOrEqualTo(0);
        RuleFor(x => x.PaymentMode).IsInEnum();
        RuleForEach(x => x.Items).ChildRules(i =>
        {
            i.RuleFor(x => x.ProductId).NotEmpty();
            i.RuleFor(x => x.Quantity).GreaterThan(0);
            i.RuleFor(x => x.UnitPrice).GreaterThanOrEqualTo(0).When(x => x.UnitPrice.HasValue);
        });
    }
}

public class CreateReturnValidator : AbstractValidator<CreateReturnRequest>
{
    public CreateReturnValidator()
    {
        RuleFor(x => x.SaleId).NotEmpty();
        RuleFor(x => x.Lines).NotEmpty().WithMessage("Choose at least one item to return.");
        RuleForEach(x => x.Lines).ChildRules(l =>
        {
            l.RuleFor(x => x.SaleItemId).NotEmpty();
            l.RuleFor(x => x.Quantity).GreaterThan(0);
            l.RuleFor(x => x.Reason).IsInEnum();
        });
    }
}

public class CrateReturnValidator : AbstractValidator<CrateReturnRequest>
{
    public CrateReturnValidator()
    {
        RuleFor(x => x.CustomerId).NotEmpty();
        RuleFor(x => x.Quantity).GreaterThan(0);
    }
}

public class CrateAdjustmentValidator : AbstractValidator<CrateAdjustmentRequest>
{
    public CrateAdjustmentValidator()
    {
        RuleFor(x => x.CustomerId).NotEmpty();
        RuleFor(x => x.Quantity).NotEqual(0);
        RuleFor(x => x.Notes).NotEmpty().WithMessage("Give a reason for the crate adjustment.");
    }
}

public class SaleCrateReturnValidator : AbstractValidator<SaleCrateReturnRequest>
{
    public SaleCrateReturnValidator() => RuleFor(x => x.Quantity).GreaterThan(0);
}
