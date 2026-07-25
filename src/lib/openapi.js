// ---------------------------------------------------------------------------
// OpenAPI (Swagger) specification for the SchoolGate Guardian API.
//
// The generic entity endpoints (/api/entities/:entity) work for every model in
// schema.prisma, so instead of hand-writing dozens of near-identical paths we
// derive component schemas straight from Prisma's DMMF and document the shared
// CRUD shape once. Auth and health are documented explicitly.
// Served as interactive docs at GET /docs (see app.js).
// ---------------------------------------------------------------------------
import { Prisma } from '@prisma/client';
import { entityNames } from './registry.js';
import { env } from '../config/env.js';

// Map Prisma scalar types -> OpenAPI (JSON Schema) types.
function openApiType(field) {
  const base = (() => {
    switch (field.type) {
      case 'Int':
      case 'BigInt':
        return { type: 'integer' };
      case 'Float':
      case 'Decimal':
        return { type: 'number' };
      case 'Boolean':
        return { type: 'boolean' };
      case 'DateTime':
        return { type: 'string', format: 'date-time' };
      case 'Json':
        return { type: 'object' };
      default:
        return { type: 'string' };
    }
  })();
  return field.isList ? { type: 'array', items: base } : base;
}

// Build a component schema for one Prisma model.
function schemaForModel(model) {
  const properties = {};
  for (const f of model.fields) {
    if (f.kind === 'object') continue; // relations (none defined) — skip
    properties[f.name] = openApiType(f);
  }
  return { type: 'object', properties };
}

export function buildOpenApiSpec() {
  const models = Prisma.dmmf.datamodel.models;
  const schemas = {};
  for (const model of models) schemas[model.name] = schemaForModel(model);

  const names = entityNames();

  return {
    openapi: '3.0.3',
    info: {
      title: 'SchoolGate Guardian API',
      version: '1.0.0',
      description:
        'REST API for SchoolGate Guardian (Node + Express + Prisma + PostgreSQL).\n\n' +
        '**Authentication:** call `POST /auth/login`, copy the `token` from the response, ' +
        'click the green **Authorize** button above and paste it. All `/api/*` and `/users` ' +
        'routes require it.\n\n' +
        '**Entities:** every data model is reachable through the generic ' +
        '`/api/entities/{entity}` routes. Valid `{entity}` values are listed on each endpoint.',
    },
    servers: [
      { url: env.publicUrl || 'http://localhost:4000', description: 'Configured server' },
    ],
    tags: [
      { name: 'Health', description: 'Service status' },
      { name: 'Auth', description: 'Register, login, and current-user endpoints' },
      { name: 'Entities', description: 'Generic CRUD for every data model' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        ...schemas,
        AuthResponse: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: { $ref: '#/components/schemas/User' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'object' },
          },
        },
      },
    },
    // Applied globally; individual public endpoints override with `security: []`.
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          security: [],
          responses: {
            200: {
              description: 'Service is up',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { status: { type: 'string' }, time: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new account (first account becomes admin)',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 6 },
                    full_name: { type: 'string' },
                    role: { type: 'string' },
                    school_id: { type: 'string' },
                    person_id: { type: 'string' },
                    user_category: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Account created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
            },
            409: { description: 'Email already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Log in and receive a JWT token',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Logged in',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
            },
            401: { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get the currently logged-in user',
          responses: {
            200: { description: 'Current user', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
            401: { description: 'Not authenticated' },
          },
        },
        patch: {
          tags: ['Auth'],
          summary: 'Update your own profile',
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          responses: {
            200: { description: 'Updated user', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          },
        },
      },
      '/api/entities/{entity}': {
        parameters: [
          {
            name: 'entity',
            in: 'path',
            required: true,
            description: 'Which data model to operate on.',
            schema: { type: 'string', enum: names },
          },
        ],
        get: {
          tags: ['Entities'],
          summary: 'List records for an entity',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'skip', in: 'query', schema: { type: 'integer' } },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'e.g. -created_date' },
          ],
          responses: {
            200: { description: 'Array of records', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } },
            401: { description: 'Not authenticated' },
          },
        },
        post: {
          tags: ['Entities'],
          summary: 'Create a record',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          responses: {
            201: { description: 'Created record', content: { 'application/json': { schema: { type: 'object' } } } },
            401: { description: 'Not authenticated' },
          },
        },
      },
      '/api/entities/{entity}/{id}': {
        parameters: [
          { name: 'entity', in: 'path', required: true, schema: { type: 'string', enum: names } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        get: {
          tags: ['Entities'],
          summary: 'Get one record by id',
          responses: { 200: { description: 'The record' }, 404: { description: 'Not found' } },
        },
        put: {
          tags: ['Entities'],
          summary: 'Replace/update a record',
          requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          responses: { 200: { description: 'Updated record' } },
        },
        patch: {
          tags: ['Entities'],
          summary: 'Partially update a record',
          requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          responses: { 200: { description: 'Updated record' } },
        },
        delete: {
          tags: ['Entities'],
          summary: 'Delete a record',
          responses: { 200: { description: 'Deleted' } },
        },
      },
      '/api/entities/{entity}/count': {
        parameters: [{ name: 'entity', in: 'path', required: true, schema: { type: 'string', enum: names } }],
        get: {
          tags: ['Entities'],
          summary: 'Count records for an entity',
          responses: { 200: { description: 'Count', content: { 'application/json': { schema: { type: 'object', properties: { count: { type: 'integer' } } } } } } },
        },
      },
    },
  };
}
