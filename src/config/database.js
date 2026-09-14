/**
 * MongoDB connection using Mongoose.
 * Handles connection events, retries, and graceful shutdown.
 */

'use strict';

const mongoose = require('mongoose');
const logger = require('./logger');

// Disable strictQuery warning
mongoose.set('strictQuery', true);

let isConnected = false;

/**
 * Connect to MongoDB.
 * @returns {Promise<typeof mongoose>}
 */
async function connectDatabase() {
    if (isConnected) {
        logger.info('MongoDB already connected');
        return mongoose;
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI is not defined in environment variables');
    }

    const options = {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4,
        autoIndex: process.env.NODE_ENV !== 'production',
    };

    try {
        await mongoose.connect(uri, options);
        isConnected = true;
        logger.info(`MongoDB connected: ${mongoose.connection.host}`);

        mongoose.connection.on('error', (err) => {
            logger.error(`MongoDB connection error: ${err.message}`);
        });

        mongoose.connection.on('disconnected', () => {
            isConnected = false;
            logger.warn('MongoDB disconnected');
        });

        mongoose.connection.on('reconnected', () => {
            isConnected = true;
            logger.info('MongoDB reconnected');
        });

        return mongoose;
    } catch (err) {
        logger.error(`MongoDB initial connection failed: ${err.message}`);
        throw err;
    }
}

/**
 * Gracefully close MongoDB connection.
 */
async function disconnectDatabase() {
    if (!isConnected) return;
    await mongoose.connection.close();
    isConnected = false;
    logger.info('MongoDB connection closed');
}

module.exports = { connectDatabase, disconnectDatabase, mongoose };