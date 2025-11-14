import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DateTime } from 'luxon';
import { getCacheInstance } from '../../app.js';
import discord from '../../helpers/discord.js';
import { vatusaApi } from '../../helpers/vatusa.js';
import zau from '../../helpers/zau.js';
import { isTrainingStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { DossierModel } from '../../models/dossier.js';
import { NotificationModel } from '../../models/notification.js';
import { SoloEndorsementModel } from '../../models/soloEndorsement.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();

router.get(
	'/',
	getUser,
	isTrainingStaff,
	async (_req: Request, res: Response, next: NextFunction) => {
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
			if (!(e as any).code) {
				captureException(e);
			}
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
					message: 'Id required.',
				};
			}

			const solos = await SoloEndorsementModel.findOne({ id: req.params['id'] })
				.populate('student', 'fname lname')
				.populate('instructor', 'fname lname')
				.sort({ expires: 'desc' })
				.limit(50)
				.lean({ virtuals: true })
				.cache('10 minutes', `solo-${req.params['id']}`)
				.exec();

			return res.status(status.OK).json(solos);
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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

			const student = await UserModel.findOne({ cid: req.body.student }).exec();
			if (!student) {
				throw {
					code: status.NOT_FOUND,
					message: 'Student not found',
				};
			}

			const endDate = new Date(req.body.expirationDate);

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
			});

			if (process.env['DISCORD_TOKEN'] !== '') {
				try {
					await discord.sendMessage('1341139323604439090', {
						content:
							':student: **SOLO ENDORSEMENT ISSUED** :student:\n\n' +
							`Student Name: ${student.name}${student.discord ? ` <@${student.discord}>` : ''}\n` +
							`Instructor Name: ${req.user.name}\n` +
							`Issued Date: ${DateTime.fromJSDate(new Date()).toUTC().toFormat(zau.DATE_FORMAT)}\n` +
							`Expires Date: ${DateTime.fromJSDate(endDate).toUTC().toFormat(zau.DATE_FORMAT)}\n` +
							`Position: ${req.body.position}\n` +
							zau.isProd
								? '<@&1215950778120933467>'
								: '\nThis was sent from a test environment and is not real.',
					});
				} catch (err) {
					console.log('Error posting solo endorsement to discord', err);
				}
			}

			return res.status(status.CREATED).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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
					message: 'Id required.',
				};
			}

			const solo = await SoloEndorsementModel.findOne({
				id: req.params['id'],
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
			await getCacheInstance().clear('solos');

			if (zau.isProd) {
				try {
					await vatusaApi.delete(`/solo?id=${solo.vatusaId}`);
				} catch (err) {
					throw {
						code: status.INTERNAL_SERVER_ERROR,
						message: 'Error deleting from VATUSA',
					};
				}
			}

			DossierModel.create({
				by: req.user.cid,
				affected: req.body.student,
				action: `%b deleted a solo endorsement for %a to work ${req.body.position} until ${DateTime.fromJSDate(solo.expires).toUTC().toFormat(zau.DATE_FORMAT)}`,
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
