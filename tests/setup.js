'use strict';

require('dotenv').config({ path: '.env.test' });

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

// -------------------------------------------------------------------------
// Test-environment overrides
// -------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_min_32_characters_long!!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_min_32_characters_long!!';
process.env.REDIS_ENABLED = 'false';
process.env.RATE_LIMIT_MAX = '10000';
process.env.AUTH_RATE_LIMIT_MAX = '10000';
process.env.EMAIL_ENABLED = 'false';
process.env.UPLOAD_PROVIDER = 'local';
process.env.UPLOAD_DIR = 'uploads-test';
process.env.STATIC_UPLOADS_PREFIX = '/static/uploads';
process.env.MAX_FILE_SIZE = '10485760';

// Mock the email service globally (no real SMTP in tests)
jest.mock('../src/services/email.service', () => ({
    sendMail: jest.fn().mockResolvedValue({ delivered: false, previewOnly: true }),
    sendPasswordResetEmail: jest.fn().mockResolvedValue({ delivered: false, previewOnly: true }),
}));

// -------------------------------------------------------------------------
// Mongo lifecycle
// -------------------------------------------------------------------------
let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri);
});

afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    if (mongoServer) await mongoServer.stop();

    // Clean up test uploads
    const fs = require('fs/promises');
    const path = require('path');
    await fs.rm(path.join(process.cwd(), 'uploads-test'), { recursive: true, force: true });
});

afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
        await collections[key].deleteMany({});
    }
});