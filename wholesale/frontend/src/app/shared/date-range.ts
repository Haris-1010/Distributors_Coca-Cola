import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { addDays, isoDate, startOfMonth } from '../core/util';

export interface Range { from: string; to: string; }

/** Quick presets plus a from/to date picker. Emits local calendar dates (yyyy-mm-dd). */
@Component({
  selector: 'app-date-range',
  imports: [FormsModule, MatButtonToggleModule, MatDatepickerModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="dr">
      <mat-button-toggle-group [value]="preset()" (change)="applyPreset($event.value)" hideSingleSelectionIndicator aria-label="Date range">
        <mat-button-toggle value="today">Today</mat-button-toggle>
        <mat-button-toggle value="7d">7 days</mat-button-toggle>
        <mat-button-toggle value="month">This month</mat-button-toggle>
        <mat-button-toggle value="last">Last month</mat-button-toggle>
      </mat-button-toggle-group>
      <mat-form-field class="picker">
        <mat-label>Custom range</mat-label>
        <mat-date-range-input [rangePicker]="rp">
          <input matStartDate [ngModel]="fromDate()" (ngModelChange)="fromDate.set($event)" placeholder="From">
          <input matEndDate [ngModel]="toDate()" (ngModelChange)="toDate.set($event); custom()" placeholder="To">
        </mat-date-range-input>
        <mat-datepicker-toggle matIconSuffix [for]="rp" />
        <mat-date-range-picker #rp panelClass="app-calendar-panel" />
      </mat-form-field>
    </div>
  `,
  styles: `.dr { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; } .picker { width: 250px; }`,
})
export class DateRangeComponent {
  initial = input<'today' | '7d' | 'month' | 'last'>('month');
  changed = output<Range>();
  preset = signal<string>('month');
  fromDate = signal<Date | null>(startOfMonth());
  toDate = signal<Date | null>(new Date());

  /** Emits the initial range so the parent page can load straight away. */
  ngOnInit() { this.applyPreset(this.initial()); }

  applyPreset(p: string) {
    const today = new Date();
    let from = startOfMonth(today), to = today;
    if (p === 'today') from = today;
    if (p === '7d') from = addDays(today, -6);
    if (p === 'last') { from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = addDays(startOfMonth(today), -1); }
    this.preset.set(p);
    this.fromDate.set(from);
    this.toDate.set(to);
    this.changed.emit({ from: isoDate(from), to: isoDate(to) });
  }

  custom() {
    const f = this.fromDate(), t = this.toDate();
    if (!f || !t) return;
    this.preset.set('');
    this.changed.emit({ from: isoDate(f), to: isoDate(t) });
  }
}
