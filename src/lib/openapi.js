// ---------------------------------------------------------------------------
// OpenAPI (Swagger) specification for the SchoolGate Guardian API.
//
// Documents EVERY route the API actually serves, grouped by tag:
//   Health, Auth, Entities, Super Admin, Integrations, Functions, Users.
//
// Component schemas for the data models are derived straight from Prisma's DMMF
// so they stay in sync with schema.prisma automatically. The generic entity
// endpoints (/api/entities/:entity) work for every model, so their shared CRUD
// shape is documented once with the model name as a path parameter.
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

// --- small response/body helpers so paths stay readable ---------------------
const json = (schema) => ({ 'application/json': { schema } });
const ok = (description, schema) => ({ description, ...(schema ? { content: json(schema) } : {}) });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const freeObject = { type: 'object', additionalProperties: true };
const errorRef = ok('Error', ref('Error'));
const authErr = { 401: { description: 'Missing or invalid token' } };
const forbiddenErr = { 403: { description: 'Insufficient role' } };

export function buildOpenApiSpec() {
  const models = Prisma.dmmf.datamodel.models;
  const schemas = {};
  for (const model of models) schemas[model.name] = schemaForModel(model);

  const names = entityNames();
  const entityParam = {
    name: 'entity',
    in: 'path',
    required: true,
    description: 'Which data model to operate on.',
    schema: { type: 'string', enum: names },
  };
  const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
  const saIdParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };

  return {
    openapi: '3.0.3',
    info: {
      title: 'SchoolGate Guardian API',
      version: '1.0.0',
      description:
        'REST API for SchoolGate Guardian (Node + Express + Prisma + PostgreSQL).\n\n' +
        '**Authentication:** call `POST /auth/login`, copy the `token` from the response, ' +
        'click the green **Authorize** button above and paste it. Everything except ' +
        '`/health`, `/auth/register` and `/auth/login` requires it.\n\n' +
        '**Roles:** `/api/superadmin/*` additionally requires a `superadmin` (or ' +
        '`head_of_schools`) account. `/users/invite` requires an admin/management account.\n\n' +
        '**Entities:** every data model is reachable through the generic ' +
        '`/api/entities/{entity}` routes — valid `{entity}` values are in the dropdown.\n\n' +
        '**Functions:** the scheduler can call `/functions/*` without a user token by ' +
        'sending the `x-cron-secret` header instead.',
    },
    // Default the docs (incl. the Integrations upload/email endpoints) to the
    // live production origin so "Try it out" never falls back to localhost.
    // The configured PUBLIC_URL wins when it is a real https origin; localhost
    // is offered only as a secondary option for local development.
    servers: [
      {
        url:
          env.publicUrl && env.publicUrl.startsWith('https')
            ? env.publicUrl
            : 'https://schoolgate-guardian-backend.onrender.com',
        description: 'Production (live)',
      },
      { url: 'http://localhost:4000', description: 'Local development' },
    ],
    tags: [
      { name: 'Health', description: 'Service status' },
      { name: 'Auth', description: 'Register, login, current user, password' },
      { name: 'Entities', description: 'Generic CRUD for every data model' },
      { name: 'Super Admin', description: 'Platform console — schools, invitations, analytics, config (superadmin only)' },
      { name: 'Integrations', description: 'File uploads, email, document extraction' },
      { name: 'Functions', description: 'Callable server functions (CRM/bus/absence jobs)' },
      { name: 'Users', description: 'User invitations' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cronSecret: { type: 'apiKey', in: 'header', name: 'x-cron-secret' },
      },
      schemas: {
        ...schemas,
        AuthResponse: {
          type: 'object',
          properties: { token: { type: 'string' }, user: ref('User') },
        },
        SuccessResponse: {
          type: 'object',
          properties: { success: { type: 'boolean' }, id: { type: 'string' } },
        },
        Error: {
          type: 'object',
          properties: { error: { type: 'string' }, details: { type: 'object' } },
        },
      },
    },
    // Applied globally; public endpoints override with `security: []`.
    security: [{ bearerAuth: [] }],
    paths: {
      // -------------------------------------------------------------------
      // Health
      // -------------------------------------------------------------------
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          security: [],
          responses: {
            200: ok('Service is up', {
              type: 'object',
              properties: { status: { type: 'string' }, time: { type: 'string' } },
            }),
          },
        },
      },

      // -------------------------------------------------------------------
      // Auth
      // -------------------------------------------------------------------
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new account (the very first account becomes admin/superadmin)',
          security: [],
          requestBody: {
            required: true,
            content: json({
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
            }),
          },
          responses: {
            201: ok('Account created', ref('AuthResponse')),
            409: ok('Email already exists', ref('Error')),
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
            content: json({
              type: 'object',
              required: ['email', 'password'],
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string' },
              },
            }),
          },
          responses: {
            200: ok('Logged in', ref('AuthResponse')),
            401: ok('Invalid credentials', ref('Error')),
          },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get the currently logged-in user',
          responses: { 200: ok('Current user', ref('User')), ...authErr },
        },
        patch: {
          tags: ['Auth'],
          summary: 'Update your own profile',
          description: 'Self-editable fields: full_name, gate_name, assigned_bus_id, person_id, profile_completed, password.',
          requestBody: { content: json(freeObject) },
          responses: { 200: ok('Updated user', ref('User')), ...authErr },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Log out (stateless — provided for symmetry)',
          responses: { 200: ok('Logged out', ref('SuccessResponse')), ...authErr },
        },
      },
      '/auth/invite/{token}': {
        get: {
          tags: ['Auth'],
          summary: 'Validate a set-password / reset link (public)',
          description: 'Lets the web app show who the link belongs to before asking for a password.',
          security: [],
          parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: ok('Link is valid', {
              type: 'object',
              properties: {
                valid: { type: 'boolean' },
                purpose: { type: 'string', enum: ['invite', 'reset'] },
                email: { type: 'string' },
                full_name: { type: 'string' },
                school: { type: 'object' },
                expires_at: { type: 'string', format: 'date-time' },
              },
            }),
            410: ok('Invalid, already used, or expired', ref('Error')),
          },
        },
      },
      '/auth/accept-invite': {
        post: {
          tags: ['Auth'],
          summary: 'Set your password from an invite link, and sign in',
          security: [],
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['token', 'password'],
              properties: { token: { type: 'string' }, password: { type: 'string', minLength: 8 } },
            }),
          },
          responses: {
            200: ok('Password set — signed in', ref('AuthResponse')),
            400: errorRef,
            410: ok('Link invalid or expired', ref('Error')),
          },
        },
      },
      '/auth/forgot-password': {
        post: {
          tags: ['Auth'],
          summary: 'Request a password reset link',
          description: 'Always returns 200 with the same message — the API never reveals whether an address is registered.',
          security: [],
          requestBody: {
            required: true,
            content: json({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } }),
          },
          responses: { 200: ok('Accepted', ref('SuccessResponse')) },
        },
      },
      '/auth/reset-password': {
        post: {
          tags: ['Auth'],
          summary: 'Complete a password reset, and sign in',
          security: [],
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['token', 'password'],
              properties: { token: { type: 'string' }, password: { type: 'string', minLength: 8 } },
            }),
          },
          responses: {
            200: ok('Password reset — signed in', ref('AuthResponse')),
            400: errorRef,
            410: ok('Link invalid or expired', ref('Error')),
          },
        },
      },
      '/api/superadmin/schools/{id}/resend-invite': {
        parameters: [saIdParam],
        post: {
          tags: ['Super Admin'],
          summary: "Re-send the school admin's set-password link",
          responses: {
            200: ok('Sent', {
              type: 'object',
              properties: {
                success: { type: 'boolean' }, email: { type: 'string' },
                expires_at: { type: 'string', format: 'date-time' }, delivery: { type: 'object' },
              },
            }),
            400: errorRef, ...authErr, ...forbiddenErr,
          },
        },
      },
      '/auth/change-password': {
        post: {
          tags: ['Auth'],
          summary: 'Change your password',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['new_password'],
              properties: {
                current_password: { type: 'string' },
                new_password: { type: 'string', minLength: 6 },
              },
            }),
          },
          responses: { 200: ok('Password changed', ref('SuccessResponse')), 400: errorRef, ...authErr },
        },
      },

      // -------------------------------------------------------------------
      // Entities (generic CRUD)
      // -------------------------------------------------------------------
      '/api/entities/{entity}': {
        parameters: [entityParam],
        get: {
          tags: ['Entities'],
          summary: 'List records for an entity',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'skip', in: 'query', schema: { type: 'integer' } },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'e.g. -created_date' },
          ],
          responses: { 200: ok('Array of records', { type: 'array', items: freeObject }), ...authErr },
        },
        post: {
          tags: ['Entities'],
          summary: 'Create a record',
          requestBody: { required: true, content: json(freeObject) },
          responses: { 201: ok('Created record', freeObject), 400: errorRef, ...authErr },
        },
      },
      '/api/entities/{entity}/query': {
        parameters: [entityParam],
        post: {
          tags: ['Entities'],
          summary: 'Filter records (equivalent to entity.filter)',
          description: 'Body is a set of field/value filters, optionally with sort & limit.',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              properties: {
                where: { type: 'object', additionalProperties: true },
                sort: { type: 'string' },
                limit: { type: 'integer' },
                skip: { type: 'integer' },
              },
            }),
          },
          responses: { 200: ok('Array of matching records', { type: 'array', items: freeObject }), ...authErr },
        },
      },
      '/api/entities/{entity}/count': {
        parameters: [entityParam],
        get: {
          tags: ['Entities'],
          summary: 'Count records for an entity',
          responses: {
            200: ok('Count', { type: 'object', properties: { count: { type: 'integer' } } }),
            ...authErr,
          },
        },
      },
      '/api/entities/{entity}/bulk': {
        parameters: [entityParam],
        post: {
          tags: ['Entities'],
          summary: 'Create many records at once (entity.bulkCreate)',
          requestBody: { required: true, content: json({ type: 'array', items: freeObject }) },
          responses: { 201: ok('Created records', { type: 'array', items: freeObject }), 400: errorRef, ...authErr },
        },
      },
      '/api/entities/{entity}/{id}': {
        parameters: [entityParam, idParam],
        get: {
          tags: ['Entities'],
          summary: 'Get one record by id',
          responses: { 200: ok('The record', freeObject), 404: ok('Not found', ref('Error')), ...authErr },
        },
        put: {
          tags: ['Entities'],
          summary: 'Replace/update a record',
          requestBody: { required: true, content: json(freeObject) },
          responses: { 200: ok('Updated record', freeObject), 404: ok('Not found', ref('Error')), ...authErr },
        },
        patch: {
          tags: ['Entities'],
          summary: 'Partially update a record',
          requestBody: { required: true, content: json(freeObject) },
          responses: { 200: ok('Updated record', freeObject), 404: ok('Not found', ref('Error')), ...authErr },
        },
        delete: {
          tags: ['Entities'],
          summary: 'Delete a record',
          responses: { 200: ok('Deleted', ref('SuccessResponse')), 404: ok('Not found', ref('Error')), ...authErr },
        },
      },

      // -------------------------------------------------------------------
      // Super Admin (platform console) — superadmin role required
      // -------------------------------------------------------------------
      '/api/superadmin/overview': {
        get: {
          tags: ['Super Admin'],
          summary: 'Dashboard KPIs, time series and breakdowns',
          responses: { 200: ok('Overview object', freeObject), ...authErr, ...forbiddenErr },
        },
      },
      '/api/superadmin/series': {
        get: {
          tags: ['Super Admin'],
          summary: 'Time-series analytics',
          responses: { 200: ok('Series object', freeObject), ...authErr, ...forbiddenErr },
        },
      },
      '/api/superadmin/plans': {
        get: {
          tags: ['Super Admin'],
          summary: 'Subscription plan catalog',
          responses: { 200: ok('Array of plans', { type: 'array', items: freeObject }), ...authErr, ...forbiddenErr },
        },
      },
      '/api/superadmin/audit': {
        get: {
          tags: ['Super Admin'],
          summary: 'Platform audit feed',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }],
          responses: { 200: ok('Array of audit events', { type: 'array', items: freeObject }), ...authErr, ...forbiddenErr },
        },
      },
      '/api/superadmin/config': {
        get: {
          tags: ['Super Admin'],
          summary: 'Get platform configuration',
          responses: { 200: ok('Platform config', ref('PlatformConfig')), ...authErr, ...forbiddenErr },
        },
        put: {
          tags: ['Super Admin'],
          summary: 'Update platform configuration',
          requestBody: {
            content: json({
              type: 'object',
              properties: {
                platform_name: { type: 'string' },
                support_email: { type: 'string' },
                default_plan: { type: 'string' },
                attendance_cutoff: { type: 'string' },
                trial_days: { type: 'integer' },
                allow_self_signup: { type: 'boolean' },
                maintenance_mode: { type: 'boolean' },
              },
            }),
          },
          responses: { 200: ok('Updated config', ref('PlatformConfig')), ...authErr, ...forbiddenErr },
        },
      },
      '/api/superadmin/schools': {
        get: {
          tags: ['Super Admin'],
          summary: 'List all schools (with aggregated stats)',
          responses: { 200: ok('Array of schools', { type: 'array', items: freeObject }), ...authErr, ...forbiddenErr },
        },
        post: {
          tags: ['Super Admin'],
          summary: 'Create/onboard a school (also provisions its admin user)',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                code: { type: 'string' },
                city: { type: 'string' },
                state: { type: 'string' },
                plan: { type: 'string', description: 'stored as subscription_plan' },
                status: { type: 'string', enum: ['active', 'trial', 'suspended', 'inactive'] },
                admin_name: { type: 'string' },
                admin_email: { type: 'string' },
                admin_phone: { type: 'string' },
                address: { type: 'string' },
                phone: { type: 'string' },
                email: { type: 'string' },
                website: { type: 'string' },
              },
            }),
          },
          responses: { 201: ok('Created school', freeObject), 400: errorRef, ...authErr, ...forbiddenErr },
        },
      },
      '/api/superadmin/schools/{id}': {
        parameters: [saIdParam],
        get: {
          tags: ['Super Admin'],
          summary: 'Get one school (with stats)',
          responses: { 200: ok('School', freeObject), 404: ok('Not found', ref('Error')), ...authErr, ...forbiddenErr },
        },
        patch: {
          tags: ['Super Admin'],
          summary: 'Update a school',
          requestBody: { content: json(freeObject) },
          responses: { 200: ok('Updated school', freeObject), 404: ok('Not found', ref('Error')), ...authErr, ...forbiddenErr },
        },
        put: {
          tags: ['Super Admin'],
          summary: 'Update a school (alias of PATCH)',
          requestBody: { content: json(freeObject) },
          responses: { 200: ok('Updated school', freeObject), 404: ok('Not found', ref('Error')), ...authErr, ...forbiddenErr },
        },
        delete: {
          tags: ['Super Admin'],
          summary: 'Delete a school',
          responses: { 200: ok('Deleted', ref('SuccessResponse')), 404: ok('Not found', ref('Error')), ...authErr, ...forbiddenErr },
        },
      },
      '/api/superadmin/schools/{id}/status': {
        parameters: [saIdParam],
        post: {
          tags: ['Super Admin'],
          summary: 'Set a school status (active/trial/suspended/inactive)',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['status'],
              properties: { status: { type: 'string', enum: ['active', 'trial', 'suspended', 'inactive'] } },
            }),
          },
          responses: { 200: ok('Updated school', freeObject), 400: errorRef, ...authErr, ...forbiddenErr },
        },
      },
      '/api/superadmin/invitations': {
        get: {
          tags: ['Super Admin'],
          summary: 'List onboarding invitations',
          responses: { 200: ok('Array of invitations', { type: 'array', items: ref('SchoolInvitation') }), ...authErr, ...forbiddenErr },
        },
        post: {
          tags: ['Super Admin'],
          summary: 'Create an onboarding invitation for a new school',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['school_name', 'admin_email'],
              properties: {
                school_name: { type: 'string' },
                admin_email: { type: 'string' },
                admin_name: { type: 'string' },
                admin_phone: { type: 'string' },
                code: { type: 'string' },
                city: { type: 'string' },
                state: { type: 'string' },
                plan: { type: 'string' },
              },
            }),
          },
          responses: { 201: ok('Created invitation', ref('SchoolInvitation')), 400: errorRef, ...authErr, ...forbiddenErr },
        },
      },
      '/api/superadmin/invitations/{id}/accept': {
        parameters: [saIdParam],
        post: {
          tags: ['Super Admin'],
          summary: 'Accept an invitation → creates the school + admin',
          responses: { 201: ok('Created school', freeObject), 400: errorRef, 404: ok('Not found', ref('Error')), ...authErr, ...forbiddenErr },
        },
      },
      '/api/superadmin/invitations/{id}': {
        parameters: [saIdParam],
        delete: {
          tags: ['Super Admin'],
          summary: 'Delete an invitation',
          responses: { 200: ok('Deleted', ref('SuccessResponse')), ...authErr, ...forbiddenErr },
        },
      },

      // -------------------------------------------------------------------
      // Integrations
      // -------------------------------------------------------------------
      '/integrations/upload': {
        post: {
          tags: ['Integrations'],
          summary: 'Upload a file (multipart, field name "file")',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: { file: { type: 'string', format: 'binary' } },
                },
              },
            },
          },
          responses: {
            200: ok('Uploaded', {
              type: 'object',
              properties: {
                file_url: { type: 'string' },
                filename: { type: 'string' },
                original_name: { type: 'string' },
                size: { type: 'integer' },
                mime_type: { type: 'string' },
              },
            }),
            400: errorRef,
            ...authErr,
          },
        },
      },
      '/integrations/send-email': {
        post: {
          tags: ['Integrations'],
          summary: 'Send an email (or log it if SMTP is not configured)',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['to', 'subject'],
              properties: {
                to: { type: 'string' },
                subject: { type: 'string' },
                body: { type: 'string' },
                html: { type: 'string' },
                from_name: { type: 'string' },
                from: { type: 'string' },
              },
            }),
          },
          responses: { 200: ok('Sent', ref('SuccessResponse')), 400: errorRef, ...authErr },
        },
      },
      '/integrations/extract-data': {
        post: {
          tags: ['Integrations'],
          summary: 'Extract structured data from an uploaded file',
          description: 'Integration point — returns 501 until wired to an OCR/LLM provider.',
          requestBody: {
            content: json({
              type: 'object',
              properties: { file_url: { type: 'string' }, json_schema: { type: 'object' } },
            }),
          },
          responses: { 501: ok('Not implemented', ref('Error')), ...authErr },
        },
      },

      // -------------------------------------------------------------------
      // Functions (user token OR x-cron-secret header)
      // -------------------------------------------------------------------
      '/functions': {
        get: {
          tags: ['Functions'],
          summary: 'List available server functions',
          security: [{ bearerAuth: [] }, { cronSecret: [] }],
          responses: {
            200: ok('Function names', { type: 'object', properties: { functions: { type: 'array', items: { type: 'string' } } } }),
            ...authErr,
          },
        },
        post: {
          tags: ['Functions'],
          summary: 'Invoke a function by name (functions.invoke)',
          security: [{ bearerAuth: [] }, { cronSecret: [] }],
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', enum: ['crmFollowUpReminders', 'crmStageEmailSequence', 'notifyBusEvent', 'sendAbsenceReport'] },
                payload: { type: 'object', additionalProperties: true },
              },
            }),
          },
          responses: { 200: ok('Function result', freeObject), 404: ok('Unknown function', ref('Error')), ...authErr },
        },
      },
      '/functions/{name}': {
        parameters: [
          { name: 'name', in: 'path', required: true, schema: { type: 'string', enum: ['crmFollowUpReminders', 'crmStageEmailSequence', 'notifyBusEvent', 'sendAbsenceReport'] } },
        ],
        post: {
          tags: ['Functions'],
          summary: 'Invoke a named function directly',
          security: [{ bearerAuth: [] }, { cronSecret: [] }],
          requestBody: { content: json(freeObject) },
          responses: { 200: ok('Function result', freeObject), 404: ok('Unknown function', ref('Error')), ...authErr },
        },
      },

      // -------------------------------------------------------------------
      // Users
      // -------------------------------------------------------------------
      '/users/invite': {
        post: {
          tags: ['Users'],
          summary: 'Invite a user by email (admin/management only)',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string' },
                role: { type: 'string' },
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                phone: { type: 'string' },
                department: { type: 'string' },
                grade: { type: 'string' },
                school_id: { type: 'string' },
                portal_access: { type: 'boolean' },
                notes: { type: 'string' },
              },
            }),
          },
          responses: {
            201: ok('Invitation created', {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                invitation: ref('Invitation'),
                invite_link: { type: 'string' },
              },
            }),
            400: errorRef,
            403: { description: 'Not permitted to invite users' },
            ...authErr,
          },
        },
      },
    },
  };
}
