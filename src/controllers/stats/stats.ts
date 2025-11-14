import { captureException } from '@sentry/node';
import axios from 'axios';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DateTime } from 'luxon';
import type { FlattenMaps } from 'mongoose';
import zau from '../../helpers/zau.js';
import { hasRole, isInstructor, isStaff } from '../../middleware/auth.js';
import internalAuth from '../../middleware/internalAuth.js';
import getUser from '../../middleware/user.js';
import { ControllerHoursModel } from '../../models/controllerHours.js';
import { FeedbackModel } from '../../models/feedback.js';
import { TrainingRequestModel } from '../../models/trainingRequest.js';
import { TrainingSessionModel } from '../../models/trainingSession.js';
import { UserModel, type IUser } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();

const months = [
	'',
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

let testUserCID = 0;

//#region Dashboards
router.get('/admin', getUser, isStaff, async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const d = new Date();
		const thisMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
		const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
		const totalTime = await ControllerHoursModel.aggregate([
			{ $match: { timeStart: { $gt: thisMonth, $lt: nextMonth } } },
			{ $project: { length: { $subtract: ['$timeEnd', '$timeStart'] } } },
			{ $group: { _id: null, total: { $sum: '$length' } } },
		])
			.cache('10 minutes')
			.exec();

		const sessionCount = await ControllerHoursModel.aggregate([
			{ $match: { timeStart: { $gt: thisMonth, $lt: nextMonth } } },
			{ $group: { _id: null, total: { $sum: 1 } } },
		])
			.cache('10 minutes')
			.exec();

		const feedback = await FeedbackModel.aggregate([
			{ $match: { approved: true } },
			{ $project: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } } },
			{
				$group: {
					_id: {
						month: '$month',
						year: '$year',
					},
					total: { $sum: 1 },
					month: { $first: '$month' },
					year: { $first: '$year' },
				},
			},
			{ $sort: { year: -1, month: -1 } },
			{ $limit: 12 },
		])
			.cache('10 minutes')
			.exec();

		const hours = await ControllerHoursModel.aggregate([
			{
				$project: {
					length: {
						$subtract: ['$timeEnd', '$timeStart'],
					},
					month: {
						$month: '$timeStart',
					},
					year: {
						$year: '$timeStart',
					},
				},
			},
			{
				$group: {
					_id: {
						month: '$month',
						year: '$year',
					},
					total: { $sum: '$length' },
					month: { $first: '$month' },
					year: { $first: '$year' },
				},
			},
			{ $sort: { year: -1, month: -1 } },
			{ $limit: 12 },
		])
			.cache('10 minutes')
			.exec();

		for (const item of feedback) {
			item.month = months[item.month];
		}
		for (const item of hours) {
			item.month = months[item.month];
			item.total = Math.round(item.total / 1000);
		}

		const homeCount = await UserModel.countDocuments({ member: true, vis: false })
			.cache('10 minutes')
			.exec();
		const visitorCount = await UserModel.countDocuments({ member: true, vis: true })
			.cache('10 minutes')
			.exec();
		const ratingCounts = await UserModel.aggregate([
			{ $match: { member: true } },
			{ $group: { _id: '$rating', count: { $sum: 1 } } },
			{ $sort: { _id: -1 } },
		])
			.cache('10 minutes')
			.exec();

		for (const item of ratingCounts) {
			item.rating = zau.ratingsShort[item._id];
		}

		return res.status(status.OK).json({
			totalTime: totalTime[0] ? Math.round(totalTime[0].total / 1000) : 1,
			totalSessions: sessionCount[0] ? Math.round(sessionCount[0].total) : 1,
			feedback: feedback.reverse(),
			hours: hours.reverse(),
			counts: {
				home: homeCount,
				vis: visitorCount,
				byRating: ratingCounts.reverse(),
			},
		});
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get(
	'/ins',
	getUser,
	isInstructor,
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			let lastTraining = await TrainingSessionModel.aggregate([
				{
					$group: {
						_id: '$studentCid',
						studentCid: { $first: '$studentCid' },
						lastSession: { $last: '$endTime' },
						milestoneCode: { $first: '$milestoneCode' },
					},
				},
				{ $sort: { lastSession: 1 } },
			])
				.cache('10 minutes')
				.exec();

			let lastRequest = await TrainingRequestModel.aggregate([
				{
					$group: {
						_id: '$studentCid',
						studentCid: { $first: '$studentCid' },
						lastRequest: { $last: '$endTime' },
						milestoneCode: { $first: '$milestoneCode' },
					},
				},
				{ $sort: { lastSession: 1 } },
			])
				.cache('10 minutes')
				.exec();

			await TrainingSessionModel.populate(lastTraining, { path: 'student' });
			await TrainingSessionModel.populate(lastTraining, { path: 'milestone' });
			await TrainingRequestModel.populate(lastRequest, { path: 'milestone' });
			const allHomeControllers = await UserModel.find({ member: true, rating: { $lt: 12 } })
				.select('-email -idsToken -discordInfo')
				.lean({ virtuals: true })
				.cache('10 minutes')
				.exec();
			const allCids = allHomeControllers.map((c) => c.cid);
			lastTraining = lastTraining.filter(
				(train) => train.student?.rating < 12 && train.student?.member && !train.student?.vis,
			);
			const cidsWithTraining = lastTraining.map((train) => train.studentCid);
			const cidsWithoutTraining = allCids.filter((cid) => !cidsWithTraining.includes(cid));

			const controllersWithoutTraining = allHomeControllers
				.filter((c) => cidsWithoutTraining.includes(c.cid))
				.filter((c) => !c.certCodes.includes('zau'));
			lastRequest = lastRequest.reduce((acc, cur) => {
				acc[cur.studentCid] = cur;
				return acc;
			}, {});

			return res.status(status.OK).json({
				lastTraining,
				lastRequest,
				controllersWithoutTraining,
			});
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);
//#endregion

