import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Megh API',
      version: '1.0.0',
      description: 'API for managing Claude CLI container sessions',
    },
    servers: [
      { url: '/api', description: 'API server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'megh_token',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            tier: { type: 'string', enum: ['free_trial', 'prepaid', 'postpaid'] },
            status: { type: 'string', enum: ['active', 'suspended', 'banned'] },
          },
        },
        Session: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            user_id: { type: 'string', format: 'uuid' },
            container_id: { type: 'string' },
            status: { type: 'string', enum: ['creating', 'active', 'expiring', 'grace', 'destroyed'] },
            ttl_minutes: { type: 'integer' },
            port_mappings: { type: 'object' },
            started_at: { type: 'string', format: 'date-time' },
            expires_at: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new user',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8, maxLength: 128 },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Registration successful' },
            400: { description: 'Validation error' },
            429: { description: 'Rate limited' },
          },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Login',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string' },
                    password: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Login successful' },
            401: { description: 'Invalid credentials' },
            429: { description: 'Rate limited' },
          },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get current user',
          security: [{ bearerAuth: [] }, { cookieAuth: [] }],
          responses: {
            200: { description: 'User profile with billing info' },
            401: { description: 'Not authenticated' },
          },
        },
      },
      '/auth/ws-ticket': {
        post: {
          tags: ['Auth'],
          summary: 'Get one-time WebSocket ticket',
          security: [{ bearerAuth: [] }, { cookieAuth: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sessionId'],
                  properties: {
                    sessionId: { type: 'string', format: 'uuid' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Ticket generated' },
          },
        },
      },
      '/sessions': {
        get: {
          tags: ['Sessions'],
          summary: 'List sessions',
          security: [{ bearerAuth: [] }, { cookieAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: {
            200: { description: 'Session list' },
          },
        },
        post: {
          tags: ['Sessions'],
          summary: 'Create a new session',
          security: [{ bearerAuth: [] }, { cookieAuth: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ttl_minutes: { type: 'integer', minimum: 5, maximum: 480 },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Session created' },
            403: { description: 'Insufficient balance or max concurrent reached' },
          },
        },
      },
      '/sessions/{id}': {
        get: {
          tags: ['Sessions'],
          summary: 'Get session details',
          security: [{ bearerAuth: [] }, { cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Session details' },
            404: { description: 'Not found' },
          },
        },
        delete: {
          tags: ['Sessions'],
          summary: 'End or destroy a session',
          security: [{ bearerAuth: [] }, { cookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Session ended/destroyed' },
            404: { description: 'Not found' },
          },
        },
      },
      '/billing/balance': {
        get: {
          tags: ['Billing'],
          summary: 'Get account balance',
          security: [{ bearerAuth: [] }, { cookieAuth: [] }],
          responses: { 200: { description: 'Balance info' } },
        },
      },
      '/billing/topup': {
        post: {
          tags: ['Billing'],
          summary: 'Create Stripe checkout for top-up',
          security: [{ bearerAuth: [] }, { cookieAuth: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['amount'],
                  properties: {
                    amount: { type: 'number', minimum: 5, maximum: 500 },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Checkout URL' },
            400: { description: 'Invalid amount' },
          },
        },
      },
      '/health': {
        get: {
          tags: ['System'],
          summary: 'Health check',
          responses: {
            200: { description: 'All services healthy' },
            503: { description: 'One or more services degraded' },
          },
        },
      },
    },
  },
  apis: [], // We define paths inline above
};

export const openapiSpec = swaggerJsdoc(options);
