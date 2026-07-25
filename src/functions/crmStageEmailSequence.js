import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';

// Entity automation: triggered when a CRMLead moves to proposal/negotiation.
// Payload: { data: lead, old_data: oldLead }
// Port of base44 function crmStageEmailSequence.
export async function crmStageEmailSequence(payload = {}) {
  const lead = payload.data;
  const oldLead = payload.old_data;

  if (!lead) return { skipped: true, reason: 'no lead data' };

  const newStatus = lead.status;
  const oldStatus = oldLead?.status;

  if (newStatus === oldStatus) return { skipped: true, reason: 'status unchanged' };
  if (!['proposal', 'negotiation'].includes(newStatus)) return { skipped: true, reason: 'not a trigger stage' };

  const assignedEmail = lead.assigned_to;
  if (!assignedEmail) return { skipped: true, reason: 'no assigned rep' };

  const emailTemplates = {
    proposal: {
      subject: `🎯 Lead Moved to Proposal: ${lead.title}`,
      body: `
Hi ${lead.assigned_to_name || 'Sales Rep'},

Great progress! The lead "${lead.title}" has moved to the Proposal stage.

Lead Details:
• Company: ${lead.company || 'N/A'}
• Contact: ${lead.contact_name || 'N/A'} (${lead.contact_email || 'N/A'})
• Estimated Value: ₦${(lead.estimated_value || 0).toLocaleString()}
• Win Probability: ${lead.probability || 50}%

Recommended next steps:
1. Prepare and send a detailed proposal document
2. Schedule a presentation meeting within 48 hours
3. Address any objections proactively
4. Set a follow-up reminder for 3-5 business days

${lead.contact_email ? `The lead's email is: ${lead.contact_email}` : ''}

Good luck! 🚀

— School Guardian CRM
      `.trim(),
    },
    negotiation: {
      subject: `💼 Lead in Negotiation: ${lead.title}`,
      body: `
Hi ${lead.assigned_to_name || 'Sales Rep'},

You're in the negotiation stage for "${lead.title}" — you're close to closing!

Lead Details:
• Company: ${lead.company || 'N/A'}
• Contact: ${lead.contact_name || 'N/A'}
• Estimated Value: ₦${(lead.estimated_value || 0).toLocaleString()}
• Win Probability: ${lead.probability || 70}%

Negotiation tips:
1. Understand the decision-maker's key concerns
2. Identify your walk-away point before entering discussions
3. Offer time-limited incentives if appropriate
4. Document all agreements in writing

Keep pushing — you've got this! 💪

— School Guardian CRM
      `.trim(),
    },
  };

  const template = emailTemplates[newStatus];

  await sendEmail({ to: assignedEmail, subject: template.subject, body: template.body, from_name: 'School Guardian CRM' });

  if (newStatus === 'proposal' && lead.contact_email) {
    await sendEmail({
      to: lead.contact_email,
      subject: `Proposal from School Guardian`,
      body: `
Dear ${lead.contact_name || 'Valued Prospect'},

Thank you for your interest! Our team is preparing a customised proposal for you.

You can expect to hear from ${lead.assigned_to_name || 'our sales team'} (${assignedEmail}) shortly with full details tailored to your needs.

In the meantime, please don't hesitate to reach out with any questions.

Best regards,
School Guardian Team
      `.trim(),
      from_name: 'School Guardian',
    });
  }

  await prisma.cRMActivity.create({
    data: {
      type: 'email',
      title: `Automated: Stage moved to ${newStatus}`,
      description: `Automated email sent to ${assignedEmail} for stage transition from ${oldStatus} to ${newStatus}`,
      lead_id: lead.id,
      related_name: lead.title,
      sales_rep_email: lead.assigned_to,
      sales_rep_name: lead.assigned_to_name,
      school_id: lead.school_id,
      status: 'completed',
      completed_at: new Date(),
    },
  });

  return { success: true, stage: newStatus, sent_to: assignedEmail };
}