//#region Controller Activity Page
function isExempt(user: IUser, startOfPeriod: Date) {
	if (user.cid === testUserCID) {
		console.log(`Checking exemption for test user ${user.cid}`);
		console.log(
			`User joinDate: ${user.joinDate}, Start of ${zau.activity.period.unit}: ${startOfPeriod}`,
		);
	}

	if (user.joinDate && user.joinDate >= startOfPeriod) {
		if (user.cid === testUserCID) {
			console.log(
				`Test user ${user.cid} is exempt: joined during the ${zau.activity.period.unit}.`,
			);
		}
		return true;
	}

	if (user.certificationDate && Array.isArray(user.certificationDate)) {
		if (user.cid === testUserCID) {
			console.log(`CertificationDates for test user ${user.cid}:`, user.certificationDate);
		}

		const promotedToS1 = user.certificationDate.some((cert) => {
			const gainedDate = cert.gainedDate;

			if (user.cid === testUserCID) {
				console.log(`Cert code: ${cert.code}, Gained Date: ${gainedDate}`);
			}

			return cert.code === 'gnd' && gainedDate && gainedDate >= startOfPeriod;
		});

		if (promotedToS1) {
			if (user.cid === testUserCID) {
				console.log(
					`Test user ${user.cid} is exempt: promoted from OBS to S1 during the ${zau.activity.period.unit}.`,
				);
			}
			return true;
		}
	} else {
		if (user.cid === testUserCID) {
			console.log(`Test user ${user.cid} has no valid certificationDate array.`);
		}
	}

	if (user.cid === testUserCID) console.log(`Test user ${user.cid} is not exempt.`);
	return false;
}

interface UserDataEntry extends FlattenMaps<IUser> {
	totalTime: number;
	totalSessions: number;
	totalRequests: number;
	exempt: boolean;
	protected: boolean;
	tooLow: boolean;
	obsTime: number;
}

interface UserDataMap {
	[key: number]: UserDataEntry;
}

