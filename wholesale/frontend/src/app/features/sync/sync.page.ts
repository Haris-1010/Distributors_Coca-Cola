import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth.service';
import { NotifyService } from '../../core/notify.service';
import { ConnectivityService } from '../../offline/connectivity.service';
import { QueuedOperation } from '../../offline/db';
import { SyncService } from '../../offline/sync.service';

@Component({
  selector: 'app-sync',
  imports: [DatePipe, MatButtonModule],
  template: `
  <div class="page" style="max-width:960px">
    <div class="page-head">
      <div><h1>Sync status</h1><div class="sub">Work saved on this device while offline, and whether it has reached the server.</div></div>
      <div class="actions">
        <button mat-flat-button (click)="syncNow()" [disabled]="!net.online() || sync.syncing() || !auth.hasServerSession()">
          <span class="material-symbols-outlined">sync</span> {{ sync.syncing() ? 'Syncing…' : 'Sync now' }}</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><div class="label">Connection</div><div class="value" [class.neg]="!net.online()" style="font-size:18px">{{ net.online() ? 'Online' : 'Offline' }}</div></div>
      <div class="stat" [class.alert]="sync.pendingCount() > 0"><div class="label">Waiting to upload</div><div class="value">{{ sync.pendingCount() }}</div></div>
      <div class="stat" [class.alert]="sync.rejected().length > 0"><div class="label">Refused by server</div><div class="value">{{ sync.rejected().length }}</div></div>
      <div class="stat"><div class="label">Last sync</div><div class="value" style="font-size:15px">{{ sync.lastSyncAt() ? (sync.lastSyncAt() | date: 'dd MMM, HH:mm:ss') : 'Never' }}</div></div>
    </div>
    @if (sync.lastError()) { <p class="chip red">Last problem: {{ sync.lastError() }}</p> }
    @if (!auth.hasServerSession()) { <p class="chip amber">Signed in offline — sign in again while online to upload.</p> }

    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>#</th><th>When</th><th>What</th><th>Status</th><th></th></tr></thead>
        <tbody>
          @for (op of sync.queue(); track op.id) {
            <tr>
              <td class="num muted">{{ op.seq }}</td>
              <td>{{ op.createdAt | date: 'dd MMM, HH:mm' }}</td>
              <td>{{ op.label }}<div class="small muted">{{ op.type }}</div></td>
              <td>
                @switch (op.status) {
                  @case ('rejected') { <span class="chip red">Refused</span><div class="small neg">{{ op.lastError }}</div> }
                  @case ('error') { <span class="chip amber">Will retry</span><div class="small muted">{{ op.lastError }}</div> }
                  @default { <span class="chip blue">Waiting</span> }
                }
              </td>
              <td class="right">
                @if (op.status === 'rejected') {
                  <button mat-button (click)="sync.retry(op)">Try again</button>
                  <button mat-button class="danger" (click)="discard(op)">Discard</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5"><div class="empty"><span class="material-symbols-outlined">cloud_done</span>Everything is on the server.</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <p class="small muted">Changes upload in the order they were made. Each has its own id, so a dropped connection can never create a duplicate sale.</p>
  </div>
  `,
  styles: `.danger { color: var(--app-red); }`,
})
export class SyncPage {
  sync = inject(SyncService);
  net = inject(ConnectivityService);
  auth = inject(AuthService);
  private notify = inject(NotifyService);

  async syncNow() {
    await this.net.check();
    await this.sync.syncNow();
  }

  async discard(op: QueuedOperation) {
    if (await this.notify.confirm({ title: 'Discard this change?', message: `${op.label}\n\nIt will be removed from this device and never reach the server.`, confirmText: 'Discard', danger: true }))
      await this.sync.discard(op);
  }
}
