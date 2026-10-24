import { Component, inject, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { icons } from '../../shared/icons';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, apiError } from '../../core/api.service';
import { ImportSummary, Term } from '../../core/models';
import { TermService } from '../../core/term.service';

@Component({
  selector: 'app-import',
  imports: [FaIconComponent, FormsModule, RouterLink],
  template: `
    <main class="page narrow">
      <div class="page-head">
        <div>
          <h1>Importar planilha</h1>
          <p>Cada aba da planilha vira uma turma. As colunas entre “Alunos” e “Total” viram avaliações.</p>
        </div>
      </div>

      <form class="card form" (ngSubmit)="submit()">
        <div class="row">
          <label class="field">
            Bimestre
            <select name="number" [(ngModel)]="number" required>
              <option [ngValue]="null" disabled>Escolha…</option>
              @for (n of [1, 2, 3, 4]; track n) {
                <option [ngValue]="n">{{ n }}º bimestre</option>
              }
            </select>
          </label>
          <label class="field">
            Ano
            <input name="year" type="number" min="2000" max="2100" [(ngModel)]="year" />
          </label>
        </div>

        <label class="drop" [class.has-file]="file()">
          <input type="file" accept=".xlsx" (change)="pick($event)" />
          @if (file(); as f) {
            <strong><fa-icon class="file-icon" [icon]="i.file" /> {{ f.name }}</strong>
            <span class="muted">{{ (f.size / 1024).toFixed(0) }} KB · clique para trocar</span>
          } @else {
            <fa-icon class="drop-icon" [icon]="i.import" />
            <strong>Clique para escolher a planilha (.xlsx)</strong>
            <span class="muted">Mesmo formato da planilha de notas do bimestre</span>
          }
        </label>

        @if (detected()) {
          <p class="detected"><fa-icon [icon]="i.detected" /> Pelo nome do arquivo, parece ser o <strong>{{ detected() }}</strong>. Confira acima antes de importar.</p>
        }
        @if (number && existing()) {
          <p class="detected warn">
            <fa-icon class="warn-icon" [icon]="i.warning" /> Já existem notas no {{ number }}º bimestre de {{ year }}. Importar vai atualizar esse bimestre.
          </p>
        }

        <ul class="tips muted">
          <li>Reimportar a mesma planilha é seguro: só as notas que mudaram são atualizadas (e ficam no histórico).</li>
          <li>Textos como “Faltou” viram <strong>Não fez</strong>; “Atestado” no Total marca o aluno com atestado.</li>
          <li>Alunos são reconhecidos pelo nome, ignorando acentos — assim a evolução entre bimestres funciona.</li>
        </ul>

        @if (error()) {
          <div class="alert" role="alert">{{ error() }}</div>
        }

        <button class="primary" type="submit" [disabled]="!file() || !number || loading()">
          {{ loading() ? 'Importando…' : number ? 'Importar no ' + number + 'º bimestre de ' + year : 'Escolha o bimestre' }}
        </button>
      </form>

      @if (terms.terms().length) {
        <section class="card">
          <h2>Bimestres cadastrados</h2>
          <p class="muted">Importou no bimestre errado? Corrija o número/ano aqui (as notas vão junto) ou exclua o bimestre.</p>
          <div class="terms">
            @for (t of terms.terms(); track t.id) {
              <div class="term-row">
                <select [ngModel]="t.number" (ngModelChange)="moveTerm(t, +$event, t.year)" aria-label="Número do bimestre">
                  @for (n of [1, 2, 3, 4]; track n) {
                    <option [ngValue]="n">{{ n }}º bimestre</option>
                  }
                </select>
                <input type="number" min="2000" max="2100" [ngModel]="t.year" (change)="moveTerm(t, t.number, +$any($event.target).value)" aria-label="Ano" />
                <button type="button" class="ghost danger" (click)="deleteTerm(t)"><fa-icon [icon]="i.trash" /> Excluir</button>
              </div>
            }
          </div>
          @if (termMessage()) {
            <div class="alert" [class.ok]="termOk()">{{ termMessage() }}</div>
          }
        </section>
      }

      @if (summary(); as s) {
        <section class="card">
          <div class="alert ok">
            Importado para o {{ s.term.number }}º bimestre de {{ s.term.year }}: {{ s.students }} alunos
            ({{ s.newStudents }} novos), {{ s.gradesChanged }} notas novas ou alteradas.
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Turma</th>
                  <th class="right">Alunos</th>
                  <th>Avaliações</th>
                  <th>Avisos</th>
                </tr>
              </thead>
              <tbody>
                @for (c of s.classes; track c.name) {
                  <tr>
                    <td><strong>{{ c.name }}</strong></td>
                    <td class="right">{{ c.students }}</td>
                    <td class="muted">{{ c.assessments.join(', ') }}</td>
                    <td>
                      @for (w of c.warnings; track $index) {
                        <div class="warn"><fa-icon class="warn-icon" [icon]="i.warning" /> {{ w }}</div>
                      } @empty {
                        <span class="muted">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p><a routerLink="/turmas">Ver as turmas <fa-icon [icon]="i.forward" /></a></p>
        </section>
      }
    </main>
  `,
  styles: `
    .narrow {
      max-width: 980px;
    }
    .form {
      display: grid;
      gap: 1rem;
    }
    .row {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .drop {
      display: grid;
      gap: 0.3rem;
      place-items: center;
      text-align: center;
      padding: 2rem 1rem;
      border: 2px dashed var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      background: var(--surface-2);
    }
    .drop:hover,
    .drop.has-file {
      border-color: var(--accent);
    }
    .drop input {
      display: none;
    }
    .tips {
      margin: 0;
      padding-left: 1.2rem;
      font-size: 0.9rem;
    }
    .warn {
      font-size: 0.85rem;
    }
    .detected {
      margin: 0;
    }
    .warn-icon {
      color: var(--warning);
    }
    .drop-icon,
    .file-icon {
      color: var(--good);
    }
    .drop-icon {
      font-size: 2rem;
    }
    .terms {
      display: grid;
      gap: 0.5rem;
      margin: 0.75rem 0;
    }
    .term-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .term-row input {
      width: 7rem;
    }
    button {
      justify-self: start;
    }
  `,
})
export class ImportPage {
  protected readonly i = icons;
  private readonly api = inject(ApiService);
  protected readonly terms = inject(TermService);

