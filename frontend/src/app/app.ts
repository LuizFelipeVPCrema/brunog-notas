import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UiService } from './core/ui.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  template: '<router-outlet />',
})
export class App {
  // Instancia cedo para aplicar tema/modo TV salvos antes da primeira tela.
  protected readonly ui = inject(UiService);
}
