import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import {
  loadEntity,
  list,
  query,
  count,
  getOne,
  create,
  bulkCreate,
  update,
  remove,
} from '../controllers/entity.controller.js';

// Generic RESTful resource router mounted at /api/entities.
// Every entity from the Prisma schema is reachable as /api/entities/:entity.
const router = Router();

router.use(requireAuth);
router.param('entity', loadEntity);

router.get('/:entity', asyncHandler(list));
router.post('/:entity/query', asyncHandler(query));
router.get('/:entity/count', asyncHandler(count));
router.post('/:entity/bulk', asyncHandler(bulkCreate));
router.post('/:entity', asyncHandler(create));
router.get('/:entity/:id', asyncHandler(getOne));
router.put('/:entity/:id', asyncHandler(update));
router.patch('/:entity/:id', asyncHandler(update));
router.delete('/:entity/:id', asyncHandler(remove));

export default router;
