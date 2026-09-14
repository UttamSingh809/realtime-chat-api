'use strict';

const request = require('supertest');
const sharp = require('sharp');
const app = require('../src/app');

const API = '/api';

let counter = 0;
function uniq(p = 'u') {
    counter += 1;
    return `${p}${Date.now().toString(36)}${counter}`;
}

describe('Debug file ext rejection', () => {
    let token;
    let png;

    beforeAll(async () => {
        png = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
        }).png().toBuffer();

        const username = uniq('dbg');
        const reg = await request(app).post(`${API}/auth/register`).send({
            name: 'Debug User',
            username,
            email: `${username}@example.com`,
            password: 'Password123!',
        });
        token = reg.body.data.accessToken;
    });

    it('sends evil.exe and dumps the full response', async () => {
        const res = await request(app)
            .post(`${API}/files/upload`)
            .set('Authorization', `Bearer ${token}`)
            .attach('file', png, { filename: 'evil.exe', contentType: 'image/png' });

        console.log('STATUS:', res.status);
        console.log('BODY:', JSON.stringify(res.body, null, 2));
        console.log('HEADERS:', JSON.stringify(res.headers, null, 2));
    });
});