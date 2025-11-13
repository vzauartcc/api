import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { AtcOnlineModel } from '../models/atcOnline.js';
import { ControllerHoursModel } from '../models/controllerHours.js';
import { PilotOnlineModel } from '../models/pilotOnline.js';
import status from '../types/status.js';

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

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const pilots = await PilotOnlineModel.find().lean().cache().exec();
		const atc = await AtcOnlineModel.find().lean({ virtuals: true }).cache().exec();

		return res.status(status.OK).json({ pilots, atc });
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/top', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const d = new Date();
		const thisMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
		const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
		const sessions = await ControllerHoursModel.find({
			$and: [
				{ isInstructor: { $ne: true } },
				{ isStudent: { $ne: true } },
				{ timeStart: { $gt: thisMonth, $lt: nextMonth } },
			],
		})
			.populate('user', 'fname lname cid')
			.lean({ virtuals: true })
			.cache('5 minutes')
			.exec();

		const controllerTimes: Map<number, any> = new Map();
		const positionTimes: Map<string, any> = new Map();
		for (const session of sessions) {
			if (!session || !session.timeEnd) continue;

			const posSimple = session.position.replace(/_[A-Z0-9]{1,3}_/, '_');
			const len = Math.round((session.timeEnd.getTime() - session.timeStart.getTime()) / 1000);
			if (!controllerTimes.has(session.cid)) {
				controllerTimes.set(session.cid, {
					name: session.user ? `${session.user.name}` : session.cid,
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

		return res.status(status.OK).json({
			controllers: controllerTimes
				.values()
				.toArray()
				.sort((a, b) => b.len - a.len)
				.slice(0, 5),
			positions: positionTimes
				.values()
				.toArray()
				.sort((a, b) => b.len - a.len)
				.slice(0, 5),
		});
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

export default router;
