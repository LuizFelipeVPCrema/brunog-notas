import { Component, inject, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { icons } from '../../shared/icons';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { apiError } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [FaIconComponent, FormsModule],
  template: `
    <main class="login">
      <form class="card login-card" (ngSubmit)="submit()">
        <div class="logo" aria-hidden="true"><fa-icon [icon]="i.brand" /></div>
        <h1>Notas da Turma</h1>
        <p class="muted">Entre para ver os resultados do bimestre.</p>

        <label class="field">
          Usuário
          <input name="username" [(ngModel)]="username" autocomplete="username" required autofocus />
        </label>
        <label class="field">
          Senha
          <input
            name="password"
            type="password"
            [(ngModel)]="password"
            autocomplete="current-password"
            required
          />
        </label>

        @if (error()) {
          <div class="alert" role="alert">{{ error() }}</div>
        }

        <button class="primary" type="submit" [disabled]="loading() || !username || !password">
          {{ loading() ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>
    </main>
  `,
  styles: `
    .login {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 1rem;
      background:
        radial-gradient(60rem 30rem at 10% -10%, color-mix(in srgb, var(--accent) 25%, transparent), transparent),
        radial-gradient(50rem 30rem at 110% 110%, color-mix(in srgb, var(--series-7) 22%, transparent), transparent),
        var(--page);
    }
    .login-card {
      width: min(100%, 380px);
      display: grid;
      gap: 1rem;
      padding: 2rem;
    }
    .login-card h1 {
      font-size: 1.6rem;
    }
    .login-card p {
      margin: -0.6rem 0 0.4rem;
    }
    .logo {
      font-size: 2.4rem;
      color: var(--accent);
    }
    button {
      justify-content: center;
      padding: 0.7rem;
    }
  `,
})
export class LoginPage {
  protected readonly i = icons;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected username = '';
  protected password = '';
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  submit() {
    this.loading.set(true);
    this.error.set('');
    this.auth.login(this.username.trim(), this.password).subscribe({
      next: () => this.router.navigate(['/']),
      error: (err) => {
        this.error.set(apiError(err));
        this.loading.set(false);
      },
    });
  }
}
