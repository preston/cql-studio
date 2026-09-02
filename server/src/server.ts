// Author: Preston Lee

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { loadEnv } from './config/env.js';
import { createLogger, logger } from './logger.js';
import { applyPendingMigrations } from './db/migrate.js';
import { mcpRouter } from './mcp/index.js';
import { ollamaProxyRouter } from './ollama/proxy.js';
import { vsacFhirProxyRouter, vsacSiteProxyRouter } from './vsac/proxy.js';
import { createAuthRouter } from './auth/routes.js';
import { createTeamRouter } from './team/routes.js';
import { createActivityRouter, createWorkspaceRouter } from './workspace/routes.js';
import { createUserSettingsRouter } from './user/routes.js';

async function main(): Promise<void> {
  const env = loadEnv();
  createLogger(env);
  const isDev = env.nodeEnv === 'development';

  await applyPendingMigrations(env);

  const app = express();

  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
      optionsSuccessStatus: 200,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      ssoEnabled: true,
    });
  });

  app.use('/', mcpRouter);
  app.use('/api/ollama', ollamaProxyRouter);
  app.use('/api/vsac/fhir', vsacFhirProxyRouter);
  app.use('/api/vsac/site', vsacSiteProxyRouter);
  app.use('/api/auth', createAuthRouter(env));
  app.use('/api/teams', createTeamRouter(env));
  app.use('/api/workspaces', createWorkspaceRouter(env));
  app.use('/api/activity', createActivityRouter(env));
  app.use('/api/users', createUserSettingsRouter(env));

  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const oauthErr = err as Error & { error?: string; error_description?: string };
    const oauthDetail =
      oauthErr.error
        ? `${oauthErr.error}${oauthErr.error_description ? `: ${oauthErr.error_description}` : ''}`
        : '';
    const message = oauthDetail || err?.message || 'Internal server error';
    logger.error(
      {
        method: req.method,
        path: req.path,
        err: isDev ? err : undefined,
        message,
      },
      'Request error'
    );
    if (!res.headersSent) {
      res.status(oauthErr.error === 'access_denied' ? 403 : 500).json({
        error: message,
        ...(oauthErr.error && { oauthError: oauthErr.error }),
        ...(oauthErr.error_description && { oauthErrorDescription: oauthErr.error_description }),
      });
    }
  });

  app.use((req, res) => {
    logger.warn({ method: req.method, path: req.path }, 'Not found');
    res.status(404).json({ error: 'Not found' });
  });

  app.listen(env.port, () => {
    logger.info(
      {
        port: env.port,
        nodeEnv: env.nodeEnv,
        sso: 'enabled',
        uiBaseUrl: env.uiBaseUrl,
        corsOrigin: `${env.corsOrigin} (credentials)`,
      },
      'CQL Studio Server listening'
    );
  });
}

main().catch((err) => {
  // loadEnv may fail before createLogger; ensure the message is visible
  if (logger.level === 'silent') {
    logger.level = 'error';
  }
  logger.error(
    { err: err instanceof Error ? err : undefined, message: err instanceof Error ? err.message : err },
    '[startup] Fatal error'
  );
  process.exit(1);
});
