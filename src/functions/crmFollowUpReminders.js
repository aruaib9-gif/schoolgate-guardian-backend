import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';

// Scheduled daily job: send follow-up reminder emails for leads due today or
// overdue. Port of base44 function crmFollowUpReminders.
export async function crmFollowUpReminders() {
  const today = new Date().toISOString().split('T')[0];
  const allLeads = await prisma.cRMLead.findMany();

  const dueLeads = allLeads.filter((lead) => {
    if (!lead.next_follow_up) return false;
    if (['won', 'lost'].includes(lead.status)) return false;
    return lead.next_follow_up <= today;
  });

  const results = [];
  for (const lead of dueLeads) {
    const assignedEmail = lead.assigned_to;
    if (!assignedEmail) continue;

    const isOverdue = lead.next_follow_up < today;
    const subject = isOverdue ? `⚠️ Overdue Follow-up: ${lead.title}` : `📅 Follow-up Reminder: ${lead.title}`;

    const body = `
Hi ${lead.assigned_to_name || 'Sales Rep'},

You have a ${isOverdue ? 'overdue' : 'scheduled'} follow-up for the lead below:

• Lead: ${lead.title}
• Company: ${lead.company || 'N/A'}
• Contact: ${lead.contact_name || 'N/A'} (${lead.contact_email || 'no email'})
• Status: ${lead.status}
• Follow-up date: ${lead.next_follow_up}
• Estimated Value: ₦${(lead.estimated_value || 0).toLocaleString()}
${lead.notes ? `\nNotes: ${lead.notes}` : ''}

Please take action on this lead today.

— School Guardian CRM
    `.trim();

    await sendEmail({ to: assignedEmail, subject, body, from_name: 'School Guardian CRM' });
    results.push({ lead_id: lead.id, title: lead.title, sent_to: assignedEmail });
  }

  return { success: true, reminders_sent: results.length, leads: results };
}
