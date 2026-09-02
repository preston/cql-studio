// Author: Preston Lee

export const PINO_LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type PinoLogLevel = (typeof PINO_LOG_LEVELS)[number];

export interface ServerEnv {
  port: number;
  nodeEnv: string;
  logLevel: PinoLogLevel;
  corsOrigin: string;
  /** Public origin of the CQL Studio UI (no trailing slash). Used for post-login redirects. */
  uiBaseUrl: string;
  ssoIssuerUrl: string;
  ssoClientId: string;
  ssoClientSecret: string;
  /** Previous OIDC client secrets accepted during rotation (token exchange fallback). */
  ssoClientSecretPrevious: string[];
  ssoRedirectUrl: string;
  ssoScopes: string;
  /** Primary secret used to sign new cookies. */
  sessionSecret: string;
  /** Verification order: [current, ...previous]. */
  sessionSecrets: string[];
  databaseUrl: string;
}

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  return trimmed;
}

function parseSecretList(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const secret = part.trim();
    if (!secret || seen.has(secret)) {
      continue;
    }
    seen.add(secret);
    out.push(secret);
  }
  return out;
}

function parseLogLevel(raw: string | undefined): PinoLogLevel {
  const level = (raw?.trim() || 'info').toLowerCase();
  if (!(PINO_LOG_LEVELS as readonly string[]).includes(level)) {
    throw new Error(
      `CQL_STUDIO_SERVER_LOG_LEVEL must be one of: ${PINO_LOG_LEVELS.join(', ')} (got "${raw}")`
    );
  }
  return level as PinoLogLevel;
}

export function loadEnv(): ServerEnv {
  const ssoIssuerUrl = required(
    'CQL_STUDIO_SERVER_SSO_ISSUER_URL',
    process.env.CQL_STUDIO_SERVER_SSO_ISSUER_URL
  );
  const databaseUrl = required(
    'CQL_STUDIO_SERVER_DATABASE_URL',
    process.env.CQL_STUDIO_SERVER_DATABASE_URL
  );

  const sessionSecret = required(
    'CQL_STUDIO_SERVER_SESSION_SECRET',
    process.env.CQL_STUDIO_SERVER_SESSION_SECRET
  );
  const previousSessionSecrets = parseSecretList(
    process.env.CQL_STUDIO_SERVER_SESSION_SECRET_PREVIOUS
  ).filter((s) => s !== sessionSecret);

  const ssoClientSecret = required(
    'CQL_STUDIO_SERVER_SSO_CLIENT_SECRET',
    process.env.CQL_STUDIO_SERVER_SSO_CLIENT_SECRET
  );
  const ssoClientSecretPrevious = parseSecretList(
    process.env.CQL_STUDIO_SERVER_SSO_CLIENT_SECRET_PREVIOUS
  ).filter((s) => s !== ssoClientSecret);

  const corsOrigin = process.env.CQL_STUDIO_SERVER_CORS_ORIGIN?.trim() || 'http://localhost:4200';
  const uiBaseUrl = required(
    'CQL_STUDIO_SERVER_UI_BASE_URL',
    process.env.CQL_STUDIO_SERVER_UI_BASE_URL
  ).replace(/\/+$/, '');

  const nodeEnv = process.env.CQL_STUDIO_SERVER_NODE_ENV || 'development';
  if (ssoIssuerUrl.startsWith('http://') && nodeEnv !== 'development') {
    throw new Error(
      'HTTP SSO issuer URLs are only allowed when CQL_STUDIO_SERVER_NODE_ENV=development'
    );
  }

  return {
    port: Number.parseInt(process.env.CQL_STUDIO_SERVER_PORT || '3003', 10),
    nodeEnv,
    logLevel: parseLogLevel(process.env.CQL_STUDIO_SERVER_LOG_LEVEL),
    corsOrigin,
    uiBaseUrl,
    ssoIssuerUrl,
    ssoClientId: required(
      'CQL_STUDIO_SERVER_SSO_CLIENT_ID',
      process.env.CQL_STUDIO_SERVER_SSO_CLIENT_ID
    ),
    ssoClientSecret,
    ssoClientSecretPrevious,
    ssoRedirectUrl: required(
      'CQL_STUDIO_SERVER_SSO_REDIRECT_URL',
      process.env.CQL_STUDIO_SERVER_SSO_REDIRECT_URL
    ),
    ssoScopes: process.env.CQL_STUDIO_SERVER_SSO_SCOPES?.trim() || 'openid profile email',
    sessionSecret,
    sessionSecrets: [sessionSecret, ...previousSessionSecrets],
    databaseUrl,
  };
}
