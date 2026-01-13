import { Router, type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import tar from 'tar-stream';
import zlib from 'zlib';
import { sendMail } from '../../helpers/mailer.js';
import { clearCacheKeys } from '../../helpers/redis.js';
import { isManagement } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { AbsenceModel } from '../../models/absence.js';
import { AtcOnlineModel } from '../../models/atcOnline.js';
import { AtisOnlineModel } from '../../models/atisOnline.js';
import { ControllerHoursModel } from '../../models/controllerHours.js';
import { DocumentModel } from '../../models/document.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { DownloadModel } from '../../models/download.js';
import EventModel from '../../models/event.js';
import { ExamModel } from '../../models/exam.js';
import { ExamAttemptModel } from '../../models/examAttempt.js';
import { FeedbackModel } from '../../models/feedback.js';
import { NewsModel } from '../../models/news.js';
import { NotificationModel } from '../../models/notification.js';
import { PilotOnlineModel } from '../../models/pilotOnline.js';
import { SoloEndorsementModel } from '../../models/soloEndorsement.js';
import { TrainingRequestModel } from '../../models/trainingRequest.js';
import { TrainingSessionModel } from '../../models/trainingSession.js';
import { UserModel } from '../../models/user.js';
import { VisitApplicationModel } from '../../models/visitApplication.js';
import status from '../../types/status.js';
import { clearUserCache } from '../controller/utils.js';

const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

const router = Router();

router.post('/request', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (req.user.lastGdrpRequest && Date.now() - req.user.lastGdrpRequest.getTime() < DAYS_30) {
			throw {
				code: status.TOO_MANY_REQUESTS,
				message: 'Only one request is permitted every 30 days.',
			};
		}

		res.status(status.OK).json({
			message:
				'Your request has been received. We are gathering your data and will send the archive to your email address on file with VATSIM shortly.',
		});

		getGdrpData(req.user.cid);
	} catch (e) {
		return next(e);
	}
});

router.post(
	'/request/:cid',
	getUser,
	isManagement,
	async (req: Request, _res: Response, next: NextFunction) => {
		try {
			if (
				!req.params['cid'] ||
				req.params['cid'] === 'undefined' ||
				isNaN(Number(req.params['cid'])) ||
				+req.params['cid'] < 1
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid request.',
				};
			}

			getGdrpData(Number(req.params['cid']));
		} catch (e) {
			return next(e);
		}
	},
);

