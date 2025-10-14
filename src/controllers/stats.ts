import axios from 'axios';
import { Router, type Request, type Response } from 'express';
import { DateTime as L } from 'luxon';
import type { FlattenMaps } from 'mongoose';
import { convertToReturnDetails } from '../app.js';
import { hasRole } from '../middleware/auth.js';
import internalAuth from '../middleware/internalAuth.js';
import getUser from '../middleware/user.js';
import { ControllerHoursModel } from '../models/controllerHours.js';
import { FeedbackModel } from '../models/feedback.js';
import { TrainingRequestModel } from '../models/trainingRequest.js';
import { TrainingSessionModel } from '../models/trainingSession.js';
import { UserModel, type IUser } from '../models/user.js';
import zau from '../zau.js';

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
const ratings = [
	'Unknown',
	'OBS',
	'S1',
	'S2',
	'S3',
	'C1',
	'C2',
	'C3',
	'I1',
	'I2',
	'I3',
	'SUP',
	'ADM',
];

let testUserCID = 10000002;

router.get(
	'/admin',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'ec', 'wm']),
	async (req: Request, res: Response) => {
		try {
			const d = new Date();
			const thisMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
			const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
			const totalTime = await ControllerHoursModel.aggregate([
				{ $match: { timeStart: { $gt: thisMonth, $lt: nextMonth } } },
				{ $project: { length: { $subtract: ['$timeEnd', '$timeStart'] } } },
				{ $group: { _id: null, total: { $sum: '$length' } } },
			]);

			const sessionCount = await ControllerHoursModel.aggregate([
				{ $match: { timeStart: { $gt: thisMonth, $lt: nextMonth } } },
				{ $group: { _id: null, total: { $sum: 1 } } },
			]);

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
			]);

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
			]);

			for (const item of feedback) {
				item.month = months[item.month];
			}
			for (const item of hours) {
				item.month = months[item.month];
				item.total = Math.round(item.total / 1000);
			}

			const homeCount = await UserModel.countDocuments({ member: true, vis: false });
			const visitorCount = await UserModel.countDocuments({ member: true, vis: true });
			const ratingCounts = await UserModel.aggregate([
				{ $match: { member: true } },
				{ $group: { _id: '$rating', count: { $sum: 1 } } },
				{ $sort: { _id: -1 } },
			]);

			for (const item of ratingCounts) {
				item.rating = ratings[item._id];
			}

			res.stdRes.data.totalTime = totalTime[0] ? Math.round(totalTime[0].total / 1000) : 1;
			res.stdRes.data.totalSessions = sessionCount[0] ? Math.round(sessionCount[0].total) : 1;
			res.stdRes.data.feedback = feedback.reverse();
			res.stdRes.data.hours = hours.reverse();
			res.stdRes.data.counts = {
				home: homeCount,
				vis: visitorCount,
				byRating: ratingCounts.reverse(),
			};
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.get(
	'/ins',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']),
	async (req: Request, res: Response) => {
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
			]);

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
			]);

			await TrainingSessionModel.populate(lastTraining, { path: 'student' });
			await TrainingSessionModel.populate(lastTraining, { path: 'milestone' });
			await TrainingRequestModel.populate(lastRequest, { path: 'milestone' });
			const allHomeControllers = await UserModel.find({ member: true, rating: { $lt: 12 } }).select(
				'-email -idsToken -discordInfo',
			);
			const allCids = allHomeControllers.map((c: IUser) => c.cid);
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

			res.stdRes.data = {
				lastTraining,
				lastRequest,
				controllersWithoutTraining,
			};
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

// Helper function to calculate the start and end of a quarter given a year and quarter number
function getQuarterStartEnd(quarter: number, year: number) {
	const startOfQuarter = L.utc(year)
		.startOf('year')
		.plus({ months: (quarter - 1) * 3 }); // First day of the quarter
	const endOfQuarter = startOfQuarter.plus({ months: 3 }).minus({ days: 1 }).endOf('day'); // Last day of the quarter
	return { startOfQuarter, endOfQuarter };
}

