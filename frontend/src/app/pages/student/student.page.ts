import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { icons } from '../../shared/icons';
import { RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { ApiService } from '../../core/api.service';
import { GradeChange, GradeStatus, StudentHistory, TermResult, termLabel } from '../../core/models';
import { cellView, fmt } from '../../core/stats';
import { TermService } from '../../core/term.service';
import { UiService } from '../../core/ui.service';
import { BreakdownComponent } from '../../shared/breakdown.component';
import { ChartComponent, cssVar } from '../../shared/chart.component';
import { GradeCellComponent } from '../../shared/grade-cell.component';
import { ScorePipe, StudentNamePipe } from '../../shared/pipes';

interface Comparison {
  name: string;
  current: TermResult['breakdown'][number] | null;
  previous: TermResult['breakdown'][number] | null;
  delta: number | null;
}

const STATUS_LABEL: Record<GradeStatus, string> = {
  graded: '',
  absent: 'Não fez',
  excused: 'Atestado',
  missing: 'Sem nota',
};

@Component({
  selector: 'app-student',
  imports: [FaIconComponent, RouterLink, BreakdownComponent, ChartComponent, GradeCellComponent, ScorePipe, StudentNamePipe],
  template: `
    <main class="page">
      @if (history(); as h) {
        <div class="page-head">
          <div>
            @if (current(); as c) {
              <a [routerLink]="['/turmas', c.class.id]" class="back"><fa-icon [icon]="i.back" /> {{ c.class.name }}</a>
            }
            <h1>{{ h.student.name | studentName: ui.shortNames() }}</h1>
            <p>{{ h.terms.length }} bimestre(s) registrado(s)</p>
          </div>
          @if (h.terms.length > 1) {
            <div class="segmented" role="tablist" aria-label="Bimestre">
              @for (t of h.terms; track t.term.id; let idx = $index) {
                <button [class.active]="selectedIndex() === idx" (click)="selectedIndex.set(idx)">{{ label(t) }}</button>
              }
            </div>
          }
        </div>

        @if (current(); as c) {
          <section class="tiles">
            <div class="tile hero">
              <div class="tile-label">Nota final · {{ label(c) }}</div>
              <div class="tile-value">{{ c.total | score }} <span class="muted of">/ {{ h.maxTotal | score: 0 }}</span></div>
              <div class="tile-sub">
                @if (previous(); as p) {
                  @if (c.total - p.total > 0.001) {
                    <span class="pos"><fa-icon [icon]="i.up" /> subiu {{ c.total - p.total | score }}</span>
                  } @else if (c.total - p.total < -0.001) {
                    <span class="neg"><fa-icon [icon]="i.down" /> caiu {{ p.total - c.total | score }}</span>
                  } @else {
                    igual
                  }
                  em relação ao {{ label(p) }}
                } @else {
                  primeiro bimestre registrado
                }
              </div>
            </div>
            <div class="tile">
              <div class="tile-label">Posição na turma</div>
              <div class="tile-value">{{ c.rank ? c.rank + 'º' : '–' }}</div>
              <div class="tile-sub">de {{ c.rankedCount }} alunos</div>
            </div>
            <div class="tile">
              <div class="tile-label">Prova bimestral</div>
              <div class="tile-value">{{ c.teacherExam | score }}</div>
              <div class="tile-sub">{{ c.examRank ? c.examRank + 'º lugar na prova' : 'sem nota de prova' }}</div>
            </div>
            <div class="tile">
              <div class="tile-label">Média da turma</div>
              <div class="tile-value">{{ c.classAverage | score }}</div>
              <div class="tile-sub">
                @if (c.total >= c.classAverage) {
                  <span class="pos">{{ c.total - c.classAverage | score }} acima da média</span>
                } @else {
                  <span class="neg">{{ c.classAverage - c.total | score }} abaixo da média</span>
                }
              </div>
            </div>
          </section>

          <section class="grid-2">
            <div class="card">
              <header>
                <div>
                  <h2>Por que a nota foi {{ c.total | score }}?</h2>
                  <p>Pontos ganhos e perdidos em cada avaliação</p>
                </div>
              </header>
              <app-breakdown
                [assessments]="assessmentsOf(c)"
                [grades]="gradesOf(c)"
                [total]="c.total"
                [maxTotal]="h.maxTotal"
                [situation]="c.situation"
              />
            </div>

            <div class="card">
              <header>
                <div>
                  <h2>Evolução nos bimestres</h2>
                  <p>Nota final do aluno comparada com a turma</p>
                </div>
              </header>
              @if (h.terms.length > 1) {
                <app-chart [config]="evolutionChart()" label="Evolução da nota final" />
              } @else {
                <div class="empty">
                  Só há um bimestre registrado. Importe ou cadastre os bimestres anteriores para ver a evolução.
                </div>
              }
            </div>
          </section>

          @if (previous(); as p) {
            <section class="card">
              <header>
                <div>
                  <h2>Comparação com o {{ label(p) }}</h2>
                  <p>Avaliação por avaliação (pelo nome)</p>
                </div>
              </header>
              <div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Avaliação</th>
                      <th class="center">{{ label(p) }}</th>
                      <th class="center">{{ label(c) }}</th>
                      <th class="right">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of comparison(); track row.name) {
                      <tr>
                        <td><strong>{{ row.name }}</strong></td>
                        <td class="center">
                          @if (row.previous) {
                            <app-grade-cell [assessment]="row.previous.assessment" [grade]="row.previous.grade" />
                          } @else {
                            <span class="muted">não existia</span>
                          }
                        </td>
                        <td class="center">
                          @if (row.current) {
                            <app-grade-cell [assessment]="row.current.assessment" [grade]="row.current.grade" />
                          } @else {
                            <span class="muted">não existe</span>
                          }
                        </td>
                        <td class="right num">
                          @if (row.delta !== null) {
                            @if (row.delta > 0.001) {
                              <span class="pos"><fa-icon [icon]="i.up" /> {{ row.delta | score }}</span>
                            } @else if (row.delta < -0.001) {
                              <span class="neg"><fa-icon [icon]="i.down" /> {{ -row.delta | score }}</span>
                            } @else {
                              <span class="muted"><fa-icon [icon]="i.same" /></span>
                            }
                          }
                        </td>
                      </tr>
                    }
                    <tr class="sum">
                      <td><strong>Nota final</strong></td>
                      <td class="center num"><strong>{{ p.total | score }}</strong></td>
                      <td class="center num"><strong>{{ c.total | score }}</strong></td>
                      <td class="right num">
                        <strong [class.pos]="c.total > p.total" [class.neg]="c.total < p.total">
                          {{ c.total - p.total > 0 ? '+' : '' }}{{ c.total - p.total | score }}
                        </strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          }

          @if (h.terms.length > 1) {
            <section class="grid-2">
              @if (hasExam()) {
                <div class="card">
                  <h2>Prova bimestral em cada bimestre</h2>
                  <app-chart [config]="examChart()" label="Prova bimestral por bimestre" />
                </div>
              }
              <div class="card">
                <h2>Todos os bimestres</h2>
                <div class="table-wrap">
                  <table class="data">
                    <thead>
                      <tr>
                        <th>Bimestre</th>
                        <th>Turma</th>
                        <th class="right">Nota</th>
                        <th class="right">Prova</th>
                        <th class="right">Posição</th>
                        <th class="right">Média turma</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (t of h.terms; track t.term.id; let idx = $index) {
                        <tr class="clickable" (click)="selectedIndex.set(idx)">
                          <td>{{ label(t) }}</td>
                          <td>{{ t.class.name }}</td>
                          <td class="right num"><strong>{{ t.total | score }}</strong></td>
                          <td class="right num">{{ t.teacherExam | score }}</td>
                          <td class="right num">{{ t.rank ? t.rank + 'º/' + t.rankedCount : t.situation ?? '–' }}</td>
                          <td class="right num">{{ t.classAverage | score }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          }

          <details class="card no-tv" (toggle)="historyOpen.set($any($event.target).open)">
            <summary>
              <fa-icon class="caret" [icon]="historyOpen() ? i.collapse : i.expand" />
              <h2>Histórico de alterações de nota</h2>
            </summary>
            @if (changes().length) {
              <div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Bimestre</th>
                      <th>Avaliação</th>
                      <th>De</th>
                      <th>Para</th>
                      <th>Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (ch of changes(); track ch.id) {
                      <tr>
                        <td class="num">{{ ch.changedAt }}</td>
                        <td>{{ termText(ch) }} · {{ ch.class }}</td>
                        <td>{{ ch.assessment }}</td>
                        <td>{{ changeValue(ch.oldScore, ch.oldStatus) }}</td>
                        <td><strong>{{ changeValue(ch.newScore, ch.newStatus) }}</strong></td>
                        <td class="muted">{{ ch.source === 'import' ? 'Planilha' : 'Manual' }}{{ ch.changedBy ? ' · ' + ch.changedBy : '' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">Nenhuma alteração registrada.</p>
            }
          </details>
        }
      } @else if (error()) {
        <div class="alert">{{ error() }}</div>
      } @else {
        <div class="card empty">Carregando…</div>
      }
    </main>
  `,
  styles: `
    .back {
      font-size: 0.9rem;
      font-weight: 600;
    }
    .hero {
      background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, var(--surface-1)), var(--surface-1));
    }
    .hero .tile-value {
      font-size: 2.6rem;
    }
    .of {
      font-size: 1.2rem;
    }
    tr.sum td {
      border-top: 2px solid var(--grid);
    }
    details summary {
      cursor: pointer;
      list-style: none;
    }
    details summary h2 {
      display: inline;
    }
    details summary::-webkit-details-marker {
      display: none;
    }
    .caret {
      color: var(--text-muted);
      margin-right: 0.4rem;
    }
    details[open] summary {
      margin-bottom: 0.9rem;
    }
  `,
})
export class StudentPage {
  protected readonly i = icons;
  readonly studentId = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly terms = inject(TermService);
  protected readonly ui = inject(UiService);

  protected readonly history = signal<StudentHistory | null>(null);
  protected readonly changes = signal<GradeChange[]>([]);
  protected readonly error = signal('');
  protected readonly selectedIndex = signal(0);
  protected readonly historyOpen = signal(false);

  protected readonly current = computed(() => this.history()?.terms[this.selectedIndex()] ?? null);
  protected readonly previous = computed(() =>
    this.selectedIndex() > 0 ? (this.history()?.terms[this.selectedIndex() - 1] ?? null) : null,
  );

  protected readonly comparison = computed<Comparison[]>(() => {
    const c = this.current();
    const p = this.previous();
    if (!c || !p) return [];
    const key = (n: string) => n.trim().toLowerCase();
    const names: string[] = [];
    for (const b of [...p.breakdown, ...c.breakdown]) {
      if (!names.some((n) => key(n) === key(b.assessment.name))) names.push(b.assessment.name);
    }
    return names.map((name) => {
      const cur = c.breakdown.find((b) => key(b.assessment.name) === key(name)) ?? null;
      const prev = p.breakdown.find((b) => key(b.assessment.name) === key(name)) ?? null;
      const score = (b: typeof cur) => (b ? cellView(b.assessment, b.grade).score : null);
      const sc = score(cur);
      const sp = score(prev);
      return { name, current: cur, previous: prev, delta: sc !== null && sp !== null ? sc - sp : null };
    });
  });

  protected readonly evolutionChart = computed(() => {
    const h = this.history();
    const terms = h?.terms ?? [];
    const max = h?.maxTotal ?? 10;
    return (): ChartConfiguration => ({
      type: 'line',
      data: {
        labels: terms.map((t) => termLabel(t.term)),
        datasets: [
          {
            label: 'Nota do aluno',
            data: terms.map((t) => t.total),
            borderColor: cssVar('--series-1'),
            backgroundColor: cssVar('--series-1'),
            borderWidth: 3,
            pointRadius: 6,
            pointHoverRadius: 8,
            pointBorderColor: cssVar('--surface-1'),
            pointBorderWidth: 2,
            tension: 0.25,
          },
          {
            label: 'Média da turma',
            data: terms.map((t) => t.classAverage),
            borderColor: cssVar('--series-2'),
            backgroundColor: cssVar('--series-2'),
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 4,
            tension: 0.25,
          },
          {
            label: 'Melhor da turma',
            data: terms.map((t) => t.classBest),
            borderColor: cssVar('--series-3'),
            backgroundColor: cssVar('--series-3'),
            borderWidth: 2,
            borderDash: [2, 4],
            pointRadius: 4,
            tension: 0.25,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}` } },
        },
        scales: { y: { min: 0, max, grid: { color: cssVar('--grid') } }, x: { grid: { display: false } } },
      },
    });
  });

  protected readonly hasExam = computed(() => !!this.history()?.terms.some((t) => t.teacherExam !== null));

  protected readonly examChart = computed(() => {
    const terms = this.history()?.terms ?? [];
    return (): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: terms.map((t) => termLabel(t.term)),
        datasets: [
          {
            label: 'Prova bimestral',
            data: terms.map((t) => t.teacherExam ?? 0),
            backgroundColor: cssVar('--series-7'),
            borderRadius: 4,
            maxBarThickness: 56,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, grid: { color: cssVar('--grid') } }, x: { grid: { display: false } } },
      },
    });
  });

  constructor() {
    effect(() => {
      const id = Number(this.studentId());
      this.history.set(null);
      this.error.set('');
      this.api.studentHistory(id).subscribe({
        next: (h) => {
          // Abre no bimestre selecionado no topo, se o aluno tiver nota nele.
          const sel = this.terms.selected();
          const idx = h.terms.findIndex((t) => t.term.id === sel?.id);
          this.selectedIndex.set(idx >= 0 ? idx : h.terms.length - 1);
          this.history.set(h);
        },
        error: () => this.error.set('Aluno não encontrado.'),
      });
      this.api.gradeChanges(id).subscribe((c) => this.changes.set(c));
    });
  }

  protected label(t: TermResult) {
    return termLabel(t.term);
  }

  protected termText(ch: GradeChange) {
    return termLabel(ch.term);
  }

  protected assessmentsOf(t: TermResult) {
    return t.breakdown.map((b) => b.assessment);
  }

  protected gradesOf(t: TermResult) {
    return Object.fromEntries(t.breakdown.map((b) => [String(b.assessment.id), b.grade]));
  }

  protected changeValue(score: number | null, status: GradeStatus | null): string {
    if (!status) return '—';
    return status === 'graded' ? fmt(score) : STATUS_LABEL[status];
  }
}
