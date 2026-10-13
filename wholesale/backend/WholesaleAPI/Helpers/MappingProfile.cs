using AutoMapper;
using WholesaleAPI.DTOs;
using WholesaleAPI.Models;

namespace WholesaleAPI.Helpers;

public class MappingProfile : Profile
{
    public MappingProfile()
    {
        CreateMap<User, UserDto>();

        CreateMap<Product, ProductDto>()
            .ForMember(d => d.StockQuantity, o => o.Ignore())
            .ForMember(d => d.MinSellingPrice, o => o.Ignore()); // set by ProductService (depends on profit basis)

        CreateMap<StockBatch, StockBatchDto>()
            .ForMember(d => d.ProductName, o => o.MapFrom(s => s.Product != null ? s.Product.Name : ""))
            .ForMember(d => d.CrateQuantity, o => o.MapFrom(s =>
                s.Product != null && s.Product.BottlesPerCrate > 0 ? s.Quantity / s.Product.BottlesPerCrate : 0))
            .ForMember(d => d.LoosePieces, o => o.MapFrom(s =>
                s.Product != null && s.Product.BottlesPerCrate > 0 ? s.Quantity % s.Product.BottlesPerCrate : s.Quantity))
            .ForMember(d => d.DaysToExpiry, o => o.MapFrom(s =>
                s.ExpiryDate.HasValue ? s.ExpiryDate.Value.DayNumber - DateOnly.FromDateTime(DateTime.UtcNow).DayNumber : (int?)null));

        CreateMap<PurchaseItem, PurchaseItemDto>()
            .ForMember(d => d.ProductName, o => o.MapFrom(s => s.Product != null ? s.Product.Name : ""));
        CreateMap<Purchase, PurchaseDto>()
            .ForMember(d => d.Balance, o => o.MapFrom(s => s.TotalAmount - s.PaidAmount))
            .ForMember(d => d.ItemCount, o => o.MapFrom(s => s.Items.Count));

        CreateMap<Customer, CustomerDto>();
        CreateMap<Payment, PaymentDto>();

        CreateMap<SaleItem, SaleItemDto>()
            .ForMember(d => d.NetQuantity, o => o.MapFrom(s => s.Quantity - s.ReturnedQuantity))
            .ForMember(d => d.CratesRequired, o => o.MapFrom(s => s.CratesRequired));

        CreateMap<SaleReturn, SaleReturnDto>()
            .ForMember(d => d.ProductName, o => o.Ignore())
            .ForMember(d => d.InvoiceNumber, o => o.Ignore())
            .ForMember(d => d.CustomerName, o => o.Ignore());

        CreateMap<Sale, SaleDto>()
            .ForMember(d => d.CustomerName, o => o.MapFrom(s => s.Customer != null ? s.Customer.Name : ""))
            .ForMember(d => d.CustomerBusinessName, o => o.MapFrom(s => s.Customer != null ? s.Customer.BusinessName : null))
            .ForMember(d => d.CustomerPhone, o => o.MapFrom(s => s.Customer != null ? s.Customer.Phone : null))
            .ForMember(d => d.Balance, o => o.MapFrom(s => s.NetAmount - s.PaidAmount))
            .ForMember(d => d.PendingCrates, o => o.MapFrom(s => s.PendingCrates))
            .ForMember(d => d.Payments, o => o.Ignore())
            .ForMember(d => d.SettlementBlockers, o => o.Ignore())
            .ForMember(d => d.CreatedByName, o => o.Ignore());

        CreateMap<Sale, SaleListItemDto>()
            .ForMember(d => d.CustomerName, o => o.MapFrom(s => s.Customer != null ? s.Customer.Name : ""))
            .ForMember(d => d.Balance, o => o.MapFrom(s => s.NetAmount - s.PaidAmount))
            .ForMember(d => d.PendingCrates, o => o.MapFrom(s => s.PendingCrates));

        CreateMap<EmptyCrateTransaction, CrateTransactionDto>()
            .ForMember(d => d.CustomerName, o => o.Ignore())
            .ForMember(d => d.InvoiceNumber, o => o.Ignore());
    }
}
