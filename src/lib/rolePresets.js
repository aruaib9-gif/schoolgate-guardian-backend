/**
 * The permission presets every role starts with.
 *
 * Lifted out of prisma/seed.js so that the full seed — which also creates a
 * superadmin, schools and invitations — is not the only way to bring a
 * deployment's role rows up to date. scripts/sync-role-permissions.js writes
 * just these, which is what a running school needs after a release that
 * changes what a role may do.
 *
 * A grant is `true` for every record of a resource, `false` for none, or one
 * of two narrow strings enforced in lib/permissions.js:
 *   'own'  — only records this person created (a pass they issued)
 *   'self' — only records about this person and their children (a gate log)
 */
// Permission resource shape used across the app.
const RESOURCES = {
  people: ['view', 'create', 'edit', 'delete'],
  users: ['view', 'create', 'edit', 'delete'],
  access_logs: ['view', 'create', 'export', 'correct'],
  attendance: ['view', 'create', 'edit', 'delete'],
  guest_passes: ['view', 'create', 'edit', 'delete'],
  school_bus: ['view', 'manage', 'scan'],
  reports: ['view', 'export'],
  roles: ['view', 'assign', 'manage_permissions'],
  audit_log: ['view', 'export'],
  security_gate: ['scan', 'override'],
};

// Build a permissions object; `grants` maps resource -> array of allowed actions
// (or the string 'all'). Everything else defaults to false.
//
// A grant may also be an object naming each action separately, whose value is
// `true` for every record of that resource or the string 'own' for only the
// records that person created — see lib/permissions.js, which enforces it.
export function perms(grants) {
  const out = {};
  for (const [resource, actions] of Object.entries(RESOURCES)) {
    out[resource] = {};
    const allowed = grants[resource];
    const perAction = allowed && !Array.isArray(allowed) && typeof allowed === 'object';
    for (const action of actions) {
      out[resource][action] = perAction
        ? (allowed[action] ?? false)
        : allowed === 'all' || (Array.isArray(allowed) && allowed.includes(action));
    }
  }
  return out;
}

export const ROLE_PRESETS = {
  superadmin: {
    description: 'Platform owner — full access across all schools',
    permissions: perms(Object.fromEntries(Object.keys(RESOURCES).map((r) => [r, 'all']))),
  },
  head_of_schools: {
    description: 'Oversees multiple schools',
    permissions: perms(Object.fromEntries(Object.keys(RESOURCES).map((r) => [r, 'all']))),
  },
  admin: {
    description: 'School administrator — full access within their school',
    permissions: perms(Object.fromEntries(Object.keys(RESOURCES).map((r) => [r, 'all']))),
  },
  school_admin: {
    description: 'School administrator',
    permissions: perms(Object.fromEntries(Object.keys(RESOURCES).map((r) => [r, 'all']))),
  },
  management: {
    description: 'School management — broad read plus reports',
    permissions: perms({
      people: ['view'],
      users: ['view'],
      access_logs: ['view', 'export'],
      attendance: ['view'],
      guest_passes: ['view', 'create'],
      school_bus: ['view'],
      reports: ['view', 'export'],
      audit_log: ['view'],
    }),
  },
  security: {
    description: 'Gate security — scanning and access logs',
    permissions: perms({
      people: ['view'],
      access_logs: ['view', 'create'],
      guest_passes: ['view'],
      security_gate: ['scan'],
      school_bus: ['view', 'scan'],
    }),
  },
  teacher: {
    description: 'Teacher — attendance, roster, and guest passes they issue themselves',
    permissions: perms({
      people: ['view'],
      attendance: ['view', 'create', 'edit'],
      reports: ['view'],
      // A teacher expecting a parent can issue the pass themselves and follow
      // it up, without reading the passes the rest of the staff issued. 'own'
      // means exactly the records they created.
      //
      // No delete: cancelling is an edit to the pass's status, which keeps the
      // record of a visitor having been expected. Deleting would erase it.
      //
      // Note this resource also covers one-time passes and visitors, so the
      // same narrow rule applies there — a teacher sees only what they
      // themselves created.
      guest_passes: { view: 'own', create: true, edit: 'own', delete: false },
      // Their own comings and goings, not the whole school's gate history.
      access_logs: { view: 'self' },
    }),
  },
  school_worker: {
    description: 'General school staff',
    permissions: perms({ people: ['view'], attendance: ['view'] }),
  },
  school_bus_admin: {
    description: 'Bus operations — routes and boarding scans',
    permissions: perms({
      people: ['view'],
      school_bus: ['view', 'manage', 'scan'],
    }),
  },
  parent: {
    description: 'Parent — their own children, and passes they issue',
    permissions: perms({
      // 'self' is the parent and the children they are named against, rather
      // than the whole roster. The app used to be handed every person in the
      // school and hide the rest on the device, which is not the same thing as
      // not sending them.
      people: { view: 'self' },
      // A child's gate history is the point of the product for a parent. Their
      // own children's, and nobody else's.
      access_logs: { view: 'self' },
      guest_passes: { view: 'own', create: true },
    }),
  },
  student: {
    description: 'Student — minimal self-service access',
    permissions: perms({
      people: { view: 'self' },
      access_logs: { view: 'self' },
    }),
  },
};

export { RESOURCES };
