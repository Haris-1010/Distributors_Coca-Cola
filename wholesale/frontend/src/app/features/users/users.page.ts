import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ROLES, User, UserRole } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { PromptDialog } from '../../shared/dialogs';

const ROLE_HELP: Record<UserRole, string> = {
  SuperAdmin: 'Everything, including other SuperAdmins',
  Admin: 'Everything except SuperAdmin accounts',
  Manager: 'Sales, stock, purchases, returns, reports, discounts & low prices',
  Salesman: 'Sell, view stock, returns, payments and crates',
  Viewer: 'Read-only reports',
};

@Component({
  selector: 'app-user-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ u ? 'Edit user' : 'New user' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" id="userForm" (ngSubmit)="save()">
        <mat-form-field class="full"><mat-label>Full name</mat-label><input matInput formControlName="fullName"></mat-form-field>
        <mat-form-field class="full"><mat-label>Email</mat-label><input matInput type="email" formControlName="email"></mat-form-field>
        @if (!u) {
          <mat-form-field class="full"><mat-label>Temporary password</mat-label><input matInput formControlName="password">
            <mat-hint>8+ characters with a capital, small letter and number. They'll change it at first sign-in.</mat-hint></mat-form-field>
        }
        <mat-form-field class="full"><mat-label>Role</mat-label>
          <mat-select formControlName="role">
            @for (r of roles; track r) { @if (r !== 'SuperAdmin' || auth.hasRole('SuperAdmin')) { <mat-option [value]="r">{{ r }} <small class="muted">— {{ help[r] }}</small></mat-option> } }
          </mat-select></mat-form-field>
        @if (u) { <mat-slide-toggle formControlName="isActive">Active</mat-slide-toggle> }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button form="userForm" [disabled]="form.invalid || busy()">Save</button>
    </mat-dialog-actions>
  `,
})
export class UserDialog {
  u = inject<User | null>(MAT_DIALOG_DATA, { optional: true });
  auth = inject(AuthService);
  private api = inject(ApiService);
  private notify = inject(NotifyService);
  private ref = inject(MatDialogRef<UserDialog, boolean>);
  private fb = inject(FormBuilder);
  roles = ROLES;
  help = ROLE_HELP;
  busy = signal(false);
  form = this.fb.nonNullable.group({
    fullName: [this.u?.fullName ?? '', Validators.required],
    email: [this.u?.email ?? '', [Validators.required, Validators.email]],
    password: ['', this.u ? [] : [Validators.required, Validators.minLength(8)]],
    role: [this.u?.role ?? ('Salesman' as UserRole)],
    isActive: [this.u?.isActive ?? true],
  });

  async save() {
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      if (this.u) await this.api.put(`/users/${this.u.id}`, { fullName: v.fullName, email: v.email, role: v.role, isActive: v.isActive });
      else await this.api.post('/users', { fullName: v.fullName, email: v.email, password: v.password, role: v.role });
      this.notify.success('User saved.');
      this.ref.close(true);
    } catch (e) { this.notify.error(e); } finally { this.busy.set(false); }
  }
}

@Component({
  selector: 'app-users',
  imports: [DatePipe, FormsModule, MatButtonModule, MatMenuModule],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Users</h1><div class="sub">Who can sign in, and what they can do.</div></div>
      <div class="actions"><button mat-flat-button (click)="edit(null)"><span class="material-symbols-outlined">person_add</span> New user</button></div>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>
          @for (u of users(); track u.id) {
            <tr>
              <td><b>{{ u.fullName }}</b></td><td>{{ u.email }}</td>
              <td><span class="chip blue">{{ u.role }}</span></td>
              <td>@if (u.isActive) { <span class="chip green">Active</span> } @else { <span class="chip">Disabled</span> }
                  @if (u.mustChangePassword) { <span class="chip amber">must change password</span> }</td>
              <td>{{ u.lastLoginAt ? (u.lastLoginAt | date: 'dd MMM yyyy, HH:mm') : 'Never' }}</td>
              <td class="right">
                <button mat-icon-button [matMenuTriggerFor]="m" aria-label="User actions"><span class="material-symbols-outlined">more_vert</span></button>
                <mat-menu #m="matMenu">
                  <button mat-menu-item (click)="edit(u)">Edit</button>
                  <button mat-menu-item (click)="reset(u)">Reset password</button>
                  @if (u.id !== auth.user()?.id) { <button mat-menu-item (click)="remove(u)">Delete</button> }
                </mat-menu>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  </div>
  `,
})
export class UsersPage {
  private api = inject(ApiService);
  private dialog = inject(MatDialog);
  private notify = inject(NotifyService);
  auth = inject(AuthService);
  users = signal<User[]>([]);

  ngOnInit() { void this.load(); }
  async load() { try { this.users.set(await this.api.get<User[]>('/users')); } catch (e) { this.notify.error(e); } }

  async edit(u: User | null) {
    if (await firstValueFrom(this.dialog.open(UserDialog, { width: '480px', data: u }).afterClosed())) await this.load();
  }

  async reset(u: User) {
    const pw = await firstValueFrom(this.dialog.open(PromptDialog, {
      width: '440px', data: { title: `Reset password for ${u.fullName}`, label: 'Temporary password', confirmText: 'Reset',
        message: 'They will be signed out everywhere and asked to choose a new password.' },
    }).afterClosed());
    if (!pw) return;
    try { await this.api.post(`/users/${u.id}/reset-password`, { newPassword: pw }); this.notify.success('Password reset.'); await this.load(); }
    catch (e) { this.notify.error(e); }
  }

  async remove(u: User) {
    if (!(await this.notify.confirm({ title: `Delete ${u.fullName}?`, message: 'They will no longer be able to sign in. Their past sales stay on record.', confirmText: 'Delete', danger: true }))) return;
    try { await this.api.delete(`/users/${u.id}`); this.notify.success('User deleted.'); await this.load(); } catch (e) { this.notify.error(e); }
  }
}
