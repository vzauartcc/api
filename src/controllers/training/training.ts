import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import getUser from '../../middleware/user.js';
import { TrainingRequestMilestoneModel } from '../../models/trainingMilestone.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';
import requestRouter from './requests.js';
import sessionRouter from './sessions.js';
import soloRouter from './soloendorsements.js';

const router = Router();

router.use('/request', requestRouter);
router.use('/session', sessionRouter);
router.use('/solo', soloRouter);

router.get('/milestones', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const user = await UserModel.findOne({ cid: req.user.cid })
			.select('trainingMilestones rating')
			.populate('trainingMilestones', 'code name rating')
			.lean()
			.cache('10 minutes', `milestone-users-${req.user.cid}`)
			.exec();

		const milestones = await TrainingRequestMilestoneModel.find()
			.sort({ rating: 'asc', code: 'asc' })
			.lean()
			.cache('1 day', `milestones`)
			.exec();

		return res.status(status.OK).json({ user, milestones });
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

export default router;
