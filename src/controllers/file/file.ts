import { Router, type NextFunction, type Request, type Response } from 'express';
import { throwBadRequestException, throwNotFoundException } from '../../helpers/errors.js';
import { getUploadStatus } from '../../helpers/s3.js';
import status from '../../types/status.js';
import documentsRouter from './documents.js';
import downloadsRouter from './downloads.js';

const router = Router();

router.use('/downloads', downloadsRouter);
router.use('/documents', documentsRouter);

router.get('/checkStatus/:id', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['id'] || req.params['id'] === 'undefined') {
			throwBadRequestException('Invalid ID');
		}

		const progress = getUploadStatus(req.params['id']);

		if (!progress) {
			throwNotFoundException('Not Found');
		}

		return res.status(status.OK).json({ progress });
	} catch (e) {
		return next(e);
	}
});

export default router;
