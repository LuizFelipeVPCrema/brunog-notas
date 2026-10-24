import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { icons } from '../../shared/icons';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ApiService, apiError } from '../../core/api.service';
import {
  Assessment,
  AssessmentKind,
  Board,
  BoardStudent,
  Grade,
  GradeInput,
  KIND_LABELS,
} from '../../core/models';
import { StudentNamePipe } from '../../shared/pipes';

interface Parsed {
  status: Grade['status'];
  score: number | null;
}

interface AssessmentDraft {
  id: number | null;
  name: string;
  kind: AssessmentKind;
  maxPoints: number | null;
}

/** Converte o que foi digitado na célula: número, F (faltou), A (atestado) ou vazio. */
export function parseCell(text: string): Parsed | null {
  const t = text.trim().toLowerCase();
  if (!t) return { status: 'missing', score: null };
  if (t.startsWith('f') || t === 'nf') return { status: 'absent', score: null };
  if (t.startsWith('a')) return { status: 'excused', score: null };
  const n = Number(t.replace(',', '.'));
  if (Number.isNaN(n) || n < 0 || n > 100) return null;
  return { status: 'graded', score: Math.round(n * 100) / 100 };
}

export function cellText(g: Grade | undefined): string {
  if (!g) return '';
  switch (g.status) {
    case 'absent':
      return 'F';
    case 'excused':
      return 'A';
    case 'missing':
      return '';
    default:
      return g.score === null ? '' : String(g.score).replace('.', ',');
  }
}

