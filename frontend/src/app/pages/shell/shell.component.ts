import { Component, inject, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { icons } from '../../shared/icons';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Student, termLabel } from '../../core/models';
import { TermService } from '../../core/term.service';
import { UiService } from '../../core/ui.service';
import { StudentNamePipe } from '../../shared/pipes';

@Component({
  selector: 'app-shell',
  imports: [FaIconComponent, RouterOutlet, RouterLink, RouterLinkActive, FormsModule, StudentNamePipe],
  template: `
    <header class="top">
      <a class="brand" routerLink="/turmas"><fa-icon [icon]="i.brand" /> <span>Notas da Turma</span></a>

      <nav class="nav">
        <a routerLink="/turmas" routerLinkActive="active"><fa-icon [icon]="i.stats" /> Turmas</a>
        <a routerLink="/importar" routerLinkActive="active" class="no-tv"><fa-icon [icon]="i.import" /> Importar</a>
        <a routerLink="/conta" routerLinkActive="active" class="no-tv"><fa-icon [icon]="i.account" /> Conta</a>
      </nav>

      <div class="search no-tv">
        <input
          type="search"
          placeholder="Buscar aluno…"
          aria-label="Buscar aluno"
          [ngModel]="query()"
          (ngModelChange)="search($event)"
          (keydown.escape)="clearSearch()"
        />
        @if (results().length) {
          <ul class="results" role="listbox">
            @for (s of results(); track s.id) {
              <li>
                <button type="button" class="ghost" (click)="open(s)">
                  {{ s.name | studentName }}
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <div class="controls">
        @if (terms.terms().length) {
          <select
            aria-label="Bimestre"
            [ngModel]="terms.selected()?.id"
            (ngModelChange)="terms.select(+$event)"
          >
            @for (t of terms.terms(); track t.id) {
              <option [value]="t.id">{{ label(t) }}</option>
            }
          </select>
        }
        <button
          type="button"
          [class.active-toggle]="ui.shortNames()"
          (click)="ui.shortNames.set(!ui.shortNames())"
          title="Mostrar só o primeiro nome (bom para projetar na TV)"
        >
          <fa-icon [icon]="ui.shortNames() ? i.hideNames : i.showNames" /> <span class="hide-sm">Nomes curtos</span>
        </button>
        <button type="button" [class.active-toggle]="ui.tvMode()" (click)="ui.toggleTv()" title="Modo TV: letras grandes e tela cheia">
          <fa-icon [icon]="i.tv" /> <span class="hide-sm">{{ ui.tvMode() ? 'Sair do modo TV' : 'Modo TV' }}</span>
        </button>
        <button type="button" (click)="ui.toggleTheme()" [title]="ui.theme() === 'dark' ? 'Tema claro' : 'Tema escuro'">
          <fa-icon [icon]="ui.theme() === 'dark' ? i.light : i.dark" />
        </button>
        <button type="button" class="ghost no-tv" (click)="auth.logout()" title="Sair">
          <fa-icon [icon]="i.logout" /> <span class="hide-sm">Sair</span>
        </button>
      </div>
    </header>

    <router-outlet />
  `,
  styles: `
    .top {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
      padding: 0.6rem 1rem;
      background: color-mix(in srgb, var(--surface-1) 88%, transparent);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--border);
    }
    .brand fa-icon {
      color: var(--accent);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      font-weight: 800;
      font-size: 1.1rem;
      color: var(--text-primary);
      white-space: nowrap;
    }
    .nav {
      display: flex;
      gap: 0.25rem;
    }
    .nav a {
      padding: 0.4rem 0.75rem;
      border-radius: 9px;
      color: var(--text-secondary);
      font-weight: 600;
    }
    .nav a.active,
    .nav a:hover {
      background: var(--surface-2);
      color: var(--text-primary);
    }
    .search {
      position: relative;
      flex: 1 1 200px;
      max-width: 320px;
    }
    .search input {
      width: 100%;
    }
    .results {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      list-style: none;
      margin: 0;
      padding: 0.3rem;
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: var(--shadow);
      max-height: 320px;
      overflow: auto;
    }
    .results button {
      width: 100%;
      justify-content: flex-start;
      font-weight: 500;
    }
    .controls {
      display: flex;
      gap: 0.4rem;
      align-items: center;
      margin-left: auto;
      flex-wrap: wrap;
    }
    .active-toggle {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 20%, var(--surface-2));
    }
    @media (max-width: 900px) {
      .hide-sm {
        display: none;
      }
      .brand span {
        display: none;
      }
    }
  `,
})
export class ShellComponent {
  protected readonly i = icons;
  protected readonly terms = inject(TermService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly results = signal<Student[]>([]);
  private readonly search$ = new Subject<string>();
  protected readonly label = termLabel;

  constructor() {
    this.terms.reload();
    this.search$
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((q) => (q.trim().length >= 2 ? this.api.searchStudents(q) : of([]))),
        takeUntilDestroyed(),
      )
      .subscribe((r) => this.results.set(r));
  }

  search(q: string) {
    this.query.set(q);
    this.search$.next(q);
  }

  clearSearch() {
    this.query.set('');
    this.results.set([]);
    this.search$.next('');
  }

  open(s: Student) {
    this.clearSearch();
    this.router.navigate(['/alunos', s.id]);
  }
}
