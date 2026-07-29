/**
 * create-superadmin.js — provision an additional superadmin account.
 *
 *   node scripts/create-superadmin.js <email> "<full name>" [password]
 *
 * Uses DATABASE_URL from .env. If no password is given, a strong random one
 * is generated and printed ONCE — store it, then change it after first login.
 * Idempotent: refuses to overwrite an existing account with the same email.
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

const [email, fullName, passwordArg] = process.argv.slice(2);
if (!email || !fullName) {
  console.error('Usage: node scripts/create-superadmin.js <email> "<full name>" [password]');
  process.exit(1);
}

const normalizedEmail = email.trim().toLowerCase();
// base64url gives ~4 bits+/char with no shell-hostile characters.
const password = passwordArg || randomBytes(12).toString('base64url');

const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
if (existing) {
  console.error(`An account with ${normalizedEmail} already exists (${existing.user_category || existing.role}) — nothing changed.`);
  process.exit(1);
}

const password_hash = await bcrypt.hash(password, 10);
const user = await prisma.user.create({
  data: {
    email: normalizedEmail,
    password_hash,
    role: 'admin',
    user_category: 'superadmin',
    full_name: fullName,
    is_active: true,
    profile_completed: true,
    created_by: 'create-superadmin script',
  },
});

console.log(`Created superadmin ${user.full_name} <${user.email}> (id ${user.id})`);
if (!passwordArg) console.log(`Generated password (shown once): ${password}`);
console.log('Have them change the password after first login.');
await prisma.$disconnect();
