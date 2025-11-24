import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import tar from 'tar-stream';
import zlib from 'zlib';
import { sendMail } from '../../helpers/mailer.js';
import getUser from '../../middleware/user.js';
import { AbsenceModel } from '../../models/absence.js';
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
import { SoloEndorsementModel } from '../../models/soloEndorsement.js';
import { TrainingRequestModel } from '../../models/trainingRequest.js';
import { TrainingSessionModel } from '../../models/trainingSession.js';
import { UserModel } from '../../models/user.js';
import { VisitApplicationModel } from '../../models/visitApplication.js';
import status from '../../types/status.js';

const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

const router = Router();

router.post('/request', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (req.user.lastGdrpRequest && Date.now() - req.user.lastGdrpRequest.getTime() < DAYS_30) {
			return res.status(status.TOO_MANY_REQUESTS).json();
		}

		res.status(status.OK).json({
			message:
				'Your request has been received. We are gathering your data and will send the archive to your email address on file with VATSIM shortly.',
		});

		const absences = await AbsenceModel.find({ controller: req.user.cid }).lean().exec();
		const hours = await ControllerHoursModel.find({ cid: req.user.cid }).lean().exec();
		const createdDocuments = await DocumentModel.find({ author: req.user.cid }).lean().exec();
		const actionLog = await DossierModel.find({
			$or: [{ affected: req.user.cid }, { by: req.user.cid }],
		})
			.lean()
			.exec();
		const createdFiles = await DownloadModel.find({ author: req.user._id }).lean().exec();
		const events = await EventModel.find({
			$or: [
				{ createdBy: req.user.cid },
				{ 'positions.takenBy': req.user.cid },
				{ 'signups.cid': req.user.cid },
			],
		})
			.lean()
			.exec();
		const exams = await ExamModel.find({ createdBy: req.user._id }).lean().exec();
		const examAttempts = await ExamAttemptModel.find({ user: req.user._id }).lean().exec();
		const feedback = await FeedbackModel.find({
			$or: [{ submitter: req.user.cid }, { controllerCid: req.user.cid }],
		})
			.lean()
			.exec();
		const news = await NewsModel.find({ createdBy: req.user.cid }).lean().exec();
		const notifications = await NotificationModel.find({ recipient: req.user.cid }).lean().exec();
		const solos = await SoloEndorsementModel.find({
			$or: [{ studentCid: req.user.cid }, { instructorCid: req.user.cid }],
		})
			.lean()
			.exec();
		const trainingRequests = await TrainingRequestModel.find({
			$or: [{ studentCid: req.user.cid }, { instructorCid: req.user.cid }],
		})
			.lean()
			.exec();
		const trainingSessions = await TrainingSessionModel.find({
			$or: [{ studentCid: req.user.cid }, { instructorCid: req.user.cid }],
		})
			.select('-insNotes')
			.lean()
			.exec();
		const user = await UserModel.findOne({ cid: req.user.cid }).lean().exec();
		const visitApplications = await VisitApplicationModel.find({ cid: req.user.cid }).lean().exec();

		const filename = `${req.user.cid}-${Date.now()}.tar.gz`;

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
				name: req.user.name,
				date: new Date(),
			},
			attachments: [{ filename, content: gzBuffer }],
		});

		await UserModel.findOneAndUpdate(
			{ cid: req.user.cid },
			{ $set: { lastGdrpRequest: new Date() } },
		);

		await DossierModel.create({
			affected: -1,
			by: req.user.cid,
			action: "%b generated a copy of their data under GDRP's Right to Access.",
			actionType: ACTION_TYPE.REQUEST_GDRP_DATA,
		});
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}

		return next(e);
	}
});

export default router;
