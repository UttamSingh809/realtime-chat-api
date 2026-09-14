/**
 * Integration tests for file uploads.
 * Uses a real (generated) PNG so `sharp` can process it.
 */

'use strict';

const request = require('supertest');
const path = require('path');
const fs = require('fs/promises');
const sharp = require('sharp');
const app = require('../../src/app');

const API = '/api';

let counter = 0;
function uniq(p = 'u') {
    counter += 1;
    return `${p}${Date.now().toString(36)}${counter}`;
}

async function registerUser() {
    const username = uniq('fu');
    const res = await request(app).post(`${API}/auth/register`).send({
        name: 'File User',
        username,
        email: `${username}@example.com`,
        password: 'Password123!',
    });
    return { user: res.body.data.user, token: res.body.data.accessToken };
}

const authed = (req, token) => req.set('Authorization', `Bearer ${token}`);

// Valid 2×2 red PNG, generated once at module load.
let PNG_2x2;

describe('File API', () => {
    const uploaded = [];

    beforeAll(async () => {
        PNG_2x2 = await sharp({
            create: {
                width: 2,
                height: 2,
                channels: 3,
                background: { r: 255, g: 0, b: 0 },
            },
        })
            .png()
            .toBuffer();
    });

    afterAll(async () => {
        for (const f of uploaded) {
            try {
                await fs.unlink(path.join(process.cwd(), 'uploads-test', f));
            } catch {
                /* ignore */
            }
        }
    });

    // ---------------------------------------------------------------------
    describe('GET /api/files/config', () => {
        it('returns provider + limits', async () => {
            const { token } = await registerUser();
            const res = await authed(request(app).get(`${API}/files/config`), token);

            expect(res.status).toBe(200);
            expect(res.body.data.provider).toBe('local');
            expect(res.body.data.maxFileSize).toBeGreaterThan(0);
            expect(Array.isArray(res.body.data.allowedExtensions)).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    describe('POST /api/files/upload', () => {
        it('uploads a PNG', async () => {
            const { token } = await registerUser();

            const res = await authed(request(app).post(`${API}/files/upload`), token)
                .attach('file', PNG_2x2, { filename: 'pixel.png', contentType: 'image/png' });

            expect(res.status).toBe(201);
            expect(res.body.data.file.url).toMatch(/^\/static\/uploads\//);
            expect(res.body.data.file.type).toBe('image');
            expect(res.body.data.file.mimeType).toBe('image/png');
            expect(res.body.data.file.size).toBe(PNG_2x2.length);
            expect(res.body.data.file.name).toBe('pixel.png');

            uploaded.push(res.body.data.file.publicId);
        });

        it('generates a thumbnail for images', async () => {
            const { token } = await registerUser();

            const res = await authed(request(app).post(`${API}/files/upload`), token)
                .attach('file', PNG_2x2, { filename: 'thumbed.png', contentType: 'image/png' });

            expect(res.status).toBe(201);
            expect(res.body.data.file.thumbnail).toMatch(/_thumb\.webp$/);

            uploaded.push(res.body.data.file.publicId);
        });

        it('rejects missing file', async () => {
            const { token } = await registerUser();
            const res = await authed(request(app).post(`${API}/files/upload`), token);
            expect(res.status).toBe(422);
        });

        it('rejects disallowed MIME type', async () => {
            const { token } = await registerUser();

            const res = await authed(request(app).post(`${API}/files/upload`), token)
                .attach('file', Buffer.from('#!/bin/bash\necho hi'), {
                    filename: 'evil.sh',
                    contentType: 'application/x-sh',
                });

            expect(res.status).toBe(422);
        });

        it('rejects disallowed extension', async () => {
            const { token } = await registerUser();

            const res = await authed(request(app).post(`${API}/files/upload`), token)
                .attach('file', PNG_2x2, {
                    filename: 'evil.exe',      // bad extension
                    contentType: 'image/png',  // spoofed MIME (allowed)
                });

            expect(res.status).toBe(422);
        });

        it('rejects unauthenticated upload', async () => {
            const res = await request(app).post(`${API}/files/upload`)
                .attach('file', PNG_2x2, { filename: 'x.png', contentType: 'image/png' });
            expect(res.status).toBe(401);
        });
    });

    // ---------------------------------------------------------------------
    describe('POST /api/files/upload-multiple', () => {
        it('uploads up to 10 files', async () => {
            const { token } = await registerUser();

            const res = await authed(
                request(app).post(`${API}/files/upload-multiple`),
                token
            )
                .attach('files', PNG_2x2, { filename: 'a.png', contentType: 'image/png' })
                .attach('files', PNG_2x2, { filename: 'b.png', contentType: 'image/png' })
                .attach('files', PNG_2x2, { filename: 'c.png', contentType: 'image/png' });

            expect(res.status).toBe(201);
            expect(res.body.data.files).toHaveLength(3);
            res.body.data.files.forEach((f) => uploaded.push(f.publicId));
        });

        it('rejects empty upload', async () => {
            const { token } = await registerUser();
            const res = await authed(
                request(app).post(`${API}/files/upload-multiple`),
                token
            );
            expect(res.status).toBe(422);
        });
    });

    // ---------------------------------------------------------------------
    describe('DELETE /api/files/*', () => {
        it('deletes an owned file', async () => {
            const { token } = await registerUser();

            const up = await authed(request(app).post(`${API}/files/upload`), token)
                .attach('file', PNG_2x2, { filename: 'del.png', contentType: 'image/png' });
            const publicId = up.body.data.file.publicId;

            const res = await authed(
                request(app).delete(`${API}/files/${encodeURIComponent(publicId)}`),
                token
            );
            expect(res.status).toBe(200);
            expect(res.body.data.removed).toBe(true);
        });

        it("forbids deleting another user's file", async () => {
            const a = await registerUser();
            const b = await registerUser();

            const up = await authed(request(app).post(`${API}/files/upload`), a.token)
                .attach('file', PNG_2x2, { filename: 'mine.png', contentType: 'image/png' });
            const publicId = up.body.data.file.publicId;
            uploaded.push(publicId);

            const res = await authed(
                request(app).delete(`${API}/files/${encodeURIComponent(publicId)}`),
                b.token
            );
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('NOT_OWNER');
        });
    });

    // ---------------------------------------------------------------------
    describe('Static serving (local provider)', () => {
        it('serves uploaded files under /static/uploads', async () => {
            const { token } = await registerUser();

            const up = await authed(request(app).post(`${API}/files/upload`), token)
                .attach('file', PNG_2x2, { filename: 'served.png', contentType: 'image/png' });
            const url = up.body.data.file.url;
            uploaded.push(up.body.data.file.publicId);

            const res = await request(app).get(url);
            expect(res.status).toBe(200);
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['content-disposition']).toContain('inline');
        });
    });
});