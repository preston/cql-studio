// Author: Preston Lee

import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-measure-editor',
  imports: [RouterOutlet],
  template: `
    <router-outlet></router-outlet>
  `,

  styles: [`
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
  `]
})
export class MeasureEditorComponent {}
