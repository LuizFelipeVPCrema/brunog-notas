import { Component, computed, input } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { Assessment, Grade } from '../core/models';
import { cellView, CellView, fmt } from '../core/stats';
import { TONE_ICONS } from './icons';
import { ScorePipe } from './pipes';

interface Part {
  assessment: Assessment;
  view: CellView;
  max: number;
}

/**
 * Explica a nota final: uma barra com o quanto o aluno ganhou em cada
 * avaliação e a lista do que fez ele perder pontos.
 */
@Component({
  selector: 'app-breakdown',
  imports: [ScorePipe, FaIconComponent],
  template: `
    <div class="bd">
      <div class="bd-head">
        <div>
          <span class="bd-total">{{ total() | score }}</span>
          <span class="bd-of">de {{ maxTotal() | score: 0 }}</span>
        </div>
        @if (situation()) {
          <span class="badge tone-excused">{{ situation() }}</span>
        }
      </div>

      <div class="bd-bar" role="img" [attr.aria-label]="summary()">
        @for (p of parts(); track p.assessment.id) {
          <div class="bd-seg" [style.flex-grow]="p.max" [title]="p.view.title">
            <div class="bd-fill tone-{{ p.view.tone }}" [style.width.%]="pct(p)"></div>
            <span class="bd-seg-label">{{ p.assessment.name }}</span>
          </div>
        }
      </div>

      <ul class="bd-list">
        @for (p of parts(); track p.assessment.id) {
          <li class="bd-item" [class.lost]="p.view.lost > 0">
            <span class="cell tone-{{ p.view.tone }}">
              @if (icon(p); as i) {
                <fa-icon class="icon" [icon]="i" aria-hidden="true" />
              }
              {{ p.view.label }}
            </span>
            <span class="bd-name">{{ p.assessment.name }}</span>
            <span class="bd-points">
              @if (p.view.tone === 'excused') {
                <span class="muted">não conta</span>
              } @else {
                {{ p.view.score | score }} / {{ p.max | score }}
              }
            </span>
            <span class="bd-delta">
              @if (p.view.lost > 0) {
                <span class="neg">−{{ p.view.lost | score }}</span>
              } @else if (p.view.tone !== 'excused') {
                <span class="pos">completo</span>
              }
            </span>
          </li>
        }
        @for (b of bonus(); track b.assessment.id) {
          <li class="bd-item">
            <span class="cell tone-bonus"><fa-icon class="icon" [icon]="bonusIcon" aria-hidden="true" /> {{ b.view.label }}</span>
            <span class="bd-name">{{ b.assessment.name }}</span>
            <span class="bd-points muted">extra</span>
            <span class="bd-delta"><span class="pos">+{{ b.view.score | score }}</span></span>
          </li>
        }
      </ul>

      @if (lostTotal() > 0) {
        <p class="bd-foot">
          Perdeu <strong class="neg">{{ lostTotal() | score }} pontos</strong>.
          @if (biggest(); as b) {
            O que mais pesou: <strong>{{ b.assessment.name }}</strong> ({{ b.view.label }}).
          }
        </p>
      } @else if (parts().length) {
        <p class="bd-foot pos">Fez tudo com nota máxima!</p>
      }
    </div>
  `,
  styles: `
    .bd-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.75rem;
    }
    .bd-total {
      font-size: 3rem;
      font-weight: 800;
      line-height: 1;
    }
    .bd-of {
      color: var(--text-secondary);
      margin-left: 0.4rem;
      font-size: 1.1rem;
    }
    .bd-bar {
      display: flex;
      gap: 2px;
      height: 2.6rem;
      margin-bottom: 1rem;
    }
    .bd-seg {
      position: relative;
      flex-basis: 0;
      background: var(--surface-3);
      border-radius: 6px;
      overflow: hidden;
      min-width: 0;
    }
    .bd-fill {
      height: 100%;
      background: var(--tone-bg);
      border-right: 0;
    }
    .bd-seg-label {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 0.3rem;
    }
    .bd-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.35rem;
    }
    .bd-item {
      display: grid;
      grid-template-columns: 7.5rem 1fr auto 6rem;
      align-items: center;
      gap: 0.75rem;
      padding: 0.4rem 0.6rem;
      border-radius: 8px;
      background: var(--surface-2);
    }
    .bd-item.lost {
      outline: 1px solid color-mix(in srgb, var(--critical) 35%, transparent);
    }
    .bd-name {
      font-weight: 600;
    }
    .bd-points {
      font-variant-numeric: tabular-nums;
      color: var(--text-secondary);
    }
    .bd-delta {
      text-align: right;
      font-weight: 700;
    }
    .bd-foot {
      margin: 0.9rem 0 0;
      color: var(--text-secondary);
    }
    @media (max-width: 560px) {
      .bd-item {
        grid-template-columns: 6.5rem 1fr auto;
      }
      .bd-points {
        display: none;
      }
    }
  `,
})
export class BreakdownComponent {
  readonly assessments = input.required<Assessment[]>();
  readonly grades = input.required<Record<string, Grade | null | undefined>>();
  readonly total = input.required<number>();
  readonly maxTotal = input(10);
  readonly situation = input<string | null>(null);

  protected readonly parts = computed<Part[]>(() =>
    this.assessments()
      .filter((a) => a.kind !== 'bonus')
      .map((a) => ({ assessment: a, view: cellView(a, this.grades()[a.id]), max: a.maxPoints ?? 0 })),
  );

  protected readonly bonus = computed(() =>
    this.assessments()
      .filter((a) => a.kind === 'bonus')
      .map((a) => ({ assessment: a, view: cellView(a, this.grades()[a.id]) }))
      .filter((b) => b.view.tone === 'bonus'),
  );

  protected readonly lostTotal = computed(() => this.parts().reduce((s, p) => s + p.view.lost, 0));

  protected readonly biggest = computed(() => {
    const lost = this.parts().filter((p) => p.view.lost > 0);
    return lost.sort((a, b) => b.view.lost - a.view.lost)[0] ?? null;
  });

  protected readonly summary = computed(() =>
    this.parts()
      .map((p) => p.view.title)
      .join('; '),
  );

  protected pct(p: Part): number {
    if (!p.max) return 0;
    return Math.min(100, (p.view.score / p.max) * 100);
  }

  protected icon(p: Part) {
    return TONE_ICONS[p.view.tone];
  }

  protected readonly bonusIcon = TONE_ICONS.bonus!;

  protected readonly fmt = fmt;
}
