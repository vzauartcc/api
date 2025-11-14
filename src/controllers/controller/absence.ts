import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance } from '../../app.js';
import { isManagement } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { AbsenceModel } from '../../models/absence.js';
import { DossierModel } from '../../models/dossier.js';
import { NotificationModel } from '../../models/notification.js';
import status from '../../types/status.js';

const router = Router();

router.get('/', getUser, isManagement, async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const absences = await AbsenceModel.find({
			expirationDate: {
				$gte: new Date(),
			},
			deleted: false,
		})
			.populate('user', 'fname lname cid')
			.sort({
				expirationDate: 'asc',
			})
			.lean()
			.cache('10 minutes', 'absences')
			.exec();

		return res.status(status.OK).json(absences);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.post('/', getUser, isManagement, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (
			!req.body ||
			req.body.controller === '' ||
			req.body.expirationDate === 'T00:00:00.000Z' ||
			req.body.reason === ''
		) {
			throw {
				code: status.BAD_REQUEST,
				message: 'You must fill out all required fields',
			};
		}

		if (new Date(req.body.expirationDate) < new Date()) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Expiration date must be in the future',
			};
		}

		await AbsenceModel.create(req.body);
		await getCacheInstance().clear('absences');

		await NotificationModel.create({
			recipient: req.body.controller,
			title: 'Leave of Absence granted',
			read: false,
			content: `You have been granted a Leave of Absence until <b>${new Date(
				req.body.expirationDate,
			).toLocaleString('en-US', {
				month: 'long',
				day: 'numeric',
				year: 'numeric',
				timeZone: 'UTC',
			})}</b>.`,
		});

		await DossierModel.create({
			by: req.user.cid,
			affected: req.body.controller,
			action: `%b added a leave of absence for %a until ${new Date(req.body.expirationDate).toLocaleDateString()}: ${req.body.reason}`,
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.delete(
	'/:id',
	getUser,
	isManagement,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id']) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid request',
				};
			}

			const absence = await AbsenceModel.findOne({ _id: req.params['id'] }).cache().exec();
			if (!absence) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Unable to locate absence.',
				};
			}

			await absence.delete();
			await getCacheInstance().clear('absences');

			await DossierModel.create({
				by: req.user.cid,
				affected: absence.controller,
				action: `%b deleted the leave of absence for %a.`,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

export default router;
