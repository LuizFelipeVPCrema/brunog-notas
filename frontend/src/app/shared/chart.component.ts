import {
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  viewChild,
  untracked,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { UiService } from '../core/ui.service';

Chart.register(...registerables);

/** Lê uma cor definida como variável CSS no :root (muda com o tema). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Cores das séries (slots categóricos validados para daltonismo). */
export function seriesColor(i: number): string {
  return cssVar(`--series-${(i % 8) + 1}`);
}

/**
 * Wrapper fino de Chart.js. Recebe uma função que monta a configuração para
 * que as cores sejam relidas quando o tema muda.
 */
@Component({
  selector: 'app-chart',
  template: `<div class="chart-box" [style.height.px]="height()">
    <canvas #canvas [attr.aria-label]="label()" role="img"></canvas>
  </div>`,
  styles: `
    .chart-box {
      position: relative;
      width: 100%;
    }
  `,
})
export class ChartComponent implements OnDestroy {
  readonly config = input.required<() => ChartConfiguration>();
  readonly height = input(280);
  readonly label = input('');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly ui = inject(UiService);
  private chart?: Chart;

  constructor() {
    effect(() => {
      const build = this.config();
      this.ui.theme();
      this.ui.tvMode();
      const el = this.canvas().nativeElement;
      untracked(() => {
        // Espera o tema ser aplicado ao DOM antes de ler as variáveis CSS.
        requestAnimationFrame(() => {
          this.chart?.destroy();
          const cfg = build();
          Chart.defaults.color = cssVar('--text-secondary');
          Chart.defaults.borderColor = cssVar('--grid');
          Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
          Chart.defaults.font.size = this.ui.tvMode() ? 16 : 12;
          this.chart = new Chart(el, cfg);
        });
      });
    });
  }

  ngOnDestroy() {
    this.chart?.destroy();
  }
}
