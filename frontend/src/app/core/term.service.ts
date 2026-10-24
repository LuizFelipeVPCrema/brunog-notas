import { computed, inject, Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Term } from './models';
import { storage } from './storage';

/** Lista de bimestres e o bimestre selecionado (compartilhado entre as telas). */
@Injectable({ providedIn: 'root' })
export class TermService {
  private readonly api = inject(ApiService);

  readonly terms = signal<Term[]>([]);
  readonly loaded = signal(false);
  private readonly selectedId = signal<number | null>(Number(storage.get('notas.term')) || null);

  readonly selected = computed(() => {
    const list = this.terms();
    return list.find((t) => t.id === this.selectedId()) ?? list[list.length - 1] ?? null;
  });

  /** Bimestre imediatamente anterior ao selecionado, se existir. */
  readonly previous = computed(() => {
    const list = this.terms();
    const i = list.findIndex((t) => t.id === this.selected()?.id);
    return i > 0 ? list[i - 1] : null;
  });

  reload() {
    this.api.terms().subscribe((terms) => {
      this.terms.set(terms);
      this.loaded.set(true);
    });
  }

  select(id: number) {
    this.selectedId.set(id);
    storage.set('notas.term', String(id));
  }
}
