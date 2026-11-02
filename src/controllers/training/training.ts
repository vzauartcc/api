import { Router } from 'express';
import milestonesRouter from './milestones.js';
import ratingExamRouter from './ratingExam.js';
import requestRouter from './requests.js';
import sessionRouter from './sessions.js';
import soloRouter from './soloendorsements.js';
import waitlistRouter from './waitlist.js';

const router = Router();

router.use('/milestones', milestonesRouter);
router.use('/request', requestRouter);
router.use('/ratingExam', ratingExamRouter);
router.use('/session', sessionRouter);
router.use('/solo', soloRouter);
router.use('/waitlist', waitlistRouter);

export default router;
