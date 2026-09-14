/**
 * Generic Joi validation middleware.
 *
 * Usage:
 *   router.post('/', validate(schema, 'body'), controller)
 *   router.get('/', validate(schema, 'query'), controller)
 *
 * Strips unknown keys, coerces types, and throws ValidationError
 * with a structured `details` array on failure.
 */

'use strict';

const { ValidationError } = require('../utils/exceptions');

/**
 * @param {import('joi').Schema} schema
 * @param {'body'|'query'|'params'} source
 */
function validate(schema, source = 'body') {
    return (req, res, next) => {
        const { value, error } = schema.validate(req[source], {
            abortEarly: false,      // return all errors, not just the first
            stripUnknown: true,     // drop unlisted keys (prevents pollution)
            convert: true,          // allow string → number coercion
        });

        if (error) {
            const details = error.details.map((d) => ({
                path: d.path.join('.'),
                message: d.message,
            }));
            return next(new ValidationError('Validation failed', details));
        }

        // Replace the source with the sanitized value
        req[source] = value;
        next();
    };
}

module.exports = validate;