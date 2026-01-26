import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance } from '../../app.js';
import {
	throwBadRequestException,
	throwNotFoundException,
	throwTooManyRequestsException,
} from '../../helpers/errors.js';
import { sendMail } from '../../helpers/mailer.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import { isTrainingStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { NotificationModel } from '../../models/notification.js';
import { TrainingRequestMilestoneModel } from '../../models/trainingMilestone.js';
import { TrainingRequestModel } from '../../models/trainingRequest.js';
import { TrainingSessionModel } from '../../models/trainingSession.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();

router.get('/upcoming', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const upcoming = await TrainingRequestModel.find({
			studentCid: req.user.cid,
			deleted: false,
			startTime: {
				$gt: new Date(new Date().toUTCString()), // request is in the future
			},
		})
			.populate('instructor', 'fname lname cid')
			.populate('milestone', 'code name')
			.sort({ startTime: 'asc' })
			.lean()
			.cache('10 minutes', 'training-requests')
			.exec();

		return res.status(status.OK).json(upcoming);
	} catch (e) {
		return next(e);
	}
});

router.post('/new', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.body.never || req.body.never) {
			throwBadRequestException('Temporarily Disabled');
		}
		if (
			!req.body.submitter ||
			!req.body.startTime ||
			!req.body.endTime ||
			!req.body.milestone ||
			req.body.remarks.length > 500
		) {
			throwBadRequestException('All fields are required');
		}

		if (new Date(req.body.startTime) < new Date() || new Date(req.body.endTime) < new Date()) {
			throwBadRequestException('Dates must be in the future');
		}

		if (new Date(req.body.startTime) > new Date(req.body.endTime)) {
			throwBadRequestException('End time must be greater than start time');
		}

		if (
			(new Date(req.body.endTime).getTime() - new Date(req.body.startTime).getTime()) / 60000 <
			60
		) {
			throwBadRequestException('Duration must be at least 60 minutes');
		}

		if (
			(new Date(req.body.endTime).getTime() - new Date(req.body.startTime).getTime()) / 60000 >
			960
		) {
			throwBadRequestException('Duration must be less than 16 hours');
		}

		const totalRequests = await req.app.redis.get(`TRAININGREQ:${req.user.cid}`);

		if (parseInt(totalRequests!, 10) > 5) {
			throwTooManyRequestsException('You have requested too many session in the past 4 hours.');
		}

		req.app.redis.set(`TRAININGREQ:${req.user.cid}`, (+totalRequests! || 0) + 1);
		req.app.redis.expire(`TRAININGREQ:${req.user.cid}`, 14400);

		await TrainingRequestModel.create({
			studentCid: req.user.cid,
			startTime: req.body.startTime,
			endTime: req.body.endTime,
			milestoneCode: req.body.milestone,
			remarks: req.body.remarks,
		});
		await getCacheInstance().clear('training-requests');

		const student = await UserModel.findOne({ cid: req.user.cid })
			.select('fname lname')
			.lean()
			.cache('10 minutes', `training-user-${req.user.cid}`)
			.exec();
		if (!student) {
			throwNotFoundException('Student Not Found');
		}

		const milestone = await TrainingRequestMilestoneModel.findOne({
			code: req.body.milestone,
		})
			.lean()
			.cache('1 day', `milestone-${req.body.milestone}`)
			.exec();

		if (!milestone) {
			throwNotFoundException('Milestone Not Found');
		}

		sendMail({
			to: 'training@zauartcc.org',
			subject: `New Training Request: ${student.name} | Chicago ARTCC`,
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

		return res.status(status.CREATED).json();
	} catch (e) {
		return next(e);
	}
});

router.get(
	'/open',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
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
				.cache('10 minutes', 'open-requests')
				.exec();

			return res.status(status.OK).json(requests);
		} catch (e) {
			return next(e);
		}
	},
);

router.get(
	'/open/:date',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['date'] || req.params['date'] === 'undefined') {
				throwBadRequestException('Invalid date');
			}

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
				.cache()
				.exec();

			return res.status(status.OK).json(requests);
		} catch (e) {
			return next(e);
		}
	},
);

router.post(
	'/:id/take',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throwBadRequestException('Invalid ID');
			}

			if (new Date(req.body.startTime) >= new Date(req.body.endTime)) {
				throwBadRequestException('End time must be greater than start time');
			}

			const request = await TrainingRequestModel.findByIdAndUpdate(req.params['id'], {
				instructorCid: req.user.cid,
				startTime: req.body.startTime,
				endTime: req.body.endTime,
			})
				.lean()
				.exec();

			await getCacheInstance().clear('open-requests');

			if (!request) {
				throwNotFoundException('Training Request Not Found');
			}

			const session = await TrainingSessionModel.create({
				studentCid: request.studentCid,
				instructorCid: req.user.cid,
				startTime: req.body.startTime,
				endTime: req.body.endTime,
				milestoneCode: request.milestoneCode,
				submitted: false,
			});

			const student = await UserModel.findOne({ cid: request.studentCid })
				.select('fname lname email')
				.lean()
				.cache('10 minutes', `take-${request.studentCid}`)
				.exec();
			if (!student) {
				throwNotFoundException('Student Not Found');
			}

			const instructor = await UserModel.findOne({ cid: req.user.cid })
				.select('fname lname email')
				.lean()
				.cache('10 minutes', `take-${req.user.cid}`)
				.exec();
			if (!instructor) {
				throwNotFoundException('Instructor Not Found');
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

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.delete('/:id', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['id'] || req.params['id'] === 'undefined') {
			throwBadRequestException('Invalid ID');
		}

		const request = await TrainingRequestModel.findById(req.params['id'])
			.cache('10 minutes', `request-${req.params['id']}`)
			.exec();

		if (!request) {
			throwNotFoundException('Training Request Not Found');
		}

		const isSelf = req.user.cid === request.studentCid;

		if (!isSelf && !req.user.isSeniorStaff) {
			res.status(status.FORBIDDEN).json();
		}

		await request.delete();
		await getCacheInstance().clear('open-requests');
		await getCacheInstance().clear('training-requests');
		await getCacheInstance().clear(`request-${req.params['id']}`);

		if (isSelf) {
			await NotificationModel.create({
				recipient: req.user.cid,
				read: false,
				title: 'Training Request Cancelled',
				content: 'You have deleted your training request.',
			});

			clearCachePrefix(`notifications-${req.user.cid}`);
		} else {
			await NotificationModel.create({
				recipient: request.studentCid,
				read: false,
				title: 'Training Request Cancelled',
				content: `Your training request has been deleted by ${req.user.name}.`,
			});

			clearCachePrefix(`notifications-${request.studentCid}`);
		}

		return res.status(status.NO_CONTENT).json();
	} catch (e) {
		return next(e);
	}
});

export default router;
