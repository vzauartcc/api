import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance } from '../../app.js';
import { getUsersWithPrivacy } from '../../helpers/mongodb.js';
import { isSeniorStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { DossierModel } from '../../models/dossier.js';
import { FeedbackModel } from '../../models/feedback.js';
import { NotificationModel } from '../../models/notification.js';
import status from '../../types/status.js';

const router = Router();

router.get('/', getUser, isSeniorStaff, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 20;

		const amount = await FeedbackModel.countDocuments({
			$or: [{ approved: true }, { deleted: true }],
		})
			.cache('5 minutes', 'feedback-count')
			.exec();
		const feedback = await FeedbackModel.find({
			$or: [{ approved: true }, { deleted: true }],
		})
			.skip(limit * (page - 1))
			.limit(limit)
			.sort({ createdAt: 'desc' })
			.populate('controller', 'fname lname cid')
			.lean()
			.cache()
			.exec();

		return res.status(status.OK).json({ amount, feedback });
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/own', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 10;

		const amount = await FeedbackModel.countDocuments({
			approved: true,
			controllerCid: req.user.cid,
		})
			.cache()
			.exec();
		const feedback = await FeedbackModel.aggregate([
			{
				$match: {
					controllerCid: req.user.cid,
					approved: true,
				},
			},
			{
				$project: {
					controller: 1,
					position: 1,
					rating: 1,
					comments: 1,
					createdAt: 1,
					anonymous: 1,
					name: { $cond: ['$anonymous', '$$REMOVE', '$name'] }, // Conditionally remove name if submitter wishes to remain anonymous
				},
			},
			{ $sort: { createdAt: -1 } },
			{ $skip: limit * (page - 1) },
			{ $limit: limit },
		])
			.cache()
			.exec();

		return res.status(status.OK).json({ feedback, amount });
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
	// Submit feedback
	try {
		if (
			req.body.name === '' ||
			req.body.email === '' ||
			req.body.cid === null ||
			req.body.controller === null ||
			req.body.rating === null ||
			req.body.position === null ||
			req.body.comments === ''
		) {
			// Validation
			throw {
				code: status.BAD_REQUEST,
				message: 'You must fill out all required forms',
			};
		}

		if (req.body.comments && req.body.comments.length > 5000) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Comments must not exceed 5000 characters in length',
			};
		}

		await FeedbackModel.create({
			name: req.body.name,
			email: req.body.email,
			submitter: req.body.cid,
			controllerCid: req.body.controller,
			rating: req.body.rating,
			position: req.body.position,
			comments: req.body.comments,
			anonymous: req.body.anon,
			approved: false,
		});
		await getCacheInstance().clear('feedback-count');

		await DossierModel.create({
			by: req.body.cid,
			affected: req.body.controller,
			action: `%b submitted feedback about %a.`,
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/controllers', getUser, async (req: Request, res: Response, next: NextFunction) => {
	// Controller list on feedback page, and used in various other places to only return a trimmed list of controllers
	try {
		const allUsers = await getUsersWithPrivacy(req.user, {
			deletedAt: null,
			member: true,
		});
		const controllers = [];

		for (const user of allUsers) {
			controllers.push({
				_id: user.id,
				fname: user.fname,
				lname: user.lname,
				cid: user.cid,
				rating: user.rating,
				vis: user.vis,
			});
		}

		controllers.sort((a, b) => {
			const nameA = a.fname.toUpperCase();
			const nameB = b.fname.toUpperCase();

			if (nameA < nameB) return -1;

			if (nameA > nameB) return 1;

			const aName = a.lname.toUpperCase();
			const bName = b.lname.toUpperCase();

			if (aName < bName) return -1;

			if (aName > bName) return 1;

			return 0;
		});

		return res.status(status.OK).json(controllers);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get(
	'/unapproved',
	getUser,
	isSeniorStaff,
	async (_req: Request, res: Response, next: NextFunction) => {
		// Get all unapproved feedback
		try {
			const feedback = await FeedbackModel.find({ deletedAt: null, approved: false })
				.populate('controller', 'fname lname cid')
				.sort({ createdAt: 'desc' })
				.lean()
				.cache('1 minute', 'feedback-unapproved')
				.exec();

			return res.status(status.OK).json(feedback);
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.patch(
	'/:id/approve',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		// Approve feedback
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid ID.',
				};
			}

			const approved = await FeedbackModel.findOneAndUpdate(
				{ _id: req.params['id'] },
				{
					approved: true,
				},
			)
				.populate('controller', 'cid')
				.exec();

			if (!approved) {
				throw {
					code: status.NOT_FOUND,
					message: 'Feedback entry not found',
				};
			}

			await getCacheInstance().clear(`feedback-${approved.id}`);
			await getCacheInstance().clear('feedback-unapproved');
			await getCacheInstance().clear('feedback-count');

			await NotificationModel.create({
				recipient: approved.controller!.cid,
				read: false,
				title: 'New Feedback Received',
				content: `You have received new feedback from ${approved.anonymous ? '<b>Anonymous</b>' : '<b>' + approved.name + '</b>'}.`,
				link: '/dash/feedback',
			});

			await DossierModel.create({
				by: req.user.cid,
				affected: approved.controllerCid,
				action: `%b approved feedback for %a.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.patch(
	'/:id/reject',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		// Reject feedback
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid ID.',
				};
			}

			const feedback = await FeedbackModel.findOne({ _id: req.params['id'] })
				.cache('1 minute', `feedback-${req.params['id']}`)
				.exec();
			if (!feedback) {
				throw {
					code: status.NOT_FOUND,
					message: 'Feedback entry not found',
				};
			}

			await feedback.delete();
			await getCacheInstance().clear(`feedback-${feedback.id}`);
			await getCacheInstance().clear('feedback-unapproved');
			await getCacheInstance().clear('feedback-count');

			await DossierModel.create({
				by: req.user.cid,
				affected: feedback.controllerCid,
				action: `%b rejected feedback for %a.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

export default router;
