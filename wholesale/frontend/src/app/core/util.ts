import { HttpErrorResponse } from '@angular/common/http';

/** UUID v4. Uses crypto.randomUUID when available (secure origins), otherwise getRandomValues. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const moneyFmt = new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });

export function money(v: number | null | undefined, symbol = 'Rs'): string {
  const n = Number(v ?? 0);
  return `${n < 0 ? '-' : ''}${symbol} ${moneyFmt.format(Math.abs(n))}`;
}
export function int(v: number | null | undefined): string { return intFmt.format(Number(v ?? 0)); }

export function round2(v: number): number { return Math.round((v + Number.EPSILON) * 100) / 100; }

/** yyyy-mm-dd for the user's local calendar day. */
export function isoDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function startOfMonth(d = new Date()): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/** Start of a local day as a UTC ISO string, for API filters on timestamps. */
export function dayStartUtc(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d + 'T00:00:00') : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return x.toISOString();
}

/** Crates needed for a number of glass bottles (partial crates round up). */
export function cratesFor(pieces: number, perCrate: number): number {
  return perCrate > 0 ? Math.ceil(pieces / perCrate) : 0;
}

export function cratesAndPieces(pieces: number, perCrate: number): string {
  if (!perCrate || perCrate <= 1) return `${int(pieces)} pcs`;
  const c = Math.floor(pieces / perCrate), r = pieces % perCrate;
  return r ? `${int(c)} cr + ${r} pcs` : `${int(c)} cr`;
}

/** Turns any HTTP / JS error into a sentence for the user. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server.';
    const body = err.error as { message?: string; errors?: Record<string, string[]> } | null;
    if (body?.errors) {
      const first = Object.values(body.errors).flat()[0];
      if (first) return first;
    }
    if (body?.message) return body.message;
    return `${err.status} ${err.statusText}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** True for failures that mean "no connection" rather than "the server said no". */
export function isNetworkError(err: unknown): boolean {
  return err instanceof HttpErrorResponse && (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504);
}

export function brandLabel(b: string): string { return b === 'CocaCola' ? 'Coca-Cola' : b; }
