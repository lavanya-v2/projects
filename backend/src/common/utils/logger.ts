import { config } from '../../config';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

class Logger {
    private logLevel: LogLevel;
    private isDevelopment: boolean;

    constructor() {
        this.isDevelopment = process.env.NODE_ENV !== 'production';
        this.logLevel = this.parseLogLevel(config.logging.level);
    }

    private parseLogLevel(level: string): LogLevel {
        const upperLevel = level.toUpperCase();
        switch (upperLevel) {
            case 'DEBUG':
                return LogLevel.DEBUG;
            case 'INFO':
                return LogLevel.INFO;
            case 'WARN':
                return LogLevel.WARN;
            case 'ERROR':
                return LogLevel.ERROR;
            default:
                return LogLevel.INFO;
        }
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.logLevel;
    }

    private formatMessage(level: string, message: string, context?: string): string {
        const timestamp = new Date().toISOString();
        const contextStr = context ? `[${context}]` : '';
        return `${timestamp} [${level}]${contextStr} ${message}`;
    }

    private getColor(level: LogLevel): string {
        if (!this.isDevelopment) return '';

        switch (level) {
            case LogLevel.DEBUG:
                return '\x1b[36m'; // Cyan
            case LogLevel.INFO:
                return '\x1b[32m'; // Green
            case LogLevel.WARN:
                return '\x1b[33m'; // Yellow
            case LogLevel.ERROR:
                return '\x1b[31m'; // Red
            default:
                return '';
        }
    }

    private resetColor(): string {
        return this.isDevelopment ? '\x1b[0m' : '';
    }

    debug(message: string, context?: string): void {
        if (this.shouldLog(LogLevel.DEBUG)) {
            const formatted = this.formatMessage('DEBUG', message, context);
            console.log(`${this.getColor(LogLevel.DEBUG)}${formatted}${this.resetColor()}`);
        }
    }

    info(message: string, context?: string): void {
        if (this.shouldLog(LogLevel.INFO)) {
            const formatted = this.formatMessage('INFO', message, context);
            console.log(`${this.getColor(LogLevel.INFO)}${formatted}${this.resetColor()}`);
        }
    }

    warn(message: string, context?: string): void {
        if (this.shouldLog(LogLevel.WARN)) {
            const formatted = this.formatMessage('WARN', message, context);
            console.warn(`${this.getColor(LogLevel.WARN)}${formatted}${this.resetColor()}`);
        }
    }

    error(message: string, error?: Error | string, context?: string): void {
        if (this.shouldLog(LogLevel.ERROR)) {
            const formatted = this.formatMessage('ERROR', message, context);
            console.error(`${this.getColor(LogLevel.ERROR)}${formatted}${this.resetColor()}`);

            if (error) {
                if (error instanceof Error) {
                    console.error(`${this.getColor(LogLevel.ERROR)}Stack: ${error.stack}${this.resetColor()}`);
                } else {
                    console.error(`${this.getColor(LogLevel.ERROR)}Details: ${error}${this.resetColor()}`);
                }
            }
        }
    }
}

export const logger = new Logger();
