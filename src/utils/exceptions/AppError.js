/**
 * Base application error class.
 * All operational (expected) errors should extend this.
 */

'use strict';

class AppError extends Error {
    /**
     * @param {string} message
     * @param {number} statusCode
     * @param {string} [code] - Optional machine-readable code
     * @param {object} [details] - Optional extra details
     */
    constructor(message, statusCode = 500, code = null, details = null) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

class BadRequestError extends AppError {
    constructor(message = 'Bad Request', code = 'BAD_REQUEST', details = null) {
        super(message, 400, code, details);
    }
}

class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
        super(message, 401, code);
    }
}

class ForbiddenError extends AppError {
    constructor(message = 'Forbidden', code = 'FORBIDDEN') {
        super(message, 403, code);
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Resource not found', code = 'NOT_FOUND') {
        super(message, 404, code);
    }
}

class ConflictError extends AppError {
    constructor(message = 'Conflict', code = 'CONFLICT') {
        super(message, 409, code);
    }
}

class ValidationError extends AppError {
    constructor(message = 'Validation failed', details = null) {
        super(message, 422, 'VALIDATION_ERROR', details);
    }
}

class TooManyRequestsError extends AppError {
    constructor(message = 'Too many requests', code = 'TOO_MANY_REQUESTS') {
        super(message, 429, code);
    }
}

module.exports = {
    AppError,
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    ValidationError,
    TooManyRequestsError,
};