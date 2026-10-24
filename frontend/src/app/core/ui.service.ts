import { effect, Injectable, signal } from '@angular/core';
import { storage } from './storage';

export type Theme = 'dark' | 'light';

/** Preferências de exibição: tema, modo TV, privacidade e média de aprovação. */
@Injectable({ providedIn: 'root' })
export class UiService {
  readonly theme = signal<Theme>((storage.get('notas.theme') as Theme) || 'dark');
  readonly tvMode = signal(storage.get('notas.tv') === '1');
  readonly shortNames = signal(storage.get('notas.shortNames') === '1');
  readonly passingGrade = signal(Number(storage.get('notas.passing')) || 6);

  constructor() {
    effect(() => {
      const root = document.documentElement;
      root.dataset['theme'] = this.theme();
      root.classList.toggle('tv', this.tvMode());
      storage.set('notas.theme', this.theme());
      storage.set('notas.tv', this.tvMode() ? '1' : '0');
      storage.set('notas.shortNames', this.shortNames() ? '1' : '0');
      storage.set('notas.passing', String(this.passingGrade()));
    });
  }

  toggleTheme() {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  toggleTv() {
    const on = !this.tvMode();
    this.tvMode.set(on);
    try {
      if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.();
      if (!on && document.fullscreenElement) document.exitFullscreen?.();
    } catch {
      /* tela cheia é opcional */
    }
  }
}
