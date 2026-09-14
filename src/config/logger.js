/**
 * Winston logger configuration.
 * - Console transport for dev (colorized)
 * - Daily rotating file transports for production
 * - Separates error and combined logs
 */

'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const LOG_DIR = process.env.LOG_DIR || 'logs';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Ensure log directory exists
try {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
} catch (err) {
    // If we can't create the log dir (read-only FS, tests), fall back to console only
    // eslint-disable-next-line no-console
    console.warn(`Could not create log dir "${LOG_DIR}": ${err.message}`);
}

const { combine, timestamp, printf, colorize, errors, json, splat } = winston.format;

// Custom dev format
const devFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}]: ${stack || message}${metaStr}`;
});

// Base format
const baseFormat = combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    splat()
);

// Transports
const transports = [];

if (NODE_ENV === 'production') {
    transports.push(
        new DailyRotateFile({
            filename: path.join(LOG_DIR, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxFiles: '14d',
            maxSize: '20m',
            format: combine(baseFormat, json()),
        }),
        new DailyRotateFile({
            filename: path.join(LOG_DIR, 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: '14d',
            maxSize: '20m',
            format: combine(baseFormat, json()),
        })
    );
} else {
    transports.push(
        new winston.transports.Console({
            format: combine(baseFormat, colorize(), devFormat),
        })
    );
}

const logger = winston.createLogger({
    level: LOG_LEVEL,
    format: baseFormat,
    transports,
    exitOnError: false,
});

// Stream for morgan HTTP logging
logger.stream = {
    write: (message) => logger.info(message.trim()),
};

module.exports = logger;