'use strict';

const AuthService = require('../src/services/auth.service');

describe('Debug service', () => {
    it('registers directly', async () => {
        try {
            const result = await AuthService.register({
                name: 'Test User',
                username: 'debugsvc',
                email: 'debugsvc@example.com',
                password: 'Password123!',
            });
            console.log('SUCCESS:', result);
            expect(result).toBeDefined();
        } catch (err) {
            console.error('FAILED:', err);
            console.error('STACK:', err.stack);
            throw err;
        }
    });
});