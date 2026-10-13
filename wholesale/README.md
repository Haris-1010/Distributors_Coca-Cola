# Wholesale Manager — Pepsi & Coca-Cola

Distributor → shop → customers, with returns, empty-crate tracking, credit, reports and full offline selling.
Currency is Pakistani Rupees (Rs); payment modes are Cash, Credit, JazzCash, Easypaisa, Bank transfer and Cheque.

```
backend/WholesaleAPI   .NET 8 Web API · PostgreSQL · EF Core + Dapper · JWT + refresh tokens
frontend               Angular 20 · Angular Material · Dexie (IndexedDB) · PWA service worker · Chart.js
docker-compose.yml     PostgreSQL + API in containers
```

## Run it (development)

You need the **.NET 8 SDK**, **Node 20+** and **PostgreSQL 14+**.

1. Create an empty database called `wholesale` and check the connection string in
   `backend/WholesaleAPI/appsettings.json`.
2. Start the API:
   ```bash
   cd backend/WholesaleAPI
   dotnet run
   ```
   On first start it creates the tables, seeds the SuperAdmin, 12 sample products, one customer and opening stock.
   Swagger: http://localhost:5080/swagger
3. Start the app:
   ```bash
   cd frontend
   npm install
   npm start          # http://localhost:4200
   ```
4. Sign in with **admin@gmail.com / Admin@123**. You'll be asked to set a new password.

### Using migrations instead of auto-create
The API creates the schema directly when the project has no migrations. To switch to migrations:
```bash
dotnet tool install --global dotnet-ef
dotnet ef migrations add Initial
```
From then on the API applies pending migrations at start-up.

## Production

```bash
cd frontend && npx ng build                       # output: dist/frontend/browser
cp -r dist/frontend/browser/* ../backend/WholesaleAPI/wwwroot/
cd ../backend/WholesaleAPI && dotnet publish -c Release
```
One server then hosts both the app and `/api`. Or use Docker: put `JWT_KEY=<long random string>` in a `.env` file and run `docker compose up -d`.

**Set these before going live:** `Jwt__Key` (32+ random characters — the API refuses to start in production with the placeholder), the database password, and `Cors__Origins__0` if the app is served from a different address.

**Offline mode needs HTTPS** (or `localhost`): browsers only allow the service worker and offline sign-in on secure origins. Put the server behind HTTPS (e.g. Caddy or IIS with a certificate) when other devices on the shop network use it.

**Backups:** schedule a nightly `pg_dump -Fc wholesale > wholesale-$(date +%F).dump` and keep copies off the machine. Restore with `pg_restore -d wholesale <file>`.

## Business rules as built

| Rule | How it works |
|---|---|
| Profit target | Each product has Min/Max profit (default Rs 50/60). **Settings → Profit target applies** chooses *per piece* (as the spec says) or *per full crate/pack*. Salesmen can't sell below cost + min profit; Managers and Admins can. Discounts are Manager+. |
| Crates | Glass products need `ceil(bottles ÷ 24)` crates per line. Crates brought back are applied to the **oldest** open sales first (or to a chosen sale). |
| Settlement | A sale settles automatically once fully paid **and** every crate is back. An Admin can override with a reason (audit-logged); the money and crates stay on the customer's ledger. |
| Returns | Unsold / Extra / Other go back into the same stock batch. Damaged / Expired are written off (profit reduced by the full price). Returning bottles lowers the crates owed. If the customer had paid more than the new total, a cash refund is recorded. |
| Stock | Batch + expiry; sales take stock FIFO by earliest expiry with row locks so two counters can't sell the same bottles. |
| Payments | A payment without a sale clears the oldest dues first; any extra becomes an advance. |
| Offline | Sales, customers, payments, crate collection, returns (for sales already on the device) and receiving stock work offline. Each change is queued in IndexedDB with its own id and pushed to `/api/sync` in order when the connection returns — resending can never duplicate a sale. Offline sales get a temporary `OFF-…` number; the server assigns the final invoice number. Anything the server refuses (e.g. stock ran out meanwhile) appears under **Sync status** to retry or discard. |

## Roles
SuperAdmin (everything) · Admin (everything except SuperAdmin accounts) · Manager (sales, stock, purchases, returns, reports, discounts) · Salesman (sell, view stock, returns, payments, crates) · Viewer (read-only reports).
