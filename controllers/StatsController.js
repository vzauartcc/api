import express from 'express';
import getUser from '../middleware/getUser.js';
import auth from '../middleware/auth.js';
import microAuth from '../middleware/microAuth.js';
import axios from 'axios';
import zab from '../config/zab.js';
const router = express.Router();

import ControllerHours from '../models/ControllerHours.js';
import Feedback from '../models/Feedback.js';
import TrainingRequest from '../models/TrainingRequest.js';
import TrainingSession from '../models/TrainingSession.js';
import User from '../models/User.js';
import { DateTime as L } from 'luxon'

const months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ratings = ["Unknown", "OBS", "S1", "S2", "S3", "C1", "C2", "C3", "I1", "I2", "I3", "SUP", "ADM"];

router.get('/admin', getUser, auth(['atm', 'datm', 'ta', 'fe', 'ec', 'wm']), async (req, res) => {
	try {
		const d = new Date();
		const thisMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
		const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 1))
		const totalTime = await ControllerHours.aggregate([
			{$match: {timeStart: {$gt: thisMonth, $lt: nextMonth}}},
			{$project: {length: {$subtract: ['$timeEnd', '$timeStart']}}},
			{$group: {_id: null, total: {$sum: '$length'}}}
		])

		const sessionCount = await ControllerHours.aggregate([
			{$match: {timeStart: {$gt: thisMonth, $lt: nextMonth}}},
			{$group: {_id: null, total: {$sum: 1}}}
		])

		const feedback = await Feedback.aggregate([
			{$match: {approved: true}},
			{$project: { month: {$month: "$createdAt"}, year: {$year: "$createdAt"}}},
			{$group:
					{
						_id: {
							month: "$month",
							year: "$year"
						},
						total: { $sum: 1 },
						month: { $first: "$month" },
						year: { $first: "$year" },
					}
			},
			{$sort: {year: -1, month: -1}},
			{$limit: 12}
		]);

		const hours = await ControllerHours.aggregate([
			{
				$project: {
					length: {
						$subtract: ['$timeEnd', '$timeStart']
					},
					month: {
						$month: "$timeStart"
					},
					year: {
						$year: "$timeStart"
					}
				}
			},
			{
				$group: {
					_id: {
						month: "$month",
						year: "$year"
					},
					total: {$sum: '$length'},
					month: { $first: "$month" },
					year: { $first: "$year" },
				}
			},
			{$sort: {year: -1, month: -1}},
			{$limit: 12}
		]);

		for(const item of feedback) {
			item.month = months[item.month]
		}
		for(const item of hours) {
			item.month = months[item.month]
			item.total = Math.round(item.total/1000)
		}

		const homeCount = await User.countDocuments({member: true, vis: false});
		const visitorCount = await User.countDocuments({member: true, vis: true});
		const ratingCounts = await User.aggregate([
			{$match: {member: true}},
			{$group: {_id: "$rating", count: {$sum: 1}}},
			{$sort: {_id: -1}}
		])

		for(const item of ratingCounts) {
			item.rating = ratings[item._id];
		}

		res.stdRes.data.totalTime = Math.round(totalTime[0].total/1000);
		res.stdRes.data.totalSessions = Math.round(sessionCount[0].total);
		res.stdRes.data.feedback = feedback.reverse();
		res.stdRes.data.hours = hours.reverse();
		res.stdRes.data.counts = {
			home: homeCount,
			vis: visitorCount,
			byRating: ratingCounts.reverse()
		}
	}
	catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
})

router.get('/ins', getUser, auth(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']), async (req, res) => {
	try {
		let lastTraining = await TrainingSession.aggregate([
			{$group: {
					_id: "$studentCid",
					studentCid: {$first: "$studentCid"},
					lastSession: {$last: "$endTime"},
					milestoneCode: {$first: "$milestoneCode"}
				}},
			{$sort: {lastSession: 1}}
		]);

		let lastRequest = await TrainingRequest.aggregate([
			{$group: {
					_id: "$studentCid",
					studentCid: {$first: "$studentCid"},
					lastRequest: {$last: "$endTime"},
					milestoneCode: {$first: "$milestoneCode"}
				}},
			{$sort: {lastSession: 1}}
		]);

		await TrainingSession.populate(lastTraining, {path: 'student'})
		await TrainingSession.populate(lastTraining, {path: 'milestone'})
		await TrainingRequest.populate(lastRequest, {path: 'milestone'})
		const allHomeControllers = await User.find({member:true, rating: {$lt: 12}}).select('-email -idsToken -discordInfo');
        const allCids = allHomeControllers.map(c => c.cid);
		lastTraining = lastTraining.filter(train => (train.student?.rating < 12 && train.student?.member && !train.student?.vis));
		const cidsWithTraining = lastTraining.map(train => train.studentCid);
		const cidsWithoutTraining = allCids.filter(cid => !cidsWithTraining.includes(cid))

		const controllersWithoutTraining = allHomeControllers.filter((c) => cidsWithoutTraining.includes(c.cid)).filter(c => !c.certCodes.includes('zau'));
		lastRequest = lastRequest.reduce((acc, cur) => {
			acc[cur.studentCid] = cur
			return acc;
		}, {})

		res.stdRes.data = {
			lastTraining,
			lastRequest,
			controllersWithoutTraining
		}
	}
	catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
})

