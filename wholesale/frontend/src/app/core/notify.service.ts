import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, ConfirmData } from '../shared/confirm.dialog';
import { errorMessage } from './util';

@Injectable({ providedIn: 'root' })
export class NotifyService {
  private snack = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  success(message: string) { this.snack.open(message, 'OK', { duration: 3000, panelClass: 'snack-success' }); }
  info(message: string) { this.snack.open(message, 'OK', { duration: 4000 }); }
  error(err: unknown) { this.snack.open(errorMessage(err), 'Close', { duration: 7000, panelClass: 'snack-error' }); }

  confirm(data: ConfirmData): Promise<boolean> {
    return firstValueFrom(this.dialog.open(ConfirmDialog, { data, width: '420px' }).afterClosed()).then(r => !!r);
  }
}
