import express from 'express';
const router = express.Router();
import transporter from '../config/mailer.js';
import TrainingSession from '../models/TrainingSession.js';
import TrainingRequest from '../models/TrainingRequest.js';
import TrainingMilestone from '../models/TrainingMilestone.js';
import TrainingModule from '../models/TrainingModule.js';
import TrainingProgress from '../models/TrainingProgress.js';
import TrainerProfile from '../models/TrainerProfile.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import getUser from '../middleware/getUser.js';
import auth from '../middleware/auth.js';
import axios from 'axios';
import dayjs from 'dayjs';


router.get('/request/upcoming', getUser, async (req, res) => {
	try {
		const upcoming = await TrainingRequest.find({
			studentCid: res.user.cid, 
			deleted: false,
			startTime: {
				$gt: new Date(new Date().toUTCString()) // request is in the future
			},
		}).populate('instructor', 'fname lname cid').populate('milestone', 'code name').sort({startTime: "asc"}).lean();

		res.stdRes.data = upcoming;
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.post('/request/new', getUser, async (req, res) => {
	try {
		if(!req.body.submitter || !req.body.startTime || !req.body.endTime || !req.body.milestone || req.body.remarks.length > 500) {
			throw {
				code: 400,
				message: "You must fill out all required forms"
			};
		}

		if((new Date(req.body.startTime) < new Date()) || (new Date(req.body.endTime) < new Date())) {
			throw {
				code: 400,
				message: "Dates must be in the future"
			}
		}

		if(new Date(req.body.startTime) > new Date(req.body.endTime)) {
			throw {
				code: 400,
				message: "End time must be greater than start time"
			}
		}

		if((new Date(req.body.endTime).getTime() - new Date(req.body.startTime).getTime()) / 60000 < 60) {
			throw {
				code: 400,
				message: "Requests must be longer than 60 minutes"
			}
		}

		if((new Date(req.body.endTime).getTime() - new Date(req.body.startTime).getTime()) / 60000 > 960) {
			throw {
				code: 400,
				message: "Requests must be shorter than 16 hours"
			}
		}

		const totalRequests = await req.app.redis.get(`TRAININGREQ:${res.user.cid}`);
		
		if(totalRequests > 5) {
			throw {
				code: 429,
				message: `You have requested too many sessions in the last 4 hours.`
			}
		}

		req.app.redis.set(`TRAININGREQ:${res.user.cid}`, (+totalRequests || 0 ) + 1);
		req.app.redis.expire(`TRAININGREQ:${res.user.cid}`, 14400)

		await TrainingRequest.create({
			studentCid: res.user.cid,
			startTime: req.body.startTime,
			endTime: req.body.endTime,
			milestoneCode: req.body.milestone,
			remarks: req.body.remarks,
		});

		const student = await User.findOne({cid: res.user.cid}).select('fname lname').lean();
		const milestone = await TrainingMilestone.findOne({code: req.body.milestone}).lean();

		transporter.sendMail({
			to: 'training@zauartcc.org',
			from: {
				name: "Chicago ARTCC",
				address: 'no-reply@zauartcc.org'
			},
			subject: `New Training Request: ${student.fname} ${student.lname} | Chicago ARTCC`,
			template: 'newRequest',
			context: {
				student: student.fname + ' ' + student.lname,
				startTime: new Date(req.body.startTime).toLocaleString('en-US', {month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}),
				endTime: new Date(req.body.endTime).toLocaleString('en-US', {month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}),
				milestone: milestone.code.toUpperCase() + ' - ' + milestone.name
			}
		});
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/milestones', getUser, async (req, res) => {
	try {
		const user = await User.findOne({cid: res.user.cid}).select('trainingMilestones rating').populate('trainingMilestones', 'code name rating').lean();
		const milestones = await TrainingMilestone.find().sort({rating: "asc", code: "asc"}).lean();

		res.stdRes.data = {
			user,
			milestones
		};
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/request/open', getUser, auth(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']), async (req, res) => {
	try {
		const days = +req.query.period || 21; // days from start of CURRENT week
		const d = new Date(Date.now()),
			currentDay = d.getDay(),
			diff = d.getDate() - currentDay,
			startOfWeek = d.setDate(diff);

		const requests = await TrainingRequest.find({
			startTime: {
				$gte: ((new Date(startOfWeek)).toDateString()),
				$lte: ((new Date(startOfWeek + (days * 1000 * 60 * 60 * 24))).toDateString())
			},
			instructorCid: null,
			deleted: false
		}).select('startTime').lean();

		res.stdRes.data = requests;
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.post('/request/take/:id', getUser, auth(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']), async (req, res) => {
	try {
		if(new Date(req.body.startTime) >= new Date(req.body.endTime)) {
			throw {
				code: 400,
				message: "End time must be greater than start time"
			}
		}

		const request = await TrainingRequest.findByIdAndUpdate(req.params.id, {
			instructorCid: res.user.cid,
			startTime: req.body.startTime,
			endTime: req.body.endTime
		}).lean();

		const session = await TrainingSession.create({
			studentCid: request.studentCid,
			instructorCid: res.user.cid,
			startTime: req.body.startTime,
			endTime: req.body.endTime,
			milestoneCode: request.milestoneCode,
			submitted: false
		});

		const student = await User.findOne({cid: request.studentCid}).select('fname lname email').lean();
		const instructor = await User.findOne({cid: res.user.cid}).select('fname lname email').lean();

		transporter.sendMail({
			to: `${student.email}, ${instructor.email}`,
			from: {
				name: "Chicago ARTCC",
				address: 'no-reply@zauartcc.org'
			},
			subject: 'Training Request Taken | Chicago ARTCC',
			template: 'requestTaken',
			context: {
				student: student.fname + ' ' + student.lname,
				instructor: instructor.fname + ' ' + instructor.lname,
				startTime: new Date(session.startTime).toLocaleString('en-US', {month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}),
				endTime: new Date(session.endTime).toLocaleString('en-US', {month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
			}
		});
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});
router.delete('/request/:id', getUser, async (req, res) => {
	try {
	  const request = await TrainingRequest.findById(req.params.id);
	  
	  if (!request) {
		return res.status(404).json({ error: 'Training request not found' });
	  }
  
	  const isSelf = res.user.cid === request.studentCid;
  
	  if (!isSelf) {
		auth(['atm', 'datm', 'ta'])(req, res, () => {}); // Call the auth middleware
	  }
  
	  request.deleted = true;
	  await request.save();
  
	  if (isSelf) {
		await Notification.create({
		  recipient: res.user.cid,
		  read: false,
		  title: "Training Request Cancelled",
		  content: 'You have deleted your training request.'
		});
	  } else {
		await Notification.create({
		  recipient: request.studentCid,
		  read: false,
		  title: "Training Request Cancelled",
		  content: `Your training request has been deleted by ${res.user.fname + ' ' + res.user.lname}.`
		});
	  }
	} catch (e) {
	  console.log('Error:', e);
	  req.app.Sentry.captureException(e);
	  res.stdRes.ret_det = e;
	}
  
	return res.json(res.stdRes);
  });

router.get('/request/:date', getUser, auth(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']), async (req, res) => {
	try {
		const d = new Date(`${req.params.date.slice(0,4)}-${req.params.date.slice(4,6)}-${req.params.date.slice(6,8)}`);
		const dayAfter = new Date(d);
		dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

		const requests = await TrainingRequest.find({
			startTime: {
				$gte: (d.toISOString()),
				$lt: (dayAfter.toISOString())
			},
			instructorCid: null,
			deleted: false
		}).populate('student', 'fname lname rating vis').populate('milestone', 'name code').lean();

		res.stdRes.data = requests;
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/session/open', getUser, auth(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']), async (req, res) => {
	try {
		const sessions = await TrainingSession.find({
			instructorCid: res.user.cid,
			submitted: false
		}).populate('student', 'fname lname cid vis').populate('milestone', 'name code').lean();

		res.stdRes.data = sessions;
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/session/:id', getUser, async(req, res) => {
	try {
		const isIns = ['ta', 'ins', 'mtr', 'ia', 'atm', 'datm'].some(r => res.user.roleCodes.includes(r));

		if(isIns) {
			const session = await TrainingSession.findById(
				req.params.id
			).populate(
				'student', 'fname lname cid vis'
			).populate(
				'instructor', 'fname lname cid'
			).populate(
				'milestone', 'name code'
			).lean();

			res.stdRes.data = session;
		} else {
			const session = await TrainingSession.findById(
				req.params.id
			).select(
				'-insNotes'
			).populate(
				'student', 'fname lname cid vis'
			).populate(
				'instructor', 'fname lname cid'
			).populate(
				'milestone', 'name code'
			).lean();

			res.stdRes.data = session;
		}
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/sessions', getUser, auth(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']), async(req, res) => {
	try {
		const page = +req.query.page || 1;
		const limit = +req.query.limit || 20;

		const amount = await TrainingSession.countDocuments({submitted: true, deleted: false});
		const sessions = await TrainingSession.find({
			deleted: false, submitted: true
		}).skip(limit * (page - 1)).limit(limit).sort({
			startTime: 'desc'
		}).populate(
			'student', 'fname lname cid vis'
		).populate(
			'instructor', 'fname lname'
		).populate(
			'milestone', 'name code'
		).lean();

		res.stdRes.data = {
			count: amount,
			sessions: sessions
		};
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/sessions/past', getUser, async (req, res) => {
	try {
		const page = +req.query.page || 1;
		const limit = +req.query.limit || 20;

		const amount = await TrainingSession.countDocuments({studentCid: res.user.cid, deleted: false, submitted: true});
		const sessions = await TrainingSession.find({
			studentCid: res.user.cid, deleted: false, submitted: true
		}).skip(limit * (page - 1)).limit(limit).sort({
			startTime: 'desc'
		}).populate(
			'instructor', 'fname lname cid'
		).populate(
			'student', 'fname lname'
		).populate(
			'milestone', 'name code'
		).lean();

		res.stdRes.data = {
			count: amount,
			sessions: sessions
		};
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/sessions/:cid', getUser, auth(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']), async(req, res) => {
	try {
		const controller = await User.findOne({cid: req.params.cid}).select('fname lname').lean();
		if(!controller) {
			throw {
				code: 400,
				messgage: 'User not found'
			};
		}

		const page = +req.query.page || 1;
		const limit = +req.query.limit || 20;

		const amount = await TrainingSession.countDocuments({studentCid: req.params.cid, submitted: true, deleted: false});
		const sessions = await TrainingSession.find({
			studentCid: req.params.cid, deleted: false, submitted: true
		}).skip(limit * (page - 1)).limit(limit).sort({
			createdAt: 'desc'
		}).populate(
			'instructor', 'fname lname'
		).populate(
			'milestone', 'name code'
		).lean();

		res.stdRes.data = {
			count: amount,
			sessions: sessions,
			controller: controller
		};
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.put('/session/save/:id', getUser, auth(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']), async(req, res) => {
	try {
		await TrainingSession.findByIdAndUpdate(req.params.id, req.body);
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.put('/session/submit/:id', getUser, auth(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']), async(req, res) => {
	try {
		if(req.body.position === '' || req.body.progress === null || req.body.movements === null || req.body.location === null || req.body.ots === null || req.body.studentNotes === null || (req.body.studentNotes && req.body.studentNotes.length > 3000) || (req.body.insNotes && req.body.insNotes.length > 3000)) {
			throw {
				code: 400,
				message: "You must fill out all required forms"
			};
		}

		const delta = Math.abs(new Date(req.body.endTime) - new Date(req.body.startTime)) / 1000;
		const hours = Math.floor(delta / 3600);
		const minutes = Math.floor(delta / 60) % 60;

		const duration = `${('00' + hours).slice(-2)}:${('00' + minutes).slice(-2)}`;

		const session = await TrainingSession.findByIdAndUpdate(req.params.id, {
			sessiondate: req.body.startTime.slice(1,11),
			position: req.body.position,
			progress: req.body.progress,
			duration: duration,
			movements: req.body.movements,
			location: req.body.location,
			ots: req.body.ots,
			studentNotes: req.body.studentNotes,
			insNotes: req.body.insNotes,
			submitted: true
		});

		const instructor = await User.findOne({cid: session.instructorCid}).select('fname lname').lean();

		// Send the training record to vatusa
		const vatusaApi = axios.create({ baseUrl: 'https://api.vatusa.net/v2'}, {
			params: { apiKey: process.env.VATUSA_API_KEY } }
		);

		const Response = await vatusaApi.post(`https://api.vatusa.net/v2/user/${session.studentCid}/training/record/?apikey=${process.env.VATUSA_API_KEY}` , 
					{
					instructor_id: session.instructorCid,
                	session_date: dayjs(req.body.startTime).format("YYYY-MM-DD HH:mm"),
					position: req.body.position,
					duration: duration,
					movements: req.body.movements,
					score: req.body.progress,
					notes: req.body.studentNotes,
			     	ots_status: req.body.ots,
				    location: req.body.location,
                    is_cbt: false,
                    solo_granted: false
					});	

		// If we get here, vatusa update was successful
		console.log('VATUSA API Training note submitted - status: ' + Response.status);

		// update the database flag to submitted to prevent further updates.	
		const sessionfinalize = await TrainingSession.findByIdAndUpdate(req.params.id, {
			sessiondate: dayjs(req.body.startTime).format("YYYY-MM-DD HH:mm"),
			position: req.body.position,
			progress: req.body.progress,
			duration: duration,
			movements: req.body.movements,
			location: req.body.location,
			ots: req.body.ots,
			studentNotes: req.body.studentNotes,
			insNotes: req.body.insNotes,
			submitted: true
		});

		await Notification.create({
			recipient: session.studentCid,
			read: false,
			title: 'Training Notes Submitted',
			content: `The training notes from your session with <b>${instructor.fname + ' ' + instructor.lname}</b> have been submitted.`,
			link: `/dash/training/session/${req.params.id}`
		});
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/modules', getUser, auth(['atm', 'datm', 'ta']), async (req, res) => {
    try {
        const modules = await TrainingModule.find()
            .populate('prerequisites')
            .populate('extensionModule');

        const modulesWithSortedCourses = modules.map(module => {
            // Sort courses by their 'order' field
            const sortedCourses = module.courses.sort((a, b) => a.order - b.order);
            return {
                ...module._doc, // Use the _doc property to get the raw document
                courses: sortedCourses,
                numberOfCourses: sortedCourses.length // Include the number of courses
            };
        });

        res.stdRes.data = modulesWithSortedCourses;
        res.stdRes.ret_det.code = 200;
        res.stdRes.ret_det.message = 'Modules fetched successfully';
    } catch (error) {
        res.stdRes.ret_det.code = 500;
        res.stdRes.ret_det.message = 'Error fetching training modules: ' + error.message;
    }
    res.json(res.stdRes);
});


// POST: Create a new training module
router.post('/modules', getUser, auth(['atm', 'datm', 'ta' ]), async (req, res) => {
    try {
        const newModule = new TrainingModule(req.body);
        await newModule.save();
        res.stdRes.data = newModule;
        res.stdRes.ret_det.code = 201;
        res.stdRes.ret_det.message = 'Module created successfully';
    } catch (error) {
        res.stdRes.ret_det.code = 400;
        res.stdRes.ret_det.message = 'Error creating training module: ' + error.message;
    }
    res.json(res.stdRes);
});

router.patch('modules/:moduleId', getUser, auth(['atm', 'datm', 'ta' ]), async (req, res) => {
    try {
        const updatedModule = await TrainingModule.findByIdAndUpdate(req.params.moduleId, req.body, { new: true });
        res.stdRes.data = updatedModule;
        res.stdRes.ret_det.code = 200;
        res.stdRes.ret_det.message = 'Module updated successfully';
    } catch (error) {
        res.stdRes.ret_det.code = 400;
        res.stdRes.ret_det.message = 'Error updating training module: ' + error.message;
    }
    res.json(res.stdRes);
});

// DELETE: Delete a training module
router.delete('modules/:moduleId', getUser, auth(['atm', 'datm', 'ta' ]), async (req, res) => {
    try {
        await TrainingModule.findByIdAndDelete(req.params.moduleId);
        res.stdRes.ret_det.code = 200;
        res.stdRes.ret_det.message = 'Module deleted successfully';
    } catch (error) {
        res.stdRes.ret_det.code = 500;
        res.stdRes.ret_det.message = 'Error deleting training module: ' + error.message;
    }
    res.json(res.stdRes);
});

router.get('/modules/:cid', getUser, auth(['atm', 'datm', 'ta', 'ins', 'mtr', 'ia']), async (req, res) => {
    try {
        const cid = req.params.cid;

        const populatedProgress = await TrainingProgress.findOne({ cid: cid })
            .populate({
                path: 'modulesInProgress.moduleId',
                model: 'TrainingModule' // Ensure this matches the name used in mongoose.model() when registering the TrainingModule model
            });

        if (!populatedProgress) {
            res.stdRes.ret_det.code = 404;
            res.stdRes.ret_det.message = "Training progress not found for the given CID.";
            return res.json(res.stdRes);
        }

        // Assuming you want to include the logic to console log course names
        if (populatedProgress && populatedProgress.modulesInProgress) {
            populatedProgress.modulesInProgress.forEach(progressItem => {
                if (progressItem.moduleId && progressItem.moduleId.courses) {
                    progressItem.moduleId.courses.forEach(course => {
                        console.log(course.courseName); // Logs the name of each course
                    });
                }
            });
        }

        // Set the successful response
        res.stdRes.ret_det.code = 200;
        res.stdRes.ret_det.message = "Modules in progress fetched successfully.";
        res.stdRes.data = populatedProgress;

    } catch (error) {
        console.error("Error fetching modules in progress:", error);
        res.stdRes.ret_det.code = 500;
        res.stdRes.ret_det.message = "Internal Server Error";
    }

    res.json(res.stdRes);
});

router.get('/trainers/assignments', getUser, auth(['atm', 'datm', 'ta']), async (req, res) => {
  try {
    const instructorRoles = ['atm', 'datm', 'ta', 'ins', 'mtr', 'ia'];
    const trainers = await User.find({ roleCodes: { $in: instructorRoles } });

    const trainerAssignments = await Promise.all(trainers.map(async (trainer) => {
      const assignments = await TrainingProgress.find({ "modulesInProgress.trainingTeam.trainers": trainer._id });

      // Find the corresponding TrainerProfile for each trainer
      const trainerProfile = await TrainerProfile.findOne({ trainerId: trainer._id });

      // Return the combined data
      return { trainer, assignments, trainerProfile }; // Include trainerProfile in the returned object
    }));

    res.stdRes.data = trainerAssignments; // Set the data part of the standardized response
    res.stdRes.ret_det.message = 'Successfully retrieved trainer assignments.';
    res.json(res.stdRes); // Send the standardized response
  } catch (error) {
    res.stdRes.ret_det.code = 500;
    res.stdRes.ret_det.message = error.toString();
    res.status(500).json(res.stdRes); // Send the standardized response with error details
  }
});

router.get('/trainers/:cid', getUser, auth(['atm', 'datm', 'ta']), async (req, res) => {
	try {
		const cid = req.params.cid;
		// Use findOne to fetch the trainer by cid instead of _id
		const trainer = await User.findOne({ cid: cid });
		if (!trainer) {
				return res.status(404).json({ message: 'Trainer not found' });
		}

		// Fetch the trainer's profile and populate the assignableModules with TrainingModule details
		const trainerProfile = await TrainerProfile.findOne({ trainerId: trainer._id })
		.populate('assignableModules.moduleId');

		const assignments = await TrainingProgress.find({ "modulesInProgress.trainingTeam.trainers": trainer._id });
			
		const response = {
			trainer: {
				_id: trainer._id,
				cid: trainer.cid,
				fname: trainer.fname,
				lname: trainer.lname,
				roleCodes: trainer.roleCodes,
				ratingShort: trainer.ratingShort,
				oi: trainer.oi,
			},
				assignments,
				trainerProfile: trainerProfile ? trainerProfile.toObject() : null, // Convert to plain object if found
		};

		res.stdRes.data = response;
		res.stdRes.ret_det.message = 'Successfully retrieved trainer details.';
		res.json(res.stdRes);
	} catch (error) {
		res.stdRes.ret_det.code = 500;
		res.stdRes.ret_det.message = error.toString();
		res.status(500).json(res.stdRes);
	}
});

router.put('/trainerProfile/:trainerId', getUser, auth(['atm', 'datm', 'ta']), async (req, res) => {
	try {
			const { trainerId } = req.params;
			console.log(`Updating trainer profile for trainerId: ${trainerId}`); // Log the trainerId being updated

			const { assignableModules, canConductEVAL } = req.body;
			console.log('Received assignableModules:', assignableModules); // Log the received assignableModules
			console.log('Received canConductEVAL:', canConductEVAL); // Log the received canConductEVAL status

			// Optionally, add data validation here

			// Find and update the trainer profile
			const updatedProfile = await TrainerProfile.findOneAndUpdate(
					{ trainerId: trainerId }, // Ensure 'trainerId' matches your schema's reference field
					{ 
							assignableModules: assignableModules, 
							canConductEVAL: canConductEVAL 
					},
					{ new: true, runValidators: true } // Return the updated document and run schema validators
			);

			if (!updatedProfile) {
					console.log('Trainer profile not found for trainerId:', trainerId); // Log if no profile found
					res.stdRes.ret_det.code = 404;
					res.stdRes.ret_det.message = 'Trainer profile not found.';
					return res.status(404).json(res.stdRes);
			}

			console.log('Updated trainer profile:', updatedProfile); // Log the updated trainer profile
			res.stdRes.data = updatedProfile;
			res.stdRes.ret_det.message = 'Trainer profile updated successfully.';
			res.json(res.stdRes);
	} catch (error) {
			console.error('Error updating trainer profile:', error); // Log any errors encountered
			res.stdRes.ret_det.code = 500;
			res.stdRes.ret_det.message = error.toString();
			res.status(500).json(res.stdRes);
	}
});

router.delete('/trainer/:trainerId', getUser, auth(['atm', 'datm', 'ta']), async (req, res) => {
	try {
			const { trainerId } = req.params;
			const objectId = m.Types.ObjectId(trainerId);

			// Check for any TrainingProgress documents where this trainer is part of the training team
			const activeTrainingAssignments = await TrainingProgress.find({
					"modulesInProgress.trainers": objectId
			}).exec();

			if (activeTrainingAssignments.length > 0) {
					// Return an error message if the trainer is part of any training teams
					return res.status(400).json({ message: 'Cannot remove trainer with active training assignments.' });
			}

			// Proceed with role removal and TrainerProfile deletion as before
			await User.updateOne({ _id: objectId }, { $pull: { roleCodes: { $in: ['ins', 'mtr', 'ia'] } } });
			const deletionResult = await TrainerProfile.findOneAndDelete({ trainerId: objectId });

			if (!deletionResult) {
					return res.status(404).json({ message: 'Trainer profile not found for the provided ID.' });
			}

			res.status(200).json({ message: 'Trainer and their profile removed successfully.' });
	} catch (error) {
			console.error("Failed to remove trainer:", error);
			res.status(500).json({ message: 'Failed to remove trainer.', error: error.message });
	}
});

router.get('/training-progress', getUser, auth(['atm', 'datm', 'ta', ]), async (req, res) => {
  try {
    // Fetch all entries from the TrainingProgress collection
    const trainingProgress = await TrainingProgress.find()
			.populate({
				path: 'modulesInProgress.moduleId', // First, populate the moduleId field with the name from the TrainingModule collection
				select: 'name'
			})
			.populate({ // Now, add another populate to fetch trainer details
				path: 'modulesInProgress.trainingTeam.trainers', // Specify the path to the trainers array
				select: 'fname lname' // Only fetch the first and last name of each trainer
			});
		res.stdRes.data = trainingProgress;

	} catch (e) {
    console.error(e);
    res.stdRes.ret_det = e;
  }

	return res.json(res.stdRes)
});

router.get('/trainers/by-module/:moduleId', getUser, auth(['atm', 'datm', 'ta']), async (req, res) => {
  const { moduleId } = req.params;
  
  try {
    // Find trainers who can teach the specific module and populate only specific fields from the User document
    const trainers = await TrainerProfile.find({
      "assignableModules.moduleId": moduleId,
      "assignableModules.canTeach": true
    })
    .populate('trainerId', 'cid fname lname email') // Example: Only include the 'cid', 'fname' 'lname' and 'email' fields from the User document
    .select('trainerId -_id'); // Example: Only include 'trainerId' in the results, exclude '_id' of TrainerProfile

		res.stdRes.data = trainers.map(trainer => trainer.trainerId); // Assuming you want to return an array of User details directly
    
  } catch (e) {
    console.error(e);
		res.stdRes.ret_det = e;
  }

	return res.json(res.stdRes);
});

router.get('/modules/extensions/by-module/:moduleId', async (req, res) => {
  const { moduleId } = req.params;
  
  try {
    const extensions = await TrainingModule.find({
      extensionModule: moduleId,
      isExtension: true
    });

    res.stdRes.data = extensions;

  } catch (e) {
    console.error(e);
		res.stdRes.ret_det = e;
  }

	return res.json(res.stdRes);
});

router.put('/trainingProgress/:cid', getUser, auth(['atm', 'datm', 'ta']), async (req, res) => {
  // Convert CID from params to Number
  const cid = Number(req.params.cid);
  const { moduleInProgressUpdate } = req.body;

  // Log incoming CID and module update payload
  console.log('CID:', cid);
  console.log('Module In Progress Update:', moduleInProgressUpdate);

  try {
    // Prepare query and update objects for logging
    const query = { cid, "modulesInProgress.moduleId": moduleInProgressUpdate.moduleId };
    const update = {
      $set: {
        "modulesInProgress.$.status": moduleInProgressUpdate.status,
        "modulesInProgress.$.trainingTeam": moduleInProgressUpdate.trainingTeam
      }
    };

    // Log the query and update objects
    console.log('Query:', query);
    console.log('Update:', update);

    const result = await TrainingProgress.findOneAndUpdate(query, update, { new: true });

    // Log the result of the findOneAndUpdate operation
    console.log('findOneAndUpdate Result:', result);

    if (!result) {
      res.stdRes.ret_det.code = 404;
      res.stdRes.ret_det.message = 'Training progress not found.';
      return res.status(404).json(res.stdRes);
    }

    res.stdRes.ret_det.message = 'Training progress updated successfully.';
    res.stdRes.data = result;
  } catch (e) {
    console.error('Failed to update training progress:', e);
    res.stdRes.ret_det.code = 500;
    res.stdRes.ret_det.message = 'Internal server error';
    return res.status(500).json(res.stdRes);
  }

  return res.json(res.stdRes);
});



export default router;