// Helper function to calculate the start and end of a quarter given a year and quarter number
function getQuarterStartEnd(quarter, year) {
  const startOfQuarter = L.utc(year).startOf('year').plus({ months: (quarter - 1) * 3 }); // First day of the quarter
  const endOfQuarter = startOfQuarter.plus({ months: 3 }).minus({ days: 1 }).endOf('day'); // Last day of the quarter
  return { startOfQuarter, endOfQuarter };
}

function getHighestCertification(userCerts, certHierarchy) {
  return userCerts
    .filter(cert => certHierarchy.includes(cert.code))
    .sort((a, b) => certHierarchy.indexOf(a.code) - certHierarchy.indexOf(b.code))[0]; // First highest cert based on hierarchy
}

function isExempt(user, startOfQuarter) {
  // Exempt if the user joined during the quarter
  if (new Date(user.joinDate) >= startOfQuarter) {
    return true;
  }

  // Exempt if the user was promoted from OBS to S1 by gaining `gnd` certification during the quarter
  const promotedToS1 = user.certifications.some(cert => cert.code === 'gnd' && new Date(cert.gainedDate) >= startOfQuarter);
  if (promotedToS1) {
    return true;
  }

  // Not exempt otherwise
  return false;
}

function isValidAtcPosition(atcPosition) {
  // Exception for ORD_I_GND
  if (atcPosition === 'ORD_I_GND') {
    return true;
  }

  // Regex to match positions with I, or S in the middle, e.g., MDW_I_TWR, ZAU_M_CTR
  const invalidMiddlePosition = /_(I|S)_/;

  // Return false if it matches invalid positions
  if (invalidMiddlePosition.test(atcPosition)) {
    return false;
  }

  // Accept all other positions
  return true;
}

async function getTotalActivityTime(cid, startOfQuarter, endOfQuarter) {
  // Query the ControllerHours collection for total activity time within the quarter
  const result = await ControllerHours.aggregate([
    {
      $match: {
        cid: cid, // Filter by controller ID
        timeStart: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() } // Filter by time range
      }
    },
    {
      $group: {
        _id: "$cid", // Group by controller ID
        totalTime: { $sum: { $subtract: ["$timeEnd", "$timeStart"] } } // Calculate total time by subtracting start from end
      }
    }
  ]);

  // Return total time in seconds (default to 0 if no result)
  return result.length > 0 ? Math.round(result[0].totalTime / 1000) : 0;
}

async function getCertActivityTime(cid, certCode, startOfQuarter, endOfQuarter) {
  // Create a mapping of ATC positions to certs (already defined earlier in the app)
  const atcPositionToCertMap = {
    'MDW_TWR': 'mdwtwr',
    'MDW_GND': 'mdwgnd',
    'ORD_TWR': 'ordtwr',
    'ORD_GND': 'ordgnd',
    'ORD_APP': 'ordapp',
    'ZAU_CTR': 'zau'
    // Add more mappings as needed
  };

  // Find ATC positions corresponding to the given certCode
  const matchingPositions = Object.keys(atcPositionToCertMap).filter(pos => atcPositionToCertMap[pos] === certCode);

  if (matchingPositions.length === 0) {
    return 0; // No matching positions for the certification
  }

  // Query the ControllerHours collection for activity time on the specific cert within the quarter
  const result = await ControllerHours.aggregate([
    {
      $match: {
        cid: cid,
        atcPosition: { $in: matchingPositions }, // Only match positions related to the cert
        timeStart: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() } // Filter by time range
      }
    },
    {
      $group: {
        _id: "$cid",
        totalTime: { $sum: { $subtract: ["$timeEnd", "$timeStart"] } } // Calculate total time
      }
    }
  ]);

  // Return total cert-specific time in seconds (default to 0 if no result)
  return result.length > 0 ? Math.round(result[0].totalTime / 1000) : 0;
}

function getHighestCertification(userCerts, certHierarchy) {
  // Filter user certifications that are part of the certHierarchy
  const matchingCerts = userCerts.filter(cert => certHierarchy.includes(cert.code));

  // Sort the certifications by the order in certHierarchy and return the highest (first)
  return matchingCerts.sort((a, b) => certHierarchy.indexOf(a.code) - certHierarchy.indexOf(b.code))[0];
}

