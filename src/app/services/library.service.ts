// Author: Preston Lee

import { Injectable } from '@angular/core';
import { BaseService } from './base.service';
import { Library, Parameters, Bundle } from 'fhir/r4';
import { Observable } from 'rxjs';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { SettingsService } from './settings.service';

@Injectable({
	providedIn: 'root'
})
export class LibraryService extends BaseService {

	public static readonly LIBRARY_PATH = '/Library';

	public libraryId: string = '';

	constructor(protected override http: HttpClient, protected settingsService: SettingsService) { 
	  super(http);
	}

	public order: 'asc' | 'desc' = 'asc';
	public pageSize = 10;
	public offset = 0;

	url(): string {
		const baseUrl = this.settingsService.settings().fhirBaseUrl || this.settingsService.getDefaultFhirBaseUrl();
		return baseUrl + LibraryService.LIBRARY_PATH;
	}

	search(searchTerm: string): Observable<Bundle<Library>> {
		return this.http.get<Bundle<Library>>(this.url() + "?title:contains=" + searchTerm, { headers: this.headers() });
	}

	urlFor(id: string) {
		const baseUrl = this.settingsService.settings().fhirBaseUrl || this.settingsService.getDefaultFhirBaseUrl();
		return baseUrl + '/Library/' + id;
	}

	get(id: string) {
		return this.http.get<Library>(this.urlFor(id), { headers: this.headers() });
	}

	getExampleCql(url: string) {
		let headers = new HttpHeaders({ 'Accept': 'text/plain' });
		return this.http.get<string>(url, { headers: headers, responseType: 'text' as 'json' });
	}

	post(Library: Library) {
		return this.http.post<Library>(this.url(), JSON.stringify(Library), { headers: this.headers() });
	}

	put(Library: Library) {
		return this.http.put<Library>(this.urlFor(Library.id!), JSON.stringify(Library), { headers: this.headers() });
	}

	delete(Library: Library) {
		return this.http.delete<Library>(this.urlFor(Library.id!), { headers: this.headers() });
	}

    evaluate(libraryId: string, parameters: Parameters) {
        return this.http.post<Parameters>(this.urlFor(libraryId) + '/$evaluate', JSON.stringify(parameters), { headers: this.headers() });
    }
}