// Main activity API endpoint
router.get(
	'/activity',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'wm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			//console.log('Start processing /activity endpoint');
			if (req.query['cid']) {
				testUserCID = parseInt(req.query['cid'] as string, 10);
			}

			// SECTION: Get Period & Year
			const period =
				parseInt(req.query['period'] as string) || zau.activity.period.periodFromDate();
			const year = parseInt(req.query['year'] as string, 10) || DateTime.utc().year;
			const startofPeriod = zau.activity.period.periodStartFromPeriod(period, year);
			const endOfPeriod = zau.activity.period.periodEndFromPeriod(period, year);
			console.log(
				`${zau.activity.period.unit}: ${period}, Year: ${year}, Start: ${startofPeriod}, End: ${endOfPeriod}`,
			);

			// SECTION: Fetch Users Data
			//console.log('Fetching users...');
			const users = await UserModel.find({ member: true })
				.select(
					'fname lname cid oi vis rating isStaff certCodes createdAt roleCodes certCodes joinDate certificationDate absence',
				)
				.populate('certifications')
				.populate({ path: 'certificationDate', select: 'code gainedDate' })
				.populate({
					path: 'absence',
					match: { expirationDate: { $gte: new Date() }, deleted: false },
					select: 'expirationDate',
				})
				.lean({ virtuals: true })
				.cache('10 minutes')
				.exec();

			//console.log(`Fetched ${users.length} users`);

			// SECTION: Fetch & Process Activity and Training Data
			//console.log('Fetching activity and training data...');
			const [activityReduced, trainingRequests, trainingSessions, obsReduced] = await Promise.all([
				ControllerHoursModel.aggregate([
					{
						$match: {
							timeStart: { $gte: startofPeriod, $lte: endOfPeriod },
							isStudent: { $ne: true },
							isInstructor: { $ne: true },
						},
					},
					{
						$project: {
							cid: 1,
							position: { $toUpper: '$position' },
							totalTime: { $divide: [{ $subtract: ['$timeEnd', '$timeStart'] }, 1000] },
						},
					},
					{ $match: { position: { $exists: true, $not: /_OBS$/ } } },
					{ $group: { _id: '$cid', totalTime: { $sum: '$totalTime' } } },
				])
					.cache('10 minutes')
					.exec(),
				TrainingRequestModel.aggregate([
					{
						$match: {
							startTime: { $gte: startofPeriod, $lte: endOfPeriod },
						},
					},
					{ $group: { _id: '$studentCid', totalRequests: { $sum: 1 } } },
				])
					.cache('10 minutes')
					.exec(),
				TrainingSessionModel.aggregate([
					{
						$match: {
							startTime: { $gte: startofPeriod, $lte: endOfPeriod },
						},
					},
					{ $group: { _id: '$studentCid', totalSessions: { $sum: 1 } } },
				])
					.cache('10 minutes')
					.exec(),
				ControllerHoursModel.aggregate([
					{
						$match: {
							timeStart: { $gte: startofPeriod, $lte: endOfPeriod },
							isStudent: { $ne: true },
							isInstructor: { $ne: true },
						},
					},
					{
						$project: {
							cid: 1,
							position: { $toUpper: '$position' },
							totalTime: { $divide: [{ $subtract: ['$timeEnd', '$timeStart'] }, 1000] },
						},
					},
					{ $match: { position: { $exists: true, $regex: /_OBS$/ } } },
					{ $group: { _id: '$cid', totalTime: { $sum: '$totalTime' } } },
				])
					.cache('10 minutes')
					.exec(),
			]);

			// Convert activity data into lookup objects for quick access
			const activityMap = Object.fromEntries(
				activityReduced.map(({ _id, totalTime }) => [_id, totalTime]),
			);
			const trainingRequestsMap = Object.fromEntries(
				trainingRequests.map(({ _id, totalRequests }) => [_id, totalRequests]),
			);
			const trainingSessionsMap = Object.fromEntries(
				trainingSessions.map(({ _id, totalSessions }) => [_id, totalSessions]),
			);
			const obsMap = Object.fromEntries(obsReduced.map(({ _id, totalTime }) => [_id, totalTime]));

			//console.log('Activity and training data mapped');

			// SECTION: Classify Users
			//console.log('Classifying users...');
			const userData: UserDataMap = {};

			for (const user of users) {
				if (user.cid === testUserCID) console.log(`Processing test user: ${user.cid}`);

				const totalTime = activityMap[user.cid] || 0;
				const totalRequests = trainingRequestsMap[user.cid] || 0;
				const totalSessions = trainingSessionsMap[user.cid] || 0;
				const obsTime = user.rating === 1 ? obsMap[user.cid] || 0 : 0;

				const exempt = isExempt(user as unknown as IUser, startofPeriod);
				const protectedStatus =
					user.isStaff ||
					[1202744].includes(user.cid) ||
					user.absence.some((a) => new Date(a.expirationDate) > new Date());

				userData[user.cid] = {
					...user,
					totalTime,
					totalRequests,
					totalSessions,
					exempt,
					protected: protectedStatus,
					tooLow: false,
					obsTime,
				};
			}

			// SECTION: Apply "Too Low" Checks (Now That All Data is Gathered)
			Object.keys(userData).forEach((cid) => {
				const user = userData[parseInt(cid, 10)]!;

				let tooLow = false; // Default: user has enough activity

				if (user.cid === testUserCID) {
					console.log(`\n🔍 Checking "tooLow" for Test User ${cid}`);
					console.log(`Total Time: ${user.totalTime}s`);
					console.log(`Total Sessions: ${user.totalSessions}`);
					console.log(`Rating: ${user.rating}`);
					console.log(`Exempt: ${user.exempt}`);
					if (user.rating === 1) {
						console.log(`OBS Time: ${user.obsTime}`);
					}
				}

				// Apply tooLow checks
				if (!user.exempt) {
					if (user.rating === 1) {
						if (
							user.obsTime < zau.activity.requirements.observer.seconds &&
							user.totalSessions < zau.activity.requirements.observer.trainingSessions
						) {
							if (user.cid === testUserCID) {
								console.log(
									`❌ Test User ${cid} flagged tooLow: obsTime (${user.totalTime}s) is less than ${zau.activity.requirements.observer.hours} ${zau.activity.requirements.unit}`,
								);
							}
							tooLow = true;
						}
					} else if (user.totalTime < zau.activity.requirements.controller.seconds) {
						if (user.cid === testUserCID) {
							console.log(
								`❌ Test User ${cid} flagged tooLow: totalTime (${user.totalTime}s) is less than ${zau.activity.requirements.controller.hours} ${zau.activity.requirements.unit}`,
							);
						}
						tooLow = true;
					}
				} else {
					if (user.cid === testUserCID) {
						console.log(`✅ Test User ${cid} is exempt, skipping tooLow checks.`);
					}
				}

				userData[parseInt(cid, 10)]!.tooLow = tooLow;

				if (user.cid === testUserCID) {
					console.log(`✅ Final "tooLow" status for Test User ${cid}: ${tooLow}`);
				}
			});

			//console.log('Final checks applied, returning data');

			// SECTION: Return Final Data
			res.status(status.OK).json(Object.values(userData));
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);
//#endregion

router.post(
	'/fifty/:cid',
	internalAuth,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { redis } = req.app;
			const { cid } = req.params;
			const fiftyData = await getFiftyData(cid!);
			redis.set(`FIFTY:${cid}`, fiftyData);
			redis.expire(`FIFTY:${cid}`, 86400);

			return res.status(status.CREATED).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

const getFiftyData = async (cid: string) => {
	const today = DateTime.utc();
	const chkDate = today.minus({ days: 60 });

	const { data: fiftyData } = await axios.get(
		`https://api.vatsim.net/api/ratings/${cid}/atcsessions/?start=${chkDate.toISODate()}&group_by_callsign`,
	);

	let total = 0;

	for (const session of fiftyData.results) {
		const callsignParts = session.callsign.split('_');

		if (!zau.atcPos.includes(callsignParts[0])) {
			total += session.total_minutes_on_callsign;
		}
	}

	return total;
};

export default router;
