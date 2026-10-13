import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

type Params = Record<string, string | number | boolean | null | undefined>;

/** Thin promise wrapper around HttpClient for the Wholesale API. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  get<T>(path: string, params?: Params): Promise<T> {
    return firstValueFrom(this.http.get<T>(this.base + path, { params: toParams(params) }));
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.base + path, body));
  }
  put<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(this.base + path, body));
  }
  delete(path: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(this.base + path));
  }
}

function toParams(p?: Params): HttpParams {
  let hp = new HttpParams();
  for (const [k, v] of Object.entries(p ?? {})) if (v !== null && v !== undefined && v !== '') hp = hp.set(k, String(v));
  return hp;
}