router.get('/activity', getUser, auth(['atm', 'datm', 'ta', 'wm']), async (req, res) => {
  try {
    const quarter = parseInt(req.query.quarter, 10) || Math.floor((L.utc().month - 1) / 3) + 1;
    const year = parseInt(req.query.year, 10) || L.utc().year;
    const { startOfQuarter, endOfQuarter } = getQuarterStartEnd(quarter, year);

    const T1Certs = ['ordgnd', 'ordtwr', 'ordapp', 'zau'];
    const T2Certs = ['mdwgnd', 'mdwtwr', 'zaut2'];

    // Step 1: Fetch users and their certifications in one call (initial bulk fetch)
    const users = await User.find({ member: true })
      .select('fname lname cid rating oi vis createdAt roleCodes certCodes joinDate certificationDate')
      .populate('certifications')
      .populate({
        path: 'absence',
        match: { expirationDate: { $gte: new Date() }, deleted: false },
        select: '-reason'
      })
      .lean({ virtuals: true });

    const userData = {};
    const usersNeedingCertCheck = []; // Keep track of users who need cert checks

    for (let user of users) {
      let tooLow = false;

      // Exemption Check (Step 1)
      if (isExempt(user, startOfQuarter)) {
        tooLow = false;
        userData[user.cid] = { ...user, tooLow };
        continue; // Skip further checks if exempt
      }

      // Step 2: Check for 3-Hour Requirement
      const totalTime = await getTotalActivityTime(user.cid, startOfQuarter, endOfQuarter); // Function to get total time
      if (user.rating > 1 && totalTime < 3600 * 3) {
        tooLow = true;
      }

      // Step 3: Check for T1/T2 certifications and add to list for further checking
      const highestT1 = getHighestCertification(user.certifications, T1Certs);
      const highestT2 = getHighestCertification(user.certifications, T2Certs);

      if (highestT1 || highestT2) {
        usersNeedingCertCheck.push({ user, highestT1, highestT2 });
      }

      userData[user.cid] = { ...user, totalTime, tooLow };
    }

    // Step 4: For users needing T1/T2 checks, fetch their specific activity times
    for (let { user, highestT1, highestT2 } of usersNeedingCertCheck) {
      let tooLow = userData[user.cid].tooLow;

      if (highestT1) {
        const certTimeT1 = await getCertActivityTime(user.cid, highestT1.code, startOfQuarter, endOfQuarter); // Fetch cert-specific activity
        if (certTimeT1 < 3600) {
          tooLow = true;
        }
      }

      if (highestT2) {
        const certTimeT2 = await getCertActivityTime(user.cid, highestT2.code, startOfQuarter, endOfQuarter); // Fetch cert-specific activity
        if (certTimeT2 < 3600) {
          tooLow = true;
        }
      }

      userData[user.cid].tooLow = tooLow; // Update the user data
    }

    res.stdRes.data = Object.values(userData);
  } catch (e) {
    res.stdRes.ret_det = e;
  }

  return res.json(res.stdRes);
});

