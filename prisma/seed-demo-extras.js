/**
 * seed-demo-extras.js — completes the Grace Academy demo data that comes after
 * the guest pass in seed-demo.js (one-time pass, visitor, alerts, bus,
 * messages). Idempotent: each row is created only if missing. Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();
const now = Date.now();
const hoursAgo = (n) => new Date(now - n * 3600000);
const todayStr = () => new Date().toISOString().slice(0, 10);

async function main() {
  const school = await prisma.school.findUnique({ where: { code: 'GRACE' } });
  if (!school) { console.log('GRACE school not found — run seed-demo.js first.'); return; }
  const SCHOOL_ID = school.id;

  if (!(await prisma.oneTimePass.findFirst({ where: { qr_code: 'OTP-0001' } }))) {
    await prisma.oneTimePass.create({ data: {
      school_id: SCHOOL_ID, parent_id: 'demo_par1', parent_name: 'Nkechi Nwosu',
      child_id: 'demo_stu3', child_name: 'Ifeoma Nwosu', purpose: 'pickup', qr_code: 'OTP-0001',
      status: 'active', valid_until: hoursAgo(-4), created_by: 'demo-seed',
    } });
  }

  if (!(await prisma.visitor.findFirst({ where: { qr_code: 'V-014' } }))) {
    await prisma.visitor.create({ data: {
      school_id: SCHOOL_ID, visitor_name: 'Grace Effiong', visitor_phone: '+234 803 555 6666',
      purpose: 'Maintenance', host_name: 'Chidi Okafor', visit_date: todayStr(), status: 'checked_in',
      check_in_time: hoursAgo(2), badge_number: 'V-014', qr_code: 'V-014', created_by: 'demo-seed',
    } });
  }

  if (!(await prisma.securityAlert.findFirst({ where: { title: 'Unregistered visitor at Main Gate' } }))) {
    await prisma.securityAlert.createMany({ data: [
      { school_id: SCHOOL_ID, alert_type: 'unauthorized_access', severity: 'medium', title: 'Unregistered visitor at Main Gate', message: 'Please verify identity.', status: 'unread', created_by: 'demo-seed' },
      { school_id: SCHOOL_ID, alert_type: 'suspicious_activity', severity: 'low', title: 'Gate held open', message: 'Side Gate reported open for 5 min.', status: 'unread', created_by: 'demo-seed' },
    ] });
  }

  if (!(await prisma.schoolBus.findFirst({ where: { bus_number: 'BUS-01', school_id: SCHOOL_ID } }))) {
    await prisma.schoolBus.create({ data: {
      school_id: SCHOOL_ID, bus_name: 'Bus 1', bus_number: 'BUS-01', plate_number: 'LAG-234-XY',
      driver_name: 'Musa Ibrahim', driver_phone: '+234 803 000 0170', route_name: 'North Route', capacity: 40,
      is_active: true, current_status: 'idle', assigned_security_email: 'security@grace.ng',
      assigned_security_name: 'Emeka Balogun', assigned_student_ids: ['demo_stu1'], stops: ['Ikeja', 'Maryland', 'Yaba'],
      created_by: 'demo-seed',
    } });
  }

  if (!(await prisma.message.findFirst({ where: { subject: 'Welcome to the new term', school_id: SCHOOL_ID } }))) {
    await prisma.message.createMany({ data: [
      { school_id: SCHOOL_ID, subject: 'Welcome to the new term', body: 'We are excited to welcome everyone back.', sender_id: 'demo_admin', sender_name: 'Chidi Okafor', sender_role: 'admin', recipient_type: 'all', priority: 'normal', status: 'sent', read_by: [], created_by: 'demo-seed' },
      { school_id: SCHOOL_ID, subject: 'Bus route change', body: 'North Route will have a temporary stop change this week.', sender_id: 'demo_admin', sender_name: 'Chidi Okafor', sender_role: 'admin', recipient_type: 'role', recipient_role: 'parent', priority: 'high', status: 'sent', read_by: [], created_by: 'demo-seed' },
    ] });
  }

  console.log('Demo extras complete: one-time pass, visitor, alerts, bus, messages.');
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
