/**
 * Removing a person from the roll.
 *
 * Person rows are referenced by id from several places that are plain string
 * columns, not foreign keys, so deleting a Person leaves those references
 * pointing at nothing unless they are cleaned up here.
 *
 * What goes and what stays is a deliberate split:
 *
 *   Goes  — live state that would otherwise be wrong: a seat on a bus, an
 *           active pickup pass, the login that could still sign in.
 *   Stays — history. Access logs keep person_name, so "who came through the
 *           gate last Tuesday" survives. Deleting a duplicate record must not
 *           quietly rewrite the school's attendance history.
 */
export async function detachPerson(prisma, { personId, schoolId }) {
  const detached = { buses: 0, passes: 0, logins: 0 };
  if (!personId) return detached;

  // Off any bus they were riding.
  const buses = await prisma.schoolBus.findMany({
    where: {
      ...(schoolId ? { school_id: schoolId } : {}),
      assigned_student_ids: { has: personId },
    },
    select: { id: true, assigned_student_ids: true },
  });
  for (const bus of buses) {
    await prisma.schoolBus.update({
      where: { id: bus.id },
      data: { assigned_student_ids: bus.assigned_student_ids.filter((id) => id !== personId) },
    });
    detached.buses += 1;
  }

  // Any pass that could still open a gate for them.
  const passes = await prisma.oneTimePass.updateMany({
    where: { child_id: personId, status: 'active' },
    data: { status: 'revoked' },
  });
  detached.passes = passes.count;

  // The login stops existing with the person it belonged to.
  const logins = await prisma.user.deleteMany({ where: { person_id: personId } });
  detached.logins = logins.count;

  return detached;
}
