import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

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
function perms(grants) {
  const out = {};
  for (const [resource, actions] of Object.entries(RESOURCES)) {
    out[resource] = {};
    const allowed = grants[resource];
    for (const action of actions) {
      out[resource][action] = allowed === 'all' || (Array.isArray(allowed) && allowed.includes(action));
    }
  }
  return out;
}

const ROLE_PRESETS = {
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
    description: 'Teacher — attendance and roster access',
    permissions: perms({
      people: ['view'],
      attendance: ['view', 'create', 'edit'],
      reports: ['view'],
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
    description: 'Parent — view own children, create passes',
    // people:view lets the app resolve the parent's own profile/children.
    // Tighten to record-owner scoping if you need to hide the wider roster.
    permissions: perms({ people: ['view'], guest_passes: ['view', 'create'] }),
  },
  student: {
    description: 'Student — minimal self-service access',
    // people:view lets the app resolve the student's own profile.
    permissions: perms({ people: ['view'] }),
  },
};

async function seedRolePermissions() {
  for (const [role_name, preset] of Object.entries(ROLE_PRESETS)) {
    const existing = await prisma.rolePermissions.findFirst({ where: { role_name, school_id: null } });
    if (existing) {
      await prisma.rolePermissions.update({
        where: { id: existing.id },
        data: { permissions: preset.permissions, description: preset.description, is_active: true },
      });
    } else {
      await prisma.rolePermissions.create({
        data: { role_name, school_id: null, permissions: preset.permissions, description: preset.description, is_active: true },
      });
    }
  }
  console.log(`Seeded ${Object.keys(ROLE_PRESETS).length} global role permission sets.`);
}

async function seedSuperadmin() {
  const email = process.env.SEED_SUPERADMIN_EMAIL || 'superadmin@schoolgate.example';
  const password = process.env.SEED_SUPERADMIN_PASSWORD || 'ChangeMe123!';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Superadmin ${email} already exists — skipping.`);
    return;
  }
  const password_hash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      password_hash,
      role: 'admin',
      user_category: 'superadmin',
      full_name: 'Platform Superadmin',
      is_active: true,
      profile_completed: true,
      last_login: new Date(),
      created_by: 'seed',
    },
  });
  console.log(`Created superadmin: ${email} (password from SEED_SUPERADMIN_PASSWORD).`);
}

// ---------------------------------------------------------------------------
// Platform / Super Admin seed data (Nigerian schools, admins, activity)
// ---------------------------------------------------------------------------
const GATES = ['Main Gate', 'Side Gate', 'Gym Entrance', 'Back Gate', 'Sports Complex'];
const NAMES = ['Chiamaka Eze', 'Oluwaseun Adebayo', 'Ifeoma Nwosu', 'Kunle Bello', 'Amarachi Okeke', 'Chinedu Obi', 'Ngozi Adeyemi', 'Tunde Okonkwo', 'Blessing Ogunleye', 'Emeka Balogun'];

const SCHOOLS = [
  { name: 'Grace Academy, Lagos', code: 'GRACE', city: 'Lagos', state: 'Lagos', plan: 'premium', status: 'active', admin_name: 'Chidi Okafor', admin_email: 'admin@graceacademy.edu.ng', phone: '+234 803 000 0001', students: 1240, staff: 96, gates: 3, createdMonthsAgo: 7, eventsPerMonth: 130 },
  { name: 'Chrisland College', code: 'CHRIS', city: 'Ikeja', state: 'Lagos', plan: 'enterprise', status: 'active', admin_name: 'Adaeze Okoro', admin_email: 'admin@chrisland.edu.ng', phone: '+234 803 000 0002', students: 2180, staff: 210, gates: 5, createdMonthsAgo: 7, eventsPerMonth: 190 },
  { name: 'Corona Secondary School', code: 'CORONA', city: 'Agbara', state: 'Ogun', plan: 'premium', status: 'active', admin_name: 'Bola Ahmed', admin_email: 'principal@corona.edu.ng', phone: '+234 803 000 0003', students: 980, staff: 84, gates: 2, createdMonthsAgo: 6, eventsPerMonth: 110 },
  { name: 'Greensprings School', code: 'GREEN', city: 'Lekki', state: 'Lagos', plan: 'enterprise', status: 'active', admin_name: 'Uche Nnamdi', admin_email: 'admin@greensprings.edu.ng', phone: '+234 803 000 0004', students: 1760, staff: 168, gates: 4, createdMonthsAgo: 5, eventsPerMonth: 170 },
  { name: 'Sunrise College, Abuja', code: 'SUNRISE', city: 'Gwarinpa', state: 'FCT', plan: 'basic', status: 'trial', admin_name: 'Ibrahim Sani', admin_email: 'head@sunrise.edu.ng', phone: '+234 803 000 0005', students: 420, staff: 38, gates: 1, createdMonthsAgo: 1, eventsPerMonth: 30 },
  { name: 'Loyola Jesuit College', code: 'LOYOLA', city: 'Gidan Mangoro', state: 'FCT', plan: 'premium', status: 'active', admin_name: 'Ngozi Eze', admin_email: 'admin@loyola.edu.ng', phone: '+234 803 000 0006', students: 890, staff: 72, gates: 2, createdMonthsAgo: 4, eventsPerMonth: 100 },
  { name: "King's College", code: 'KINGS', city: 'Lagos Island', state: 'Lagos', plan: 'basic', status: 'active', admin_name: 'Emeka Obi', admin_email: 'admin@kingscollege.edu.ng', phone: '+234 803 000 0007', students: 640, staff: 58, gates: 2, createdMonthsAgo: 3, eventsPerMonth: 70 },
  { name: 'Deeper Life High School', code: 'DLHS', city: 'Abeokuta', state: 'Ogun', plan: 'basic', status: 'suspended', admin_name: 'Grace Effiong', admin_email: 'admin@deeperlife.edu.ng', phone: '+234 803 000 0008', students: 510, staff: 44, gates: 1, createdMonthsAgo: 6, eventsPerMonth: 0 },
  { name: 'Whitesands School', code: 'WHITE', city: 'Lekki', state: 'Lagos', plan: 'premium', status: 'active', admin_name: 'Tunde Bakare', admin_email: 'admin@whitesands.edu.ng', phone: '+234 803 000 0009', students: 1120, staff: 90, gates: 3, createdMonthsAgo: 2, eventsPerMonth: 120 },
];

const INVITES = [
  { school_name: 'Nigerian Tulip Intl College', city: 'Abuja', state: 'FCT', admin_name: 'Aisha Bello', admin_email: 'aisha.bello@ntic.edu.ng', plan: 'premium', status: 'pending' },
  { school_name: 'Lifeforte Intl School', city: 'Ibadan', state: 'Oyo', admin_name: 'Segun Adeyinka', admin_email: 'segun@lifeforte.edu.ng', plan: 'basic', status: 'pending' },
  { school_name: 'Charterhouse Lagos', city: 'Lekki', state: 'Lagos', admin_name: 'Funmi Alade', admin_email: 'funmi@charterhouse.ng', plan: 'enterprise', status: 'sent' },
];

function seedMonthWindows(n = 8) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({ start, end });
  }
  return out;
}

async function seedPlatformConfig() {
  await prisma.platformConfig.upsert({ where: { id: 'platform' }, update: {}, create: { id: 'platform' } });
  console.log('Seeded platform config.');
}

async function seedSchools() {
  const now = Date.now();
  const windows = seedMonthWindows(8);
  // A shared password for the seeded school-admin logins so the app/mobile are
  // testable out of the box. Override with SEED_SCHOOL_ADMIN_PASSWORD.
  const adminPassword = process.env.SEED_SCHOOL_ADMIN_PASSWORD || 'password123';
  const adminHash = await bcrypt.hash(adminPassword, 10);
  for (const s of SCHOOLS) {
    if (await prisma.school.findUnique({ where: { code: s.code } })) {
      console.log(`School ${s.code} exists — skipping.`);
      continue;
    }
    const createdAt = new Date();
    createdAt.setMonth(createdAt.getMonth() - s.createdMonthsAgo);
    createdAt.setDate(2);

    const school = await prisma.school.create({
      data: {
        name: s.name, code: s.code, city: s.city, state: s.state, country: 'Nigeria',
        subscription_plan: s.plan, status: s.status,
        admin_name: s.admin_name, admin_email: s.admin_email, admin_phone: s.phone, email: s.admin_email,
        students: s.students, staff: s.staff, gates: s.gates,
        gate_locations: GATES.slice(0, s.gates),
        created_date: createdAt, created_by: 'seed',
      },
    });

    if (!(await prisma.user.findUnique({ where: { email: s.admin_email } }))) {
      await prisma.user.create({
        data: {
          email: s.admin_email, full_name: s.admin_name, role: 'admin', user_category: 'admin',
          password_hash: adminHash,
          school_id: school.id, is_active: true, profile_completed: true, created_by: 'seed',
        },
      });
    }

    // Synthetic access activity so analytics/aggregates reflect real records.
    if (s.eventsPerMonth > 0) {
      const logs = [];
      for (const w of windows) {
        if (w.start.getTime() > now) continue;
        const end = Math.min(w.end.getTime(), now);
        for (let k = 0; k < s.eventsPerMonth; k++) {
          const ts = new Date(w.start.getTime() + Math.random() * (end - w.start.getTime()));
          logs.push({
            school_id: school.id,
            person_id: `seed_${s.code}_${k % 200}`,
            person_name: NAMES[k % NAMES.length],
            person_category: k % 5 === 0 ? 'teacher' : 'student',
            action: k % 2 ? 'exit' : 'entry',
            timestamp: ts, gate_name: GATES[k % s.gates], scanned_by: 'Security', pass_type: 'regular',
            created_date: ts,
          });
        }
      }
      for (let i = 0; i < logs.length; i += 500) await prisma.accessLog.createMany({ data: logs.slice(i, i + 500) });
      console.log(`  ${s.code}: onboarded + ${logs.length} access logs`);
    } else {
      console.log(`  ${s.code}: onboarded (${s.status})`);
    }
  }
}

async function seedInvitations() {
  if ((await prisma.schoolInvitation.count()) > 0) {
    console.log('School invitations exist — skipping.');
    return;
  }
  for (const i of INVITES) {
    await prisma.schoolInvitation.create({ data: { ...i, invited_by: 'seed', created_by: 'seed' } });
  }
  console.log(`Seeded ${INVITES.length} onboarding invitations.`);
}

async function main() {
  await seedRolePermissions();
  await seedSuperadmin();
  await seedPlatformConfig();
  await seedSchools();
  await seedInvitations();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
