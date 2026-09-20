/**
 * Express application setup.
 * Wires middleware, routes, and error handling.
 * Does NOT start the server (that's server.js).
 */

'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const logger = require('./config/logger');
const routes = require('./routes');
const { mountSwagger } = require('./docs/swagger');
const { NotFoundError } = require('./utils/exceptions');
const { generalLimiter } = require('./middleware/rateLimiter');

// ---------------------------------------------------------------------------
// App instance
// ---------------------------------------------------------------------------
const app = express();

// Trust proxy (for rate limiting / IP detection behind reverse proxy)
app.set('trust proxy', 1);

// Security headers
app.use(
    helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        crossOriginEmbedderPolicy: false,
    })
);

// CORS
const corsOrigins = (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim());
app.use(
    cors({
        origin: corsOrigins.includes('*') ? true : corsOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    })
);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Compression
app.use(compression());

// Serve static uploads when using local storage
if ((process.env.UPLOAD_PROVIDER || 'local') === 'local') {
    const path = require('path');
    const staticPrefix = process.env.STATIC_UPLOADS_PREFIX || '/static/uploads';
    const uploadDir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    app.use(
        staticPrefix,
        express.static(uploadDir, {
            maxAge: '7d',
            index: false,
            dotfiles: 'deny',
            setHeaders: (res, filePath) => {
                // Never let browsers sniff our uploads as HTML/JS
                res.setHeader('X-Content-Type-Options', 'nosniff');
                // Force inline display for images, download for everything else
                const ext = path.extname(filePath).toLowerCase();
                const safeInline = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
                if (safeInline) {
                    res.setHeader('Content-Disposition', 'inline');
                } else {
                    res.setHeader('Content-Disposition', 'attachment');
                }
            },
        })
    );
}

// HTTP request logging (skipped in tests)
if (process.env.NODE_ENV !== 'test') {
    app.use(
        morgan(':method :url :status :res[content-length] - :response-time ms', {
            stream: logger.stream,
            skip: (req) => req.path === '/api/health',
        })
    );
}

// ---------------------------------------------------------------------------
// Routes (with global rate limit)
// ---------------------------------------------------------------------------
const API_PREFIX = process.env.API_PREFIX || '/api';
app.use(API_PREFIX, generalLimiter, routes);

// API documentation (Swagger UI)
mountSwagger(app, `${API_PREFIX}/docs`);

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.isOperational) {
        logger.warn(`Operational error: ${err.message}`, {
            code: err.code,
            status: err.statusCode,
        });
    } else {
        logger.error(`Unexpected error: ${err.message}`, { stack: err.stack });
    }

    const statusCode = err.statusCode || 500;
    const isTest = process.env.NODE_ENV === 'test';
    const isDev = process.env.NODE_ENV === 'development';

    const response = {
        success: false,
        message: err.isOperational
            ? err.message
            : isTest || isDev
                ? err.message
                : 'Internal server error',
        ...(err.code && { code: err.code }),
        ...(err.details && { details: err.details }),
        ...((isDev || isTest) && { stack: err.stack }),
    };

    res.status(statusCode).json(response);
});

module.exports = app;