import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * Tracks whether the API is reachable. The browser's online flag only says a network exists,
 * so we also ping the server's /health endpoint and react to failed API calls.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private zone = inject(NgZone);
  private browserOnline = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  private serverReachable = signal(true);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** True when we believe API calls will work. */
  readonly online = computed(() => this.browserOnline() && this.serverReachable());

  private readonly healthUrl = environment.apiUrl.replace(/\/api\/?$/, '') + '/health';

  constructor() {
    window.addEventListener('online', () => this.zone.run(() => { this.browserOnline.set(true); void this.check(); }));
    window.addEventListener('offline', () => this.zone.run(() => this.browserOnline.set(false)));
    void this.check();
  }

  /** Called by the HTTP layer when a request failed because the server could not be reached. */
  markUnreachable(): void {
    if (!this.serverReachable()) return;
    this.serverReachable.set(false);
    this.startPolling();
  }

  markReachable(): void {
    if (this.serverReachable()) return;
    this.serverReachable.set(true);
    this.stopPolling();
  }

  async check(): Promise<boolean> {
    if (!navigator.onLine) { this.browserOnline.set(false); return false; }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(this.healthUrl, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) { this.markReachable(); return true; }
      this.markUnreachable();
      return false;
    } catch {
      this.markUnreachable();
      return false;
    }
  }

  private startPolling(): void {
    if (this.timer) return;
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => this.zone.run(() => void this.check()), 15000);
    });
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
