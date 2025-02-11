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

const testUserCID = 10000002;

function getHighestCertificationBeforeQuarter(certificationDates, certHierarchy, startOfQuarter, userCid) {
  if (userCid === testUserCID) {
    console.log(`Getting highest certification before ${startOfQuarter} for test user ${userCid}`);
    console.log(`Cert hierarchy: ${JSON.stringify(certHierarchy)}`);
    console.log(`User certification dates:`, certificationDates);
  }

  const validCerts = certificationDates.filter(cert => {
    const isValid = certHierarchy.includes(cert.code) && new Date(cert.gainedDate) < startOfQuarter;

    if (userCid === testUserCID) {
      console.log(
        `Checking cert: ${JSON.stringify(cert)} | Valid: ${isValid} | In hierarchy: ${certHierarchy.includes(cert.code)}`
      );
    }

    return isValid;
  });

  if (userCid === testUserCID) console.log(`Valid certifications before the quarter:`, validCerts);

  const sortedCerts = validCerts.sort((a, b) => {
    const hierarchyComparison = certHierarchy.indexOf(a.code) - certHierarchy.indexOf(b.code);
    if (hierarchyComparison !== 0) {
      if (userCid === testUserCID) console.log(`Sorting by hierarchy: ${a.code} vs ${b.code} => ${hierarchyComparison}`);
      return hierarchyComparison;
    }

    const dateComparison = new Date(b.gainedDate) - new Date(a.gainedDate);
    if (userCid === testUserCID) console.log(`Sorting by date: ${a.gainedDate} vs ${b.gainedDate} => ${dateComparison}`);
    return dateComparison;
  });

  const highestCert = sortedCerts[0] || null;
  if (userCid === testUserCID) console.log(`Test user ${userCid} highest certification: ${JSON.stringify(highestCert)}`);

  return highestCert;
}

function isExempt(user, startOfQuarter) {
  if (user.cid === testUserCID) {
    console.log(`Checking exemption for test user ${user.cid}`);
    console.log(`User joinDate: ${user.createdAt}, Start of Quarter: ${startOfQuarter}`);
  }

  if (new Date(user.createdAt) >= startOfQuarter) {
    if (user.cid === testUserCID) console.log(`Test user ${user.cid} is exempt: joined during the quarter.`);
    return true;
  }

  if (user.certificationDate && Array.isArray(user.certificationDate)) {
    if (user.cid === testUserCID) console.log(`CertificationDates for test user ${user.cid}:`, user.certificationDate);

    const promotedToS1 = user.certificationDate.some(cert => {
      const gainedDate = cert.gainedDate ? new Date(cert.gainedDate) : null;
      
      if (user.cid === testUserCID) console.log(`Cert code: ${cert.code}, Gained Date: ${gainedDate}`);
      
      return cert.code === 'gnd' && gainedDate && gainedDate >= startOfQuarter;
    });

    if (promotedToS1) {
      if (user.cid === testUserCID) console.log(`Test user ${user.cid} is exempt: promoted from OBS to S1 during the quarter.`);
      return true;
    }
  } else {
    if (user.cid === testUserCID) console.log(`Test user ${user.cid} has no valid certificationDate array.`);
  }

  if (user.cid === testUserCID) console.log(`Test user ${user.cid} is not exempt.`);
  return false;
}

function isValidATCPosition(position) {
  if (!position) return false;

  // Convert to uppercase to match database format
  position = position.toUpperCase();

  // Special case: Allow "ORD_I_GND"
  if (position === 'ORD_I_GND' || 'ORD_S_TWR') return true;

  // Split by `_` to check the middle section
  const parts = position.split('_');

  // If it has 3 parts (e.g., MDW_I_GND), check the middle part
  if (parts.length === 3) {
    const middlePart = parts[1]; // The section between underscores
    if (middlePart.includes('I') || middlePart.includes('S')) {
      //console.log(`❌ Rejecting position: ${position} (Invalid middle section: ${middlePart})`);
      return false;
    }
  }

  return true; // Accept all other positions
}

// Normalize positions to lowercase before mapping
function getMatchingPositions(basePosition) {
  return Object.keys(atcPositionToCertMap)
    .filter(position => position.toLowerCase() === basePosition.toLowerCase()) // Case-insensitive match
    .map(position => position.toUpperCase()); // Convert back to uppercase for consistency
}

