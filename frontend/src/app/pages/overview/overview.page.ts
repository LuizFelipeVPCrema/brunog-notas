import { Component, computed, effect, inject, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { icons } from '../../shared/icons';
import { RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { ApiService } from '../../core/api.service';
import { Board, BoardStudent, termLabel } from '../../core/models';
import { classStats, ClassStats, examMax, mean, ranked } from '../../core/stats';
import { TermService } from '../../core/term.service';
import { UiService } from '../../core/ui.service';
import { ChartComponent, cssVar } from '../../shared/chart.component';
import { ScorePipe, StudentNamePipe, displayName } from '../../shared/pipes';

interface ClassCard {
  board: Board;
  stats: ClassStats;
  top: BoardStudent[];
}

type Metric = 'total' | 'exam';

@Component({
  selector: 'app-overview',
  imports: [FaIconComponent, RouterLink, ChartComponent, ScorePipe, StudentNamePipe],
  template: `
    <main class="page">
      <div class="page-head">
        <div>
          <h1>Visão geral das turmas</h1>
          <p>{{ termText() }}</p>
        </div>
        @if (grades().length > 1) {
          <div class="chips" role="group" aria-label="Filtrar por série">
            <button class="chip" [class.active]="!grade()" (click)="grade.set(null)">Todas</button>
            @for (g of grades(); track g) {
              <button class="chip" [class.active]="grade() === g" (click)="grade.set(g)">
                {{ g }} ano
              </button>
            }
          </div>
        }
      </div>

      @if (terms.loaded() && !terms.terms().length) {
        <div class="card empty">
          <h2>Nenhuma nota cadastrada ainda</h2>
          <p>Importe a planilha do bimestre para começar.</p>
          <a class="btn" routerLink="/importar">Importar planilha</a>
        </div>
      } @else if (loading()) {
        <div class="card empty">Carregando…</div>
      } @else if (cards().length) {
        <section class="tiles">
          <div class="tile">
            <div class="tile-label">Alunos</div>
            <div class="tile-value">{{ totals().count }}</div>
            <div class="tile-sub">{{ cards().length }} turmas</div>
          </div>
          <div class="tile">
            <div class="tile-label">Média geral</div>
            <div class="tile-value">{{ totals().average | score }}</div>
            <div class="tile-sub">de {{ maxTotal() | score: 0 }} pontos</div>
          </div>
          <div class="tile">
            <div class="tile-label">Com nota ≥ {{ ui.passingGrade() }}</div>
            <div class="tile-value">{{ totals().passingPct | score: 0 }}%</div>
            <div class="tile-sub">{{ totals().passing }} alunos</div>
          </div>
          <div class="tile">
            <div class="tile-label">Média na prova bimestral</div>
            <div class="tile-value">{{ totals().examAverage | score }}</div>
            <div class="tile-sub">de {{ totals().examMax | score }} pontos</div>
          </div>
          <div class="tile">
            <div class="tile-label">Notas máximas</div>
            <div class="tile-value">{{ totals().perfect }}</div>
            <div class="tile-sub">alunos com {{ maxTotal() | score: 0 }}</div>
          </div>
        </section>

        <section class="grid-2">
          <div class="card">
            <header>
              <div>
                <h2>Média por turma</h2>
                <p>Nota final média (0 a {{ maxTotal() | score: 0 }})</p>
              </div>
            </header>
            <app-chart [config]="averageChart()" [height]="chartHeight()" label="Média por turma" />
          </div>
          <div class="card">
            <header>
              <div>
                <h2>Alunos acima e abaixo da média {{ ui.passingGrade() }}</h2>
                <p>Quantidade de alunos por turma</p>
              </div>
            </header>
            <app-chart [config]="passChart()" [height]="chartHeight()" label="Aprovação por turma" />
          </div>
        </section>

        <section class="card">
          <header>
            <div>
              <h2><fa-icon class="gold" [icon]="i.trophy" /> Melhores da escola</h2>
              <p>Top 10 entre todas as turmas selecionadas</p>
            </div>
            <div class="segmented" role="tablist">
              <button [class.active]="metric() === 'total'" (click)="metric.set('total')">Nota final</button>
              <button [class.active]="metric() === 'exam'" (click)="metric.set('exam')">Prova bimestral</button>
            </div>
          </header>
          <ol class="top-list">
            @for (t of schoolTop(); track t.student.id) {
              <li>
                <a [routerLink]="['/alunos', t.student.id]">
                  <span class="pos-badge" [class]="'p' + (t.position <= 3 ? t.position : 0)">{{ t.position }}º</span>
                  <span class="name">{{ t.student.name | studentName: ui.shortNames() }}</span>
                  <span class="muted">{{ t.className }}</span>
                  <span class="value num">{{ t.value | score }}</span>
                </a>
              </li>
            }
          </ol>
        </section>

        <section>
          <h2 class="section-title">Turmas</h2>
          <div class="grid-3">
            @for (c of cards(); track c.board.class.id) {
              <a class="card class-card" [routerLink]="['/turmas', c.board.class.id]">
                <div class="cc-head">
                  <h3>{{ c.board.class.name }}</h3>
                  <span class="muted">{{ c.stats.count }} alunos</span>
                </div>
                <div class="cc-stats">
                  <div>
                    <div class="tile-label">Média</div>
                    <div class="cc-value">{{ c.stats.average | score }}</div>
                  </div>
                  <div>
                    <div class="tile-label">≥ {{ ui.passingGrade() }}</div>
                    <div class="cc-value">{{ c.stats.passingPct | score: 0 }}%</div>
                  </div>
                  <div>
                    <div class="tile-label">Prova</div>
                    <div class="cc-value">{{ c.stats.examAverage | score }}</div>
                  </div>
                </div>
                <div class="meter" [title]="'Média ' + (c.stats.average | score)">
                  <div [style.width.%]="(c.stats.average / maxTotal()) * 100"></div>
                </div>
                <div class="cc-top">
                  @for (s of c.top; track s.id) {
                    <span class="badge"><fa-icon [icon]="i.medal" [class]="['gold', 'silver', 'bronze'][$index]" /> {{ s.name | studentName: true }} · {{ s.total | score }}</span>
                  }
                </div>
              </a>
            }
          </div>
        </section>
      } @else {
        <div class="card empty">Nenhuma turma neste bimestre.</div>
      }
    </main>
  `,
  styles: `
    .section-title {
      margin: 0.5rem 0 0.9rem;
    }
    .class-card {
      color: inherit;
      display: grid;
      gap: 0.8rem;
      transition: transform 0.15s, border-color 0.15s;
    }
    .class-card:hover {
      transform: translateY(-2px);
      border-color: var(--accent);
    }
    .cc-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .cc-head h3 {
      font-size: 1.25rem;
    }
    .cc-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.5rem;
    }
    .cc-value {
      font-size: 1.5rem;
      font-weight: 800;
    }
    .meter {
      height: 8px;
      border-radius: 99px;
      background: var(--surface-3);
      overflow: hidden;
    }
    .meter div {
      height: 100%;
      border-radius: 99px;
      background: var(--accent);
    }
    .cc-top {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .top-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
      gap: 0.4rem 1.25rem;
    }
    .top-list a {
      display: grid;
      grid-template-columns: 2.8rem 1fr auto 3.5rem;
      gap: 0.75rem;
      align-items: center;
      padding: 0.45rem 0.6rem;
      border-radius: 10px;
      color: inherit;
      background: var(--surface-2);
    }
    .top-list a:hover {
      background: var(--surface-3);
    }
    .name {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .value {
      font-weight: 800;
      font-size: 1.15rem;
      text-align: right;
    }
    .pos-badge {
      display: inline-grid;
      place-items: center;
      width: 2.3rem;
      height: 2.3rem;
      border-radius: 50%;
      font-weight: 800;
      background: var(--surface-3);
    }
    .pos-badge.p1 {
      background: var(--gold);
      color: #1a1300;
    }
    .pos-badge.p2 {
      background: var(--silver);
      color: #111;
    }
    .pos-badge.p3 {
      background: var(--bronze);
      color: #1a0c00;
    }
  `,
})
export class OverviewPage {
  protected readonly i = icons;
  private readonly api = inject(ApiService);
  protected readonly terms = inject(TermService);
  protected readonly ui = inject(UiService);

  protected readonly boards = signal<Board[]>([]);
  protected readonly loading = signal(false);
  protected readonly grade = signal<string | null>(null);
  protected readonly metric = signal<Metric>('total');

  protected readonly termText = computed(() => termLabel(this.terms.selected()));
  protected readonly maxTotal = computed(() => this.boards()[0]?.maxTotal ?? 10);

  /** Séries disponíveis, deduzidas do começo do nome da turma ("1° A INF" -> "1°"). */
  protected readonly grades = computed(() => {
    const set = new Set(this.boards().map((b) => seriesOf(b.class.name)).filter(Boolean));
    return [...set].sort();
  });

  protected readonly filtered = computed(() => {
    const g = this.grade();
    return this.boards().filter((b) => !g || seriesOf(b.class.name) === g);
  });

  protected readonly cards = computed<ClassCard[]>(() =>
    this.filtered().map((board) => ({
      board,
      stats: classStats(board, this.ui.passingGrade()),
      top: ranked(board.students)
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
        .slice(0, 3),
    })),
  );

  protected readonly totals = computed(() => {
    const all = this.filtered().flatMap((b) => ranked(b.students));
    const totals = all.map((s) => s.total);
    const exams = all.filter((s) => s.teacherExam !== null).map((s) => s.teacherExam as number);
    const passing = totals.filter((t) => t >= this.ui.passingGrade()).length;
    return {
      count: all.length,
      average: mean(totals),
      passing,
      passingPct: totals.length ? (passing / totals.length) * 100 : 0,
      examAverage: exams.length ? mean(exams) : null,
      examMax: Math.max(0, ...this.filtered().map((b) => examMax(b.assessments))),
      perfect: totals.filter((t) => t >= this.maxTotal() - 0.001).length,
    };
  });

  protected readonly schoolTop = computed(() => {
    const exam = this.metric() === 'exam';
    const rows = this.filtered().flatMap((b) =>
      ranked(b.students)
        .filter((s) => !exam || s.teacherExam !== null)
        .map((s) => ({ student: s, className: b.class.name, value: exam ? (s.teacherExam as number) : s.total })),
    );
    rows.sort((a, b) => b.value - a.value);
    let prev = -1;
    let prevPos = 0;
    return rows.slice(0, 10).map((r, i) => {
      const position = Math.abs(r.value - prev) < 0.001 ? prevPos : i + 1;
      prev = r.value;
      prevPos = position;
      return { ...r, position };
    });
  });

  protected readonly chartHeight = computed(() => Math.max(240, this.cards().length * 34 + 60));

  protected readonly averageChart = computed(() => {
    const cards = [...this.cards()].sort((a, b) => b.stats.average - a.stats.average);
    const max = this.maxTotal();
    return (): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: cards.map((c) => c.board.class.name),
        datasets: [
          {
            label: 'Média',
            data: cards.map((c) => Math.round(c.stats.average * 100) / 100),
            backgroundColor: cssVar('--series-1'),
            borderRadius: 4,
            maxBarThickness: 26,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { min: 0, max, grid: { color: cssVar('--grid') } }, y: { grid: { display: false } } },
      },
    });
  });

  protected readonly passChart = computed(() => {
    const cards = this.cards();
    const passing = this.ui.passingGrade();
    return (): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: cards.map((c) => c.board.class.name),
        datasets: [
          {
            label: `Nota ≥ ${passing}`,
            data: cards.map((c) => c.stats.passing),
            backgroundColor: cssVar('--good'),
            borderRadius: 4,
            borderColor: cssVar('--surface-1'),
            borderWidth: { right: 2 },
            maxBarThickness: 26,
          },
          {
            label: `Nota < ${passing}`,
            data: cards.map((c) => c.stats.count - c.stats.passing),
            backgroundColor: cssVar('--serious'),
            borderRadius: 4,
            maxBarThickness: 26,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          x: { stacked: true, grid: { color: cssVar('--grid') }, ticks: { precision: 0 } },
          y: { stacked: true, grid: { display: false } },
        },
      },
    });
  });

  constructor() {
    effect(() => {
      const term = this.terms.selected();
      if (!term) return;
      this.loading.set(true);
      this.api.overview(term.id).subscribe({
        next: (b) => {
          this.boards.set(b);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
    });
  }

  protected readonly displayName = displayName;
}

function seriesOf(name: string): string {
  const m = name.match(/^\s*(\d+)\s*[°ºo]?/);
  return m ? `${m[1]}°` : '';
}
