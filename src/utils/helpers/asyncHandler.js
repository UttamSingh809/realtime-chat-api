/**
 * Wraps an async controller/handler so thrown errors reach Express's
 * error middleware without try/catch in every controller.
 */

'use strict';

const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;