// Helper function: Fetch activity data for users and their corresponding ATC positions
async function fetchCertificationActivityTime(cid, validPositions, startOfQuarter, endOfQuarter) {

  const testUserCID = 10000002;

  if (!cid || validPositions.length === 0) {
    if (cid === testUserCID) console.log(`No valid positions found for test user ${cid}, returning 0s`);
    return 0;
  }

  // Normalize positions and filter out invalid ones
  validPositions = validPositions
    .map(pos => pos.toUpperCase()) // Convert to uppercase for consistency
    .filter(pos => isValidATCPosition(pos)); // Apply filtering rules

  if (validPositions.length === 0) {
    if (cid === testUserCID) console.log(`❌ No valid positions remaining for test user ${cid}, returning 0s`);
    return 0;
  }

  if (cid === testUserCID) console.log(`Fetching cert-specific activity time for test user ${cid} on positions:`, validPositions);

  const certActivity = await ControllerHours.aggregate([
    {
      $match: {
        cid: cid,
        position: { $in: validPositions }, // Only count activity on valid certification-mapped positions
        timeStart: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() },
      },
    },
    {
      $group: {
        _id: "$cid",
        certTime: { $sum: { $divide: [{ $subtract: ["$timeEnd", "$timeStart"] }, 1000] } },
      },
    },
  ]);

  const certTime = certActivity.length > 0 ? certActivity[0].certTime : 0;
  if (cid === testUserCID) console.log(`Test user ${cid} certification-specific activity time: ${certTime}s`);
  return certTime;
}

