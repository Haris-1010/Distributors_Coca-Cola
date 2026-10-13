import { Component, forwardRef, Input } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { isoDate } from '../core/util';

@Component({
  selector: 'app-date-input',
  imports: [FormsModule, MatDatepickerModule, MatFormFieldModule, MatInputModule],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => DateInputComponent),
    multi: true,
  }],
  host: { '[class.date-input-compact]': 'compact' },
  template: `
    <mat-form-field>
      @if (label) { <mat-label>{{ label }}</mat-label> }
      <input matInput [matDatepicker]="picker" [ngModel]="selectedDate"
        (ngModelChange)="update($event)" [ngModelOptions]="{ standalone: true }"
        [attr.aria-label]="ariaLabel || label || 'Date'" [disabled]="disabled"
        (blur)="onTouched()">
      <mat-datepicker-toggle matIconSuffix [for]="picker" [disabled]="disabled">
        <span matDatepickerToggleIcon class="material-symbols-outlined">calendar_month</span>
      </mat-datepicker-toggle>
      <mat-datepicker #picker [disabled]="disabled" panelClass="app-calendar-panel" />
    </mat-form-field>
  `,
  styles: `:host { display: block; min-width: 0; } mat-form-field { width: 100%; }`,
})
export class DateInputComponent implements ControlValueAccessor {
  @Input() label = '';
  @Input() ariaLabel = '';
  @Input() compact = false;

  selectedDate: Date | null = null;
  disabled = false;

  private onChange: (value: string) => void = () => {};
  onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    if (!value) {
      this.selectedDate = null;
      return;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      this.selectedDate = null;
      return;
    }
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    this.selectedDate = date.getFullYear() === Number(year)
      && date.getMonth() === Number(month) - 1
      && date.getDate() === Number(day)
      ? date
      : null;
  }

  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.disabled = disabled; }

  update(value: Date | null): void {
    this.selectedDate = value;
    this.onChange(value ? isoDate(value) : '');
  }
}
