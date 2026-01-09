import { Router, type NextFunction, type Request, type Response } from 'express';
import { DateTime } from 'luxon';
import { getCacheInstance, logException } from '../../app.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import { vatusaApi } from '../../helpers/vatusa.js';
import zau from '../../helpers/zau.js';
import { isInstructor, isTrainingStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { NotificationModel } from '../../models/notification.js';
import { SoloEndorsementModel } from '../../models/soloEndorsement.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();

router.get(
	'/',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const solos = await SoloEndorsementModel.find({
				deleted: false,
			})
				.populate('student', 'fname lname')
				.populate('instructor', 'fname lname')
				.sort({ expires: 'desc' })
				.limit(50)
				.lean({ virtuals: true })
				.cache('10 minutes', 'solos')
				.exec();

			return res.status(status.OK).json(solos);
		} catch (e) {
			logException(req, e);

			return next(e);
		}
	},
);

router.get(
	'/:id',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid ID.',
				};
			}

			const solos = await SoloEndorsementModel.findById(req.params['id'])
				.populate('student', 'fname lname')
				.populate('instructor', 'fname lname')
				.sort({ expires: 'desc' })
				.limit(50)
				.lean({ virtuals: true })
				.cache('10 minutes', `solo-${req.params['id']}`)
				.exec();

			return res.status(status.OK).json(solos);
		} catch (e) {
			logException(req, e);

			return next(e);
		}
	},
);

router.post(
	'/',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.body.student || !req.body.position || !req.body.expirationDate) {
				throw {
					code: status.BAD_REQUEST,
					message: 'All fields are required',
				};
			}

			if (!req.body.expirationDate || isNaN(Date.parse(req.body.expirationDate))) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid request.',
				};
			}

			const student = await UserModel.findOne({ cid: req.body.student }).exec();
			if (!student) {
				throw {
					code: status.NOT_FOUND,
					message: 'Student not found',
				};
			}

			const today = new Date();
			const maxDate = new Date(
				today.getUTCFullYear(),
				today.getUTCMonth(),
				today.getUTCDate() + 45,
			);

			const endDate = new Date(req.body.expirationDate);

			if (endDate.getTime() > maxDate.getTime()) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Solo endorsements cannot be issued for more than 45 days.',
				};
			}

			let vatusaId = 0;
			if (zau.isProd) {
				try {
					const { data: vatusaResponse } = await vatusaApi.post('/solo', {
						cid: student.cid,
						position: req.body.position,
						expDate: DateTime.fromJSDate(endDate).toUTC().toFormat('yyyy-MM-dd'),
					});
					vatusaId = vatusaResponse.data.id || 0;
				} catch (err) {
					throw {
						code: status.INTERNAL_SERVER_ERROR,
						message: (err as any).response?.data?.data?.msg || 'Error posting to VATUSA',
					};
				}
			}

			SoloEndorsementModel.create({
				studentCid: student.cid,
				instructorCid: req.user.cid,
				position: req.body.position,
				vatusaId: vatusaId,
				expires: endDate,
			});

			await getCacheInstance().clear('solos');

			NotificationModel.create({
				recipient: req.body.student,
				read: false,
				title: 'Solo Endorsement Issued',
				content: `You have been issued a solo endorsement for <b>${req.body.position}</b> by <b>${req.user.name}</b>. It will expire on ${DateTime.fromJSDate(endDate).toUTC().toFormat(zau.DATE_FORMAT)}`,
			});

			DossierModel.create({
				by: req.user.cid,
				affected: req.body.student,
				action: `%b issued a solo endorsement for %a to work ${req.body.position} until ${DateTime.fromJSDate(endDate).toUTC().toFormat(zau.DATE_FORMAT)}`,
				actionType: ACTION_TYPE.CREATE_SOLO_ENDORSEMENT,
			});

			return res.status(status.CREATED).json();
		} catch (e) {
			logException(req, e);

			return next(e);
		}
	},
);