// Main activity API endpoint
router.get('/activity', getUser, auth(['atm', 'datm', 'ta', 'wm']), async (req, res) => {
  try {
    //console.log('Start processing /activity endpoint');
    const testUserCID = 10000002; // 🔹 Replace with the specific user's CID

    // SECTION: Get Quarter & Year
    const quarter = parseInt(req.query.quarter, 10) || Math.floor((L.utc().month - 1) / 3) + 1;
    const year = parseInt(req.query.year, 10) || L.utc().year;
    const { startOfQuarter, endOfQuarter } = getQuarterStartEnd(quarter, year);
    //console.log(`Quarter: ${quarter}, Year: ${year}, Start: ${startOfQuarter}, End: ${endOfQuarter}`);

    // SECTION: Define Constants (Including Position-to-Cert Mapping)
    const T1Certs = ['zau', 'ordapp', 'ordtwr', 'ordgnd'];
    const T2Certs = ['zaut2', 'mdwtwr', 'mdwgnd'];

    const atcPositionToCertMap = {
      'mdw_twr': 'mdwtwr', 'mdw_gnd': 'mdwgnd',
      'ord_twr': 'ordtwr', 'ord_gnd': 'ordgnd',
      'ord_app': 'ordapp', 'zau_ctr': 'zau'
    };

    // SECTION: Fetch Users Data
    //console.log('Fetching users...');
    const users = await User.find({ member: true })
      .select('fname lname cid oi rating isStaff certCodes createdAt roleCodes certCodes certificationDate absence')
      .populate('certifications')
      .populate({ path: 'certificationDate', select: 'code gainedDate' })
      .populate({ path: 'absence', match: { expirationDate: { $gte: new Date() }, deleted: false }, select: 'expirationDate' })
      .lean({ virtuals: true });

    //console.log(`Fetched ${users.length} users`);

    // SECTION: Fetch & Process Activity and Training Data
    //console.log('Fetching activity and training data...');
    const [activityReduced, trainingRequests, trainingSessions] = await Promise.all([
      ControllerHours.aggregate([
        { $match: { timeStart: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() } } },
        { $project: { cid: 1, position: { $toUpper: "$position" }, totalTime: { $divide: [{ $subtract: ['$timeEnd', '$timeStart'] }, 1000] } } },
        { $match: { position: { $exists: true } } },
        { $match: { $expr: { $or: [ { $eq: ["$position", ["ORD_I_GND", "ORD_S_TWR"]] }, { $not: { $regexMatch: { input: "$position", regex: "_.?[IS]_.?" } } } ] } } },
        { $group: { _id: "$cid", totalTime: { $sum: "$totalTime" } } }
      ]),
      TrainingRequest.aggregate([
        { $match: { startTime: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() } } },
        { $group: { _id: "$studentCid", totalRequests: { $sum: 1 } } },
      ]),
      TrainingSession.aggregate([
        { $match: { startTime: { $gte: startOfQuarter.toJSDate(), $lte: endOfQuarter.toJSDate() } } },
        { $group: { _id: "$studentCid", totalSessions: { $sum: 1 } } },
      ]),
    ]);
  
    // Convert activity data into lookup objects for quick access
    const activityMap = Object.fromEntries(activityReduced.map(({ _id, totalTime }) => [_id, totalTime]));
    const trainingRequestsMap = Object.fromEntries(trainingRequests.map(({ _id, totalRequests }) => [_id, totalRequests]));
    const trainingSessionsMap = Object.fromEntries(trainingSessions.map(({ _id, totalSessions }) => [_id, totalSessions]));
  
    //console.log('Activity and training data mapped');
  
    // SECTION: Classify Users
    //console.log('Classifying users...');
    const userData = {};
    
    for (const user of users) {
      if (user.cid === testUserCID) console.log(`Processing test user: ${user.cid}`);
      const totalTime = activityMap[user.cid] || 0;
      const totalRequests = trainingRequestsMap[user.cid] || 0;
      const totalSessions = trainingSessionsMap[user.cid] || 0;
    
      const exempt = isExempt(user, startOfQuarter);
      const protectedStatus = user.isStaff || [1202744].includes(user.cid) || user.absence.some(a => new Date(a.expirationDate) > new Date());
    
      // Get highest T1/T2 certification before the quarter
      const highestCert = getHighestCertificationBeforeQuarter(
        user.certificationDate || [],
        [...T1Certs, ...T2Certs],
        startOfQuarter
      );
    
      // Determine valid ATC positions based on highest certification
      let validPositions = [];
      if (highestCert) {
        validPositions = Object.keys(atcPositionToCertMap).filter(
          position => atcPositionToCertMap[position] === highestCert.code
        );
      }
    
      // Fetch certification-specific activity time
      let certSpecificTime = 0;
      if (validPositions.length > 0) {
        certSpecificTime = await fetchCertificationActivityTime(user.cid, validPositions, startOfQuarter, endOfQuarter);
      }
    
      userData[user.cid] = {
        ...user,
        totalTime,
        totalRequests,
        totalSessions,
        highestCert,
        certSpecificTime,
        exempt,
        protected: protectedStatus,
      };

      if (user.cid === testUserCID) {
        console.log(`Test User ${user.cid} - Total Time: ${totalTime}s, Cert Time: ${certSpecificTime}s`);
      }
    }
    
    //console.log('Users classified with activity and certification data');
    
  
    // SECTION: Apply "Too Low" Checks (Now That All Data is Gathered)
    Object.keys(userData).forEach(cid => {
    const user = userData[cid];

    let tooLow = false; // Default: user has enough activity

    if (user.cid === testUserCID) {
      console.log(`\n🔍 Checking "tooLow" for Test User ${cid}`);
      console.log(`Total Time: ${user.totalTime}s`);
      console.log(`Total Sessions: ${user.totalSessions}`);
      console.log(`Certification-Specific Time: ${user.certSpecificTime}s`);
      console.log(`Highest Certification: ${JSON.stringify(user.highestCert)}`);
      console.log(`Rating: ${user.rating}`);
      console.log(`Exempt: ${user.exempt}`);
    }

    // Apply tooLow checks
    if (!user.exempt) {
      if (user.totalTime < 3600 * 3) {
        if (user.cid === testUserCID) console.log(`❌ Test User ${cid} flagged tooLow: totalTime (${user.totalTime}s) is less than 3 hours`);
        tooLow = true;
      }
      
      // This has to deal with training and will need to be reworked once training system is done.
      /*if (user.rating > 1 && user.totalSessions < 1) { 
        if (user.cid === testUserCID) console.log(`❌ Test User ${cid} flagged tooLow: rating (${user.rating}) > 1 and totalSessions (${user.totalSessions}) < 1`);
        tooLow = true; // Changed from totalRequests to totalSessions for accuracy
      }*/

      if (user.highestCert && user.certSpecificTime < 3600) {
        if (user.cid === testUserCID) console.log(`❌ Test User ${cid} flagged tooLow: has cert (${user.highestCert.code}) but certSpecificTime (${user.certSpecificTime}s) < 1 hour`);
        tooLow = true;
      }
    } else {
      if (user.cid === testUserCID) console.log(`✅ Test User ${cid} is exempt, skipping tooLow checks.`);
    }

    userData[cid].tooLow = tooLow;

    if (user.cid === testUserCID) console.log(`✅ Final "tooLow" status for Test User ${cid}: ${tooLow}`);
    });
  
    //console.log('Final checks applied, returning data');
  
    // SECTION: Return Final Data
    res.stdRes.data = Object.values(userData);
  } catch (e) {
    console.error('Error encountered:', e);
    res.stdRes.ret_det = e;
  }
  
  return res.json(res.stdRes);
});

