'use strict';

const request = require('supertest');
const app = require('../src/app');
const { User } = require('../src/models');
const { verifyAccessToken } = require('../src/utils/helpers/jwt');

const API = '/api';

describe('Debug passwordChangedAt', () => {
    it('traces the password change flow', async () => {
        // 1. Register
        const reg = await request(app).post(`${API}/auth/register`).send({
            name: 'Trace User',
            username: 'traceuser',
            email: 'trace@example.com',
            password: 'Password123!',
        });
        const { accessToken } = reg.body.data;
        console.log('1. Registered. Token iat:', verifyAccessToken(accessToken).iat);

        // 2. Check user's passwordChangedAt BEFORE change
        const userBefore = await User.findOne({ email: 'trace@example.com' })
            .select('+passwordChangedAt');
        console.log('2. passwordChangedAt BEFORE change:', userBefore.passwordChangedAt);

        // 3. Change password (wait 1.5s to ensure timestamp differs)
        await new Promise((r) => setTimeout(r, 1500));
        const change = await request(app)
            .put(`${API}/auth/change-password`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!' });
        console.log('3. Change password response status:', change.status, change.body);

        // 4. Check user's passwordChangedAt AFTER change
        const userAfter = await User.findOne({ email: 'trace@example.com' })
            .select('+passwordChangedAt');
        console.log('4. passwordChangedAt AFTER change:', userAfter.passwordChangedAt);
        console.log('   as seconds:', userAfter.passwordChangedAt
            ? Math.floor(userAfter.passwordChangedAt.getTime() / 1000)
            : null);
        console.log('   token iat:', verifyAccessToken(accessToken).iat);
        console.log('   passwordChangedAfter(iat)?:',
            userAfter.passwordChangedAfter(verifyAccessToken(accessToken).iat));

        // 5. Try /me with old token
        const me = await request(app)
            .get(`${API}/auth/me`)
            .set('Authorization', `Bearer ${accessToken}`);
        console.log('5. /me with old token:', me.status, me.body);

        expect(true).toBe(true);
    });
});