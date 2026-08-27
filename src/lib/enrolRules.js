/**
 * Enrolment rules that need no database — kept here so the route and the tests
 * exercise the same code rather than two copies that drift apart.
 */

/** Spreadsheet pastes carry stray and doubled spaces; the roll should not. */
export function normaliseName(value) {
  return (value || '').trim().replace(/\s+/g, ' ');
}

/**
 * A row may insist that a name collision is a genuine namesake. A CSV cell
 * arrives as text, so accept the spellings a person actually types.
 */
export function allowsNamesake(value) {
  return value === true || /^(true|yes|y|1)$/i.test(String(value ?? '').trim());
}

/**
 * Why this row must not be enrolled, or null to go ahead.
 *
 * Email is the primary key: one address is one human, and a repeat is never a
 * coincidence, so it cannot be overridden. Exact name is the secondary key,
 * which is what catches children — they have no address of their own — and
 * that one can be overridden per row for a real namesake.
 */
export function duplicateError(dup, { name, email, allowNamesake }) {
  if (!dup) return null;
  if (dup.on === 'email') {
    return {
      code: 'duplicate_email',
      message: `${email} is already enrolled here as ${dup.person.full_name}. One email address belongs to one person.`,
    };
  }
  if (allowNamesake) return null;
  return {
    code: 'duplicate_name',
    // Deliberately does not mention a spreadsheet column: this fires from the
    // enrolment form too, where there is no such column to set. The caller
    // decides how to offer the override — a checkbox on a form, a column in a
    // sheet — and the code is what tells it this is the overridable rule.
    message: `Someone called ${name} is already enrolled at this school.`,
    conflict: { id: dup.person.id, full_name: dup.person.full_name },
  };
}

/**
 * Is this person already on the roll?
 *
 * Note what is NOT consulted: father_email and mother_email. A parent email is
 * deliberately unconstrained — a family with three children at the school uses
 * the same address three times, and each child is their own person. Only the
 * person's *own* email identifies them, and children have none.
 */
export async function findExisting(prisma, schoolId, { email, name }) {
  const school = { school_id: schoolId || null };

  if (email) {
    const byEmail = await prisma.person.findFirst({
      where: { ...school, email: { equals: email, mode: 'insensitive' } },
      select: { id: true, full_name: true, email: true },
    });
    if (byEmail) return { person: byEmail, on: 'email' };
  }

  const byName = await prisma.person.findFirst({
    where: { ...school, full_name: { equals: name, mode: 'insensitive' } },
    select: { id: true, full_name: true, email: true },
  });
  return byName ? { person: byName, on: 'name' } : null;
}
