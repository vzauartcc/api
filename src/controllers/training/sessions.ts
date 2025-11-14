import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DateTime } from 'luxon';
import { getCacheInstance } from '../../app.js';
import { vatusaApi } from '../../helpers/vatusa.js';
import zau from '../../helpers/zau.js';
import { isTrainingStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { NotificationModel } from '../../models/notification.js';
import { TrainingSessionModel } from '../../models/trainingSession.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();
const FIFTEEN = 15 * 60 * 1000;

//#region Fetching Sessions
// Get all sessions with pagination
router.get(
	'/',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const page = +(req.query['page'] as string) || 1;
			const limit = +(req.query['limit'] as string) || 20;

			const amount = await TrainingSessionModel.countDocuments({
				submitted: true,
				deleted: false,
			})
				.cache('10 minutes', 'session-count')
				.exec();
			const sessions = await TrainingSessionModel.find({
				deleted: false,
				submitted: true,
			})
				.skip(limit * (page - 1))
				.limit(limit)
				.sort({
					startTime: 'desc',
				})
				.populate('student', 'fname lname cid vis')
				.populate('instructor', 'fname lname')
				.populate('milestone', 'name code')
				.lean()
				.cache()
				.exec();

			return res.status(status.OK).json({ count: amount, sessions });
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.get('/past', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 20;

		const amount = await TrainingSessionModel.countDocuments({
			studentCid: req.user.cid,
			deleted: false,
			submitted: true,
		})
			.cache('10 minutes', `past-sessions-${req.user.cid}`)
			.exec();
		const sessions = await TrainingSessionModel.find({
			studentCid: req.user.cid,
			deleted: false,
			submitted: true,
		})
			.skip(limit * (page - 1))
			.limit(limit)
			.sort({
				startTime: 'desc',
			})
			.populate('instructor', 'fname lname cid')
			.populate('student', 'fname lname')
			.populate('milestone', 'name code')
			.lean()
			.cache()
			.exec();

		return res.status(status.OK).json({ count: amount, sessions });
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get(
	'/by-user/:cid',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const controller = await UserModel.findOne({ cid: req.params['cid'] })
				.select('fname lname cid')
				.lean()
				.cache()
				.exec();
			if (!controller) {
				throw {
					code: status.NOT_FOUND,
					message: 'User not found',
				};
			}

			const page = +(req.query['page'] as string) || 1;
			const limit = +(req.query['limit'] as string) || 20;

			const amount = await TrainingSessionModel.countDocuments({
				studentCid: req.params['cid'],
				submitted: true,
				deleted: false,
			})
				.cache()
				.exec();
			const sessions = await TrainingSessionModel.find({
				studentCid: req.params['cid'],
				deleted: false,
				submitted: true,
			})
				.skip(limit * (page - 1))
				.limit(limit)
				.sort({
					createdAt: 'desc',
				})
				.populate('instructor', 'fname lname')
				.populate('milestone', 'name code')
				.lean()
				.cache()
				.exec();

			return res.status(status.OK).json({
				count: amount,
				sessions,
				controller,
			});
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.get(
	'/open',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const sessions = await TrainingSessionModel.find({
				instructorCid: req.user.cid,
				submitted: false,
				deleted: { $ne: true },
			})
				.populate('student', 'fname lname cid vis')
				.populate('milestone', 'name code')
				.lean()
				.cache('10 minutes', `instructor-sessions-${req.user.cid}`)
				.exec();

			return res.status(status.OK).json(sessions);
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.get('/:id', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const isIns = ['ta', 'ins', 'mtr', 'ia', 'atm', 'datm'].some((r) =>
			req.user.roleCodes.includes(r),
		);

		let session = null;
		if (isIns) {
			session = await TrainingSessionModel.findById(req.params['id'])
				.populate('student', 'fname lname cid vis')
				.populate('instructor', 'fname lname cid')
				.populate('milestone', 'name code')
				.lean()
				.cache('10 minutes', `instructor-session-${req.params['id']}`)
				.exec();
		} else {
			session = await TrainingSessionModel.findById(req.params['id'])
				.select('-insNotes')
				.populate('student', 'fname lname cid vis')
				.populate('instructor', 'fname lname cid')
				.populate('milestone', 'name code')
				.lean()
				.cache('10 minutes', `student-session-${req.params['id']}`)
				.exec();
		}

		if (!session) {
			throw {
				code: status.NOT_FOUND,
				message: 'Session not found',
			};
		}

		return res.status(status.OK).json(session);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});
//#endregion

//#region Editing Sessions
router.patch(
	'/:id/save',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const session = await TrainingSessionModel.findByIdAndUpdate(
				req.params['id'],
				req.body,
			).exec();
			if (!session) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Session not found',
				};
			}

			await getCacheInstance().clear(`student-session-${req.params['id']}`);
			await getCacheInstance().clear(`instructor-session-${req.params['id']}`);
			await getCacheInstance().clear(`session-${req.params['id']}`);
			await getCacheInstance().clear(`instructor-sessions-${req.user.cid}`);

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
	'/:id/submit',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				req.body.position === '' ||
				req.body.progress === null ||
				req.body.movements === null ||
				req.body.location === null ||
				req.body.ots === null ||
				req.body.studentNotes === null ||
				(req.body.studentNotes && req.body.studentNotes.length > 10_000) ||
				(req.body.insNotes && req.body.insNotes.length > 10_000)
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'You must fill out all required forms',
				};
			}

			if (req.body.ots !== 0 && req.body.ots !== 3) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Cannot update training notes for an OTS session',
				};
			}

			const session = await TrainingSessionModel.findById(req.params['id'])
				.cache('10 minutes', `session-${req.params['id']}`)
				.exec();

			if (!session) {
				throw {
					code: status.NOT_FOUND,
					message: 'Session not found',
				};
			}

			const startTime = new Date(req.body.startTime);
			const endTime = new Date(req.body.endTime);

			if (startTime.getTime() >= endTime.getTime()) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Start Time must be before End Time',
				};
			}

			if (startTime.getTime() > Date.now() || endTime.getTime() > Date.now()) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Start and End Time must be before today',
				};
			}

			const delta = Math.abs(endTime.getTime() - startTime.getTime()) / 1000;
			const hours = Math.floor(delta / 3600);
			const minutes = Math.floor(delta / 60) % 60;

			const duration = `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)}`;

			if (!session.vatusaId || session.vatusaId === 0) {
				let vatusaRes = { data: { id: 0 } };
				// Send the training record to vatusa
				if (!zau.isDev) {
					vatusaRes = await vatusaApi.post(`/user/${session.studentCid}/training/record`, {
						instructor_id: session.instructorCid,
						session_date: DateTime.fromISO(req.body.startTime).toFormat('y-MM-dd HH:mm'),
						position: req.body.position,
						duration: duration,
						movements: req.body.movements,
						score: req.body.progress,
						notes: req.body.studentNotes,
						ots_status: req.body.ots,
						location: req.body.location,
						is_cbt: false,
						solo_granted: false,
					});
				}

				// store the vatusa id for updating it later
				session.vatusaId = vatusaRes.data.id;
				session.submitted = true; // submitted sessions show in a different section of the UI
				await session.save();
			} else {
				await vatusaApi.put(`/training/record/${session.vatusaId}`, {
					session_date: DateTime.fromISO(req.body.startTime).toFormat('y-MM-dd HH:mm'),
					position: req.body.position,
					duration: duration,
					movements: req.body.movements,
					score: req.body.progress,
					notes: req.body.studentNotes,
					ots_status: req.body.ots,
					location: req.body.location,
				});
			}

			await getCacheInstance().clear(`student-session-${req.params['id']}`);
			await getCacheInstance().clear(`instructor-session-${req.params['id']}`);
			await getCacheInstance().clear(`session-${req.params['id']}`);
			await getCacheInstance().clear(`instructor-sessions-${req.user.cid}`);

			const instructor = await UserModel.findOne({ cid: session.instructorCid })
				.select('fname lname')
				.lean()
				.cache('10 minutes', `training-user-${req.user.cid}`)
				.exec();

			NotificationModel.create({
				recipient: session.studentCid,
				read: false,
				title: 'Training Notes Submitted',
				content: `The training notes from your session with <b>${instructor!.fname + ' ' + instructor!.lname}</b> have been submitted.`,
				link: `/dash/training/session/${req.params['id']}`,
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

router.delete(
	'/:id',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Session id required',
				};
			}

			const session = await TrainingSessionModel.findById(req.params['id'])
				.cache('10 minutes', `session-${req.params['id']}`)
				.exec();

			if (!session) {
				throw {
					code: status.NOT_FOUND,
					message: 'Session not found',
				};
			}

			if (session.instructorCid !== req.user.cid) {
				throw {
					code: status.FORBIDDEN,
					message: 'Not your session',
				};
			}

			await session.delete();
			await getCacheInstance().clear(`student-session-${req.params['id']}`);
			await getCacheInstance().clear(`instructor-session-${req.params['id']}`);
			await getCacheInstance().clear(`session-${req.params['id']}`);
			await getCacheInstance().clear(`instructor-sessions-${req.user.cid}`);

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);
//#endregion

