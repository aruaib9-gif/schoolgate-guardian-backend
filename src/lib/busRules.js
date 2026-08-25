/**
 * A child rides one bus at a time.
 *
 * Boarding is a plain entity update from whichever device is scanning, so two
 * bus admins scanning at once could each add the same child to their own bus
 * and neither would know. The register would then show one child in two places
 * — and at drop-off, one of those buses would be waiting for someone who was
 * never aboard.
 *
 * The rule is enforced here, on the server, rather than in the scanner screen:
 * it has to hold no matter which client does the boarding.
 *
 * Boarding a child *moves* them rather than being refused. Refusing would leave
 * security stuck at the door of the right bus, unable to proceed until someone
 * found the wrong bus and alighted them from it. The move is recorded in the
 * audit log by the caller, and the scanner tells the operator it happened.
 */
export async function clearFromOtherBuses(prisma, { busId, schoolId, studentIds }) {
  const ids = (studentIds || []).filter(Boolean);
  if (!ids.length) return [];

  const others = await prisma.schoolBus.findMany({
    where: {
      ...(busId ? { id: { not: busId } } : {}),
      ...(schoolId ? { school_id: schoolId } : {}),
      assigned_student_ids: { hasSome: ids },
    },
    select: { id: true, bus_name: true, bus_number: true, assigned_student_ids: true },
  });
  if (!others.length) return [];

  const moved = [];
  for (const bus of others) {
    const taken = bus.assigned_student_ids.filter((id) => ids.includes(id));
    await prisma.schoolBus.update({
      where: { id: bus.id },
      data: { assigned_student_ids: bus.assigned_student_ids.filter((id) => !ids.includes(id)) },
    });
    moved.push({
      bus_id: bus.id,
      bus_name: bus.bus_name || bus.bus_number || 'another bus',
      student_ids: taken,
    });
  }
  return moved;
}
