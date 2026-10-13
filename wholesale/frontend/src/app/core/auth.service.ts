import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { db } from '../offline/db';
import { AuthResponse, User, UserRole } from './models';
import { isNetworkError } from './util';

export interface Session {
  user: User;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  /** Signed in with cached credentials while the server was unreachable. */
  offline: boolean;
}

const KEY = 'wh.session';
const PBKDF2_ITERATIONS = 150_000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private refreshing: Promise<boolean> | null = null;

  readonly session = signal<Session | null>(this.load());
  readonly user = computed(() => this.session()?.user ?? null);
  readonly role = computed(() => this.session()?.user.role ?? null);
  readonly isLoggedIn = computed(() => !!this.session());
  /** True when the server would accept our calls (we hold a refresh token). */
  readonly hasServerSession = computed(() => !!this.session()?.refreshToken);

  hasRole(...roles: UserRole[]): boolean {
    const r = this.role();
    return !!r && roles.includes(r);
  }
  get isManager() { return this.hasRole('SuperAdmin', 'Admin', 'Manager'); }
  get isAdmin() { return this.hasRole('SuperAdmin', 'Admin'); }
  get canSell() { return this.hasRole('SuperAdmin', 'Admin', 'Manager', 'Salesman'); }

  get accessToken(): string | undefined { return this.session()?.accessToken; }

  /**
   * Signs in against the server. If the server can't be reached, falls back to the credentials
   * cached from this device's last successful sign-in so selling can continue offline.
   */
  async login(email: string, password: string): Promise<Session> {
    email = email.trim().toLowerCase();
    try {
      const res = await firstValueFrom(this.http.post<AuthResponse>(`${environment.apiUrl}/auth/login`, { email, password }));
      const s = this.fromResponse(res);
      await this.cacheCredentials(email, password, res.user).catch(() => undefined);
      return s;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      const offline = await this.offlineLogin(email, password);
      if (!offline) throw new Error('The server is unreachable and this account has not signed in on this device before, or the password is wrong.');
      return offline;
    }
  }

  /** Exchanges the refresh token for a new access token. Concurrent callers share one request. */
  refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const token = this.session()?.refreshToken;
    if (!token) return Promise.resolve(false);
    this.refreshing = firstValueFrom(this.http.post<AuthResponse>(`${environment.apiUrl}/auth/refresh`, { refreshToken: token }))
      .then(res => { this.fromResponse(res); return true; })
      .catch(err => {
        if (isNetworkError(err)) throw err;
        // Refresh token rejected: keep the user's identity so offline work isn't lost, but drop the server session.
        const s = this.session();
        if (s) this.save({ user: s.user, offline: true });
        return false;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async logout(): Promise<void> {
    const token = this.session()?.refreshToken;
    this.save(null);
    if (token) this.http.post(`${environment.apiUrl}/auth/logout`, { refreshToken: token }).subscribe({ error: () => undefined });
    await this.router.navigateByUrl('/login');
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await firstValueFrom(this.http.post(`${environment.apiUrl}/auth/change-password`, { currentPassword, newPassword }));
    const s = this.session();
    if (s) {
      this.save({ ...s, user: { ...s.user, mustChangePassword: false } });
      await this.cacheCredentials(s.user.email, newPassword, s.user).catch(() => undefined);
    }
  }

  private fromResponse(res: AuthResponse): Session {
    const s: Session = {
      user: res.user, accessToken: res.accessToken, accessTokenExpiresAt: res.accessTokenExpiresAt,
      refreshToken: res.refreshToken, offline: false,
    };
    this.save(s);
    return s;
  }

  private save(s: Session | null): void {
    this.session.set(s);
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  }

  private load(): Session | null {
    try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
  }

  // ---------- Offline credentials (PBKDF2 hash, never the password) ----------

  private async cacheCredentials(email: string, password: string, user: User): Promise<void> {
    if (!crypto?.subtle) return; // only available on https / localhost
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await this.derive(password, salt, PBKDF2_ITERATIONS);
    await db.users.put({
      email, userId: user.id, fullName: user.fullName, role: user.role,
      salt: toB64(salt), hash, iterations: PBKDF2_ITERATIONS, cachedAt: new Date().toISOString(),
    });
  }

  private async offlineLogin(email: string, password: string): Promise<Session | null> {
    if (!crypto?.subtle) return null;
    const cached = await db.users.get(email);
    if (!cached) return null;
    const hash = await this.derive(password, fromB64(cached.salt), cached.iterations);
    if (hash !== cached.hash) return null;
    const user: User = {
      id: cached.userId, fullName: cached.fullName, email, role: cached.role,
      isActive: true, mustChangePassword: false, createdAt: cached.cachedAt,
    };
    const s: Session = { user, offline: true };
    this.save(s);
    return s;
  }

  private async derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
    return toB64(new Uint8Array(bits));
  }
}

function toB64(b: Uint8Array): string { return btoa(String.fromCharCode(...b)); }
function fromB64(s: string): Uint8Array { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
