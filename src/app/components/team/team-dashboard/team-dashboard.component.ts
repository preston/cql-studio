// Author: Preston Lee

import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { WorkspaceService } from '../../../services/workspace.service';
import { Workspace, WorkspaceActivity } from '../../../models/team.model';

@Component({
  selector: 'app-team-dashboard',
  standalone: true,
  imports: [DatePipe, RouterLink, FormsModule],
  templateUrl: './team-dashboard.component.html',
})
export class TeamDashboardComponent implements OnInit {
  private readonly workspaceService = inject(WorkspaceService);

  readonly activity = signal<WorkspaceActivity[]>([]);
  readonly workspaces = signal<Workspace[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly workspaceFilter = signal('');

  async ngOnInit(): Promise<void> {
    try {
      const [workspaces, activity] = await Promise.all([
        this.workspaceService.list(),
        this.workspaceService.activity(undefined, 50),
      ]);
      this.workspaces.set(workspaces);
      this.activity.set(activity);
    } catch (e) {
      this.error.set((e as Error).message || 'Failed to load activity');
    } finally {
      this.loading.set(false);
    }
  }

  async onFilterChange(workspaceId: string): Promise<void> {
    this.workspaceFilter.set(workspaceId);
    this.loading.set(true);
    this.error.set('');
    try {
      const activity = await this.workspaceService.activity(workspaceId || undefined, 50);
      this.activity.set(activity);
    } catch (e) {
      this.error.set((e as Error).message || 'Failed to load activity');
    } finally {
      this.loading.set(false);
    }
  }

  actorLabel(item: WorkspaceActivity): string {
    return item.actor?.displayName || item.actor?.email || item.actorUserId;
  }
}