router.get('/activity1', getUser, auth(['atm', 'datm', 'ta', 'wm']), async (req, res) => {
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

// Main activity API endpoint
router.get('/activity2', getUser, auth(['atm', 'datm', 'ta', 'wm']), async (req, res) => {
  try {
    console.log('Start processing /activity endpoint');

    // Parse query parameters
    const quarter = parseInt(req.query.quarter, 10) || Math.floor((L.utc().month - 1) / 3) + 1;
    const year = parseInt(req.query.year, 10) || L.utc().year;

    // Get the start and end of the quarter
    const { startOfQuarter, endOfQuarter } = getQuarterStartEnd(quarter, year);

    // Certification and position mappings
    const T1Certs = ['zau', 'ordapp', 'ordtwr', 'ordgnd'];
    const T2Certs = ['zaut2', 'mdwtwr', 'mdwgnd'];
    const atcPositionToCertMap = {
      'MDW_TWR': 'mdwtwr',
      'MDW_GND': 'mdwgnd',
      'ORD_TWR': 'ordtwr',
      'ORD_GND': 'ordgnd',
      'ORD_APP': 'ordapp',
      'ZAU_CTR': 'zau',
    };

    // Fetch all users with relevant data
    const users = await User.find({ member: true })
      .select('fname lname cid rating joinDate certificationDate isStaff absence')
      .populate('certifications')
      .populate({
        path: 'certificationDate',
        select: 'code gainedDate',
      })
      .populate({
        path: 'absence',
        match: { expirationDate: { $gte: new Date() }, deleted: false },
        select: '-reason',
      })
      .lean();

    console.log('Users fetched:', users.length);

    // Prepare user data
    const userData = {};

    // Step 1: Process users
    for (const user of users) {
      console.log(`Processing user CID: ${user.cid}`);

      // Step 1.1: Check exemption status
      const exempt = isExempt(user, startOfQuarter);
      console.log(`User ${user.cid} exempt status: ${exempt}`);

      // Step 1.2: Find highest T1/T2 certification
      const highestT1Cert = getHighestCertificationBeforeQuarter(user.certifications, T1Certs, startOfQuarter);
      const highestT2Cert = getHighestCertificationBeforeQuarter(user.certifications, T2Certs, startOfQuarter);
      const highestCert = highestT1Cert || highestT2Cert;

      if (!highestCert) {
        console.log(`User ${user.cid} has no T1/T2 certifications before the quarter.`);
        continue;
      }

      // Step 1.3: Get valid ATC positions for the certification using regex and validation
      const matchingPositions = Object.keys(atcPositionToCertMap)
        .filter(position => atcPositionToCertMap[position] === highestCert.code) // Base positions for cert
        .flatMap(basePosition => getMatchingPositions(basePosition)); // Get all valid variations

      console.log(`User ${user.cid} valid positions:`, matchingPositions);

      // Step 1.4: Fetch activity data
      const totalTime = await fetchTotalActivityTime(user.cid, startOfQuarter, endOfQuarter);
      const certTime = await fetchCertificationActivityTime(user.cid, matchingPositions, startOfQuarter, endOfQuarter);

      console.log(`User ${user.cid} total time: ${totalTime}, cert time: ${certTime}`);

      // Step 1.5: Check activity requirements
      let tooLow = false;
      if (!exempt) {
        if (certTime < 3600) tooLow = true; // Less than 1 hour on certification-specific positions
        if (totalTime < 3600 * 3) tooLow = true; // Less than 3 hours total
      }

      // Step 1.6: Check protection status
      const protectedStatus = user.isStaff || user.absence.some(abs => new Date(abs.expirationDate) > new Date());

      // Step 1.7: Add user data to response
      userData[user.cid] = {
        ...user,
        highestCert,
        totalTime,
        certTime,
        tooLow,
        exempt,
        protected: protectedStatus,
      };

      console.log(`User ${user.cid} final data:`, userData[user.cid]);
    }

    console.log('Returning final user data');
    res.stdRes.data = Object.values(userData);
  } catch (e) {
    console.error('Error encountered:', e);
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