@Component({
  selector: 'app-board-editor',
  imports: [FaIconComponent, FormsModule, StudentNamePipe],
  template: `
    <section class="card">
      <header>
        <div>
          <h2>Editar notas</h2>
          <p>
            Digite o número da nota, <strong>F</strong> para “faltou / não fez”, <strong>A</strong> para atestado
            ou deixe vazio para “sem nota”. Toda alteração fica no histórico do aluno.
          </p>
        </div>
        <div class="actions">
          @if (dirtyCount()) {
            <span class="badge tone-partial">{{ dirtyCount() }} alteração(ões)</span>
            <button type="button" (click)="discard()" [disabled]="saving()">Descartar</button>
          }
          <button type="button" class="primary" (click)="save()" [disabled]="!dirtyCount() || saving() || invalidCount() > 0">
            {{ saving() ? 'Salvando…' : 'Salvar notas' }}
          </button>
        </div>
      </header>

      @if (message()) {
        <div class="alert" [class.ok]="messageOk()" role="status">{{ message() }}</div>
      }

      <div class="table-wrap">
        <table class="data editor">
          <thead>
            <tr>
              <th>Aluno</th>
              @for (a of board().assessments; track a.id) {
                <th class="center">{{ a.name }}</th>
              }
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (s of board().students; track s.id) {
              <tr>
                <td class="name">{{ s.name | studentName }}</td>
                @for (a of board().assessments; track a.id) {
                  <td class="center">
                    <input
                      class="grade-input"
                      [class.dirty]="isDirty(s, a)"
                      [class.invalid]="isInvalid(s, a)"
                      [ngModel]="draft(s, a)"
                      (ngModelChange)="setDraft(s, a, $event)"
                      [attr.aria-label]="a.name + ' de ' + s.name"
                      inputmode="decimal"
                    />
                  </td>
                }
                <td>
                  <select [ngModel]="s.situation ?? ''" (ngModelChange)="setSituation(s, $event)" aria-label="Situação no bimestre">
                    <option value="">Normal</option>
                    <option value="Atestado">Atestado</option>
                    <option value="Transferido">Transferido</option>
                    <option value="Desistente">Desistente</option>
                    @if (s.situation && !['Atestado', 'Transferido', 'Desistente'].includes(s.situation)) {
                      <option [value]="s.situation">{{ s.situation }}</option>
                    }
                  </select>
                </td>
                <td class="right row-actions">
                  <button type="button" class="ghost" (click)="rename(s)" title="Corrigir nome"><fa-icon [icon]="i.rename" /></button>
                  <button type="button" class="ghost danger" (click)="remove(s)" title="Tirar do bimestre"><fa-icon [icon]="i.trash" /></button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <form class="add-row" (ngSubmit)="addStudent()">
        <input name="newStudent" placeholder="Nome do novo aluno" [(ngModel)]="newStudent" />
        <button type="submit" [disabled]="!newStudent.trim()"><fa-icon [icon]="i.add" /> Adicionar aluno</button>
      </form>
    </section>

    <section class="card">
      <header>
        <div>
          <h2>Avaliações deste bimestre</h2>
          <p>
            O tipo “Prova do professor” entra no ranking da prova. “Bônus / extra” soma pontos sem
            contar como ponto perdido. A nota final é limitada a {{ board().maxTotal }}.
          </p>
        </div>
      </header>
      <div class="assessments">
        @for (d of assessmentDrafts(); track $index) {
          <div class="a-row">
            <input [(ngModel)]="d.name" placeholder="Nome" aria-label="Nome da avaliação" />
            <select [(ngModel)]="d.kind" aria-label="Tipo">
              @for (k of kinds; track k[0]) {
                <option [value]="k[0]">{{ k[1] }}</option>
              }
            </select>
            <input
              type="number"
              min="0"
              step="0.5"
              [(ngModel)]="d.maxPoints"
              [disabled]="d.kind === 'bonus'"
              placeholder="Vale"
              aria-label="Valor máximo"
            />
            <button type="button" (click)="saveAssessment(d)" [disabled]="!d.name.trim()">
              {{ d.id ? 'Salvar' : 'Criar' }}
            </button>
            @if (d.id) {
              <button type="button" class="ghost danger" (click)="deleteAssessment(d)" title="Excluir avaliação"><fa-icon [icon]="i.trash" /></button>
            }
          </div>
        }
        <button type="button" class="ghost add" (click)="newAssessment()"><fa-icon [icon]="i.add" /> Nova avaliação</button>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: grid;
      gap: 1.25rem;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .alert {
      margin-bottom: 0.75rem;
    }
    .name {
      font-weight: 600;
      white-space: nowrap;
    }
    .grade-input {
      width: 4.6rem;
      text-align: center;
      padding: 0.35rem;
      font-variant-numeric: tabular-nums;
    }
    .grade-input.dirty {
      border-color: var(--warning);
      background: color-mix(in srgb, var(--warning) 14%, var(--surface-2));
    }
    .grade-input.invalid {
      border-color: var(--critical);
      background: color-mix(in srgb, var(--critical) 18%, var(--surface-2));
    }
    .row-actions {
      white-space: nowrap;
    }
    .row-actions button {
      padding: 0.3rem 0.45rem;
    }
    .add-row {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
      flex-wrap: wrap;
    }
    .add-row input {
      flex: 1 1 260px;
      max-width: 420px;
    }
    .assessments {
      display: grid;
      gap: 0.5rem;
    }
    .a-row {
      display: grid;
      grid-template-columns: minmax(10rem, 1fr) 12rem 6rem auto auto;
      gap: 0.5rem;
      align-items: center;
      max-width: 820px;
    }
    .add {
      justify-self: start;
    }
    @media (max-width: 700px) {
      .a-row {
        grid-template-columns: 1fr 1fr;
      }
    }
  `,
})
export class BoardEditorComponent {
  protected readonly i = icons;
  readonly board = input.required<Board>();
  readonly changed = output<void>();

  private readonly api = inject(ApiService);

  protected readonly drafts = signal(new Map<string, string>());
  protected readonly saving = signal(false);
  protected readonly message = signal('');
  protected readonly messageOk = signal(true);
  protected readonly assessmentDrafts = signal<AssessmentDraft[]>([]);
  protected newStudent = '';
  protected readonly kinds = Object.entries(KIND_LABELS) as [AssessmentKind, string][];

  constructor() {
    effect(() => {
      const b = this.board();
      this.drafts.set(new Map());
      this.assessmentDrafts.set(
        b.assessments.map((a) => ({ id: a.id, name: a.name, kind: a.kind, maxPoints: a.maxPoints })),
      );
    });
  }

  private key(s: BoardStudent, a: Assessment) {
    return `${s.id}:${a.id}`;
  }