router.get('/activity', getUser, auth(['atm', 'datm', 'ta', 'wm']), async (req, res) => {
  try {
    // Get the quarter and year from query parameters or default to the current quarter and year
    const quarter = parseInt(req.query.quarter, 10) || Math.floor((L.utc().month - 1) / 3) + 1;
    const year = parseInt(req.query.year, 10) || L.utc().year;

    // Calculate the start and end of the quarter
    const { startOfQuarter, endOfQuarter } = getQuarterStartEnd(quarter, year);

    // Define T1 and T2 cert hierarchies
    const T1Certs = ['ordgnd', 'ordtwr', 'ordapp', 'zau'];
    const T2Certs = ['mdwgnd', 'mdwtwr', 'zaut2'];

    // Fetch users and calculate their activity within the quarter
    const users = await User.find({ member: true })
      .select('fname lname cid rating oi vis createdAt roleCodes certCodes joinDate certificationDate')
      .populate('certifications')
      .populate({ path: 'absence', match: { expirationDate: { $gte: new Date() }, deleted: false }, select: '-reason' })
      .lean({ virtuals: true });

    const activityReduced = {};
    const trainingReduced = {};
    const trainingSession = {};

    // Aggregate controller hours for the entire quarter
    (await ControllerHours.aggregate([
      { $match: { timeStart: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() } } },
      {
        $project: {
          length: { $subtract: ['$timeEnd', '$timeStart'] },
          cid: 1
        }
      },
      {
        $group: {
          _id: "$cid",
          total: { $sum: "$length" }
        }
      }
    ])).forEach(i => activityReduced[i._id] = i.total);

    // Aggregate training requests for the entire quarter
    (await TrainingRequest.aggregate([
      { $match: { timeStart: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() } } },
      {
        $group: {
          _id: "$studentCid",
          total: { $sum: 1 }
        }
      }
    ])).forEach(i => trainingReduced[i._id] = i.total);

    // Aggregate training sessions for the entire quarter
    (await TrainingSession.aggregate([
      { $match: { timeStart: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() } } },
      {
        $group: {
          _id: "$studentCid",
          total: { $sum: 1 }
        }
      }
    ])).forEach(i => trainingSession[i._id] = i.total);

    const userData = {};
    for (let user of users) {
      let fiftyTime = await req.app.redis.get(`FIFTY:${user.cid}`);
      if (!fiftyTime) {
        fiftyTime = await getFiftyData(user.cid);
        req.app.redis.set(`FIFTY:${user.cid}`, fiftyTime);
        req.app.redis.expire(`FIFTY:${user.cid}`, 86400);
      }

      const totalTime = Math.round(activityReduced[user.cid] / 1000) || 0;
      const totalRequests = trainingReduced[user.cid] || 0;
      const totalSessions = trainingSession[user.cid] || 0;

      let tooLow = false; // Initialize tooLow to false, will change if they fail to meet requirements.

      // Check if the user is exempt from activity requirements (joining mid-quarter, promoted OBS to S1, etc.)
      if (isExempt(user, startOfQuarter)) {
        tooLow = false; // They are exempt, set tooLow to false.
        userData[user.cid] = { ...user, tooLow };
        continue; // Skip further checks if exempt.
      }

      // Function to check if the certification was gained in the quarter
      const gainedCertInQuarter = (cert) =>
        cert && cert.gainedDate && new Date(cert.gainedDate) >= startOfQuarter && new Date(cert.gainedDate) <= endOfQuarter;

      // --- Apply Core 3-Hour Requirement ---
      if (user.rating > 1) { // Not OBS
        if (totalTime < 3600 * 3) {
          tooLow = true; // If less than 3 hours, set tooLow to true.
        }
      }

      // --- Apply T1 Certification Logic (for users with T1 certs before the quarter) ---
      const highestT1 = getHighestCertification(user.certifications, T1Certs);

      if (highestT1 && !gainedCertInQuarter(highestT1)) { // User had the cert before the quarter
        const certTime = activityReduced[user.cid] && activityReduced[user.cid][highestT1.code] || 0;
        if (certTime < 3600) {
          tooLow = true; // If less than 1 hour on highest T1 cert, set tooLow to true.
        }
      }

      // --- Apply T2 Certification Logic (for users with T2 certs before the quarter) ---
      const highestT2 = getHighestCertification(user.certifications, T2Certs);

      if (highestT2 && !gainedCertInQuarter(highestT2)) { // User had the cert before the quarter
        const certTimeT2 = activityReduced[user.cid] && activityReduced[user.cid][highestT2.code] || 0;
        if (certTimeT2 < 3600) {
          tooLow = true; // If less than 1 hour on highest T2 cert, set tooLow to true.
        }
      }

      // Final user data entry after applying the 3-hour and T1/T2 logic
      userData[user.cid] = {
        ...user,
        totalTime,
        totalRequests,
        totalSessions,
        fiftyTime: Math.round(fiftyTime),
        tooLow,  // Set to true if they fail to meet any requirement
        protected: user.isStaff || [1202744].includes(user.cid) || user.absence.some(a => !a.deleted && new Date(a.expirationDate) > new Date() && a.controller === user.cid),
      };
    }

    res.stdRes.data = Object.values(userData);
  } catch (e) {
    res.stdRes.ret_det = e;
  }

  return res.json(res.stdRes);
});

router.post('/fifty/:cid', microAuth, async (req, res) => {
	try {
		const { redis } = req.app;
		const { cid } = req.params;
		const fiftyData = await getFiftyData(cid);
		redis.set(`FIFTY:${cid}`, fiftyData)
		redis.expire(`FIFTY:${cid}`, 86400)
	}
	catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
})

const getFiftyData = async cid => {
	const today = L.utc();
	const chkDate = today.minus({days: 60});

	const {data: fiftyData} = await axios.get(`https://api.vatsim.net/api/ratings/${1202744}/atcsessions/?start=${chkDate.toISODate()}&group_by_callsign`);

	let total = 0;

	for(const session of fiftyData.results) {
		const callsignParts = session.callsign.split('_');

		if(!zab.atcPos.includes(callsignParts[0])) {
			total += session.total_minutes_on_callsign;
		}
	}

	return total;
}

export default router;