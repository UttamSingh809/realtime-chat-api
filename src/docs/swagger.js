/**
 * Swagger / OpenAPI setup.
 * Reads annotations from route files and serves Swagger UI at /api/docs.
 */

'use strict';

const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const logger = require('../config/logger');

const PORT = process.env.PORT || 5000;
const API_PREFIX = process.env.API_PREFIX || '/api';

const options = {
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'RealTime Chat API',
            version: '1.0.0',
            description:
                'Production-grade REST + WebSocket API for a real-time chat application.\n\n' +
                '**Authentication:** All protected endpoints require a Bearer access token in the `Authorization` header. ' +
                'Use `POST /auth/register` or `POST /auth/login` to obtain one.',
            contact: {
                name: 'API Support',
                email: 'support@realtimechat.local',
            },
            license: { name: 'MIT' },
        },
        servers: [
            { url: `http://localhost:${PORT}${API_PREFIX}`, description: 'Local development' },
            { url: `https://api.example.com${API_PREFIX}`, description: 'Production (replace with real URL)' },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Paste your **access token** here. Obtain one via /auth/login.',
                },
            },
            schemas: {
                // ---- Envelope ----
                SuccessResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: true },
                        data: { type: 'object' },
                    },
                },
                ErrorResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: false },
                        message: { type: 'string', example: 'Validation failed' },
                        code: { type: 'string', example: 'VALIDATION_ERROR' },
                        details: { type: 'array', items: { type: 'object' } },
                    },
                },

                // ---- Auth ----
                RegisterRequest: {
                    type: 'object',
                    required: ['name', 'username', 'email', 'password'],
                    properties: {
                        name: { type: 'string', minLength: 2, maxLength: 80, example: 'Alice Smith' },
                        username: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 30,
                            pattern: '^[a-z0-9_.]+$',
                            example: 'alice',
                        },
                        email: { type: 'string', format: 'email', example: 'alice@example.com' },
                        password: {
                            type: 'string',
                            minLength: 8,
                            example: 'Password123!',
                            description: 'Must contain at least 3 of: lowercase, uppercase, digit, symbol',
                        },
                    },
                },
                LoginRequest: {
                    type: 'object',
                    properties: {
                        email: { type: 'string', format: 'email', example: 'alice@example.com' },
                        username: { type: 'string', example: 'alice' },
                        password: { type: 'string', example: 'Password123!' },
                    },
                    description: 'Provide either `email` OR `username`, plus `password`.',
                },
                AuthResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: true },
                        data: {
                            type: 'object',
                            properties: {
                                user: { $ref: '#/components/schemas/UserSelf' },
                                accessToken: { type: 'string' },
                                refreshToken: { type: 'string' },
                            },
                        },
                    },
                },

                // ---- Users ----
                UserSelf: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', example: '64f1c9e7e1b2c3a4d5e6f7a8' },
                        name: { type: 'string' },
                        username: { type: 'string' },
                        email: { type: 'string', format: 'email' },
                        avatar: {
                            type: 'object',
                            properties: {
                                url: { type: 'string', nullable: true },
                                publicId: { type: 'string', nullable: true },
                            },
                        },
                        bio: { type: 'string' },
                        phone: { type: 'string', nullable: true },
                        role: { type: 'string', enum: ['user', 'admin'] },
                        status: { type: 'string', enum: ['online', 'offline', 'away', 'busy'] },
                        statusMessage: { type: 'string' },
                        lastSeen: { type: 'string', format: 'date-time' },
                        settings: { type: 'object' },
                        isEmailVerified: { type: 'boolean' },
                        createdAt: { type: 'string', format: 'date-time' },
                    },
                },
                UserPublic: {
                    type: 'object',
                    description: 'Public view — no email, no settings, no role.',
                    properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        username: { type: 'string' },
                        avatar: { type: 'object' },
                        bio: { type: 'string' },
                        status: { type: 'string' },
                        statusMessage: { type: 'string' },
                        lastSeen: { type: 'string', format: 'date-time', nullable: true },
                        createdAt: { type: 'string', format: 'date-time' },
                    },
                },

                // ---- Conversations ----
                Conversation: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        type: { type: 'string', enum: ['private', 'group'] },
                        group: { type: 'object', nullable: true },
                        participants: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    user: { $ref: '#/components/schemas/UserPublic' },
                                    role: { type: 'string', enum: ['owner', 'admin', 'member'] },
                                    joinedAt: { type: 'string', format: 'date-time' },
                                },
                            },
                        },
                        lastMessage: { type: 'object', nullable: true },
                        myFlags: { type: 'object' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                    },
                },

                // ---- Messages ----
                Message: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        conversationId: { type: 'string' },
                        sender: { $ref: '#/components/schemas/UserPublic' },
                        content: { type: 'string' },
                        type: { type: 'string', enum: ['text', 'image', 'file', 'audio', 'video', 'system'] },
                        attachments: { type: 'array', items: { type: 'object' } },
                        replyTo: { type: 'object', nullable: true },
                        reactions: { type: 'object' },
                        readBy: { type: 'array', items: { type: 'object' } },
                        isEdited: { type: 'boolean' },
                        isDeleted: { type: 'boolean' },
                        isStarred: { type: 'boolean' },
                        isPinned: { type: 'boolean' },
                        createdAt: { type: 'string', format: 'date-time' },
                    },
                },

                // ---- Notifications ----
                Notification: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        type: { type: 'string' },
                        category: { type: 'string' },
                        title: { type: 'string' },
                        body: { type: 'string' },
                        data: { type: 'object' },
                        isRead: { type: 'boolean' },
                        createdAt: { type: 'string', format: 'date-time' },
                    },
                },
            },
            responses: {
                Unauthorized: {
                    description: 'Missing or invalid token',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                            example: { success: false, message: 'Authentication required', code: 'NO_TOKEN' },
                        },
                    },
                },
                Forbidden: {
                    description: 'Not allowed',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                        },
                    },
                },
                NotFound: {
                    description: 'Resource not found',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                        },
                    },
                },
                ValidationError: {
                    description: 'Request validation failed',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                            example: {
                                success: false,
                                message: 'Validation failed',
                                code: 'VALIDATION_ERROR',
                                details: [{ path: 'email', message: 'must be a valid email' }],
                            },
                        },
                    },
                },
                TooManyRequests: {
                    description: 'Rate limit exceeded',
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ErrorResponse' },
                        },
                    },
                },
            },
        },
        tags: [
            { name: 'Auth', description: 'Registration, login, tokens' },
            { name: 'Users', description: 'Profiles, search, block/mute, presence' },
            { name: 'Conversations', description: 'DMs, groups, members' },
            { name: 'Messages', description: 'Send, read, edit, delete, react' },
            { name: 'Files', description: 'Upload, thumbnails, static serving' },
            { name: 'Notifications', description: 'List, read, delete' },
            { name: 'Health', description: 'Liveness / readiness' },
        ],
        security: [{ bearerAuth: [] }],
    },
    apis: [
        path.join(__dirname, '..', 'routes', '*.js'),
        path.join(__dirname, '..', '..', 'src', 'routes', '*.js'),
    ],
};

const swaggerSpec = swaggerJsdoc(options);

/**
 * Mount Swagger UI at the given path.
 */
function mountSwagger(app, mountPath = '/api/docs') {
    if (process.env.SWAGGER_ENABLED !== 'true') {
        logger.info('Swagger UI disabled (SWAGGER_ENABLED != true)');
        return;
    }

    app.get(`${mountPath}/openapi.json`, (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });

    app.use(
        mountPath,
        swaggerUi.serve,
        swaggerUi.setup(swaggerSpec, {
            explorer: true,
            customSiteTitle: 'RealTime Chat API Docs',
            swaggerOptions: {
                persistAuthorization: true,
                displayRequestDuration: true,
                filter: true,
                tryItOutEnabled: true,
            },
        })
    );

    logger.info(`Swagger UI available at ${mountPath}`);
}

module.exports = { swaggerSpec, mountSwagger };