import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { NotifyService } from '../../core/notify.service';
import { errorMessage } from '../../core/util';

const strong = (c: AbstractControl): ValidationErrors | null => {
  const v = String(c.value ?? '');
  return v.length >= 8 && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v) ? null : { weak: true };
};

@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
  <div class="wrap">
    <form class="card" [formGroup]="form" (ngSubmit)="submit()">
      <h2>Set a new password</h2>
      @if (auth.user()?.mustChangePassword) {
        <p class="muted">For security, choose your own password before continuing.</p>
      }
      <mat-form-field class="full">
        <mat-label>Current password</mat-label>
        <input matInput type="password" formControlName="current" autocomplete="current-password">
      </mat-form-field>
      <mat-form-field class="full">
        <mat-label>New password</mat-label>
        <input matInput type="password" formControlName="next" autocomplete="new-password">
        <mat-hint>At least 8 characters with a capital, a small letter and a number.</mat-hint>
      </mat-form-field>
      <mat-form-field class="full" style="margin-top:8px">
        <mat-label>Repeat new password</mat-label>
        <input matInput type="password" formControlName="repeat" autocomplete="new-password">
        @if (form.hasError('mismatch')) { <mat-error>Passwords don't match.</mat-error> }
      </mat-form-field>
      @if (error()) { <div class="error">{{ error() }}</div> }
      <div class="row" style="margin-top:8px">
        @if (!auth.user()?.mustChangePassword) { <button mat-button type="button" (click)="back()">Cancel</button> }
        <span class="spacer"></span>
        <button mat-button type="button" (click)="auth.logout()">Sign out</button>
        <button mat-flat-button [disabled]="form.invalid || busy()">Save password</button>
      </div>
    </form>
  </div>
  `,
  styles: `
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { width: 100%; max-width: 420px; padding: 28px; }
    h2 { margin: 0 0 6px; }
    .muted { margin: 0 0 20px; }
    .error { background: var(--app-red-soft); color: var(--app-red); padding: 10px 12px; border-radius: 8px; font-size: 13px; }
  `,
})
export class ChangePasswordPage {
  auth = inject(AuthService);
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private notify = inject(NotifyService);
  busy = signal(false);
  error = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    current: ['', Validators.required],
    next: ['', [Validators.required, strong]],
    repeat: ['', Validators.required],
  }, { validators: g => g.get('next')!.value === g.get('repeat')!.value ? null : { mismatch: true } });

  async submit() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.changePassword(this.form.value.current!, this.form.value.next!);
      this.notify.success('Password changed.');
      await this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  back() { history.back(); }
}
