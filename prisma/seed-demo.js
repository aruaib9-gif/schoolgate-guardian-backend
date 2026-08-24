/**
 * seed-demo.js — a coherent "Grace Academy" demo dataset for the mobile app.
 *
 * Creates the six role login accounts the mobile login screen previews
 * (admin/teacher/security/parent/sales @grace.ng, password demo1234)
 * plus people, classes, access logs, attendance, passes, visitors, a bus and
 * messages — all scoped to the Grace Academy school — so every mobile screen
 * shows real data from the live backend.
 *
 * Idempotent: if admin@grace.ng already exists the script exits without changes.
 * Run after the main seed:  node prisma/seed-demo.js
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
const now = Date.now();
const daysAgo = (n) => new Date(now - n * 86400000);
const hoursAgo = (n) => new Date(now - n * 3600000);
const todayStr = () => new Date().toISOString().slice(0, 10);

async function main() {
  if (await prisma.user.findUnique({ where: { email: 'admin@grace.ng' } })) {
    console.log('Demo already seeded (admin@grace.ng exists) — skipping.');
    return;
  }

  // Reuse the Grace Academy created by the main seed, or create it.
  let school = await prisma.school.findUnique({ where: { code: 'GRACE' } });
  if (!school) {
    school = await prisma.school.create({
      data: {
        name: 'Grace Academy, Lagos', code: 'GRACE', city: 'Lagos', state: 'Lagos', country: 'Nigeria',
        subscription_plan: 'premium', status: 'active',
        admin_name: 'Chidi Okafor', admin_email: 'admin@grace.ng',
        gate_locations: ['Main Gate', 'Side Gate', 'Gym Entrance'],
        created_by: 'demo-seed',
      },
    });
  }
  const SCHOOL_ID = school.id;
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // --- People ---------------------------------------------------------------
  const P = (id, full_name, category, extra = {}) => ({
    id, school_id: SCHOOL_ID, full_name, category,
    qr_code: `QR-${id}`, current_status: extra.current_status || 'outside',
    portal_access: !!extra.email, registration_completed: true, profile_completed: true, active: true,
    email: extra.email, grade: extra.grade, department: extra.department,
    father_email: extra.father_email, linked_children: extra.linked_children || [],
    created_by: 'demo-seed',
  });
  const people = [
    P('demo_admin', 'Chidi Okafor', 'management', { email: 'admin@grace.ng', current_status: 'inside' }),
    P('demo_teach1', 'Ngozi Adeyemi', 'teacher', { email: 'teacher@grace.ng', department: 'Science', current_status: 'inside' }),
    P('demo_sec1', 'Emeka Balogun', 'security', { email: 'security@grace.ng', current_status: 'inside' }),
    P('demo_par1', 'Folake Adebayo', 'parent', { email: 'parent@grace.ng', linked_children: ['demo_stu1', 'demo_stu2'] }),
    P('demo_sales1', 'Sade Williams', 'staff', { email: 'sales@grace.ng', department: 'Sales', current_status: 'inside' }),
    P('demo_stu1', 'Chiamaka Eze', 'student', { grade: 'Grade 5', current_status: 'inside', father_email: 'parent@grace.ng' }),
    P('demo_stu2', 'Oluwaseun Adebayo', 'student', { grade: 'Grade 5', current_status: 'inside', father_email: 'parent@grace.ng' }),
    P('demo_stu3', 'Ifeoma Nwosu', 'student', { grade: 'Grade 5', current_status: 'outside' }),
    P('demo_stu4', 'Kunle Bello', 'student', { grade: 'Grade 6', current_status: 'inside' }),
    P('demo_stu5', 'Amarachi Okeke', 'student', { grade: 'Grade 6', current_status: 'outside' }),
    P('demo_stu6', 'Chinedu Obi', 'student', { grade: 'Grade 6', current_status: 'inside' }),
  ];
  for (const p of people) await prisma.person.create({ data: p });

  // --- Users (the six demo logins) -----------------------------------------
  const U = (email, person_id, user_category, full_name, extra = {}) => ({
    email, password_hash: hash, person_id, user_category,
    role: user_category === 'admin' ? 'admin' : 'user',
    full_name, school_id: SCHOOL_ID, is_active: true, profile_completed: true,
    created_by: 'demo-seed', ...extra,
  });
  const users = [
    U('admin@grace.ng', 'demo_admin', 'admin', 'Chidi Okafor'),
    U('teacher@grace.ng', 'demo_teach1', 'teacher', 'Ngozi Adeyemi'),
    U('security@grace.ng', 'demo_sec1', 'security', 'Emeka Balogun', { gate_name: 'Main Gate' }),
    U('parent@grace.ng', 'demo_par1', 'parent', 'Folake Adebayo'),
    U('sales@grace.ng', 'demo_sales1', 'sales_rep', 'Sade Williams'),
  ];
  for (const u of users) {
    if (!(await prisma.user.findUnique({ where: { email: u.email } }))) await prisma.user.create({ data: u });
  }

  // --- Classes --------------------------------------------------------------
  await prisma.class.create({ data: {
    id: 'demo_class1', school_id: SCHOOL_ID, class_name: '5A', grade: 'Grade 5', room: 'Room 101',
    class_teacher_id: 'demo_teach1', class_teacher_name: 'Ngozi Adeyemi',
    student_ids: ['demo_stu1', 'demo_stu2', 'demo_stu3'], is_active: true, created_by: 'demo-seed',
  } });
  await prisma.class.create({ data: {
    id: 'demo_class2', school_id: SCHOOL_ID, class_name: '6A', grade: 'Grade 6', room: 'Room 201',
    class_teacher_id: 'demo_teach1', class_teacher_name: 'Ngozi Adeyemi',
    student_ids: ['demo_stu4', 'demo_stu5', 'demo_stu6'], is_active: true, created_by: 'demo-seed',
  } });

  // --- Access logs ----------------------------------------------------------
  const log = (person_id, person_name, cat, action, ts) => ({
    school_id: SCHOOL_ID, person_id, person_name, person_category: cat, action, timestamp: ts,
    scanned_by: 'Emeka Balogun', gate_name: 'Main Gate', pass_type: 'regular', created_date: ts, created_by: 'demo-seed',
  });
  await prisma.accessLog.createMany({ data: [
    log('demo_stu1', 'Chiamaka Eze', 'student', 'entry', hoursAgo(3)),
    log('demo_stu2', 'Oluwaseun Adebayo', 'student', 'entry', hoursAgo(3)),
    log('demo_teach1', 'Ngozi Adeyemi', 'teacher', 'entry', hoursAgo(4)),
    log('demo_stu3', 'Ifeoma Nwosu', 'student', 'exit', hoursAgo(1)),
    log('demo_admin', 'Chidi Okafor', 'management', 'entry', hoursAgo(5)),
  ] });

  // --- Attendance -----------------------------------------------------------
  const att = (student_id, student_name, class_name, status) => ({
    school_id: SCHOOL_ID, student_id, student_name, class_name, status, date: todayStr(),
    teacher_id: 'demo_teach1', teacher_name: 'Ngozi Adeyemi', created_by: 'demo-seed',
  });
  await prisma.attendance.createMany({ data: [
    att('demo_stu1', 'Chiamaka Eze', '5A', 'present'),
    att('demo_stu2', 'Oluwaseun Adebayo', '5A', 'present'),
    att('demo_stu3', 'Ifeoma Nwosu', '5A', 'absent'),
    att('demo_stu4', 'Kunle Bello', '6A', 'late'),
  ] });

  // --- Passes & visitors ----------------------------------------------------
  await prisma.guestPass.create({ data: {
    school_id: SCHOOL_ID, guest_name: 'Chukwuemeka Obi', guest_phone: '+234 803 111 2222',
    purpose: 'Parent meeting', host_name: 'Chidi Okafor', qr_code: 'GP-0001', status: 'active',
    valid_from: hoursAgo(2), valid_until: hoursAgo(-22), created_by: 'demo-seed',
  } });
  await prisma.oneTimePass.create({ data: {
    school_id: SCHOOL_ID, parent_id: 'demo_par1', parent_name: 'Nkechi Nwosu',
    child_id: 'demo_stu3', child_name: 'Ifeoma Nwosu',
    purpose: 'pickup', qr_code: 'OTP-0001', status: 'active', valid_until: hoursAgo(-4), created_by: 'demo-seed',
  } });
  await prisma.visitor.create({ data: {
    school_id: SCHOOL_ID, visitor_name: 'Grace Effiong', visitor_phone: '+234 803 555 6666',
    purpose: 'Maintenance', host_name: 'Chidi Okafor', visit_date: todayStr(), status: 'checked_in',
    check_in_time: hoursAgo(2), badge_number: 'V-014', qr_code: 'V-014', created_by: 'demo-seed',
  } });

  // --- Security alerts -------------------------------------------------------
  await prisma.securityAlert.createMany({ data: [
    { school_id: SCHOOL_ID, alert_type: 'unauthorized_access', severity: 'medium', title: 'Unregistered visitor at Main Gate', message: 'Please verify identity.', status: 'unread', created_by: 'demo-seed' },
    { school_id: SCHOOL_ID, alert_type: 'suspicious_activity', severity: 'low', title: 'Gate held open', message: 'Side Gate reported open for 5 min.', status: 'unread', created_by: 'demo-seed' },
  ] });

  // --- Bus & messages -------------------------------------------------------
  await prisma.schoolBus.create({ data: {
    school_id: SCHOOL_ID, bus_name: 'Bus 1', bus_number: 'BUS-01', plate_number: 'LAG-234-XY',
    driver_name: 'Musa Ibrahim', driver_phone: '+234 803 000 0170', route_name: 'North Route', capacity: 40,
    is_active: true, current_status: 'idle', assigned_security_email: 'security@grace.ng',
    assigned_security_name: 'Emeka Balogun', assigned_student_ids: ['demo_stu1'], stops: ['Ikeja', 'Maryland', 'Yaba'],
    created_by: 'demo-seed',
  } });
  await prisma.message.createMany({ data: [
    { school_id: SCHOOL_ID, subject: 'Welcome to the new term', body: 'We are excited to welcome everyone back.', sender_id: 'demo_admin', sender_name: 'Chidi Okafor', sender_role: 'admin', recipient_type: 'all', priority: 'normal', status: 'sent', read_by: [], created_by: 'demo-seed' },
    { school_id: SCHOOL_ID, subject: 'Bus route change', body: 'North Route will have a temporary stop change this week.', sender_id: 'demo_admin', sender_name: 'Chidi Okafor', sender_role: 'admin', recipient_type: 'role', recipient_role: 'parent', priority: 'high', status: 'sent', read_by: [], created_by: 'demo-seed' },
  ] });

  console.log(`Demo seeded for Grace Academy (${SCHOOL_ID}): 6 logins (password ${DEMO_PASSWORD}), ${people.length} people, classes, logs, attendance, passes, visitor, bus, messages.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
