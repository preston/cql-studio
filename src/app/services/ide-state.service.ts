// Author: Preston Lee

import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class IdeStateService {
  private ideVisibleSubject = new BehaviorSubject<boolean>(false);
  public ideVisible$ = this.ideVisibleSubject.asObservable();

  constructor() { }

  showIDE(): void {
    this.ideVisibleSubject.next(true);
  }

  hideIDE(): void {
    this.ideVisibleSubject.next(false);
  }

  toggleIDE(): void {
    this.ideVisibleSubject.next(!this.ideVisibleSubject.value);
  }

  isIDEVisible(): boolean {
    return this.ideVisibleSubject.value;
  }
}
