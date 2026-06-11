// Author: Preston Lee

import { ApplicationConfig, Injectable, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideMarkdown } from 'ngx-markdown';
import { provideTimeago, TimeagoIntl, TimeagoFormatter, TimeagoCustomFormatter } from 'ngx-timeago';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { routes } from './app.routes';

const timeagoShortStrings = {
  suffixAgo: '',
  suffixFromNow: '',
  seconds: '1m',
  minute: '1m',
  minutes: '%dm',
  hour: '1h',
  hours: '%dh',
  day: '1d',
  days: '%dd',
  month: '1mo',
  months: '%dmo',
  year: '1yr',
  years: '%dyr',
  wordSeparator: ' '
};

@Injectable()
class TimeagoShortIntl extends TimeagoIntl {
  constructor() {
    super();
    this.strings = timeagoShortStrings;
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    provideCharts(withDefaultRegisterables()),
    provideMarkdown(),
    provideTimeago({
      intl: { provide: TimeagoIntl, useClass: TimeagoShortIntl },
      formatter: { provide: TimeagoFormatter, useClass: TimeagoCustomFormatter }
    })
  ]
};
