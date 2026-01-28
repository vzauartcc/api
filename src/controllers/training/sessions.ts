import { Router, type NextFunction, type Request, type Response } from 'express';
import { DateTime } from 'luxon';
import {
	throwBadRequestException,
	throwForbiddenException,
	throwNotFoundException,
} from '../../helpers/errors.js';
import { sanitizeInput } from '../../helpers/html.js';
import { clearCachePrefix } from '../../helpers/redis.js';
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
				.cache('10 minutes', 'sessions-all-count')
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
				.cache('10 minutes', `sessions-all-page-${page}`)
				.exec();

			return res.status(status.OK).json({ count: amount, sessions });
		} catch (e) {
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
			.cache('10 minutes', `sessions-past-sessions-${req.user.cid}-count`)
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
			.cache('10 minutes', `sessions-past-session-${req.user.cid}-page-${page}`)
			.exec();

		return res.status(status.OK).json({ count: amount, sessions });
	} catch (e) {
		return next(e);
	}
});

router.get(
	'/by-user/:cid',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.params['cid'] ||
				req.params['cid'] === 'undefined' ||
				isNaN(Number(req.params['cid']))
			) {
				throwBadRequestException('Invalid CID');
			}

			const controller = await UserModel.findOne({ cid: req.params['cid'] })
				.select('fname lname cid')
				.lean()
				.cache()
				.exec();
			if (!controller) {
				throwNotFoundException('Controller Not Found');
			}

			const page = +(req.query['page'] as string) || 1;
			const limit = +(req.query['limit'] as string) || 20;

			const amount = await TrainingSessionModel.countDocuments({
				studentCid: req.params['cid'],
				submitted: true,
				deleted: false,
			})
				.cache('10 minutes', `sessions-student-sessions-${req.params['cid']}-count`)
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
				.cache('10 minutes', `sessions-student-${req.params['cid']}-page-${page}`)
				.exec();

			return res.status(status.OK).json({
				count: amount,
				sessions,
				controller,
			});
		} catch (e) {
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
				.cache('10 minutes', `sessions-instructor-${req.user.cid}`)
				.exec();

			return res.status(status.OK).json(sessions);
		} catch (e) {
			return next(e);
		}
	},
);

