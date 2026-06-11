// Author: Preston Lee

import { Component, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-footer',
  imports: [FormsModule],
  templateUrl: './footer.component.html',

  styleUrl: './footer.component.scss'
})
export class FooterComponent {
  protected readonly settingsService = inject(SettingsService);
}
