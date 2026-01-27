import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance } from '../../app.js';
import {
	throwBadRequestException,
	throwForbiddenException,
	throwNotFoundException,
} from '../../helpers/errors.js';
import { isSeniorStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { TrainingRequestMilestoneModel } from '../../models/trainingMilestone.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();

router.get('/', getUser, async (req: Request, res: Response, next: NextFunction) => {
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
		return next(e);
	}
});

router.post(
	'/',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.body ||
				!req.body.code.trim() ||
				req.body.code.length > 4 ||
				!req.body.name.trim() ||
				!req.body.certCode.trim() ||
				req.body.rating < 0 ||
				req.body.rating > 5
			) {
				throwBadRequestException('Invalid request');
			}

			const existing = await TrainingRequestMilestoneModel.findOne({
				code: req.body.code.toUpperCase(),
			})
				.lean()
				.exec();
			if (existing) {
				throwBadRequestException('Milestone already exists');
			}

			const milestone = await TrainingRequestMilestoneModel.create({
				code: req.body.code.toUpperCase(),
				name: req.body.name,
				rating: Number(req.body.rating),
				certCode: req.body.certCode.toLowerCase(),
				isActive: true,
			});

			getCacheInstance().clear('milestones');

			return res.status(status.CREATED).json(milestone);
		} catch (e) {
			return next(e);
		}
	},
);

router.patch(
	'/order',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.body || !Array.isArray(req.body)) {
				throwBadRequestException('Invalid request');
			}

			const data = [...req.body];

			const ops = data.map((id, index) => ({
				updateOne: {
					filter: { _id: id },
					update: { $set: { order: index } },
				},
			}));

			await TrainingRequestMilestoneModel.bulkWrite(ops);

			getCacheInstance().clear('milestones');
			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.patch(
	'/:id',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || !req.params['id'].trim() || req.params['id'] === 'undefined') {
				throwBadRequestException('Invalid ID');
			}

			const milestone = await TrainingRequestMilestoneModel.findById(req.params['id']).exec();
			if (!milestone) {
				throwNotFoundException('Milestone Not Found');
			}

			if (milestone.code === 'UNKNOWN') {
				throwForbiddenException('Milestone Cannot Be Modified');
			}

			milestone.code = req.body.code.toUpperCase();
			milestone.name = req.body.name;
			milestone.rating = Number(req.body.rating);
			milestone.certCode = req.body.certCode.toLowerCase();
			milestone.isActive = Boolean(req.body.isActive);

			const updated = await milestone.save();

			getCacheInstance().clear('milestones');

			return res.status(status.OK).json(updated);
		} catch (e) {
			return next(e);
		}
	},
);

export default router;
