import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { icons } from '../../shared/icons';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { of, catchError, forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { Board, SchoolClass, termLabel } from '../../core/models';
import { classStats } from '../../core/stats';
import { TermService } from '../../core/term.service';
import { UiService } from '../../core/ui.service';
import { BoardEditorComponent } from './board-editor.component';
import { ClassStatsComponent } from './class-stats.component';
import { GradeTableComponent } from './grade-table.component';
import { RankingComponent } from './ranking.component';

type Tab = 'ranking' | 'notas' | 'stats' | 'editar';

@Component({
  selector: 'app-class-board',
  imports: [FaIconComponent, FormsModule, RouterLink, RankingComponent, GradeTableComponent, ClassStatsComponent, BoardEditorComponent],
  template: `
    <main class="page">
      <div class="page-head">
        <div>
          <a routerLink="/turmas" class="back"><fa-icon [icon]="i.back" /> Turmas</a>
          <h1>
            <select class="class-select" [ngModel]="classId()" (ngModelChange)="goTo(+$event)" aria-label="Turma">
              @for (c of classes(); track c.id) {
                <option [value]="c.id">{{ c.name }}</option>
              }
            </select>
          </h1>
          <p>{{ termText() }} · {{ board()?.students?.length ?? 0 }} alunos</p>
        </div>
        <div class="segmented tabs" role="tablist">
          <button role="tab" [class.active]="tab() === 'ranking'" (click)="tab.set('ranking')"><fa-icon [icon]="i.trophy" /> Ranking</button>
          <button role="tab" [class.active]="tab() === 'notas'" (click)="tab.set('notas')"><fa-icon [icon]="i.search" /> Notas detalhadas</button>
          <button role="tab" [class.active]="tab() === 'stats'" (click)="tab.set('stats')"><fa-icon [icon]="i.stats" /> Estatísticas</button>
          <button role="tab" class="no-tv" [class.active]="tab() === 'editar'" (click)="tab.set('editar')"><fa-icon [icon]="i.edit" /> Editar</button>
        </div>
      </div>

      @if (error()) {
        <div class="alert">{{ error() }}</div>
      } @else if (board(); as b) {
        @switch (tab()) {
          @case ('ranking') {
            <app-ranking [board]="b" [previous]="previousMap()" [previousLabel]="previousLabel()" />
          }
          @case ('notas') {
            <app-grade-table [board]="b" />
          }
          @case ('stats') {
            <app-class-stats [board]="b" [previousAverage]="previousAverage()" />
          }
          @case ('editar') {
            <app-board-editor [board]="b" (changed)="reload()" />
          }
        }
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
    .class-select {
      font-size: 1.6rem;
      font-weight: 800;
      background: transparent;
      border: 1px solid transparent;
      padding: 0.1rem 0.3rem;
      margin-left: -0.35rem;
    }
    .class-select:hover {
      border-color: var(--border);
    }
    html.tv .class-select {
      font-size: 2rem;
    }
  `,
})
export class ClassBoardPage {
  protected readonly i = icons;
  readonly classId = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly terms = inject(TermService);
  protected readonly ui = inject(UiService);

  protected readonly tab = signal<Tab>('ranking');
  protected readonly board = signal<Board | null>(null);
  protected readonly previousBoard = signal<Board | null>(null);
  protected readonly classes = signal<SchoolClass[]>([]);
  protected readonly error = signal('');
  private readonly version = signal(0);

  protected readonly termText = computed(() => termLabel(this.terms.selected()));
  protected readonly previousLabel = computed(() => {
    const p = this.terms.previous();
    return p && this.previousBoard() ? termLabel(p) : '';
  });

  protected readonly previousMap = computed(() => {
    const pb = this.previousBoard();
    if (!pb) return null;
    return new Map(pb.students.filter((s) => s.rank !== null).map((s) => [s.id, { total: s.total, exam: s.teacherExam }]));
  });

  protected readonly previousAverage = computed(() => {
    const pb = this.previousBoard();
    return pb && pb.students.length ? classStats(pb, this.ui.passingGrade()).average : null;
  });

  constructor() {
    // A aba de edição não aparece no modo TV.
    effect(() => {
      if (this.ui.tvMode() && this.tab() === 'editar') this.tab.set('ranking');
    });

    effect(() => {
      const term = this.terms.selected();
      if (term) this.api.classes(term.id).subscribe((c) => this.classes.set(c));
    });

    effect(() => {
      const id = Number(this.classId());
      const term = this.terms.selected();
      const prev = this.terms.previous();
      this.version();
      if (!term) return;
      this.error.set('');
      forkJoin({
        board: this.api.board(id, term.id),
        previous: prev ? this.api.board(id, prev.id).pipe(catchError(() => of(null))) : of(null),
      }).subscribe({
        next: ({ board, previous }) => {
          this.board.set(board);
          this.previousBoard.set(previous);
        },
        error: () => this.error.set('Não foi possível carregar esta turma.'),
      });
    });
  }

  reload() {
    this.version.update((v) => v + 1);
  }

  goTo(id: number) {
    this.router.navigate(['/turmas', id]);
  }
}
