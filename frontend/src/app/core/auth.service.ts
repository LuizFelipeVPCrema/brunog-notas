import { HttpInterceptorFn } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, tap, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { User } from './models';
import { storage } from './storage';

interface Session {
  token: string;
  expiresAt: string;
  user: User;
}

const KEY = 'notas.session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly session = signal<Session | null>(this.restore());

  readonly user = computed(() => this.session()?.user ?? null);
  readonly isAdmin = computed(() => this.user()?.role === 'admin');

  token(): string | null {
    const s = this.session();
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) {
      this.clear();
      return null;
    }
    return s.token;
  }

  login(username: string, password: string) {
    return this.api.login(username, password).pipe(
      tap((s) => {
        this.session.set(s);
        storage.set(KEY, JSON.stringify(s));
      }),
    );
  }

  logout() {
    this.clear();
    this.router.navigate(['/login']);
  }

  private clear() {
    this.session.set(null);
    storage.remove(KEY);
  }

  private restore(): Session | null {
    try {
      const raw = storage.get(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Session;
      return new Date(s.expiresAt).getTime() > Date.now() ? s : null;
    } catch {
      return null;
    }
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const request = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(request).pipe(
    catchError((err) => {
      if (err?.status === 401 && !req.url.endsWith('/auth/login')) auth.logout();
      return throwError(() => err);
    }),
  );
};

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.token() ? true : inject(Router).createUrlTree(['/login']);
};
