import { Component, computed, inject, input, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { icons } from '../../shared/icons';
import { RouterLink } from '@angular/router';
import { Board, BoardStudent } from '../../core/models';
import { examMax } from '../../core/stats';
import { UiService } from '../../core/ui.service';
import { ScorePipe, StudentNamePipe } from '../../shared/pipes';

type Metric = 'total' | 'exam';

interface Row {
  student: BoardStudent;
  position: number;
  value: number;
  delta: number | null;
}

@Component({
  selector: 'app-ranking',
  imports: [FaIconComponent, RouterLink, ScorePipe, StudentNamePipe],
  template: `
    <section class="card">
      <header>
        <div>
          <h2>
            <fa-icon [icon]="metric() === 'total' ? i.trophy : i.exam" class="gold" />
            {{ metric() === 'total' ? 'Ranking da nota final' : 'Ranking da prova bimestral' }}
          </h2>
          <p>
            @if (metric() === 'total') {
              Soma de todas as avaliações (máx. {{ max() | score: 0 }}).
            } @else {
              Só a prova do professor (máx. {{ max() | score }}).
            }
            @if (previousLabel()) {
              Setas comparam com o {{ previousLabel() }}.
            }
          </p>
        </div>
        <div class="segmented" role="tablist" aria-label="Tipo de ranking">
          <button [class.active]="metric() === 'total'" (click)="metric.set('total')">Nota final</button>
          <button [class.active]="metric() === 'exam'" (click)="metric.set('exam')">Prova bimestral</button>
        </div>
      </header>

      @if (rows().length) {
        <div class="podium">
          <!-- A posição do degrau segue a ordem; a medalha segue o ranking (empates). -->
          @for (p of podium(); track p.student.id; let idx = $index) {
            <a class="step step-{{ idx + 1 }}" [routerLink]="['/alunos', p.student.id]">
              <div class="medal"><fa-icon [icon]="i.medal" [class]="medalClass(p.position)" /></div>
              <div class="p-name">{{ p.student.name | studentName: ui.shortNames() }}</div>
              <div class="p-value">{{ p.value | score }}</div>
              <div class="block">{{ p.position }}º</div>
            </a>
          }
        </div>

        <ol class="list">
          @for (r of rows(); track r.student.id) {
            <li>
              <a [routerLink]="['/alunos', r.student.id]" [class.top3]="r.position <= 3">
                <span class="pos num">{{ r.position }}º</span>
                <span class="name">{{ r.student.name | studentName: ui.shortNames() }}</span>
                <span class="bar" aria-hidden="true">
                  <span [style.width.%]="(r.value / max()) * 100" [class.low]="metric() === 'total' && r.value < ui.passingGrade()"></span>
                </span>
                <span class="value num">{{ r.value | score }}</span>
                <span class="delta num">
                  @if (r.delta !== null) {
                    @if (r.delta > 0.001) {
                      <span class="pos" title="Subiu em relação ao bimestre anterior"><fa-icon [icon]="i.up" /> {{ r.delta | score }}</span>
                    } @else if (r.delta < -0.001) {
                      <span class="neg" title="Caiu em relação ao bimestre anterior"><fa-icon [icon]="i.down" /> {{ -r.delta | score }}</span>
                    } @else {
                      <span class="muted"><fa-icon [icon]="i.same" /></span>
                    }
                  }
                </span>
              </a>
            </li>
          }
        </ol>
        @if (unranked().length) {
          <p class="muted foot">
            Fora do ranking ({{ unranked().length }}):
            @for (s of unranked(); track s.id; let last = $last) {
              {{ s.name | studentName: ui.shortNames() }}{{ s.situation ? ' (' + s.situation + ')' : metric() === 'exam' ? ' (sem prova)' : '' }}{{ last ? '' : ', ' }}
            }
          </p>
        }
      } @else {
        <div class="empty">Nenhum aluno com nota para este ranking.</div>
      }
    </section>
  `,
  styles: `
    .podium {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: end;
      gap: 0.75rem;
      max-width: 720px;
      margin: 0.5rem auto 1.5rem;
    }
    .step {
      display: flex;
      flex-direction: column;
      align-items: center;
      color: inherit;
      text-align: center;
      min-width: 0;
    }
    .step-1 {
      order: 2;
    }
    .step-2 {
      order: 1;
    }
    .step-3 {
      order: 3;
    }
    .medal {
      font-size: 2.6rem;
      line-height: 1;
    }
    .step-1 .medal {
      font-size: 3.4rem;
    }
    .p-name {
      font-weight: 800;
      margin-top: 0.3rem;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    .p-value {
      font-size: 1.6rem;
      font-weight: 900;
      margin: 0.1rem 0 0.4rem;
    }
    .block {
      width: 100%;
      border-radius: 12px 12px 4px 4px;
      display: grid;
      place-items: center;
      font-size: 1.6rem;
      font-weight: 900;
      color: #111;
    }
    .step-1 .block {
      height: 130px;
      background: linear-gradient(180deg, var(--gold), color-mix(in srgb, var(--gold) 70%, black));
    }
    .step-2 .block {
      height: 95px;
      background: linear-gradient(180deg, var(--silver), color-mix(in srgb, var(--silver) 70%, black));
    }
    .step-3 .block {
      height: 70px;
      background: linear-gradient(180deg, var(--bronze), color-mix(in srgb, var(--bronze) 70%, black));
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.3rem;
    }
    .list a {
      display: grid;
      grid-template-columns: 3rem minmax(8rem, 16rem) 1fr 3.5rem 4.5rem;
      gap: 0.75rem;
      align-items: center;
      padding: 0.4rem 0.6rem;
      border-radius: 10px;
      color: inherit;
    }
    .list a:hover {
      background: var(--surface-2);
    }
    .list a.top3 {
      background: color-mix(in srgb, var(--gold) 10%, transparent);
    }
    .pos {
      font-weight: 800;
      color: var(--text-secondary);
    }
    .name {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bar {
      height: 12px;
      border-radius: 99px;
      background: var(--surface-3);
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      border-radius: 99px;
      background: var(--series-1);
    }
    .bar span.low {
      background: var(--serious);
    }
    .value {
      font-weight: 800;
      font-size: 1.1rem;
      text-align: right;
    }
    .delta {
      font-size: 0.85rem;
      font-weight: 700;
    }
    .foot {
      margin: 1rem 0 0;
      font-size: 0.9rem;
    }
    @media (max-width: 640px) {
      .list a {
        grid-template-columns: 2.4rem 1fr 3rem 3.6rem;
      }
      .bar {
        display: none;
      }
    }
  `,
})
export class RankingComponent {
  protected readonly i = icons;
  readonly board = input.required<Board>();
  /** Notas do bimestre anterior por aluno, para as setas de evolução. */
  readonly previous = input<Map<number, { total: number; exam: number | null }> | null>(null);
  readonly previousLabel = input('');

  protected readonly ui = inject(UiService);
  protected readonly metric = signal<Metric>('total');

  protected readonly max = computed(() =>
    this.metric() === 'total' ? this.board().maxTotal : examMax(this.board().assessments) || 1,
  );

  protected readonly rows = computed<Row[]>(() => {
    const exam = this.metric() === 'exam';
    const prev = this.previous();
    return this.board()
      .students.filter((s) => (exam ? s.examRank : s.rank) !== null)
      .map((s) => {
        const value = exam ? (s.teacherExam as number) : s.total;
        const p = prev?.get(s.id);
        const before = p ? (exam ? p.exam : p.total) : null;
        return {
          student: s,
          position: (exam ? s.examRank : s.rank) as number,
          value,
          delta: before === null || before === undefined ? null : value - before,
        };
      })
      .sort((a, b) => a.position - b.position || a.student.name.localeCompare(b.student.name));
  });

  protected readonly podium = computed(() => this.rows().slice(0, 3));

  protected readonly unranked = computed(() => {
    const exam = this.metric() === 'exam';
    return this.board().students.filter((s) => (exam ? s.examRank : s.rank) === null);
  });

  protected medalClass(position: number): string {
    return ['gold', 'silver', 'bronze'][position - 1] ?? 'muted';
  }
}
