import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';

// Daily absence report: emails each school's admin a list of staff/students who
// have not scanned in today. Port of base44 function sendAbsenceReport.
// options: { school_id?, test? }
export async function sendAbsenceReport(options = {}) {
  const targetSchoolId = options.school_id;
  const isTest = options.test === true;

  const schools = await prisma.school.findMany();
  const today = new Date().toISOString().split('T')[0];
  const results = [];

  for (const school of schools) {
    if (school.status !== 'active') continue;
    if (targetSchoolId && school.id !== targetSchoolId) continue;

    const [enabledConfigs, timeConfigs] = await Promise.all([
      prisma.systemConfig.findMany({ where: { config_key: `absence_report_enabled_${school.id}` } }),
      prisma.systemConfig.findMany({ where: { config_key: `absence_report_time_${school.id}` } }),
    ]);
    const enabled = enabledConfigs[0]?.config_value === 'true';
    if (!enabled && !isTest) continue;

    const configuredTime = timeConfigs[0]?.config_value || '08:00';
    if (!isTest && !targetSchoolId) {
      const nowLagos = new Date().toLocaleString('en-GB', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const [curH, curM] = nowLagos.split(':').map(Number);
      const [cfgH, cfgM] = configuredTime.split(':').map(Number);
      const curMin = curH * 60 + curM;
      const cfgMin = cfgH * 60 + cfgM;
      if (Math.abs(curMin - cfgMin) > 30) continue;
    }

    const people = await prisma.person.findMany({ where: { school_id: school.id } });
    const staffAndStudents = people.filter(
      (p) =>
        ['student', 'teacher', 'school_worker', 'management', 'security', 'reception'].includes(p.category) &&
        p.active !== false
    );

    // Today's entry logs. Timestamp is a DateTime; compare on the date portion.
    const logs = await prisma.accessLog.findMany({ where: { school_id: school.id, action: 'entry' } });
    const todayEntries = logs.filter((log) => {
      if (!log.timestamp) return false;
      const iso = log.timestamp instanceof Date ? log.timestamp.toISOString() : String(log.timestamp);
      return iso.startsWith(today);
    });
    const scannedInIds = new Set(todayEntries.map((log) => log.person_id));

    const absentees = staffAndStudents.filter((p) => !scannedInIds.has(p.id));

    if (absentees.length === 0) {
      results.push({ school: school.name, absentees: 0, sent: false, reason: 'Everyone scanned in' });
      continue;
    }

    const adminEmail = school.admin_email || school.email;
    if (!adminEmail) {
      results.push({ school: school.name, error: 'No admin email configured' });
      continue;
    }

    const byCategory = {};
    absentees.forEach((p) => {
      if (!byCategory[p.category]) byCategory[p.category] = [];
      byCategory[p.category].push(p);
    });

    const categoryLabels = {
      student: 'Students',
      teacher: 'Teachers',
      school_worker: 'School Workers',
      management: 'Management',
      security: 'Security',
      reception: 'Reception',
    };

    let tableRows = '';
    Object.entries(byCategory).forEach(([category, peopleList]) => {
      tableRows += `
          <tr>
            <td colspan="3" style="background:#f1f5f9;padding:8px 12px;font-weight:bold;color:#1e293b;">
              ${categoryLabels[category] || category} (${peopleList.length})
            </td>
          </tr>`;
      peopleList.forEach((p) => {
        tableRows += `
            <tr>
              <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;">${p.full_name || '—'}</td>
              <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${p.email || '—'}</td>
              <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${p.phone || '—'}</td>
            </tr>`;
      });
    });

    const reportTime = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos' });

    const emailBody = `<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#1d4ed8,#4f46e5);padding:24px;border-radius:12px 12px 0 0;">
    <h1 style="color:white;margin:0;font-size:22px;">${school.name}</h1>
    <p style="color:#bfdbfe;margin:8px 0 0 0;font-size:14px;">Daily Absence Report — ${today}</p>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;">
    <h2 style="color:#1e293b;margin:0 0 16px 0;">Absence Summary</h2>
    <p style="color:#475569;line-height:1.6;margin:0 0 16px 0;">
      The following <strong>${absentees.length}</strong> staff and students have not scanned in to school today as of ${reportTime}.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead>
        <tr style="background:#e2e8f0;">
          <th style="padding:8px 12px;text-align:left;font-size:13px;color:#334155;">Name</th>
          <th style="padding:8px 12px;text-align:left;font-size:13px;color:#334155;">Email</th>
          <th style="padding:8px 12px;text-align:left;font-size:13px;color:#334155;">Phone</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p style="color:#94a3b8;font-size:12px;margin:0;text-align:center;">
      This is an automated report from School Guardian Access Control System.
    </p>
  </div>
</div>`;

    await sendEmail({
      to: adminEmail,
      subject: `Daily Absence Report - ${school.name} - ${today}`,
      body: 'Daily absence report (HTML email).',
      html: emailBody,
    });

    results.push({ school: school.name, absentees: absentees.length, sent: true });
  }

  return { success: true, date: today, results };
}
