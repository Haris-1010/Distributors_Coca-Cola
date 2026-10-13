import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, from, switchMap, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConnectivityService } from '../offline/connectivity.service';
import { AuthService } from './auth.service';
import { UserRole } from './models';

/** Adds the bearer token, refreshes it once on 401, and tells ConnectivityService about network failures. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const net = inject(ConnectivityService);
  const isApi = req.url.startsWith(environment.apiUrl);
  const isAuthCall = /\/auth\/(login|refresh|logout)$/.test(req.url);

  const withToken = (r: HttpRequest<unknown>) => {
    const t = auth.accessToken;
    return isApi && t && !isAuthCall ? r.clone({ setHeaders: { Authorization: `Bearer ${t}` } }) : r;
  };

  return next(withToken(req)).pipe(
    tap({ next: () => isApi && net.markReachable() }),
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || !isApi) return throwError(() => err);
      if (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504) {
        net.markUnreachable();
        return throwError(() => err);
      }
      if (err.status === 401 && !isAuthCall && auth.hasServerSession()) {
        return from(auth.refresh()).pipe(switchMap(ok => ok ? next(withToken(req)) : throwError(() => err)));
      }
      return throwError(() => err);
    }),
  );
};

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isLoggedIn()) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  if (auth.user()?.mustChangePassword && !state.url.startsWith('/change-password'))
    return router.createUrlTree(['/change-password']);
  return true;
};

/** Route data: { roles: UserRole[] } */
export const roleGuard: CanActivateFn = route => {
  const auth = inject(AuthService);
  const roles = (route.data?.['roles'] as UserRole[] | undefined) ?? [];
  return roles.length === 0 || auth.hasRole(...roles) ? true : inject(Router).createUrlTree(['/']);
};
