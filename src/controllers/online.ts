import { Router, type Request, type Response } from 'express';
import { convertToReturnDetails } from '../app.js';
import { AtcOnlineModel } from '../models/atcOnline.js';
import { ControllerHoursModel } from '../models/controllerHours.js';
import { PilotOnlineModel } from '../models/pilotOnline.js';

const router = Router();

const airports = new Map([
	['ORD', "O'Hare"],
	['MDW', 'Midway'],
	['SBN', 'South Bend'],
	['MKE', 'Milwaukee'],
	['GRR', 'Grand Rapids'],
	['AZO', 'Kalamazoo'],
	['BTL', 'Battle Creek'],
	['EKM', 'Elkhart'],
	['ENW', 'Kenosha'],
	['PWK', 'Palwaukee'],
	['ARR', 'Aurora'],
	['DPA', 'Du Page'],
	['CID', 'Cedar Rapids'],
	['UGN', 'Waukegan'],
	['MSN', 'Madision'],
	['JVL', 'Janesville'],
	['GYY', 'Gary'],
	['MLI', 'Moline'],
	['OSH', 'Oshkosh'],
	['UES', 'Waukesha'],
	['VOK', 'Volk'],
	['MKG', 'Muskegan'],
	['ALO', 'Waterloo'],
	['DBQ', 'Dubuque'],
	['DEC', 'Decatur'],
	['FWA', 'Fort Wayne'],
	['GUS', 'Grissom'],
	['CMI', 'Champign'],
	['LAF', 'Lafayette'],
	['MWC', 'Timmerman'],
	['RFD', 'Rockford'],
	['CHI', 'Chicago'],
	['LOT', 'Lewis University'],
]);

const positions = new Map([
	['DEL', 'Delivery'],
	['GND', 'Ground'],
	['TWR', 'Tower'],
	['DEP', 'Departure'],
	['APP', 'Approach'],
	['CTR', 'Center'],
]);

router.get('/', async (req: Request, res: Response) => {
	try {
		const pilots = await PilotOnlineModel.find().lean().exec();
		const atc = await AtcOnlineModel.find().lean({ virtuals: true }).exec();

		res.stdRes.data = {
			pilots: pilots,
			atc: atc,
		};
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get('/top', async (req: Request, res: Response) => {
	try {
		const d = new Date();
		const thisMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
		const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
		const sessions = await ControllerHoursModel.find({
			$and: [
				{ isInstructor: false },
				{ isStudent: false },
				{ timeStart: { $gt: thisMonth, $lt: nextMonth } },
			],
		})
			.populate('user', 'fname lname cid')
			.exec();

		const controllerTimes: Map<number, any> = new Map();
		const positionTimes: Map<string, any> = new Map();
		for (const session of sessions) {
			if (!session || !session.timeEnd) continue;

			const posSimple = session.position.replace(/_[A-Z0-9]{1,3}_/, '_');
			const len = Math.round((session.timeEnd.getTime() - session.timeStart.getTime()) / 1000);
			if (!controllerTimes.has(session.cid)) {
				controllerTimes.set(session.cid, {
					name: session.user ? `${session.user.fname} ${session.user.lname}` : session.cid,
					cid: session.cid,
					len: 0,
				});
			}
			if (!positionTimes.has(posSimple)) {
				const posParts = posSimple.split('_');
				const facility = posParts[0]!;
				const pos = posParts[1]!;
				positionTimes.set(posSimple, {
					name: `${airports.get(facility) ?? 'Unknown'} ${positions.get(pos) ?? 'Unknown'}`,
					len: 0,
				});
			}

			const sessTime = controllerTimes.get(session.cid);
			const posTime = positionTimes.get(posSimple);
			controllerTimes.set(session.cid, {
				name: sessTime.name,
				cid: session.cid,
				len: sessTime.len + len,
			});
			positionTimes.set(posSimple, {
				name: posTime.name,
				len: posTime.len + len,
			});
		}
		res.stdRes.data.controllers = Object.values(controllerTimes)
			.sort((a, b) => b.len - a.len)
			.slice(0, 5);
		res.stdRes.data.positions = Object.values(positionTimes)
			.sort((a, b) => b.len - a.len)
			.slice(0, 5);
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

export default router;