//#region Instructor New Sessions
router.post(
	'/save',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				req.body.student === null ||
				req.body.milestone === null ||
				req.body.position === '' ||
				req.body.startTime === null ||
				req.body.endTime === null ||
				req.body.progress === null ||
				req.body.movements === null ||
				req.body.location === null ||
				req.body.ots === null ||
				req.body.studentNotes === null ||
				(req.body.studentNotes && req.body.studentNotes.length > 10_000) ||
				(req.body.insNotes && req.body.insNotes.length > 10_000)
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'You must fill out all required forms',
				};
			}

			const start = new Date(
				Math.round(new Date(req.body.startTime).getTime() / FIFTEEN) * FIFTEEN,
			);
			const end = new Date(Math.round(new Date(req.body.endTime).getTime() / FIFTEEN) * FIFTEEN);

			if (end < start) {
				throw {
					code: status.BAD_REQUEST,
					message: 'End Time must be before Start Time',
				};
			}

			if (start.getTime() > Date.now() || end.getTime() > Date.now()) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Start and End Time must be before today',
				};
			}

			const delta = Math.abs(end.getTime() - start.getTime()) / 1000;
			const hours = Math.floor(delta / 3600);
			const minutes = Math.floor(delta / 60) % 60;

			const duration = `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)}`;

			await TrainingSessionModel.create({
				studentCid: req.body.student,
				instructorCid: req.user.cid,
				milestoneCode: req.body.milestone,
				position: req.body.position,
				startTime: start,
				endTime: end,
				progress: req.body.progress,
				duration: duration,
				movements: req.body.movements,
				location: req.body.location,
				ots: req.body.ots,
				studentNotes: req.body.studentNotes,
				insNotes: req.body.insNotes,
				submitted: false,
			});

			await getCacheInstance().clear(`instructor-sessions-${req.user.cid}`);

			return res.status(status.CREATED).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.post(
	'/submit',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				req.body.student === null ||
				req.body.milestone === null ||
				req.body.position === '' ||
				req.body.startTime === null ||
				req.body.endTime === null ||
				req.body.progress === null ||
				req.body.movements === null ||
				req.body.location === null ||
				req.body.ots === null ||
				req.body.studentNotes === null ||
				(req.body.studentNotes && req.body.studentNotes.length > 10_000) ||
				(req.body.insNotes && req.body.insNotes.length > 10_000)
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'You must fill out all required forms',
				};
			}

			const start = new Date(
				Math.round(new Date(req.body.startTime).getTime() / FIFTEEN) * FIFTEEN,
			);
			const end = new Date(Math.round(new Date(req.body.endTime).getTime() / FIFTEEN) * FIFTEEN);

			if (end < start) {
				throw {
					code: status.BAD_REQUEST,
					message: 'End Time must be before Start Time',
				};
			}

			if (start.getTime() > Date.now() || end.getTime() > Date.now()) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Start and End Time must be before today',
				};
			}

			const delta = Math.abs(end.getTime() - start.getTime()) / 1000;

			const hours = Math.floor(delta / 3600);
			const minutes = Math.floor(delta / 60) % 60;

			const duration = `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)}`;

			let vatusaRes = { data: { id: 0 } };

			if (!zau.isDev) {
				vatusaRes = await vatusaApi.post(`/user/${req.body.student}/training/record`, {
					instructor_id: req.user.cid,
					session_date: DateTime.fromJSDate(start).toFormat('y-MM-dd HH:mm'),
					position: req.body.position,
					duration: duration,
					movements: req.body.movements,
					score: req.body.progress,
					notes: req.body.studentNotes,
					ots_status: req.body.ots,
					location: req.body.location,
					is_cbt: false,
					solo_granted: false,
				});
			}

			const doc = await TrainingSessionModel.create({
				studentCid: req.body.student,
				instructorCid: req.user.cid,
				milestoneCode: req.body.milestone,
				position: req.body.position,
				startTime: start,
				endTime: end,
				progress: req.body.progress,
				duration: duration,
				movements: req.body.movements,
				location: req.body.location,
				ots: req.body.ots,
				studentNotes: req.body.studentNotes,
				insNotes: req.body.insNotes,
				submitted: true,
				vatusaId: vatusaRes.data.id,
			});

			await getCacheInstance().clear(`instructor-sessions-${req.user.cid}`);

			await NotificationModel.create({
				recipient: doc.studentCid,
				read: false,
				title: 'Training Notes Submitted',
				content: `The training notes from your session with <b>${req.user.name}</b> have been submitted.`,
				link: `/dash/training/session/${doc._id}`,
			});

			return res.status(status.CREATED).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);
//#endregion
export default router;
