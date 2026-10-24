import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, apiError } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { User } from '../../core/models';
import { UiService } from '../../core/ui.service';

@Component({
  selector: 'app-account',
  imports: [FormsModule],
  template: `
    <main class="page narrow">
      <div class="page-head">
        <div>
          <h1>Conta e preferências</h1>
          <p>Conectado como <strong>{{ auth.user()?.name }}</strong> ({{ auth.user()?.username }})</p>
        </div>
      </div>

      <section class="card">
        <h2>Preferências</h2>
        <div class="filters">
          <label class="field">
            Média para aprovação
            <input type="number" min="0" max="10" step="0.5" [ngModel]="ui.passingGrade()" (ngModelChange)="ui.passingGrade.set(+$event || 0)" />
          </label>
        </div>
        <p class="muted">Usada para colorir notas abaixo da média e nas estatísticas. Fica salva neste navegador.</p>
      </section>

      <form class="card form" (ngSubmit)="changePassword()">
        <h2>Trocar minha senha</h2>
        <label class="field">
          Senha atual
          <input name="current" type="password" [(ngModel)]="current" autocomplete="current-password" />
        </label>
        <label class="field">
          Nova senha
          <input name="next" type="password" [(ngModel)]="next" autocomplete="new-password" />
        </label>
        <label class="field">
          Repita a nova senha
          <input name="confirm" type="password" [(ngModel)]="confirmPw" autocomplete="new-password" />
        </label>
        @if (pwMessage()) {
          <div class="alert" [class.ok]="pwOk()">{{ pwMessage() }}</div>
        }
        <button type="submit" class="primary" [disabled]="!current || !next">Trocar senha</button>
      </form>

      @if (auth.isAdmin()) {
        <section class="card">
          <h2>Usuários do sistema</h2>
          <p class="muted">Não há cadastro de novos usuários. O administrador pode redefinir a senha do professor.</p>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Usuário</th>
                  <th>Perfil</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (u of users(); track u.id) {
                  <tr>
                    <td>{{ u.name }}</td>
                    <td>{{ u.username }}</td>
                    <td>{{ u.role === 'admin' ? 'Administrador' : 'Professor' }}</td>
                    <td class="right">
                      @if (u.id !== auth.user()?.id) {
                        <button type="button" (click)="reset(u)">Redefinir senha</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (adminMessage()) {
            <div class="alert" [class.ok]="adminOk()">{{ adminMessage() }}</div>
          }
        </section>
      }
    </main>
  `,
  styles: `
    .narrow {
      max-width: 760px;
    }
    .form {
      display: grid;
      gap: 0.9rem;
    }
    .form button {
      justify-self: start;
    }
    .alert {
      margin-top: 0.5rem;
    }
  `,
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  private readonly api = inject(ApiService);

  protected current = '';
  protected next = '';
  protected confirmPw = '';
  protected readonly pwMessage = signal('');
  protected readonly pwOk = signal(false);
  protected readonly users = signal<User[]>([]);
  protected readonly adminMessage = signal('');
  protected readonly adminOk = signal(false);

  constructor() {
    if (this.auth.isAdmin()) this.api.users().subscribe((u) => this.users.set(u));
  }

  changePassword() {
    if (this.next !== this.confirmPw) {
      this.pwOk.set(false);
      this.pwMessage.set('As senhas novas não conferem.');
      return;
    }
    this.api.changePassword(this.current, this.next).subscribe({
      next: () => {
        this.pwOk.set(true);
        this.pwMessage.set('Senha alterada.');
        this.current = this.next = this.confirmPw = '';
      },
      error: (err) => {
        this.pwOk.set(false);
        this.pwMessage.set(apiError(err));
      },
    });
  }

  reset(u: User) {
    const pw = prompt(`Nova senha para ${u.name} (mínimo 8 caracteres):`);
    if (!pw) return;
    this.api.resetPassword(u.id, pw).subscribe({
      next: () => {
        this.adminOk.set(true);
        this.adminMessage.set(`Senha de ${u.name} redefinida.`);
      },
      error: (err) => {
        this.adminOk.set(false);
        this.adminMessage.set(apiError(err));
      },
    });
  }
}
