import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { SettingsService } from '../../core/settings.service';
import { errorMessage } from '../../core/util';
import { ConnectivityService } from '../../offline/connectivity.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
  <div class="wrap">
    <section class="brand">
      <div class="brand-inner">
        <div class="logo"><span class="material-symbols-outlined">local_shipping</span></div>
        <h1>{{ settings.companyName() }}</h1>
        <p>Pepsi &amp; Coca-Cola wholesale — stock, sales, crates and credit in one place.</p>
        <div class="crate" aria-hidden="true">
          @for (c of caps; track $index) { <span [class.red]="c"></span> }
        </div>
        <p class="crate-note">24 bottles · 1 crate · every crate comes back</p>
      </div>
    </section>

    <section class="form-side">
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        <h2>Sign in</h2>
        <p class="muted">Use your shop account.</p>

        @if (!net.online()) {
          <div class="offline-note">
            <span class="material-symbols-outlined">cloud_off</span>
            Server not reachable. You can still sign in if this account has used this device before.
          </div>
        }

        <mat-form-field class="full">
          <mat-label>Email</mat-label>
          <input matInput formControlName="email" type="email" autocomplete="username" autofocus>
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Password</mat-label>
          <input matInput formControlName="password" [type]="show() ? 'text' : 'password'" autocomplete="current-password">
          <button mat-icon-button matSuffix type="button" (click)="show.set(!show())" [attr.aria-label]="show() ? 'Hide password' : 'Show password'">
            <mat-icon class="material-symbols-outlined">{{ show() ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
        </mat-form-field>

        @if (error()) { <div class="error">{{ error() }}</div> }

        <button mat-flat-button class="full submit" [disabled]="busy() || form.invalid">
          @if (busy()) { <mat-spinner diameter="18" /> } @else { Sign in }
        </button>
      </form>
    </section>
  </div>
  `,
  styles: `
    .wrap { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); background: var(--app-surface); }
    .brand { background: var(--app-nav); color: #fff; display: flex; align-items: center; justify-content: center; padding: 48px;
      background-image: radial-gradient(circle at 15% 20%, rgba(255,255,255,.07), transparent 40%), radial-gradient(circle at 85% 90%, rgba(200,16,46,.25), transparent 45%); }
    .brand-inner { max-width: 420px; }
    .logo { width: 52px; height: 52px; border-radius: 14px; background: rgba(255,255,255,.12); display: grid; place-items: center;
      .material-symbols-outlined { font-size: 30px; } }
    h1 { font-size: 32px; line-height: 1.15; margin: 22px 0 10px; letter-spacing: -0.02em; }
    .brand p { color: var(--app-nav-ink); font-size: 15px; line-height: 1.5; margin: 0; }
    .crate { margin-top: 36px; display: grid; grid-template-columns: repeat(6, 34px); gap: 10px; padding: 16px;
      border: 2px solid rgba(255,255,255,.18); border-radius: 12px; width: max-content; }
    .crate span { width: 34px; height: 34px; border-radius: 50%; background: rgba(255,255,255,.14); box-shadow: inset 0 0 0 4px rgba(255,255,255,.08); }
    .crate span.red { background: var(--app-red); box-shadow: inset 0 0 0 4px rgba(255,255,255,.18); }
    .crate-note { margin-top: 12px !important; font-size: 12px !important; letter-spacing: .06em; text-transform: uppercase; opacity: .8; }
    .form-side { display: flex; align-items: center; justify-content: center; padding: 32px; }
    .form { width: 100%; max-width: 360px; }
    h2 { font-size: 24px; margin: 0; }
    .muted { margin: 4px 0 24px; }
    .submit { height: 44px; margin-top: 8px; }
    .error { background: var(--app-red-soft); color: var(--app-red); padding: 10px 12px; border-radius: 8px; margin-bottom: 8px; font-size: 13px; }
    .offline-note { display: flex; gap: 8px; align-items: flex-start; background: var(--app-amber-soft); color: var(--app-amber);
      padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
    @media (max-width: 860px) { .wrap { grid-template-columns: 1fr; } .brand { padding: 28px; } .crate { display: none; } .crate-note { display: none; } }
  `,
})
export class LoginPage {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  settings = inject(SettingsService);
  net = inject(ConnectivityService);

  // A crate of 24 caps; two red ones for the "every crate comes back" story.
  caps = Array.from({ length: 24 }, (_, i) => i === 7 || i === 16);
  show = signal(false);
  busy = signal(false);
  error = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  async submit() {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { email, password } = this.form.getRawValue();
      const s = await this.auth.login(email, password);
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
      await this.router.navigateByUrl(s.user.mustChangePassword ? '/change-password' : returnUrl);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
