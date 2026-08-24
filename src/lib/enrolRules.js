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
    return `Skipped — ${email} is already enrolled here as ${dup.person.full_name}.`;
  }
  if (allowNamesake) return null;
  return `Skipped — ${name} is already enrolled here. If this is a different person with the same name, set allow_duplicate_name to true on this row.`;
}
