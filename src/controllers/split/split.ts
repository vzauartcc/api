import { Router, type NextFunction, type Request, type Response } from 'express';
import { Redis } from 'ioredis';
import { logException } from '../../app.js';
import { isEventsTeam } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import status from '../../types/status.js';
import {
	EON_Border,
	PMM_Border,
	ZAU_Hi,
	ZAU_Hi_Borders,
	ZAU_Lo,
	ZAU_Lo_Borders,
} from './geojson.js';

const router = Router();

const DEFAULT_SECTOR = 35;
const sectors = [
	{
		id: 35,
		name: 'BEARZ',
		frequency: '134.875',
		color: '#ff7f27',
	},
	{
		id: 25,
		name: 'PMM',
		frequency: '126.125',
		color: '#4aa564',
	},
	{
		id: 26,
		name: 'KUBBS',
		frequency: '133.200',
		color: '#5674b9',
	},
	{
		id: 36,
		name: 'FWA',
		frequency: '126.325',
		color: '#f06eaa',
	},
	{
		id: 44,
		name: 'EON',
		frequency: '120.125',
		color: '#9999ff',
	},
	{
		id: 46,
		name: 'BVT',
		frequency: '121.275',
		color: '#a4d5ee',
	},
	{
		id: 51,
		name: 'PLANO',
		frequency: '135.150',
		color: '#cccc00',
	},
	{
		id: 52,
		name: 'BDF',
		frequency: '132.225',
		color: '#f5989d',
	},
	{
		id: 55,
		name: 'BRL',
		frequency: '118.750',
		color: '#7accc8',
	},
	{
		id: 60,
		name: 'BAE',
		frequency: '126.875',
		color: '#f26d7d',
	},
	{
		id: 62,
		name: 'HARLY',
		frequency: '123.825',
		color: '#fbaf5d',
	},
	{
		id: 63,
		name: 'DBQ',
		frequency: '133.950',
		color: '#f26d7d',
	},
	{
		id: 64,
		name: 'LNR',
		frequency: '133.300',
		color: '#7fd2a8',
	},
	{
		id: 74,
		name: 'FARMM',
		frequency: '133.350',
		color: '#f9ad81',
	},
	{
		id: 75,
		name: 'COTON',
		frequency: '127.775',
		color: '#fbc98e',
	},
	{
		id: 77,
		name: 'MALTA',
		frequency: '134.825',
		color: '#f06eaa',
	},
	{
		id: 81,
		name: 'CRIBB',
		frequency: '120.350',
		color: '#c2c2c2',
	},
	{
		id: 89,
		name: 'GIJ',
		frequency: '126.475',
		color: '#41b6e6',
	},
	{
		id: 94,
		name: 'IOW',
		frequency: '125.575',
		color: '#2e8540',
	},
];

router.get('/geojson', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		return res.status(status.OK).json({
			borders: {
				high: ZAU_Hi_Borders,
				low: ZAU_Lo_Borders,
				PMM: PMM_Border,
				EON: EON_Border,
			},
			sectors: {
				high: ZAU_Hi,
				low: ZAU_Lo,
			},
		});
	} catch (e) {
		logException(e);

		return next(e);
	}
});

router.get('/ownership', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const ownership = await getOwnership(req.app.redis);
		return res.status(status.OK).json({ positions: sectors, ownership: ownership });
	} catch (e) {
		logException(e);

		return next(e);
	}
});

router.put(
	'/ownership',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.body || !req.body.high || !req.body.low) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid request',
				};
			}

			for (const id of Object.keys(req.body.high)) {
				await req.app.redis.set(`split:high:${id}`, req.body.high[id]);
				// Boiler Climb Corridor
				if (id === '1') {
					await req.app.redis.set(`split:high:9`, req.body.high[id]);
				}
				// IOW Climb Corridor
				if (id === '8') {
					await req.app.redis.set(`split:high:6`, req.body.high[id]);
				}
			}

			for (const id of Object.keys(req.body.low)) {
				await req.app.redis.set(`split:low:${id}`, req.body.low[id]);
			}

			return res.status(status.OK).json(req.body);
		} catch (e) {
			logException(e);

			return next(e);
		}
	},
);

router.delete(
	'/ownership',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			await resetSplit(req.app.redis);

			const ownership = await getOwnership(req.app.redis);

			return res.status(status.OK).json(ownership);
		} catch (e) {
			logException(e);

			return next(e);
		}
	},
);

export default router;

export async function resetSplit(redis: Redis) {
	const keys = await redis.keys(`split:*`);

	if (keys.length > 0) {
		await redis.del(keys);
	}

	// Reset back to default sector
	for (const sector of ZAU_Hi.features) {
		redis.set(`split:high:${sector.properties.id}`, DEFAULT_SECTOR);
	}
	for (const sector of ZAU_Lo.features) {
		redis.set(`split:low:${sector.properties.id}`, DEFAULT_SECTOR);
	}
}

async function getOwnership(redis: Redis) {
	const retval = {
		high: {},
		low: {},
	} as any;

	const keys = await redis.keys(`split:*`);

	if (keys.length === 0) {
		console.warn('Split data does not exist, setting defaults');
		await resetSplit(redis);

		return getOwnership(redis);
	}

	for (const key of keys) {
		const val = await redis.get(key);
		if (key.startsWith('split:high:')) {
			retval.high[key.replace('split:high:', '')] = val;
		} else if (key.startsWith('split:low:')) {
			retval.low[key.replace('split:low:', '')] = val;
		}
	}

	return retval;
}
