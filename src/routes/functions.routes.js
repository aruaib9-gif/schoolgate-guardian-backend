import { Router } from 'express';
import { requireAuthOrCron } from '../middleware/auth.js';
import { asyncHandler, notFound } from '../middleware/error.js';
import { crmFollowUpReminders } from '../functions/crmFollowUpReminders.js';
import { crmStageEmailSequence } from '../functions/crmStageEmailSequence.js';
import { notifyBusEvent } from '../functions/notifyBusEvent.js';
import { sendAbsenceReport } from '../functions/sendAbsenceReport.js';
import { notifySubscriptions } from '../functions/notifySubscriptions.js';

// Registry of callable server functions (ports of the original serverless fns).
const FUNCTIONS = {
  crmFollowUpReminders: () => crmFollowUpReminders(),
  crmStageEmailSequence: (payload) => crmStageEmailSequence(payload),
  notifyBusEvent: (payload) => notifyBusEvent(payload),
  sendAbsenceReport: (payload) => sendAbsenceReport(payload || {}),
  notifySubscriptions: () => notifySubscriptions(),
};

const router = Router();

// Named routes: POST /functions/:name
// Auth: a logged-in user OR the scheduler (x-cron-secret header).
router.post(
  '/:name',
  requireAuthOrCron,
  asyncHandler(async (req, res) => {
    const fn = FUNCTIONS[req.params.name];
    if (!fn) throw notFound(`Unknown function "${req.params.name}"`);
    const result = await fn(req.body || {});
    res.json(result);
  })
);

// Generic invoke: POST /functions  { name, payload }  (mirrors functions.invoke)
router.post(
  '/',
  requireAuthOrCron,
  asyncHandler(async (req, res) => {
    const { name, payload } = req.body || {};
    const fn = FUNCTIONS[name];
    if (!fn) throw notFound(`Unknown function "${name}"`);
    const result = await fn(payload || {});
    res.json(result);
  })
);

// GET /functions — list available function names
router.get('/', requireAuthOrCron, (req, res) => {
  res.json({ functions: Object.keys(FUNCTIONS) });
});

export default router;