router.patch(
	'/:id',
	getUser,
	isInstructor,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid ID.',
				};
			}

			if (
				!req.body.expirationDate ||
				isNaN(Date.parse(req.body.expirationDate)) ||
				!req.body.confirmation ||
				req.body.confirmation !== true
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid request.',
				};
			}

			const newEndDate = new Date(req.body.expirationDate);

			const solo = await SoloEndorsementModel.findOne({
				_id: req.params['id'],
				deleted: false,
			})
				.cache('10 minutes', `solo-${req.params['id']}`)
				.exec();
			if (!solo) {
				throw {
					code: status.NOT_FOUND,
					message: 'Solo endorsement not found.',
				};
			}

			const oldDate = new Date(
				solo.createdAt.getUTCFullYear(),
				solo.createdAt.getUTCMonth(),
				solo.createdAt.getUTCDate() + 90,
			);

			if (newEndDate.getTime() <= solo.expires.getTime()) {
				throw {
					code: status.BAD_REQUEST,
					message: 'New expiration date cannot be less than the current expiration date.',
				};
			}

			if (newEndDate.getTime() >= oldDate.getTime()) {
				throw {
					code: status.BAD_REQUEST,
					message: 'New expiration date cannot be more than 90 days from the date of issuance.',
				};
			}

			solo.expires = newEndDate;

			let e = '';

			if (zau.isProd) {
				if (solo.vatusaId || 0 !== 0) {
					try {
						await vatusaApi.delete(`/solo?id=${solo.vatusaId}`);
					} catch (err) {
						e += `${e}`;
					}
				}

				try {
					const { data: vatusaResponse } = await vatusaApi.post('/solo', {
						cid: solo.studentCid,
						position: solo.position,
						expDate: DateTime.fromJSDate(newEndDate).toUTC().toFormat('yyyy-MM-dd'),
					});
					solo.vatusaId = vatusaResponse.data.id || 0;
				} catch (err) {
					e += `\n${err}`;
				}
			}

			DossierModel.create({
				by: req.user.cid,
				affected: solo.studentCid,
				action: `%b extended a solo endorsement for %a to work ${solo.position} until ${DateTime.fromJSDate(solo.expires).toUTC().toFormat(zau.DATE_FORMAT)}`,
				actionType: ACTION_TYPE.EXTEND_SOLO_ENDORSEMENT,
			});

			NotificationModel.create({
				recipient: solo.studentCid,
				read: false,
				title: 'Solo Endorsement Extended',
				content: `You have been issued a solo endorsement for <b>${solo.position}</b> has been extended and will now expire on ${DateTime.fromJSDate(newEndDate).toUTC().toFormat(zau.DATE_FORMAT)}`,
			});

			await solo.save();

			await clearCachePrefix('solo');

			if (e !== '') {
				console.error('error extending vatusa solo', e);

				return res
					.status(status.INTERNAL_SERVER_ERROR)
					.json('Error updating VATUSA, manually check VATUSA and verify.');
			}

			return res.status(status.OK).json();
		} catch (e) {
			logException(req, e);

			return next(e);
		}
	},
);

router.delete(
	'/:id',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid ID.',
				};
			}

			const solo = await SoloEndorsementModel.findOne({
				_id: req.params['id'],
				deleted: false,
			})
				.cache('10 minutes', `solo-${req.params['id']}`)
				.exec();
			if (!solo) {
				throw {
					code: status.NOT_FOUND,
					message: 'Solo endorsement not found.',
				};
			}

			await solo.delete();

			await clearCachePrefix('solo');

			DossierModel.create({
				by: req.user.cid,
				affected: req.body.student,
				action: `%b deleted a solo endorsement for %a to work ${req.body.position} until ${DateTime.fromJSDate(solo.expires).toUTC().toFormat(zau.DATE_FORMAT)}`,
				actionType: ACTION_TYPE.DELETE_SOLO_ENDORSEMENT,
			});

			if (zau.isProd) {
				try {
					await vatusaApi.delete(`/solo?id=${solo.vatusaId}`);
				} catch (err) {
					throw {
						code: status.INTERNAL_SERVER_ERROR,
						message: 'Error deleting from VATUSA, manually check VATUSA and verify.',
					};
				}
			}

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			logException(req, e);

			return next(e);
		}
	},
);

export default router;
