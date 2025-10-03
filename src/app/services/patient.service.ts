// Author: Preston Lee

import { Injectable } from '@angular/core';
import { BaseService } from './base.service';
import { Patient, Bundle, Parameters } from 'fhir/r4';
import { Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { SettingsService } from './settings.service';

@Injectable({
	providedIn: 'root'
})
export class PatientService extends BaseService {

	public static readonly PATIENT_PATH = '/Patient';

	public selectedPatient: Patient | null = null;

	constructor(protected override http: HttpClient, protected settingsService: SettingsService) { 
		super(http);
	}

	url(): string {
		const baseUrl = this.settingsService.settings().fhirBaseUrl || this.settingsService.getDefaultFhirBaseUrl();
		return baseUrl + PatientService.PATIENT_PATH;
	}

	urlFor(id: string) {
		const baseUrl = this.settingsService.settings().fhirBaseUrl || this.settingsService.getDefaultFhirBaseUrl();
		return baseUrl + '/Patient/' + id;
	}

	search(searchTerm: string): Observable<Bundle<Patient>> {
		return this.http.get<Bundle<Patient>>(this.url() + "?name:contains=" + searchTerm, { headers: this.headers() });
	}

	get(id: string) {
		return this.http.get<Patient>(this.urlFor(id), { headers: this.headers() });
	}

	post(patient: Patient) {
		return this.http.post<Patient>(this.url(), JSON.stringify(patient), { headers: this.headers() });
	}

	put(patient: Patient) {
		return this.http.put<Patient>(this.urlFor(patient.id!), JSON.stringify(patient), { headers: this.headers() });
	}

	delete(patient: Patient) {
		return this.http.delete<Patient>(this.urlFor(patient.id!), { headers: this.headers() });
	}

	clearSelection() {
		this.selectedPatient = null;
	}
}
