import { captureException } from '@sentry/node';
import { Router, type Request, type Response } from 'express';
import { convertToReturnDetails } from '../app.js';
import { hasRole } from '../middleware/auth.js';
import getUser from '../middleware/user.js';
import { DossierModel } from '../models/dossier.js';
import { FeedbackModel } from '../models/feedback.js';
import { NotificationModel } from '../models/notification.js';
import { UserModel } from '../models/user.js';

const router = Router();

router.get(
	'/',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'wm']),
	async (req: Request, res: Response) => {
		try {
			const page = +(req.query['page'] as string) || 1;
			const limit = +(req.query['limit'] as string) || 20;

			const amount = await FeedbackModel.countDocuments({
				$or: [{ approved: true }, { deleted: true }],
			}).exec();
			const feedback = await FeedbackModel.find({
				$or: [{ approved: true }, { deleted: true }],
			})
				.skip(limit * (page - 1))
				.limit(limit)
				.sort({ createdAt: 'desc' })
				.populate('controller', 'fname lname cid')
				.lean()
				.exec();

			res.stdRes.data = {
				amount,
				feedback,
			};
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.post('/', async (req: Request, res: Response) => {
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
				code: 400,
				message: 'You must fill out all required forms',
			};
		}

		if (req.body.comments && req.body.comments.length > 5000) {
			throw {
				code: 400,
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

		await DossierModel.create({
			by: req.body.cid,
			affected: req.body.controller,
			action: `%b submitted feedback about %a.`,
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get('/controllers', async (_req: Request, res: Response) => {
	// Controller list on feedback page
	try {
		const controllers = await UserModel.find({ deletedAt: null, member: true })
			.sort('fname')
			.select('fname lname cid rating vis _id')
			.lean()
			.exec();
		res.stdRes.data = controllers;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get(
	'/unapproved',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'wm']),
	async (_req: Request, res: Response) => {
		// Get all unapproved feedback
		try {
			const feedback = await FeedbackModel.find({ deletedAt: null, approved: false })
				.populate('controller', 'fname lname cid')
				.sort({ createdAt: 'desc' })
				.lean()
				.exec();
			res.stdRes.data = feedback;
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.put(
	'/approve/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'wm']),
	async (req: Request, res: Response) => {
		// Approve feedback
		try {
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
					code: 400,
					message: 'Bad Request.',
				};
			}

			await NotificationModel.create({
				recipient: approved.controller!.cid,
				read: false,
				title: 'New Feedback Received',
				content: `You have received new feedback from ${approved.anonymous ? '<b>Anonymous</b>' : '<b>' + approved.name + '</b>'}.`,
				link: '/dash/feedback',
			});

			await DossierModel.create({
				by: req.user!.cid,
				affected: approved.controllerCid,
				action: `%b approved feedback for %a.`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.put(
	'/reject/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'wm']),
	async (req: Request, res: Response) => {
		// Reject feedback
		try {
			const feedback = await FeedbackModel.findOne({ _id: req.params['id'] }).exec();
			if (!feedback) {
				throw {
					code: 404,
					message: 'Feedback Not Found.',
				};
			}

			await feedback.delete();

			await DossierModel.create({
				by: req.user!.cid,
				affected: feedback.controllerCid,
				action: `%b rejected feedback for %a.`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			captureException(e);
		}

		return res.json(res.stdRes);
	},
);

router.get('/own', getUser, async (req: Request, res: Response) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 10;

		const amount = await FeedbackModel.countDocuments({
			approved: true,
			controllerCid: req.user!.cid,
		}).exec();
		const feedback = await FeedbackModel.aggregate([
			{
				$match: {
					controllerCid: req.user!.cid,
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
		]).exec();

		res.stdRes.data = {
			feedback,
			amount,
		};
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		captureException(e);
	}

	return res.json(res.stdRes);
});

export default router;
