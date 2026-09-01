import { Router } from 'express';
import milestonesRouter from './milestones.js';
import rubricRouter from './ratingexam.js';
import requestRouter from './requests.js';
import sessionRouter from './sessions.js';
import soloRouter from './soloendorsements.js';
import waitlistRouter from './waitlist.js';

const router = Router();

router.use('/milestones', milestonesRouter);
router.use('/request', requestRouter);
router.use('/rubric', rubricRouter);
router.use('/session', sessionRouter);
router.use('/solo', soloRouter);
router.use('/waitlist', waitlistRouter);

export default router;
