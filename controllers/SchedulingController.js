import express from 'express';
const router = express.Router();
import ScheduledSession from '../models/ScheduledSession.js';
import getUser from '../middleware/getUser.js';
import auth from '../middleware/auth.js';
import AtcPosition from '../models/AtcPosition.js';



router.get('/positions', getUser, async (req, res) => {
	//console.log('API called: scheduling/positions');
	//console.log('Request query:', req.query);
    try {
        const filteredArray = await AtcPosition.find({$or: [{'positions.certCode': {$in: req.query.certCodes}},{'positions.certCode': {$in: req.query.certCodes}}]}).sort({name: 1}).lean();
        const data = filteredArray.map( item => ({
			code: item.code,
			name: item.name,
			positions: item.positions.filter(position => req.query.certCodes.some(code => position.certCode.includes(code))).map(position => ({
				name: position.name,
				id: position.id
			}))
		}));
		
        // return result to the client
        res.status(200).send(data);
    } catch (err) {
        // handle error
		console.log(err);
    }
});

router.post('/request/new', getUser, async (req, res) => {
	try {
		if(!req.body.submitter || !req.body.startTime || !req.body.endTime || !req.body.facility || !req.body.position) {
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

		const totalRequests = await req.app.redis.get(`SCHEDULEREQ:${res.user.cid}`);
		
		if(totalRequests > 10) {
			throw {
				code: 429,
				message: `You have scheduled too many sessions in the last 4 hours.`
			}
		}

		req.app.redis.set(`SCHEDULEREQ:${res.user.cid}`, (+totalRequests || 0 ) + 1);
		req.app.redis.expire(`SCHEDULEREQ:${res.user.cid}`, 14400)

		await ScheduledSession.create({
			submitterCid: res.user.cid,
			startTime: req.body.startTime,
			endTime: req.body.endTime,
			facility: req.body.facility,
			position: req.body.position,
		});

	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/sessions', async (req, res) => {
	//console.log('API called: scheduling/sessions');
	//console.log('Request query:', req.query);
	const queryDate = req.query.startTime;
	//console.log(queryDate);
	const start = new Date(Date.parse(`${queryDate}T00:00:00.000Z`));
	const date = new Date(`${queryDate}T00:00:00.000Z`);
	date.setDate(date.getDate() + 2);
	const end = new Date(date.getTime() + 86399999);
	//console.log(start);
	//console.log(end);
	const sessions = await ScheduledSession.find({
	  startTime: { $gte: start, $lt: end },
	}).populate('submitter', 'fname lname cid')
	.populate('facility2', 'code name').lean();
	if (sessions === undefined) {
	  res.status(404).send({ error: "No positions found" });
	} else if (sessions === null) { // added condition here
	  res.status(304).send({ error: "This is terrible on me" });
	} else {
	  res.set('Cache-Control', 'no-store');
	  res.status(200).send(sessions);
	}
	//console.log(sessions);
	//console.log("This is the right info above ^")
	//console.log(res.statusCode);
});

router.get('/sessions/:id', async (req, res) => {
	//console.log('API called: scheduling/sessions/:id');
	//console.log('Request params:', req.params);
	const session = await ScheduledSession.findOne({ _id: req.params.id })
	  .populate('submitter', 'fname lname cid')
	  .populate('facility2', 'code name').lean();
	if (!session) {
	  res.status(404).send({ error: "Session not found" });
	} else {
	  res.set('Cache-Control', 'no-store');
	  res.status(200).send(session);
	}
});

/*router.post('/scheduledpositions', async (req, res) => {
	console.log('API called: scheduledpositions');
	console.log('Request body:', req.body);
	const positions = await AtcScheduled.create({
		day: currentDate,
		user: req.user.cid,
		zuluTime: this.session.zuluTime,
		localTime: this.session.localTime,
		position: this.session.position
		// Add other fields for the new record here
	  });
	  res.send(positions);
	});*/

router.delete('/sessions/:_id', getUser, async (req, res) => {
	const { _id } = req.params;
	console.log("Deleting session with id:", _id);
	try {
		// Retrieve session from the database
		const session = await ScheduledSession.findById(_id);
		if(!session){
			//console.log("Session not found for id: ", _id);
			return res.status(404).json({ error: 'Session not found' });
		}
		// Check if user is ATM or DATM or User is self 
		//if(!(req.user.roles === 'atm' || req.user.roles === 'datm' || req.user.cid) ){
		//	console.log("Unauthorized user to delete session: ", _id);
		//	return res.status(401).json({error: 'Unauthorized'});
		//}
		// Delete session from the database
		await ScheduledSession.findByIdAndDelete(_id);
		//console.log("Session with id:", _id, "deleted successfully");
		//console.log('Session deleted successfully');
		res.json({ message: 'Session removed successfully' });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Error deleting session' });
	}
});





export default router;