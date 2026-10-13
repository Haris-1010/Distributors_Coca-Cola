import { Pipe, PipeTransform, inject } from '@angular/core';
import { SettingsService } from '../core/settings.service';
import { brandLabel, cratesAndPieces, int, money } from '../core/util';

/** 1234.5 → "Rs 1,234.50" (symbol from Settings). */
@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private settings = inject(SettingsService);
  transform(v: number | null | undefined): string { return money(v, this.settings.currencySymbol()); }
}

@Pipe({ name: 'int' })
export class IntPipe implements PipeTransform {
  transform(v: number | null | undefined): string { return int(v); }
}

/** 50 pieces, 24 per crate → "2 cr + 2 pcs". */
@Pipe({ name: 'crates' })
export class CratesPipe implements PipeTransform {
  transform(pieces: number | null | undefined, perCrate: number | null | undefined): string {
    return cratesAndPieces(pieces ?? 0, perCrate ?? 0);
  }
}

@Pipe({ name: 'brand' })
export class BrandPipe implements PipeTransform {
  transform(v: string | null | undefined): string { return v ? brandLabel(v) : ''; }
}

/** Splits PascalCase enum values for display: "BankTransfer" → "Bank Transfer". */
@Pipe({ name: 'words' })
export class WordsPipe implements PipeTransform {
  transform(v: string | null | undefined): string {
    if (!v) return '';
    if (v === 'CocaCola') return 'Coca-Cola';
    return v.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
}

export const SHARED_PIPES = [MoneyPipe, IntPipe, CratesPipe, BrandPipe, WordsPipe] as const;
