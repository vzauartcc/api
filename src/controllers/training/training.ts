import { Router } from 'express';
import milestonesRouter from './milestones.js';
import requestRouter from './requests.js';
import sessionRouter from './sessions.js';
import soloRouter from './soloendorsements.js';
import waitlistRouter from './waitlist.js';

const router = Router();

router.use('/request', requestRouter);
router.use('/session', sessionRouter);
router.use('/solo', soloRouter);
router.use('/waitlist', waitlistRouter);
router.use('/milestones', milestonesRouter);

export default router;