  // Sem valor padrão: o bimestre vem do nome do arquivo ou é escolhido pelo professor.
  protected number: number | null = null;
  protected year = new Date().getFullYear();
  protected readonly file = signal<File | null>(null);
  protected readonly detected = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly summary = signal<ImportSummary | null>(null);
  protected readonly termMessage = signal('');
  protected readonly termOk = signal(true);

  protected existing(): boolean {
    return this.terms.terms().some((t) => t.number === this.number && t.year === this.year);
  }

  pick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    this.file.set(f);
    this.summary.set(null);
    this.error.set('');
    this.detected.set('');
    const guess = f ? guessTerm(f.name) : null;
    if (guess?.number) this.number = guess.number;
    if (guess?.year) this.year = guess.year;
    if (guess?.number) this.detected.set(`${guess.number}º bimestre de ${guess.year ?? this.year}`);
  }

  moveTerm(t: Term, number: number, year: number) {
    if (number === t.number && year === t.year) return;
    this.api.updateTerm(t.id, year, number).subscribe({
      next: () => {
        this.termOk.set(true);
        this.termMessage.set(`Bimestre movido para ${number}º de ${year}.`);
        this.terms.reload();
      },
      error: (err) => {
        this.termOk.set(false);
        this.termMessage.set(apiError(err));
        this.terms.reload();
      },
    });
  }

  deleteTerm(t: Term) {
    if (!confirm(`Excluir o ${t.number}º bimestre de ${t.year} e TODAS as notas dele?`)) return;
    this.api.deleteTerm(t.id).subscribe({
      next: () => {
        this.termOk.set(true);
        this.termMessage.set('Bimestre excluído.');
        this.terms.reload();
      },
      error: (err) => {
        this.termOk.set(false);
        this.termMessage.set(apiError(err));
      },
    });
  }

  submit() {
    const f = this.file();
    if (!f || !this.number) return;
    this.loading.set(true);
    this.error.set('');
    this.api.importSheet(f, this.year, this.number).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.loading.set(false);
        this.terms.reload();
        this.terms.select(s.term.id);
      },
      error: (err) => {
        this.error.set(apiError(err));
        this.loading.set(false);
      },
    });
  }
}

/** "Notas 3° Bim João 2026.xlsx" -> { number: 3, year: 2026 } */
export function guessTerm(filename: string): { number: number | null; year: number | null } {
  const name = filename.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const n = name.match(/([1-4])[\s_-]*[°ºo.]?[\s_-]*bim/i);
  const y = name.match(/(20\d{2})/);
  return { number: n ? Number(n[1]) : null, year: y ? Number(y[1]) : null };
}
