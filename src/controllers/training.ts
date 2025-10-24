import axios from 'axios';
import { Router, type Request, type Response } from 'express';
import { DateTime } from 'luxon';
import { convertToReturnDetails, vatusaApi } from '../app.js';
import { sendMail } from '../mailer.js';
import { hasRole } from '../middleware/auth.js';
import getUser from '../middleware/user.js';
import { NotificationModel } from '../models/notification.js';
import { SoloEndorsementModel } from '../models/soloEndorsement.js';
import { TrainingRequestMilestoneModel } from '../models/trainingMilestone.js';
import { TrainingRequestModel } from '../models/trainingRequest.js';
import { TrainingSessionModel } from '../models/trainingSession.js';
import { UserModel } from '../models/user.js';

const router = Router();
const fifteen = 15 * 60 * 1000;

router.get('/request/upcoming', getUser, async (req: Request, res: Response) => {
	try {
		const upcoming = await TrainingRequestModel.find({
			studentCid: req.user!.cid,
			deleted: false,
			startTime: {
				$gt: new Date(new Date().toUTCString()), // request is in the future
			},
		})
			.populate('instructor', 'fname lname cid')
			.populate('milestone', 'code name')
			.sort({ startTime: 'asc' })
			.lean()
			.exec();

		res.stdRes.data = upcoming;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.post('/request/new', getUser, async (req: Request, res: Response) => {
	try {
		if (!req.body.never || req.body.never) {
			throw {
				code: 400,
				message: 'Temporarily disabled.',
			};
		}
		if (
			!req.body.submitter ||
			!req.body.startTime ||
			!req.body.endTime ||
			!req.body.milestone ||
			req.body.remarks.length > 500
		) {
			throw {
				code: 400,
				message: 'You must fill out all required forms',
			};
		}

		if (new Date(req.body.startTime) < new Date() || new Date(req.body.endTime) < new Date()) {
			throw {
				code: 400,
				message: 'Dates must be in the future',
			};
		}

		if (new Date(req.body.startTime) > new Date(req.body.endTime)) {
			throw {
				code: 400,
				message: 'End time must be greater than start time',
			};
		}

		if (
			(new Date(req.body.endTime).getTime() - new Date(req.body.startTime).getTime()) / 60000 <
			60
		) {
			throw {
				code: 400,
				message: 'Requests must be longer than 60 minutes',
			};
		}

		if (
			(new Date(req.body.endTime).getTime() - new Date(req.body.startTime).getTime()) / 60000 >
			960
		) {
			throw {
				code: 400,
				message: 'Requests must be shorter than 16 hours',
			};
		}

		const totalRequests = await req.app.redis.get(`TRAININGREQ:${req.user!.cid}`);

		if (parseInt(totalRequests!, 10) > 5) {
			throw {
				code: 429,
				message: `You have requested too many sessions in the last 4 hours.`,
			};
		}

		req.app.redis.set(`TRAININGREQ:${req.user!.cid}`, (+totalRequests! || 0) + 1);
		req.app.redis.expire(`TRAININGREQ:${req.user!.cid}`, 14400);

		await TrainingRequestModel.create({
			studentCid: req.user!.cid,
			startTime: req.body.startTime,
			endTime: req.body.endTime,
			milestoneCode: req.body.milestone,
			remarks: req.body.remarks,
		});

		const student = await UserModel.findOne({ cid: req.user!.cid })
			.select('fname lname')
			.lean()
			.exec();
		const milestone = await TrainingRequestMilestoneModel.findOne({
			code: req.body.milestone,
		})
			.lean()
			.exec();

		if (!student || !milestone) {
			throw {
				code: 400,
				message: 'Bad Request.',
			};
		}

		sendMail({
			to: 'training@zauartcc.org',
			subject: `New Training Request: ${student.fname} ${student.lname} | Chicago ARTCC`,
			template: 'newRequest',
			context: {
				student: student.fname + ' ' + student.lname,
				startTime: new Date(req.body.startTime).toLocaleString('en-US', {
					month: 'long',
					day: 'numeric',
					year: 'numeric',
					timeZone: 'UTC',
					hour: '2-digit',
					minute: '2-digit',
					hourCycle: 'h23',
				}),
				endTime: new Date(req.body.endTime).toLocaleString('en-US', {
					month: 'long',
					day: 'numeric',
					year: 'numeric',
					timeZone: 'UTC',
					hour: '2-digit',
					minute: '2-digit',
					hourCycle: 'h23',
				}),
				milestone: milestone.code.toUpperCase() + ' - ' + milestone.name,
			},
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get('/milestones', getUser, async (req: Request, res: Response) => {
	try {
		const user = await UserModel.findOne({ cid: req.user!.cid })
			.select('trainingMilestones rating')
			.populate('trainingMilestones', 'code name rating')
			.lean()
			.exec();
		const milestones = await TrainingRequestMilestoneModel.find()
			.sort({ rating: 'asc', code: 'asc' })
			.lean()
			.exec();

		res.stdRes.data = {
			user,
			milestones,
		};
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get(
	'/request/open',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
		try {
			const days = +(req.query['period'] as string) || 21; // days from start of CURRENT week
			const d = new Date(Date.now()),
				currentDay = d.getDay(),
				diff = d.getDate() - currentDay,
				startOfWeek = d.setDate(diff);

			const requests = await TrainingRequestModel.find({
				startTime: {
					$gte: new Date(startOfWeek).toDateString(),
					$lte: new Date(startOfWeek + days * 1000 * 60 * 60 * 24).toDateString(),
				},
				instructorCid: null,
				deleted: false,
			})
				.select('startTime')
				.lean()
				.exec();

			res.stdRes.data = requests;
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.post(
	'/request/take/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
		try {
			if (new Date(req.body.startTime) >= new Date(req.body.endTime)) {
				throw {
					code: 400,
					message: 'End time must be greater than start time',
				};
			}

			const request = await TrainingRequestModel.findByIdAndUpdate(req.params['id'], {
				instructorCid: req.user!.cid,
				startTime: req.body.startTime,
				endTime: req.body.endTime,
			})
				.lean()
				.exec();

			if (!request) {
				throw {
					code: 400,
					message: 'Bad Request.',
				};
			}

			const session = await TrainingSessionModel.create({
				studentCid: request.studentCid,
				instructorCid: req.user!.cid,
				startTime: req.body.startTime,
				endTime: req.body.endTime,
				milestoneCode: request.milestoneCode,
				submitted: false,
			});

			const student = await UserModel.findOne({ cid: request.studentCid })
				.select('fname lname email')
				.lean()
				.exec();
			const instructor = await UserModel.findOne({ cid: req.user!.cid })
				.select('fname lname email')
				.lean()
				.exec();

			if (!student || !instructor) {
				throw {
					code: 500,
					messgae: 'Internal Server Error',
				};
			}

			sendMail({
				to: '', // Hide student and instructor emails
				bcc: `${student.email}, ${instructor.email}`,
				subject: 'Training Request Taken | Chicago ARTCC',
				template: 'requestTaken',
				context: {
					student: student.fname + ' ' + student.lname,
					instructor: instructor.fname + ' ' + instructor.lname,
					startTime: new Date(session.startTime).toLocaleString('en-US', {
						month: 'long',
						day: 'numeric',
						year: 'numeric',
						timeZone: 'UTC',
						hour: '2-digit',
						minute: '2-digit',
						hourCycle: 'h23',
					}),
					endTime: new Date(session.endTime).toLocaleString('en-US', {
						month: 'long',
						day: 'numeric',
						year: 'numeric',
						timeZone: 'UTC',
						hour: '2-digit',
						minute: '2-digit',
						hourCycle: 'h23',
					}),
				},
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);
router.delete('/request/:id', getUser, async (req: Request, res: Response) => {
	try {
		const request = await TrainingRequestModel.findById(req.params['id']).exec();

		if (!request) {
			return res.status(404).json({ error: 'Training request not found' });
		}

		const isSelf = req.user!.cid === request.studentCid;

		if (!isSelf) {
			hasRole(['atm', 'datm', 'ta'])(req, res, () => {}); // Call the auth middleware
		}

		await request.delete();

		if (isSelf) {
			await NotificationModel.create({
				recipient: req.user!.cid,
				read: false,
				title: 'Training Request Cancelled',
				content: 'You have deleted your training request.',
			});
		} else {
			await NotificationModel.create({
				recipient: request.studentCid,
				read: false,
				title: 'Training Request Cancelled',
				content: `Your training request has been deleted by ${req.user!.fname + ' ' + req.user!.lname}.`,
			});
		}
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get(
	'/request/:date',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
		try {
			const paramDate = req.params['date'] as string;
			const d = new Date(
				`${paramDate.slice(0, 4)}-${paramDate.slice(4, 6)}-${paramDate.slice(6, 8)}`,
			);
			const dayAfter = new Date(d);
			dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

			const requests = await TrainingRequestModel.find({
				startTime: {
					$gte: d.toISOString(),
					$lt: dayAfter.toISOString(),
				},
				instructorCid: null,
				deleted: false,
			})
				.populate('student', 'fname lname rating vis')
				.populate('milestone', 'name code')
				.lean()
				.exec();

			res.stdRes.data = requests;
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.get(
	'/session/open',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
		try {
			const sessions = await TrainingSessionModel.find({
				instructorCid: req.user!.cid,
				submitted: false,
			})
				.populate('student', 'fname lname cid vis')
				.populate('milestone', 'name code')
				.lean()
				.exec();

			res.stdRes.data = sessions;
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.get('/session/:id', getUser, async (req: Request, res: Response) => {
	try {
		const isIns = ['ta', 'ins', 'mtr', 'ia', 'atm', 'datm'].some((r) =>
			req.user!.roleCodes.includes(r),
		);

		if (isIns) {
			const session = await TrainingSessionModel.findById(req.params['id'])
				.populate('student', 'fname lname cid vis')
				.populate('instructor', 'fname lname cid')
				.populate('milestone', 'name code')
				.lean()
				.exec();

			res.stdRes.data = session;
		} else {
			const session = await TrainingSessionModel.findById(req.params['id'])
				.select('-insNotes')
				.populate('student', 'fname lname cid vis')
				.populate('instructor', 'fname lname cid')
				.populate('milestone', 'name code')
				.lean()
				.exec();

			res.stdRes.data = session;
		}
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get(
	'/sessions',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
		try {
			const page = +(req.query['page'] as string) || 1;
			const limit = +(req.query['limit'] as string) || 20;

			const amount = await TrainingSessionModel.countDocuments({
				submitted: true,
				deleted: false,
			}).exec();
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
				.exec();

			res.stdRes.data = {
				count: amount,
				sessions: sessions,
			};
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.get('/sessions/past', getUser, async (req: Request, res: Response) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 20;

		const amount = await TrainingSessionModel.countDocuments({
			studentCid: req.user!.cid,
			deleted: false,
			submitted: true,
		}).exec();
		const sessions = await TrainingSessionModel.find({
			studentCid: req.user!.cid,
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
			.exec();

		res.stdRes.data = {
			count: amount,
			sessions: sessions,
		};
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get(
	'/sessions/:cid',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
		try {
			const controller = await UserModel.findOne({ cid: req.params['cid'] })
				.select('fname lname')
				.lean()
				.exec();
			if (!controller) {
				throw {
					code: 400,
					message: 'User not found',
				};
			}

			const page = +(req.query['page'] as string) || 1;
			const limit = +(req.query['limit'] as string) || 20;

			const amount = await TrainingSessionModel.countDocuments({
				studentCid: req.params['cid'],
				submitted: true,
				deleted: false,
			}).exec();
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
				.exec();

			res.stdRes.data = {
				count: amount,
				sessions: sessions,
				controller: controller,
			};
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.put(
	'/session/save/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
		try {
			await TrainingSessionModel.findByIdAndUpdate(req.params['id'], req.body).exec();
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.put(
	'/session/submit/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
		try {
			if (
				req.body.position === '' ||
				req.body.progress === null ||
				req.body.movements === null ||
				req.body.location === null ||
				req.body.ots === null ||
				req.body.studentNotes === null ||
				(req.body.studentNotes && req.body.studentNotes.length > 3000) ||
				(req.body.insNotes && req.body.insNotes.length > 3000)
			) {
				throw {
					code: 400,
					message: 'You must fill out all required forms',
				};
			}

			const delta =
				Math.abs(new Date(req.body.endTime).getTime() - new Date(req.body.startTime).getTime()) /
				1000;
			const hours = Math.floor(delta / 3600);
			const minutes = Math.floor(delta / 60) % 60;

			const duration = `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)}`;

			const session = await TrainingSessionModel.findByIdAndUpdate(
				req.params['id'],
				req.body,
			).exec();

			if (!session) {
				throw {
					code: 400,
					message: 'Bad Request.',
				};
			}

			// Send the training record to vatusa
			const vatusaRes = await vatusaApi.post(`/user/${session.studentCid}/training/record`, {
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

			// update the database flag to submitted to prevent further updates.
			session.vatusaId = vatusaRes.data.id;
			session.submitted = true;
			session.save();

			const instructor = await UserModel.findOne({ cid: session.instructorCid })
				.select('fname lname')
				.lean()
				.exec();

			NotificationModel.create({
				recipient: session.studentCid,
				read: false,
				title: 'Training Notes Submitted',
				content: `The training notes from your session with <b>${instructor!.fname + ' ' + instructor!.lname}</b> have been submitted.`,
				link: `/dash/training/session/${req.params['id']}`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.post(
	'/session/save',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
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
				(req.body.studentNotes && req.body.studentNotes.length > 3000) ||
				(req.body.insNotes && req.body.insNotes.length > 3000)
			) {
				throw {
					code: 400,
					message: 'You must fill out all required forms',
				};
			}

			const start = new Date(
				Math.round(new Date(req.body.startTime).getTime() / fifteen) * fifteen,
			);
			const end = new Date(Math.round(new Date(req.body.endTime).getTime() / fifteen) * fifteen);

			if (end < start) {
				throw {
					code: 400,
					message: 'End Time must be before Start Time',
				};
			}

			const delta = Math.abs(end.getTime() - start.getTime()) / 1000;
			const hours = Math.floor(delta / 3600);
			const minutes = Math.floor(delta / 60) % 60;

			const duration = `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)}`;

			await TrainingSessionModel.create({
				studentCid: req.body.student,
				instructorCid: req.user!.cid,
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
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.post(
	'/session/submit',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
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
				(req.body.studentNotes && req.body.studentNotes.length > 3000) ||
				(req.body.insNotes && req.body.insNotes.length > 3000)
			) {
				throw {
					code: 400,
					message: 'You must fill out all required forms',
				};
			}

			const start = new Date(
				Math.round(new Date(req.body.startTime).getTime() / fifteen) * fifteen,
			);
			const end = new Date(Math.round(new Date(req.body.endTime).getTime() / fifteen) * fifteen);

			if (end < start) {
				throw {
					code: 400,
					message: 'End Time must be before Start Time',
				};
			}

			const delta = Math.abs(end.getTime() - start.getTime()) / 1000;

			const hours = Math.floor(delta / 3600);
			const minutes = Math.floor(delta / 60) % 60;

			const duration = `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)}`;

			const doc = await TrainingSessionModel.create({
				studentCid: req.body.student,
				instructorCid: req.user!.cid,
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
			});

			const vatusaRes = await vatusaApi.post(`/user/${req.body.student}/training/record`, {
				instructor_id: req.user!.cid,
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

			doc.vatusaId = vatusaRes.data.id;
			doc.submitted = true;
			doc.save();
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.post(
	'/solo',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
		try {
			if (
				!req.body.student ||
				!req.body.position ||
				!req.body.expirationDate ||
				!req.body.vatusaId
			) {
				throw {
					code: 400,
					message: 'All fields are required.',
				};
			}

			const student = await UserModel.findOne({ cid: req.body.student }).exec();
			if (!student) {
				throw {
					code: 400,
					message: 'Student not found.',
				};
			}

			const endDate = new Date(req.body.expirationDate);

			SoloEndorsementModel.create({
				studentCid: student.cid,
				instructorCid: req.user!.cid,
				position: req.body.position,
				vatusaId: req.body.vatusaId,
				endTime: endDate,
			});

			NotificationModel.create({
				recipient: req.body.student,
				read: false,
				title: 'Solo Endorsement Issued',
				content: `You have been issued a solo endorsement for <b>${req.body.position}</b> by <b>${req.user!.fname} ${req.user!.lname}</b>. It will expire on ${endDate.toLocaleDateString()}`,
			});

			req.app.dossier.create({
				by: req.user!.cid,
				affected: req.body.student,
				action: `%b issued a solo endorsement for %a to work ${req.body.position} until ${endDate.toLocaleDateString()}`,
			});

			axios.post(
				`https://discord.com/api/v10/channels/1341139323604439090/message`,
				{
					content: `**SOLO ENDORSEMENT ISSUANCE**\n\nStudent Name: ${student.fname} ${student.lname}${student.discord ? ` <@${student.discord}>` : ''}\nInstructor Name: ${req.user!.fname} ${req.user!.lname}\nIssued Date: ${new Date().toLocaleDateString()}\nExpires Date: ${endDate.toLocaleDateString()}\nPosition: ${req.body.position}\n<@&1215950778120933467>`,
				},
				{
					headers: {
						Authorization: `Bot ${process.env['DISCORD_TOKEN']}`,
						'Content-Type': 'application/json',
						'User-Agent': 'vZAU ARTCC API Integration',
					},
				},
			);
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.delete(
	'/solo/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
		try {
			const solo = await SoloEndorsementModel.findOne({
				id: req.params['id'],
				deleted: false,
			}).exec();
			if (!solo) {
				throw {
					code: 404,
					message: 'Solo endorsement not found.',
				};
			}

			vatusaApi.delete(`/solo?id=${solo.vatusaId}`);
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

export default router;
