// Author: Preston Lee

import { Component, signal, OnInit } from '@angular/core';
import { RouterOutlet, Router, ActivatedRoute } from '@angular/router';

import { FormsModule } from '@angular/forms';
import { NavigationComponent } from './components/navigation/navigation.component';
import { FooterComponent } from './components/footer/footer.component';
import { SettingsService } from './services/settings.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FormsModule, NavigationComponent, FooterComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('CQL Workbench');

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    protected settingsService: SettingsService
  ) {}

  ngOnInit(): void {
    // Check for URL query parameters only on initial load
    // Use snapshot to avoid subscribing to every query parameter change
    const params = this.route.snapshot.queryParams;
    if (params['url']) {
      // If there's a URL parameter, navigate directly to results
      this.router.navigate(['/results'], { queryParams: params });
    }
  }

}
