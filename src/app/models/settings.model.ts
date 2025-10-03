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
    public enableElmTranslation: boolean = true;
    public runnerApiBaseUrl: string = '';
    public fhirBaseUrl: string = '';
    public translationBaseUrl: string = '';

    public static DEFAULT_THEME = ThemeType.AUTOMATIC;
}
