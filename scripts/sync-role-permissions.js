/**
 * sync-role-permissions.js — bring the global role permission rows up to date.
 *
 *   node scripts/sync-role-permissions.js [--dry-run]
 *
 * Permissions live in the database, so a release that changes what a role may
 * do does nothing until these rows are rewritten. The full seed would also do
 * it, but the full seed creates a superadmin, schools and invitations as well,
 * which is not something to run at a school that is already operating.
 *
 * Only GLOBAL rows (school_id null) are touched. A school that has customised
 * its own roles keeps that customisation, because those rows carry a school_id
 * and are left exactly as they are.
 *
 * The running API caches permissions for 15 seconds, so a change takes effect
 * within about that long. No restart needed.
 */
import { prisma } from '../src/lib/prisma.js';
import { ROLE_PRESETS } from '../src/lib/rolePresets.js';

const dryRun = process.argv.includes('--dry-run');

/**
 * Describe one resource's grants compactly: "create view:self".
 *
 * Sorted, because the database returns a JSON object whose keys are in
 * whatever order they were stored and the preset's are in source order. Left
 * unsorted, every unchanged role reported a difference and the one role that
 * had really changed was lost among them.
 */
function describe(resourcePerms) {
  const parts = [];
  for (const [action, value] of Object.entries(resourcePerms || {})) {
    if (value === true) parts.push(action);
    else if (typeof value === 'string') parts.push(`${action}:${value}`);
  }
  return parts.sort().join(' ') || '—';
}

function diff(before, after) {
  const changes = [];
  const resources = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const r of [...resources].sort()) {
    const b = describe(before?.[r]);
    const a = describe(after?.[r]);
    if (b !== a) changes.push(`      ${r}: ${b}  ->  ${a}`);
  }
  return changes;
}

let changed = 0;
let created = 0;

for (const [role_name, preset] of Object.entries(ROLE_PRESETS)) {
  const existing = await prisma.rolePermissions.findFirst({ where: { role_name, school_id: null } });

  if (!existing) {
    console.log(`  + ${role_name} (new)`);
    if (!dryRun) {
      await prisma.rolePermissions.create({
        data: { role_name, school_id: null, permissions: preset.permissions, description: preset.description, is_active: true },
      });
    }
    created++;
    continue;
  }

  const changes = diff(existing.permissions, preset.permissions);
  if (!changes.length && existing.description === preset.description && existing.is_active) continue;

  console.log(`  ~ ${role_name}`);
  for (const line of changes) console.log(line);
  if (!dryRun) {
    await prisma.rolePermissions.update({
      where: { id: existing.id },
      data: { permissions: preset.permissions, description: preset.description, is_active: true },
    });
  }
  changed++;
}

const schoolRows = await prisma.rolePermissions.count({ where: { school_id: { not: null } } });

console.log('');
console.log(dryRun
  ? `Dry run — nothing written. ${changed} role(s) would change, ${created} would be created.`
  : `Done. ${changed} role(s) updated, ${created} created.`);
if (schoolRows) {
  console.log(`${schoolRows} school-specific row(s) left untouched — those are local customisations.`);
}
await prisma.$disconnect();
