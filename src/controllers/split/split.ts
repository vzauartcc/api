import { Router, type NextFunction, type Request, type Response } from 'express';
import { Redis } from 'ioredis';
import { throwBadRequestException, throwForbiddenException } from '../../helpers/errors.js';
import getUser from '../../middleware/user.js';
import status from '../../types/status.js';
import {
	EON_Border,
	PMM_Border,
	ZAU_High,
	ZAU_High_Borders,
	ZAU_Low,
	ZAU_Low_Borders,
	ZMP_High,
	ZMP_Low,
	ZOB_High,
	ZOB_Low,
} from './geojson.js';

const router = Router();

const DEFAULT_SECTOR = 35;
const sectors = [
	{
		id: '25',
		name: 'PMM',
		frequency: '126.125',
		color: '#4aa564',
	},
	{
		id: '26',
		name: 'KUBBS',
		frequency: '133.200',
		color: '#5674b9',
	},
	{
		id: '35',
		name: 'BEARZ',
		frequency: '134.875',
		color: '#ff7f27',
	},
	{
		id: '36',
		name: 'FWA',
		frequency: '126.325',
		color: '#f06eaa',
	},
	{
		id: '44',
		name: 'EON',
		frequency: '120.125',
		color: '#9999ff',
	},
	{
		id: '46',
		name: 'BVT',
		frequency: '121.275',
		color: '#a4d5ee',
	},
	{
		id: '51',
		name: 'PLANO',
		frequency: '135.150',
		color: '#cccc00',
	},
	{
		id: '52',
		name: 'BDF',
		frequency: '132.225',
		color: '#f5989d',
	},
	{
		id: '55',
		name: 'BRL',
		frequency: '118.750',
		color: '#7accc8',
	},
	{
		id: '60',
		name: 'BAE',
		frequency: '126.875',
		color: '#f26d7d',
	},
	{
		id: '62',
		name: 'HARLY',
		frequency: '123.825',
		color: '#fbaf5d',
	},
	{
		id: '63',
		name: 'DBQ',
		frequency: '133.950',
		color: '#f26d7d',
	},
	{
		id: '64',
		name: 'LNR',
		frequency: '133.300',
		color: '#7fd2a8',
	},
	{
		id: '74',
		name: 'FARMM',
		frequency: '133.350',
		color: '#f9ad81',
	},
	{
		id: '75',
		name: 'COTON',
		frequency: '127.775',
		color: '#fbc98e',
	},
	{
		id: '77',
		name: 'MALTA',
		frequency: '134.825',
		color: '#f06eaa',
	},
	{
		id: '81',
		name: 'CRIBB',
		frequency: '120.350',
		color: '#c2c2c2',
	},
	{
		id: '89',
		name: 'GIJ',
		frequency: '126.475',
		color: '#41b6e6',
	},
	{
		id: '94',
		name: 'IOW',
		frequency: '125.575',
		color: '#2e8540',
	},
];

router.get('/geojson', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		return res.status(status.OK).json({
			borders: {
				high: ZAU_High_Borders,
				low: ZAU_Low_Borders,
				PMM: PMM_Border,
				EON: EON_Border,
			},
			sectors: {
				high: ZAU_High,
				low: ZAU_Low,
			},
			zob: {
				high: ZOB_High,
				low: ZOB_Low,
			},
			zmp: {
				high: ZMP_High,
				low: ZMP_Low,
			},
		});
	} catch (e) {
		return next(e);
	}
});

router.get('/ownership', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const ownership = await getOwnership(req.app.redis);
		return res.status(status.OK).json({ positions: sectors, ownership: ownership });
	} catch (e) {
		return next(e);
	}
});

router.put('/ownership', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.body || !req.body.high || !req.body.low) {
			throwBadRequestException('Invalid request');
		}

		if (!req.user.isStaff && req.user.rating < 5) {
			throwForbiddenException();
		}

		const entries: string[] = [];
		for (const id of Object.keys(req.body.high)) {
			entries.push(`split:g:high:${id}`, req.body.high[id]);
			// Boiler Climb Corridor
			if (id === '46') {
				entries.push(`split:g:high:9`, req.body.high[id]);
			}
			// IOW Climb Corridor
			if (id === '94') {
				entries.push(`split:g:high:6`, req.body.high[id]);
			}
		}

		for (const id of Object.keys(req.body.low)) {
			entries.push(`split:g:low:${id}`, req.body.low[id]);
		}

		await req.app.redis.mset(entries);

		const data = await getOwnership(req.app.redis);

		return res.status(status.OK).json(data);
	} catch (e) {
		return next(e);
	}
});

router.delete('/ownership', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.user.isStaff && req.user.rating < 5) {
			throwForbiddenException();
		}
		await resetSplit(req.app.redis);

		const ownership = await getOwnership(req.app.redis);

		return res.status(status.OK).json(ownership);
	} catch (e) {
		return next(e);
	}
});

export default router;

export async function resetSplit(redis: Redis) {
	const keys = await redis.keys(`split:g:*`);

	if (keys.length > 0) {
		await redis.del(keys);
	}

	// Reset back to default sector
	for (const sector of ZAU_High.features) {
		redis.set(`split:g:high:${sector.properties.id}`, DEFAULT_SECTOR);
	}
	for (const sector of ZAU_Low.features) {
		redis.set(`split:g:low:${sector.properties.id}`, DEFAULT_SECTOR);
	}
}

async function getOwnership(redis: Redis) {
	const retval = {
		zau: {
			high: {},
			low: {},
		},
		zmp: {},
		zob: {},
	} as any;

	const keys = await redis.keys(`split:*`);

	if (keys.length === 0) {
		console.warn('Split data does not exist, setting defaults');
		await resetSplit(redis);

		return getOwnership(redis);
	}

	for (const key of keys) {
		const val = await redis.get(key);
		if (key.startsWith('split:g:high:')) {
			retval.zau.high[key.replace('split:g:high:', '')] = val;
		} else if (key.startsWith('split:g:low:')) {
			retval.zau.low[key.replace('split:g:low:', '')] = val;
		} else if (key.startsWith('split:p:')) {
			retval.zmp[key.replace('split:p:', '')] = val;
		} else if (key.startsWith('split:c:')) {
			retval.zob[key.replace('split:c:', '')] = val;
		}
	}

	return retval;
}

router.get('/isSplit', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const keys = await req.app.redis.keys(`split:g:*`);

		if (keys.length === 0) {
			return res.status(status.OK).json(false);
		}

		for (const key of keys) {
			const val = await req.app.redis.get(key);
			if (val !== '35') {
				return res.status(status.OK).json(true);
			}
		}

		return res.status(status.OK).json(false);
	} catch (e) {
		return next(e);
	}
});
