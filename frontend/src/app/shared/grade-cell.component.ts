import { Component, computed, input } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { Assessment, Grade } from '../core/models';
import { cellView } from '../core/stats';
import { TONE_ICONS } from './icons';

/** Uma nota com cor + ícone + texto (nunca só cor). */
@Component({
  selector: 'app-grade-cell',
  imports: [FaIconComponent],
  template: `
    @if (view().tone !== 'none') {
      <span class="cell tone-{{ view().tone }}" [title]="view().title">
        @if (icon(); as i) {
          <fa-icon class="icon" [icon]="i" aria-hidden="true" />
        }
        <span class="label">{{ view().label }}</span>
      </span>
    }
  `,
})
export class GradeCellComponent {
  readonly assessment = input.required<Assessment>();
  readonly grade = input<Grade | null | undefined>(null);

  protected readonly view = computed(() => cellView(this.assessment(), this.grade()));
  protected readonly icon = computed(() => TONE_ICONS[this.view().tone]);
}