router.get('/:id', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['id'] || req.params['id'] === 'undefined') {
			throwBadRequestException('Invalid ID');
		}

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
				.cache('10 minutes', `sessions-instructor-session-${req.params['id']}`)
				.exec();
		} else {
			session = await TrainingSessionModel.findById(req.params['id'])
				.select('-insNotes')
				.populate('student', 'fname lname cid vis')
				.populate('instructor', 'fname lname cid')
				.populate('milestone', 'name code')
				.lean()
				.cache('10 minutes', `sessions-student-session-${req.params['id']}`)
				.exec();
		}

		if (!session) {
			throwNotFoundException('Training Session Not Found');
		}

		return res.status(status.OK).json(session);
	} catch (e) {
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
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throwBadRequestException('Invalid ID');
			}

			const session = await TrainingSessionModel.findByIdAndUpdate(req.params['id'], {
				...req.body,
				studentNotes: sanitizeInput(req.body.studentNotes),
			}).exec();
			if (!session) {
				throwNotFoundException('Training Session Not Found');
			}

			await clearCachePrefix(`sessions-instructor-${req.user.cid}`);

			return res.status(status.OK).json();
		} catch (e) {
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
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throwBadRequestException('Invalid ID');
			}

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
				throwBadRequestException('All field are required');
			}

			if (req.body.ots !== 0 && req.body.ots !== 3) {
				throwBadRequestException('OTS session notes are locked per VATUSA');
			}

			const session = await TrainingSessionModel.findById(req.params['id'])
				.cache('10 minutes', `sessions-session-${req.params['id']}`)
				.exec();

			if (!session) {
				throwNotFoundException('Training Session Not Found');
			}

			const start = new Date(
				Math.round(new Date(req.body.startTime).getTime() / FIFTEEN) * FIFTEEN,
			);
			const end = new Date(Math.round(new Date(req.body.endTime).getTime() / FIFTEEN) * FIFTEEN);

			if (start.getTime() >= end.getTime()) {
				throwBadRequestException('Start time must be before End time');
			}

			if (start.getTime() > Date.now()) {
				throwBadRequestException('Start Time must not be in the future');
			}

			const maxEnd = new Date();
			maxEnd.setUTCMinutes(maxEnd.getUTCMinutes() + 30);

			if (end.getTime() > maxEnd.getTime()) {
				throwBadRequestException('End time must not be in the future');
			}

			const delta = Math.abs(end.getTime() - start.getTime()) / 1000;
			const hours = Math.floor(delta / 3600);
			const minutes = Math.floor(delta / 60) % 60;

			const duration = `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)}`;

			if (!session.vatusaId || session.vatusaId === 0) {
				console.log('Creating VATUSA record');
				let vatusaRes = { data: { id: 0 } };
				// Send the training record to vatusa
				if (!zau.isDev) {
					const { data: vatusaRes } = await vatusaApi.post(
						`/user/${session.studentCid}/training/record`,
						{
							instructor_id: session.instructorCid,
							session_date: DateTime.fromJSDate(start).toFormat('y-MM-dd HH:mm'),
							position: req.body.position,
							duration: duration,
							movements: req.body.movements,
							score: req.body.progress,
							notes: sanitizeInput(req.body.studentNotes),
							ots_status: req.body.ots,
							location: req.body.location,
							is_cbt: false,
							solo_granted: false,
						},
					);

					console.log('vatusa gave us an id of', vatusaRes?.data?.id);
				}

				// store the vatusa id for updating it later
				session.vatusaId = vatusaRes.data.id;
				session.submitted = true; // submitted sessions show in a different section of the UI
			} else {
				console.log('Updating VATUSA record', session.vatusaId);
				await vatusaApi.put(`/training/record/${session.vatusaId}`, {
					session_date: DateTime.fromJSDate(start).toFormat('y-MM-dd HH:mm'),
					position: req.body.position,
					duration: duration,
					movements: req.body.movements,
					score: req.body.progress,
					notes: sanitizeInput(req.body.studentNotes),
					ots_status: req.body.ots,
					location: req.body.location,
				});
			}

			session.position = req.body.position;
			session.movements = req.body.movements;
			session.progress = req.body.progress;
			session.ots = req.body.ots;
			session.location = req.body.location;
			session.startTime = start;
			session.endTime = end;
			session.studentNotes = sanitizeInput(req.body.studentNotes);
			session.insNotes = req.body.insNotes;
			session.duration = duration;
			await session.save();

			await clearCachePrefix('sessions-all');
			await clearCachePrefix(`sessions-past-sessions-${session.studentCid}`);
			await clearCachePrefix(`sessions-student-sessions-${session.studentCid}`);
			await clearCachePrefix(`sessions-student-session-${session._id}`);
			await clearCachePrefix(`sessions-instructor-session-${session._id}`);
			await clearCachePrefix(`sessions-instructor-${session.instructorCid}`);

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
				throwBadRequestException('Invalid ID');
			}

			const session = await TrainingSessionModel.findById(req.params['id'])
				.cache('10 minutes', `sessions-session-${req.params['id']}`)
				.exec();

			if (!session) {
				throwNotFoundException('Training Session Not Found');
			}

			if (session.instructorCid !== req.user.cid && !req.user.isSeniorStaff) {
				throwForbiddenException('Not Your Training Session');
			}

			if (session.ots && session.ots > 0 && session.ots < 3) {
				throwForbiddenException('OTS Sessions Cannot Be Deleted');
			}

			await session.delete();

			await clearCachePrefix('session');

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
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
				throwBadRequestException('All fields are required');
			}

			const start = new Date(
				Math.round(new Date(req.body.startTime).getTime() / FIFTEEN) * FIFTEEN,
			);
			const end = new Date(Math.round(new Date(req.body.endTime).getTime() / FIFTEEN) * FIFTEEN);

			const maxEnd = new Date();
			maxEnd.setUTCMinutes(maxEnd.getUTCMinutes() + 30);

			if (end.getTime() > maxEnd.getTime()) {
				throwBadRequestException('End time must not be in the future');
			}

			if (end < start) {
				throwBadRequestException('End time must be after Start time');
			}

			if (start.getTime() > Date.now()) {
				throwBadRequestException('Start time must not be in the future');
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
				studentNotes: sanitizeInput(req.body.studentNotes),
				insNotes: req.body.insNotes,
				submitted: false,
			});

			await clearCachePrefix(`sessions-instructor-${req.user.cid}`);

			return res.status(status.CREATED).json();
		} catch (e) {
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
				throwBadRequestException('All fields are required');
			}

			const start = new Date(
				Math.round(new Date(req.body.startTime).getTime() / FIFTEEN) * FIFTEEN,
			);
			const end = new Date(Math.round(new Date(req.body.endTime).getTime() / FIFTEEN) * FIFTEEN);

			const maxEnd = new Date();
			maxEnd.setUTCMinutes(maxEnd.getUTCMinutes() + 30);

			if (end.getTime() > maxEnd.getTime()) {
				throwBadRequestException('End time must not be in the future');
			}

			if (end < start) {
				throwBadRequestException('Start time must be before end time');
			}

			if (start.getTime() > Date.now()) {
				throwBadRequestException('Start time must not be in the future');
			}

			const delta = Math.abs(end.getTime() - start.getTime()) / 1000;

			const hours = Math.floor(delta / 3600);
			const minutes = Math.floor(delta / 60) % 60;

			const duration = `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)}`;

			let vatusaRes = { data: { id: 0 } };

			if (!zau.isDev) {
				const { data: vatusaRes } = await vatusaApi.post(
					`/user/${req.body.student}/training/record`,
					{
						instructor_id: req.user.cid,
						session_date: DateTime.fromJSDate(start).toFormat('y-MM-dd HH:mm'),
						position: req.body.position,
						duration: duration,
						movements: req.body.movements,
						score: req.body.progress,
						notes: sanitizeInput(req.body.studentNotes),
						ots_status: req.body.ots,
						location: req.body.location,
						is_cbt: false,
						solo_granted: false,
					},
				);

				console.log('SUBMIT vatusa session gave id', vatusaRes?.data?.id, vatusaRes);
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
				studentNotes: sanitizeInput(req.body.studentNotes),
				insNotes: req.body.insNotes,
				submitted: true,
				vatusaId: vatusaRes.data.id,
			});

			await clearCachePrefix('session');

			await NotificationModel.create({
				recipient: doc.studentCid,
				read: false,
				title: 'Training Notes Submitted',
				content: `The training notes from your session with <b>${req.user.name}</b> have been submitted.`,
				link: `/dash/training/session/${doc._id}`,
			});

			clearCachePrefix(`notifications-${doc.studentCid}`);

			return res.status(status.CREATED).json();
		} catch (e) {
			return next(e);
		}
	},
);
//#endregion
export default router;
