import { Component, computed, inject, input } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { icons } from '../../shared/icons';
import { ChartConfiguration } from 'chart.js';
import { Board } from '../../core/models';
import { assessmentStats, classStats, examMax, histogram, ranked, round } from '../../core/stats';
import { UiService } from '../../core/ui.service';
import { ChartComponent, cssVar } from '../../shared/chart.component';
import { ScorePipe } from '../../shared/pipes';

@Component({
  selector: 'app-class-stats',
  imports: [FaIconComponent, ChartComponent, ScorePipe],
  template: `
    <section class="tiles">
      <div class="tile">
        <div class="tile-label">Média da turma</div>
        <div class="tile-value">{{ stats().average | score }}</div>
        <div class="tile-sub">
          @if (previousAverage() !== null) {
            @if (stats().average - previousAverage()! >= 0) {
              <span class="pos"><fa-icon [icon]="i.up" /> {{ stats().average - previousAverage()! | score }}</span>
            } @else {
              <span class="neg"><fa-icon [icon]="i.down" /> {{ previousAverage()! - stats().average | score }}</span>
            }
            vs. bimestre anterior
          } @else {
            {{ stats().count }} alunos no ranking
          }
        </div>
      </div>
      <div class="tile">
        <div class="tile-label">Mediana</div>
        <div class="tile-value">{{ stats().median | score }}</div>
        <div class="tile-sub">metade da turma tirou mais que isso</div>
      </div>
      <div class="tile">
        <div class="tile-label">Nota ≥ {{ ui.passingGrade() }}</div>
        <div class="tile-value">{{ stats().passingPct | score: 0 }}%</div>
        <div class="tile-sub">{{ stats().passing }} de {{ stats().count }} alunos</div>
      </div>
      <div class="tile">
        <div class="tile-label">Maior / menor</div>
        <div class="tile-value">{{ stats().best | score }} <span class="muted small">/ {{ stats().worst | score }}</span></div>
        <div class="tile-sub">desvio padrão {{ stats().stdev | score }}</div>
      </div>
      <div class="tile">
        <div class="tile-label">Média da prova bimestral</div>
        <div class="tile-value">{{ stats().examAverage | score }}</div>
        <div class="tile-sub">de {{ examMaxValue() | score }} pontos</div>
      </div>
      <div class="tile">
        <div class="tile-label">Deixaram de fazer algo</div>
        <div class="tile-value">{{ stats().withPending }}</div>
        <div class="tile-sub">alunos com atividade sem nota</div>
      </div>
    </section>

    <section class="grid-2">
      <div class="card">
        <header>
          <div>
            <h2>Distribuição das notas finais</h2>
            <p>Quantos alunos em cada faixa de nota</p>
          </div>
        </header>
        <app-chart [config]="histChart()" label="Distribuição das notas finais" />
      </div>
      <div class="card">
        <header>
          <div>
            <h2>Como a turma foi em cada avaliação</h2>
            <p>Quantidade de alunos por resultado</p>
          </div>
        </header>
        <app-chart [config]="statusChart()" [height]="assessmentChartHeight()" label="Resultado por avaliação" />
      </div>
      <div class="card">
        <header>
          <div>
            <h2>Aproveitamento médio por avaliação</h2>
            <p>Média da turma em % do valor de cada avaliação</p>
          </div>
        </header>
        <app-chart [config]="avgChart()" [height]="assessmentChartHeight()" label="Aproveitamento por avaliação" />
      </div>
      <div class="card">
        <header>
          <div>
            <h2>Notas da prova bimestral</h2>
            <p>Quantos alunos tiraram cada nota</p>
          </div>
        </header>
        <app-chart [config]="examChart()" label="Distribuição da prova bimestral" />
      </div>
    </section>

    <section class="card">
      <h2>Resumo por avaliação</h2>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Avaliação</th>
              <th class="right">Vale</th>
              <th class="right">Média</th>
              <th class="right">Aproveit.</th>
              <th class="right">Nota máx.</th>
              <th class="right">Parcial</th>
              <th class="right">Zero</th>
              <th class="right">Não fez</th>
              <th class="right">Sem nota</th>
            </tr>
          </thead>
          <tbody>
            @for (a of perAssessment(); track a.assessment.id) {
              <tr>
                <td><strong>{{ a.assessment.name }}</strong></td>
                <td class="right num">{{ a.assessment.kind === 'bonus' ? 'extra' : (a.assessment.maxPoints | score) }}</td>
                <td class="right num">{{ a.average | score: 2 }}</td>
                <td class="right num">{{ a.averagePct === null ? '–' : (a.averagePct | score: 0) + '%' }}</td>
                <td class="right num">{{ a.full }}</td>
                <td class="right num">{{ a.partial }}</td>
                <td class="right num">{{ a.zero }}</td>
                <td class="right num">{{ a.absent }}</td>
                <td class="right num">{{ a.missing }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: grid;
      gap: 1.25rem;
    }
    .small {
      font-size: 1.1rem;
    }
  `,
})
export class ClassStatsComponent {
  protected readonly i = icons;
  readonly board = input.required<Board>();
  readonly previousAverage = input<number | null>(null);
  protected readonly ui = inject(UiService);

