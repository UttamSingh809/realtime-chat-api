/**
 * Pagination helpers for list endpoints.
 *
 * Two strategies:
 *   - Offset: `page` + `limit`, returns `meta.page`, `meta.totalPages`, etc.
 *   - Cursor: `after`/`before` (an ObjectId or ISO date), returns `meta.nextCursor`.
 *
 * Cursor pagination is preferred for feeds (stable under concurrent inserts).
 * Offset is preferred for search (users want to jump pages).
 */

'use strict';

const { DEFAULT_LIMIT, MAX_LIMIT } = require('../../config/constants');

/**
 * Normalize and clamp limit/page values.
 */
function normalizePagination(query = {}) {
    const limit = Math.min(
        Math.max(parseInt(query.limit, 10) || DEFAULT_LIMIT, 1),
        MAX_LIMIT
    );
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    return { limit, page };
}

/**
 * Apply offset-based pagination to a Mongoose query.
 * @returns {{ query, meta }}
 */
function paginateOffset(query, { page, limit }, total = null) {
    const skip = (page - 1) * limit;
    const paged = query.skip(skip).limit(limit);

    const meta = {
        page,
        limit,
        skip,
        hasNextPage: total !== null ? page * limit < total : undefined,
        hasPrevPage: page > 1,
    };

    return { query: paged, meta };
}

/**
 * Build meta for a cursor-paginated response.
 */
function buildCursorMeta(items, limit, idField = '_id') {
    const hasMore = items.length === limit;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? last[idField].toString() : null;
    return { limit, hasMore, nextCursor };
}

/**
 * Parse a cursor string into an ObjectId (or date, if the field is a date).
 * Returns null if invalid.
 */
function parseCursor(cursor) {
    if (!cursor) return null;
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(cursor)) {
        return new mongoose.Types.ObjectId(cursor);
    }
    const date = new Date(cursor);
    if (!isNaN(date.getTime())) return date;
    return null;
}

module.exports = {
    normalizePagination,
    paginateOffset,
    buildCursorMeta,
    parseCursor,
};