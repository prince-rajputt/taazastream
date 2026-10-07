import type { LoggerOptions } from 'pino';
import type { AppConfig } from './config';

/**
 * Structured (JSON) logging. Secrets are redacted at the serializer level so that
 * passwords, tokens, cookies and API keys never reach the log output even by accident.
 */
export const REDACT_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'tokenHash',
  'apiKey',
  'serviceRoleKey',
  'anonKey',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.apiKey',
  '*.serviceRoleKey',
  '*.anonKey',
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers.apikey',
  'res.headers["set-cookie"]',
];

export function loggerOptions(config: AppConfig): LoggerOptions {
  const options: LoggerOptions = {
    level: config.isTest ? 'silent' : config.logLevel,
    base: { app: 'taazastream' },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req(req: { method: string; url: string; ip?: string }) {
        // Strip query strings: they may contain capability blobs or (in theory) secrets.
        return { method: req.method, url: req.url.split('?')[0], ip: req.ip };
      },
    },
  };
  if (config.logPretty) {
    options.transport = {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app' },
    };
  }
  return options;
}