async function getGdrpData(cid: number) {
	const user = await UserModel.findOne({ cid: cid }).lean().exec();
	if (!user) {
		throw {
			code: status.NOT_FOUND,
			message: 'User not found.',
		};
	}

	const absences = await AbsenceModel.find({ controller: cid }).lean().exec();
	const hours = await ControllerHoursModel.find({ cid: cid }).lean().exec();
	const createdDocuments = await DocumentModel.find({ author: cid }).lean().exec();
	const actionLog = await DossierModel.find({
		$or: [{ affected: cid }, { by: cid }],
	})
		.lean()
		.exec();
	const createdFiles = await DownloadModel.find({ author: user.cid }).lean().exec();
	const events = await EventModel.find({
		$or: [{ createdBy: cid }, { 'positions.takenBy': cid }, { 'signups.cid': cid }],
	})
		.lean()
		.exec();
	const exams = await ExamModel.find({ createdBy: cid }).lean().exec();
	const examAttempts = await ExamAttemptModel.find({ student: cid }).lean().exec();
	const feedback = await FeedbackModel.find({
		$or: [{ submitter: cid }, { controllerCid: cid }],
	})
		.lean()
		.exec();
	const news = await NewsModel.find({ createdBy: cid }).lean().exec();
	const notifications = await NotificationModel.find({ recipient: cid }).lean().exec();
	const solos = await SoloEndorsementModel.find({
		$or: [{ studentCid: cid }, { instructorCid: cid }],
	})
		.lean()
		.exec();
	const trainingRequests = await TrainingRequestModel.find({
		$or: [{ studentCid: cid }, { instructorCid: cid }],
	})
		.lean()
		.exec();
	const trainingSessions = await TrainingSessionModel.find({
		$or: [{ studentCid: cid }, { instructorCid: cid }],
	})
		.select('-insNotes')
		.lean()
		.exec();

	const visitApplications = await VisitApplicationModel.find({ cid: cid }).lean().exec();

	const filename = `${cid}-${Date.now()}.tar.gz`;

	const pack = tar.pack();

	for await (const item of absences) {
		pack.entry(
			{
				name: path.posix.join('absences', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of hours) {
		pack.entry(
			{
				name: path.posix.join('controlling_sessions', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of createdDocuments) {
		pack.entry(
			{
				name: path.posix.join('documents', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of actionLog) {
		pack.entry(
			{
				name: path.posix.join('actions', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of createdFiles) {
		pack.entry(
			{
				name: path.posix.join('downloads', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of events) {
		pack.entry(
			{
				name: path.posix.join('events', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of exams) {
		pack.entry(
			{
				name: path.posix.join('exam', 'exams', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of examAttempts) {
		pack.entry(
			{
				name: path.posix.join('exam', 'attempts', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of feedback) {
		pack.entry(
			{
				name: path.posix.join('feedback', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of news) {
		pack.entry(
			{
				name: path.posix.join('news', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of notifications) {
		pack.entry(
			{
				name: path.posix.join('notifications', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of solos) {
		pack.entry(
			{
				name: path.posix.join('training', 'solo_endorsements', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of trainingRequests) {
		pack.entry(
			{
				name: path.posix.join('training', 'requests', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of trainingSessions) {
		pack.entry(
			{
				name: path.posix.join('training', 'sessions', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	for await (const item of visitApplications) {
		pack.entry(
			{
				name: path.posix.join('visit_applications', `${item._id}.json`),
			},
			Buffer.from(JSON.stringify(item, null, 2)),
		);
	}

	pack.entry(
		{
			name: `user_${user!._id}.json`,
		},
		Buffer.from(JSON.stringify(user, null, 2)),
	);

	pack.finalize();

	const gzip = zlib.createGzip({ level: 9 });

	const chunks: any[] = [];
	const collector = new PassThrough();
	collector.on('data', (chunk) => chunks.push(chunk));

	await pipeline(pack, gzip, collector);

	const gzBuffer = Buffer.concat(chunks);

	sendMail({
		to: user!.email,
		subject: 'GDRP Right to Access Request Serviced',
		template: 'gdrpRequest',
		context: {
			name: user!.name,
			date: new Date(),
		},
		attachments: [{ filename, content: gzBuffer }],
	});

	await UserModel.findOneAndUpdate({ cid: cid }, { $set: { lastGdrpRequest: new Date() } });

	await DossierModel.create({
		affected: -1,
		by: cid,
		action: "%b generated a copy of their data under GDRP's Right to Access.",
		actionType: ACTION_TYPE.REQUEST_GDRP_DATA,
	});

	clearUserCache(cid);
}

router.delete(
	'/:cid',
	getUser,
	isManagement,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.params['cid'] ||
				req.params['cid'] === undefined ||
				isNaN(Number(req.params['cid'])) ||
				+req.params['cid'] < 0
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid request.',
				};
			}

			const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();
			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'User not found.',
				};
			}

			await AbsenceModel.deleteMany({ controller: user.cid }).exec();

			await AtcOnlineModel.deleteMany({ cid: user.cid }).exec();

			await AtisOnlineModel.deleteMany({ cid: user.cid }).exec();

			await ControllerHoursModel.deleteMany({ cid: user.cid }).exec();

			await DocumentModel.updateMany({ author: user.cid }, { $set: { author: -2 } }).exec();

			await DossierModel.deleteMany({ affected: user.cid }).exec();
			await DossierModel.updateMany({ by: user.cid }, { $set: { by: -2 } }).exec();

			await DownloadModel.updateMany({ author: user.cid }, { $set: { author: -2 } }).exec();

			await EventModel.updateMany({ createdBy: user.cid }, { $set: { createdBy: -2 } }).exec();
			await EventModel.updateMany(
				{ 'signups.cid': user.cid },
				{
					$pull: {
						signups: {
							cid: req.user.cid,
						},
					},
				},
			).exec();
			await EventModel.updateMany(
				{ 'positions.takenBy': user.cid },
				{
					$set: {
						// Target all array elements matching the filter 'pos'
						'positions.$[pos].takenBy': -2,
					},
				},
				{
					// The filter 'pos' will match any element in 'positions'
					// where the 'takenBy' field equals the oldCid.
					arrayFilters: [{ 'pos.takenBy': user.cid }],
				},
			).exec();

			await ExamModel.updateMany({ createdBy: user.cid }, { $set: { createdBy: -2 } }).exec();

			await ExamAttemptModel.deleteMany({ student: user.cid }).exec();

			await FeedbackModel.deleteMany({ controllerCid: user.cid }).exec();
			await FeedbackModel.updateMany({ submitter: user.cid }, { $set: { submitter: -2 } }).exec();

			await NewsModel.updateMany({ createdBy: user.cid }, { $set: { createdBy: -2 } }).exec();

			await NotificationModel.deleteMany({ recipient: user.cid }).exec();

			await PilotOnlineModel.deleteMany({ cid: user.cid }).exec();

			await SoloEndorsementModel.deleteMany({ studentCid: user.cid }).exec();
			await SoloEndorsementModel.updateMany(
				{ instructorCid: user.cid },
				{ $set: { instructorCid: -2 } },
			).exec();

			await TrainingRequestModel.deleteMany({ studentCid: user.cid }).exec();
			await TrainingRequestModel.updateMany(
				{ instructorCid: user.cid },
				{ $set: { instructorCid: -2 } },
			).exec();

			await TrainingSessionModel.deleteMany({ $or: [{ studentCid: user.cid }] }).exec();
			await TrainingSessionModel.updateMany(
				{ instructorCid: user.cid },
				{ $set: { instructorCid: -2 } },
			).exec();

			await VisitApplicationModel.deleteMany({ cid: user.cid }).exec();

			await UserModel.findByIdAndDelete(user._id).exec();

			await DossierModel.create({
				affected: -1,
				by: req.user.cid,
				action: `%b completed a Right to Erasure request for ${req.params['cid']}`,
				actionType: ACTION_TYPE.ERASE_USER_DATA,
			});

			// Full cache reset due to GDRP request.
			clearCacheKeys();

			return res.status(status.NO_CONTENT).json({ message: 'User erased successfully!' });
		} catch (e) {
			return next(e);
		}
	},
);

export default router;
