import { Router } from 'express';
import documentsRouter from './documents.js';
import downloadsRouter from './downloads.js';

const router = Router();

router.use('/downloads', downloadsRouter);
router.use('/documents', documentsRouter);

export default router;
