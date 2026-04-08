// Author: Preston Lee

export enum ThemeType {
    AUTOMATIC = 'automatic',
    LIGHT = 'light',
    DARK = 'dark'
}

export class Settings {
    public experimental: boolean = false;
    public developer: boolean = false;
    public theme_preferred: ThemeType = ThemeType.AUTOMATIC;
    public validateSchema: boolean = false;
    public runnerApiBaseUrl: string = '';
    public fhirBaseUrl: string = '';
    public runnerFhirBaseUrl: string = '';
    public defaultTestResultsIndexUrl: string = '';
    public terminologyBaseUrl: string = '';
    public terminologyBasicAuthUsername: string = '';
    public terminologyBasicAuthPassword: string = '';

    /** FHIR NPM package registry (normative default https://packages.fhir.org). */
    public fhirPackageRegistryBaseUrl: string = '';

    /** VSAC (NLM CTS / vsac.nlm.nih.gov) — UMLS API key auth; VSAC Browser always calls NLM via CQL Studio Server (no CORS). */
    public vsacFhirBaseUrl: string = '';
    public vsacApiUsername: string = 'apikey';
    public vsacApiPassword: string = '';
    
    // AI Settings
    public ollamaBaseUrl: string = '';
    public ollamaModel: string = '';
    public serverBaseUrl: string = '';
    public searxngBaseUrl: string = '';
    public enableAiAssistant: boolean = false;
    public useMCPTools: boolean = false;
    public allowAiWriteOperations: boolean = false;
    public autoApplyCodeEdits: boolean = false;
    public requireDiffPreview: boolean = false;
    public planActSeparateModels: boolean = false;

    public static DEFAULT_THEME = ThemeType.AUTOMATIC;
}
