import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';
import { emitEntityEvent } from '../lib/realtime.js';

// Notify parents when a student boards / is dropped off by the school bus.
// Payload may be a raw scan log or an automation wrapper { data: scanLog }.
// Port of base44 function notifyBusEvent.
export async function notifyBusEvent(payload = {}) {
  const scanLog = payload.data || payload;
  const {
    person_id,
    action,
    bus_name,
    bus_number,
    driver_name,
    guardian_name,
    scanned_by_name,
    stop_name,
    school_id,
  } = scanLog;

  if (!person_id || !action) {
    const err = new Error('person_id and action are required');
    err.status = 400;
    throw err;
  }

  if (action !== 'boarded' && action !== 'dropped_off') {
    return { message: 'No notification needed for action: ' + action, action };
  }

  const student = await prisma.person.findUnique({ where: { id: person_id } });
  if (!student) {
    const err = new Error('Student not found');
    err.status = 404;
    throw err;
  }

  const parentWhere = school_id ? { school_id, category: 'parent' } : { category: 'parent' };
  const allParents = await prisma.person.findMany({ where: parentWhere });
  const linkedParents = allParents.filter((p) => (p.linked_children || []).includes(person_id));

  const parentEmails = new Map();
  if (student.father_email) parentEmails.set(student.father_email, 'Father');
  if (student.mother_email) parentEmails.set(student.mother_email, 'Mother');
  linkedParents.forEach((p) => {
    if (p.email) parentEmails.set(p.email, p.full_name);
  });

  if (parentEmails.size === 0) {
    return { success: true, message: 'No parent contacts found for this student', notified: false };
  }

  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  let subject, body;
  if (action === 'boarded') {
    subject = '🚌 Bus Boarding Alert: ' + student.full_name;
    body = [
      'Dear Parent,',
      '',
      'This is to inform you that ' + student.full_name + ' has boarded the school bus.',
      '',
      'Bus Details:',
      '• Bus: ' + (bus_name || 'N/A') + (bus_number ? ' (' + bus_number + ')' : ''),
      '• Driver: ' + (driver_name || 'N/A'),
      stop_name ? '• Boarded at: ' + stop_name : '',
      '• Time: ' + timestamp,
      '',
      'Your child is safely on board the bus.',
      '',
      'Regards,',
      'School Guardian System',
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    subject = '🏠 Bus Drop-off Alert: ' + student.full_name;
    body = [
      'Dear Parent,',
      '',
      'This is to inform you that ' + student.full_name + ' has been safely dropped off.',
      '',
      'Bus Details:',
      '• Bus: ' + (bus_name || 'N/A') + (bus_number ? ' (' + bus_number + ')' : ''),
      '• Driver: ' + (driver_name || 'N/A'),
      guardian_name ? '• Confirmed by guardian: ' + guardian_name : '',
      stop_name ? '• Drop-off location: ' + stop_name : '',
      '• Time: ' + timestamp,
      '',
      "Your child has been dropped off and the guardian's QR was verified.",
      '',
      'Regards,',
      'School Guardian System',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const results = { messages: [], emails: [] };

  for (const parent of linkedParents) {
    try {
      await prisma.message.create({
        data: {
          subject,
          body,
          sender_id: scanned_by_name || 'bus_system',
          sender_name: 'School Bus System',
          sender_role: 'school_bus_admin',
          recipient_type: 'individual',
          recipient_id: parent.id,
          recipient_name: parent.full_name,
          priority: 'high',
          status: 'sent',
          school_id: school_id || parent.school_id || undefined,
        },
      });
      emitEntityEvent('Message', 'create', undefined, school_id || parent.school_id);
      results.messages.push({ parent_id: parent.id, status: 'sent' });
    } catch (e) {
      results.messages.push({ parent_id: parent.id, error: e.message });
    }
  }

  for (const [email] of parentEmails) {
    try {
      await sendEmail({ to: email, subject, body });
      results.emails.push({ email, status: 'sent' });
    } catch (e) {
      results.emails.push({ email, error: e.message });
    }
  }

  return {
    success: true,
    student: student.full_name,
    action,
    parents_notified: results.messages.filter((m) => m.status === 'sent').length,
    emails_sent: results.emails.filter((e) => e.status === 'sent').length,
    results,
  };
}
