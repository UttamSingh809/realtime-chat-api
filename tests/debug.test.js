'use strict';

const request = require('supertest');
const app = require('../src/app');

describe('Debug', () => {
    it('dumps the register response', async () => {
        const res = await request(app).post('/api/auth/register').send({
            name: 'Test User',
            username: 'debuguser',
            email: 'debug@example.com',
            password: 'Password123!',
        });

        // Print everything so we can see the real error
        console.log('STATUS:', res.status);
        console.log('BODY:', JSON.stringify(res.body, null, 2));
        console.log('HEADERS:', JSON.stringify(res.headers, null, 2));

        expect(true).toBe(true); // always pass, just print
    });
});