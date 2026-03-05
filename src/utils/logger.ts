/**
 * Logger — Structured logging for norman-ai
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
    : undefined,
  base: { service: 'norman-ai', version: '1.0.0' },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: pino.stdSerializers.err },
});

export default logger;