  protected readonly stats = computed(() => classStats(this.board(), this.ui.passingGrade()));
  protected readonly perAssessment = computed(() => assessmentStats(this.board()));
  protected readonly examMaxValue = computed(() => examMax(this.board().assessments));
  protected readonly assessmentChartHeight = computed(() =>
    Math.max(240, this.board().assessments.length * 44 + 70),
  );

  protected readonly histChart = computed(() => {
    const b = this.board();
    const bins = histogram(ranked(b.students).map((s) => s.total), b.maxTotal);
    const passing = this.ui.passingGrade();
    return (): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: bins.map((_, i) => `${i}–${i + 1}`),
        datasets: [
          {
            label: 'Alunos',
            data: bins,
            backgroundColor: bins.map((_, i) => (i + 1 <= passing ? cssVar('--serious') : cssVar('--series-1'))),
            borderRadius: 4,
            maxBarThickness: 48,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (items) => `Nota entre ${items[0].label}` } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: cssVar('--grid') } },
          x: { grid: { display: false }, title: { display: true, text: `Faixa de nota (laranja = abaixo de ${passing})` } },
        },
      },
    });
  });

  protected readonly statusChart = computed(() => {
    const list = this.perAssessment();
    const series: { key: 'full' | 'partial' | 'zero' | 'absent' | 'missing'; label: string; color: string }[] = [
      { key: 'full', label: 'Nota máxima', color: '--good' },
      { key: 'partial', label: 'Parcial', color: '--warning' },
      { key: 'zero', label: 'Zero', color: '--serious' },
      { key: 'absent', label: 'Não fez', color: '--critical' },
      { key: 'missing', label: 'Sem nota', color: '--text-muted' },
    ];
    const graded = list.filter((a) => a.assessment.kind !== 'bonus');
    return (): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: graded.map((a) => a.assessment.name),
        datasets: series.map((s) => ({
          label: s.label,
          data: graded.map((a) => a[s.key]),
          backgroundColor: cssVar(s.color),
          borderColor: cssVar('--surface-1'),
          borderWidth: { right: 2 },
          maxBarThickness: 30,
        })),
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          x: { stacked: true, ticks: { precision: 0 }, grid: { color: cssVar('--grid') } },
          y: { stacked: true, grid: { display: false } },
        },
      },
    });
  });

  protected readonly avgChart = computed(() => {
    const list = this.perAssessment().filter((a) => a.averagePct !== null);
    return (): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: list.map((a) => a.assessment.name),
        datasets: [
          {
            label: 'Aproveitamento (%)',
            data: list.map((a) => round(a.averagePct ?? 0, 0)),
            backgroundColor: cssVar('--series-1'),
            borderRadius: 4,
            maxBarThickness: 30,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.parsed.x}% do valor da avaliação` } },
        },
        scales: { x: { min: 0, max: 100, grid: { color: cssVar('--grid') } }, y: { grid: { display: false } } },
      },
    });
  });

  protected readonly examChart = computed(() => {
    const exams = ranked(this.board().students)
      .filter((s) => s.teacherExam !== null)
      .map((s) => s.teacherExam as number);
    const counts = new Map<number, number>();
    for (const e of exams) counts.set(e, (counts.get(e) ?? 0) + 1);
    const keys = [...counts.keys()].sort((a, b) => a - b);
    return (): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: keys.map((k) => k.toLocaleString('pt-BR')),
        datasets: [
          {
            label: 'Alunos',
            data: keys.map((k) => counts.get(k) ?? 0),
            backgroundColor: cssVar('--series-7'),
            borderRadius: 4,
            maxBarThickness: 48,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: cssVar('--grid') } },
          x: { grid: { display: false }, title: { display: true, text: 'Nota na prova' } },
        },
      },
    });
  });
}