  draft(s: BoardStudent, a: Assessment): string {
    return this.drafts().get(this.key(s, a)) ?? cellText(s.grades[a.id]);
  }

  setDraft(s: BoardStudent, a: Assessment, value: string) {
    this.drafts.update((m) => new Map(m).set(this.key(s, a), value));
  }

  private changes = computed(() => {
    const b = this.board();
    const list: { input: GradeInput | null; key: string }[] = [];
    for (const [key, text] of this.drafts()) {
      const [sid, aid] = key.split(':').map(Number);
      const s = b.students.find((x) => x.id === sid);
      if (!s) continue;
      if (text.trim() === cellText(s.grades[aid]).trim()) continue;
      const p = parseCell(text);
      list.push({ key, input: p ? { assessmentId: aid, studentId: sid, score: p.score, status: p.status } : null });
    }
    return list;
  });

  protected readonly dirtyCount = computed(() => this.changes().length);
  protected readonly invalidCount = computed(() => this.changes().filter((c) => !c.input).length);

  isDirty(s: BoardStudent, a: Assessment) {
    return this.changes().some((c) => c.key === this.key(s, a));
  }

  isInvalid(s: BoardStudent, a: Assessment) {
    return this.changes().some((c) => c.key === this.key(s, a) && !c.input);
  }

  discard() {
    this.drafts.set(new Map());
  }

  save() {
    const inputs = this.changes()
      .map((c) => c.input)
      .filter((i): i is GradeInput => !!i);
    this.saving.set(true);
    this.api.saveGrades(inputs).subscribe({
      next: () => {
        this.saving.set(false);
        this.flash(`${inputs.length} nota(s) salva(s).`, true);
        this.changed.emit();
      },
      error: (err) => {
        this.saving.set(false);
        this.flash(apiError(err), false);
      },
    });
  }

  setSituation(s: BoardStudent, value: string) {
    this.run(this.api.setSituation(s.id, this.board().term.id, value || null), 'Situação atualizada.');
  }

  rename(s: BoardStudent) {
    const name = prompt('Nome do aluno:', s.name)?.trim();
    if (name && name !== s.name) this.run(this.api.renameStudent(s.id, name), 'Nome atualizado.');
  }

  remove(s: BoardStudent) {
    if (!confirm(`Tirar ${s.name} deste bimestre? As notas dele nesta turma/bimestre serão apagadas.`)) return;
    this.run(this.api.unenroll(s.id, this.board().term.id), 'Aluno removido do bimestre.');
  }

  addStudent() {
    const name = this.newStudent.trim();
    if (!name) return;
    this.run(this.api.addStudent(name, this.board().class.id, this.board().term.id), 'Aluno adicionado.', () => {
      this.newStudent = '';
    });
  }

  newAssessment() {
    this.assessmentDrafts.update((l) => [...l, { id: null, name: '', kind: 'activity', maxPoints: 2 }]);
  }

  saveAssessment(d: AssessmentDraft) {
    const b = this.board();
    const input = {
      classId: b.class.id,
      termId: b.term.id,
      name: d.name.trim(),
      kind: d.kind,
      maxPoints: d.kind === 'bonus' || d.maxPoints === null ? null : Number(d.maxPoints),
    };
    const req: Observable<unknown> = d.id ? this.api.updateAssessment(d.id, input) : this.api.createAssessment(input);
    this.run(req, d.id ? 'Avaliação atualizada.' : 'Avaliação criada.');
  }

  deleteAssessment(d: AssessmentDraft) {
    if (!d.id || !confirm(`Excluir "${d.name}" e todas as notas dela?`)) return;
    this.run(this.api.deleteAssessment(d.id), 'Avaliação excluída.');
  }

  private run(req: Observable<unknown>, ok: string, after?: () => void) {
    req.subscribe({
      next: () => {
        after?.();
        this.flash(ok, true);
        this.changed.emit();
      },
      error: (err) => this.flash(apiError(err), false),
    });
  }

  private flash(msg: string, ok: boolean) {
    this.message.set(msg);
    this.messageOk.set(ok);
    setTimeout(() => this.message() === msg && this.message.set(''), 4000);
  }
}