function isExempt(user: IUser, startOfQuarter: L<true> | L<false>) {
	if (user.cid === testUserCID) {
		console.log(`Checking exemption for test user ${user.cid}`);
		console.log(`User joinDate: ${user.joinDate}, Start of Quarter: ${startOfQuarter}`);
	}

	if (user.joinDate && user.joinDate >= startOfQuarter.toJSDate()) {
		if (user.cid === testUserCID) {
			console.log(`Test user ${user.cid} is exempt: joined during the quarter.`);
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

			return cert.code === 'gnd' && gainedDate && gainedDate >= startOfQuarter.toJSDate();
		});

		if (promotedToS1) {
			if (user.cid === testUserCID) {
				console.log(`Test user ${user.cid} is exempt: promoted from OBS to S1 during the quarter.`);
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
}

interface UserDataMap {
	[key: number]: UserDataEntry;
}

// Main activity API endpoint
router.get(
	'/activity',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'wm']),
	async (req: Request, res: Response) => {
		try {
			//console.log('Start processing /activity endpoint');
			if (req.query.cid) {
				testUserCID = parseInt(req.query.cid as string, 10);
			}

			// SECTION: Get Quarter & Year
			const quarter =
				parseInt(req.query.quarter as string, 10) || Math.floor((L.utc().month - 1) / 3) + 1;
			const year = parseInt(req.query.year as string, 10) || L.utc().year;
			const { startOfQuarter, endOfQuarter } = getQuarterStartEnd(quarter, year);
			//console.log(`Quarter: ${quarter}, Year: ${year}, Start: ${startOfQuarter}, End: ${endOfQuarter}`);

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
				.lean({ virtuals: true });

			//console.log(`Fetched ${users.length} users`);

			// SECTION: Fetch & Process Activity and Training Data
			//console.log('Fetching activity and training data...');
			const [activityReduced, trainingRequests, trainingSessions] = await Promise.all([
				ControllerHoursModel.aggregate([
					{
						$match: {
							timeStart: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() },
						},
					},
					{
						$project: {
							cid: 1,
							position: { $toUpper: '$position' },
							totalTime: { $divide: [{ $subtract: ['$timeEnd', '$timeStart'] }, 1000] },
						},
					},
					{ $match: { position: { $exists: true } } },
					{
						$match: {
							$expr: {
								$or: [
									{ $in: ['$position', ['ORD_I_GND', 'ORD_S_TWR']] },
									{ $not: { $regexMatch: { input: '$position', regex: '_[IS]_' } } },
								],
							},
						},
					},
					{ $group: { _id: '$cid', totalTime: { $sum: '$totalTime' } } },
				]),
				TrainingRequestModel.aggregate([
					{
						$match: {
							startTime: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() },
						},
					},
					{ $group: { _id: '$studentCid', totalRequests: { $sum: 1 } } },
				]),
				TrainingSessionModel.aggregate([
					{
						$match: {
							startTime: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() },
						},
					},
					{ $group: { _id: '$studentCid', totalSessions: { $sum: 1 } } },
				]),
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

			//console.log('Activity and training data mapped');

			// SECTION: Classify Users
			//console.log('Classifying users...');
			const userData: UserDataMap = {};

			for (const user of users) {
				if (user.cid === testUserCID) console.log(`Processing test user: ${user.cid}`);
				const totalTime = activityMap[user.cid] || 0;
				const totalRequests = trainingRequestsMap[user.cid] || 0;
				const totalSessions = trainingSessionsMap[user.cid] || 0;

				const exempt = isExempt(user, startOfQuarter);
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
				}

				// Apply tooLow checks
				if (!user.exempt) {
					if (user.totalTime < 3600 * 3) {
						if (user.cid === testUserCID) {
							console.log(
								`❌ Test User ${cid} flagged tooLow: totalTime (${user.totalTime}s) is less than 3 hours`,
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
			res.stdRes.data = Object.values(userData);
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.post('/fifty/:cid', internalAuth, async (req: Request, res: Response) => {
	try {
		const { redis } = req.app;
		const { cid } = req.params;
		const fiftyData = await getFiftyData(cid!);
		redis.set(`FIFTY:${cid}`, fiftyData);
		redis.expire(`FIFTY:${cid}`, 86400);
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

const getFiftyData = async (cid: string) => {
	const today = L.utc();
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
