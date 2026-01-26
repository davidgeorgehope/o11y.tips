import { config } from '../config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m',
};

function getLogLevel(): number {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (level && level in LOG_LEVELS) {
    return LOG_LEVELS[level];
  }
  return config.server.nodeEnv === 'production' ? LOG_LEVELS.info : LOG_LEVELS.debug;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, context: string, message: string, data?: unknown): string {
  const timestamp = formatTimestamp();
  const color = COLORS[level];
  const reset = COLORS.reset;

  let output = `${color}[${timestamp}] [${level.toUpperCase()}] [${context}]${reset} ${message}`;

  if (data !== undefined) {
    if (data instanceof Error) {
      output += `\n${data.stack || data.message}`;
    } else if (typeof data === 'object') {
      output += `\n${JSON.stringify(data, null, 2)}`;
    } else {
      output += ` ${data}`;
    }
  }

  return output;
}

class Logger {
  private context: string;
  private minLevel: number;

  constructor(context: string) {
    this.context = context;
    this.minLevel = getLogLevel();
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVELS[level] >= this.minLevel) {
      const output = formatMessage(level, this.context, message, data);
      if (level === 'error') {
        console.error(output);
      } else if (level === 'warn') {
        console.warn(output);
      } else {
        console.log(output);
      }
    }
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`);
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}

export const logger = createLogger('app');
