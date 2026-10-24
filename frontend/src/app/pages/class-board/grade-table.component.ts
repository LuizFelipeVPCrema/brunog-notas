import { Component, computed, inject, input, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { icons } from '../../shared/icons';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Board, BoardStudent } from '../../core/models';
import { cellView, CellTone } from '../../core/stats';
import { TONE_ICONS } from '../../shared/icons';
import { UiService } from '../../core/ui.service';
import { BreakdownComponent } from '../../shared/breakdown.component';
import { GradeCellComponent } from '../../shared/grade-cell.component';
import { ScorePipe, StudentNamePipe } from '../../shared/pipes';

type Situation = 'all' | 'passing' | 'failing' | 'pending' | 'special';
type Condition = 'absent' | 'zero' | 'full' | 'lost';
type SortKey = string; // 'name' | 'total' | 'rank' | 'a<id da avaliação>'

const TONE_ORDER: Record<CellTone, number> = {
  absent: 0, missing: 1, zero: 2, partial: 3, good: 4, full: 5, bonus: 6, excused: 7, none: 8,
};

@Component({
  selector: 'app-grade-table',
  imports: [FaIconComponent, FormsModule, GradeCellComponent, BreakdownComponent, ScorePipe, StudentNamePipe],
  template: `
    <section class="card">
      <header>
        <div>
          <h2>Notas detalhadas</h2>
          <p>Clique em um aluno para ver por que ele ficou com essa nota.</p>
        </div>
        <div class="legend" aria-label="Legenda">
          @for (l of legend; track l.tone) {
            <span><span class="cell tone-{{ l.tone }}"><fa-icon class="icon" [icon]="icon(l.tone)" /></span> {{ l.label }}</span>
          }
        </div>
      </header>

      <div class="filters">
        <label class="field">
          Buscar
          <input type="search" placeholder="Nome do aluno" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <label class="field">
          Situação
          <select [ngModel]="situation()" (ngModelChange)="situation.set($event)">
            <option value="all">Todos</option>
            <option value="passing">Nota ≥ {{ ui.passingGrade() }}</option>
            <option value="failing">Nota &lt; {{ ui.passingGrade() }}</option>
            <option value="pending">Deixou de fazer algo</option>
            <option value="special">Atestado / fora do ranking</option>
          </select>
        </label>
        <label class="field">
          Avaliação
          <select [ngModel]="assessmentId()" (ngModelChange)="assessmentId.set(+$event)">
            <option [value]="0">Qualquer</option>
            @for (a of board().assessments; track a.id) {
              <option [value]="a.id">{{ a.name }}</option>
            }
          </select>
        </label>
        @if (assessmentId()) {
          <label class="field">
            Condição
            <select [ngModel]="condition()" (ngModelChange)="condition.set($event)">
              <option value="absent">Não fez / sem nota</option>
              <option value="zero">Tirou zero</option>
              <option value="lost">Perdeu pontos</option>
              <option value="full">Nota máxima</option>
            </select>
          </label>
        }
        <label class="field range">
          Nota final entre {{ minTotal() }} e {{ maxTotal() }}
          <span class="range-pair">
            <input type="range" min="0" [max]="board().maxTotal" step="0.5" [ngModel]="minTotal()" (ngModelChange)="setMin(+$event)" aria-label="Nota mínima" />
            <input type="range" min="0" [max]="board().maxTotal" step="0.5" [ngModel]="maxTotal()" (ngModelChange)="setMax(+$event)" aria-label="Nota máxima" />
          </span>
        </label>
        @if (filtersActive()) {
          <button type="button" class="ghost" (click)="reset()">Limpar filtros</button>
        }
      </div>

      <p class="count muted">Mostrando {{ rows().length }} de {{ board().students.length }} alunos</p>

      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th class="sortable" (click)="sortBy('name')">Aluno
                @if (arrow('name'); as dir) {
                  <fa-icon class="sort" [icon]="dir === 'desc' ? i.sortDesc : i.sortAsc" />
                }</th>
              @for (a of board().assessments; track a.id) {
                <th class="center sortable" (click)="sortBy('a' + a.id)" [title]="a.name">
                  {{ a.name }}
                @if (arrow('a' + a.id); as dir) {
                  <fa-icon class="sort" [icon]="dir === 'desc' ? i.sortDesc : i.sortAsc" />
                }
                  @if (a.maxPoints && a.kind !== 'bonus') {
                    <div class="th-sub">vale {{ a.maxPoints | score }}</div>
                  } @else if (a.kind === 'bonus') {
                    <div class="th-sub">extra</div>
                  }
                </th>
              }
              <th class="center sortable" (click)="sortBy('total')">Total
                @if (arrow('total'); as dir) {
                  <fa-icon class="sort" [icon]="dir === 'desc' ? i.sortDesc : i.sortAsc" />
                }</th>
              <th class="center sortable" (click)="sortBy('rank')">Pos.
                @if (arrow('rank'); as dir) {
                  <fa-icon class="sort" [icon]="dir === 'desc' ? i.sortDesc : i.sortAsc" />
                }</th>
            </tr>
          </thead>
          <tbody>
            @for (s of rows(); track s.id) {
              <tr class="clickable" [class.open]="expanded() === s.id" (click)="toggle(s.id)">
                <td class="name-cell">
                  <fa-icon class="caret" [icon]="expanded() === s.id ? i.collapse : i.expand" aria-hidden="true" />
                  {{ s.name | studentName: ui.shortNames() }}
                  @if (s.situation) {
                    <span class="badge tone-excused">{{ s.situation }}</span>
                  }
                </td>
                @for (a of board().assessments; track a.id) {
                  <td class="center"><app-grade-cell [assessment]="a" [grade]="s.grades[a.id]" /></td>
                }
                <td class="center">
                  <span class="total" [class.low]="s.total < ui.passingGrade()">{{ s.total | score }}</span>
                </td>
                <td class="center muted">{{ s.rank ? s.rank + 'º' : '–' }}</td>
              </tr>
              @if (expanded() === s.id) {
                <tr class="detail">
                  <td [attr.colspan]="board().assessments.length + 3">
                    <div class="detail-box">
                      <app-breakdown
                        [assessments]="board().assessments"
                        [grades]="s.grades"
                        [total]="s.total"
                        [maxTotal]="board().maxTotal"
                        [situation]="s.situation"
                      />
                      <button type="button" class="primary" (click)="open(s, $event)">Ver evolução do aluno <fa-icon [icon]="i.forward" /></button>
                    </div>
                  </td>
                </tr>
              }
            } @empty {
              <tr><td [attr.colspan]="board().assessments.length + 3" class="empty">Nenhum aluno com esses filtros.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: `
    .filters {
      margin-bottom: 0.5rem;
    }
    .range-pair {
      display: flex;
      gap: 0.5rem;
    }
    .range input {
      width: 110px;
    }
    .count {
      margin: 0.25rem 0 0.5rem;
      font-size: 0.85rem;
    }
    .th-sub {
      font-size: 0.7rem;
      font-weight: 500;
      text-transform: none;
      color: var(--text-muted);
    }
    .name-cell {
      font-weight: 700;
      white-space: nowrap;
    }
    .caret {
      color: var(--text-muted);
      margin-right: 0.3rem;
    }
    .total {
      display: inline-block;
      min-width: 3.2rem;
      padding: 0.2rem 0.5rem;
      border-radius: 8px;
      font-weight: 900;
      font-size: 1.05rem;
      background: color-mix(in srgb, var(--series-1) 20%, var(--surface-1));
    }
    .total.low {
      background: color-mix(in srgb, var(--serious) 25%, var(--surface-1));
    }
    tr.open td {
      background: var(--surface-2);
    }
    tr.detail td {
      background: var(--surface-2);
      padding: 0.25rem 0.75rem 1rem;
    }
    tr.detail:hover td {
      background: var(--surface-2);
    }
    .detail-box {
      display: grid;
      gap: 1rem;
      justify-items: start;
      max-width: 820px;
    }
    .detail-box app-breakdown {
      width: 100%;
    }
  `,
})
export class GradeTableComponent {
  protected readonly i = icons;
  readonly board = input.required<Board>();
  protected readonly ui = inject(UiService);
  private readonly router = inject(Router);

  protected readonly search = signal('');
  protected readonly situation = signal<Situation>('all');
  protected readonly assessmentId = signal(0);
  protected readonly condition = signal<Condition>('absent');
  protected readonly minTotal = signal(0);
  protected readonly maxTotal = signal(10);
  protected readonly sort = signal<{ key: SortKey; desc: boolean }>({ key: 'total', desc: true });
  protected readonly expanded = signal<number | null>(null);

  protected readonly legend: { tone: CellTone; label: string }[] = [
    { tone: 'full', label: 'Nota máxima' },
    { tone: 'partial', label: 'Parcial' },
    { tone: 'zero', label: 'Zero' },
    { tone: 'absent', label: 'Não fez' },
    { tone: 'missing', label: 'Sem nota' },
    { tone: 'excused', label: 'Atestado' },
    { tone: 'bonus', label: 'Extra' },
  ];

  protected readonly filtersActive = computed(
    () =>
      !!this.search() ||
      this.situation() !== 'all' ||
      !!this.assessmentId() ||
      this.minTotal() > 0 ||
      this.maxTotal() < this.board().maxTotal,
  );

  protected readonly rows = computed(() => {
    const b = this.board();
    const q = normalize(this.search());
    const passing = this.ui.passingGrade();
    const aid = this.assessmentId();
    const assessment = b.assessments.find((a) => a.id === aid);
    const cond = this.condition();
    const min = this.minTotal();
    const max = this.maxTotal();

    const list = b.students.filter((s) => {
      if (q && !normalize(s.name).includes(q)) return false;
      if (s.total < min || s.total > max) return false;
      switch (this.situation()) {
        case 'passing':
          if (s.rank === null || s.total < passing) return false;
          break;
        case 'failing':
          if (s.rank === null || s.total >= passing) return false;
          break;
        case 'pending':
          if (!b.assessments.some((a) => ['absent', 'missing'].includes(cellView(a, s.grades[a.id]).tone))) return false;
          break;
        case 'special':
          if (s.rank !== null) return false;
          break;
      }
      if (assessment) {
        const v = cellView(assessment, s.grades[assessment.id]);
        if (cond === 'absent' && !['absent', 'missing'].includes(v.tone)) return false;
        if (cond === 'zero' && v.tone !== 'zero') return false;
        if (cond === 'full' && v.tone !== 'full') return false;
        if (cond === 'lost' && v.lost <= 0) return false;
      }
      return true;
    });

    const { key, desc } = this.sort();
    const dir = desc ? -1 : 1;
    const value = (s: BoardStudent): number | string => {
      if (key === 'name') return normalize(s.name);
      if (key === 'total') return s.rank === null ? -1 : s.total;
      if (key === 'rank') return s.rank ?? 999;
      const a = b.assessments.find((x) => `a${x.id}` === key);
      if (!a) return 0;
      const v = cellView(a, s.grades[a.id]);
      return v.score * 10 + TONE_ORDER[v.tone] / 10;
    };
    return [...list].sort((x, y) => {
      const vx = value(x);
      const vy = value(y);
      const cmp = typeof vx === 'string' ? vx.localeCompare(vy as string) : vx - (vy as number);
      return cmp * dir || normalize(x.name).localeCompare(normalize(y.name));
    });
  });

  sortBy(key: SortKey) {
    this.sort.update((s) =>
      s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'name' && key !== 'rank' },
    );
  }

  arrow(key: string): string {
    const s = this.sort();
    return s.key === key ? (s.desc ? 'desc' : 'asc') : '';
  }

  setMin(v: number) {
    this.minTotal.set(Math.min(v, this.maxTotal()));
  }

  setMax(v: number) {
    this.maxTotal.set(Math.max(v, this.minTotal()));
  }

  reset() {
    this.search.set('');
    this.situation.set('all');
    this.assessmentId.set(0);
    this.minTotal.set(0);
    this.maxTotal.set(this.board().maxTotal);
  }

  toggle(id: number) {
    this.expanded.update((e) => (e === id ? null : id));
  }

  open(s: BoardStudent, ev: Event) {
    ev.stopPropagation();
    this.router.navigate(['/alunos', s.id]);
  }

  icon(t: CellTone) {
    return TONE_ICONS[t]!;
  }
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
