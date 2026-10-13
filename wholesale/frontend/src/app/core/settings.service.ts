import { Injectable, computed, signal } from '@angular/core';
import { getMeta, setMeta } from '../offline/db';
import { Settings } from './models';

/** Shop settings (company name, currency, profit targets...). Cached offline. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly values = signal<Settings>({});

  readonly currencySymbol = computed(() => this.values()['CurrencySymbol'] || 'Rs');
  readonly companyName = computed(() => this.values()['CompanyName'] || 'Wholesale');
  readonly profitPerCrate = computed(() => (this.values()['ProfitBasis'] || 'Piece').toLowerCase() === 'crate');

  constructor() {
    void getMeta<Settings>('settings', {}).then(s => { if (Object.keys(this.values()).length === 0) this.values.set(s); });
  }

  async set(values: Settings): Promise<void> {
    this.values.set(values);
    await setMeta('settings', values);
  }

  get(key: string, fallback = ''): string { return this.values()[key] ?? fallback; }
}
