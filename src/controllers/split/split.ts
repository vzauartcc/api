import { Router, type NextFunction, type Request, type Response } from 'express';
import { Redis } from 'ioredis';
import {
	throwBadRequestException,
	throwForbiddenException,
	throwInternalServerErrorException,
} from '../../helpers/errors.js';
import getUser from '../../middleware/user.js';
import status from '../../types/status.js';
import {
	EON_Border,
	PMM_Border,
	ZAU_High,
	ZAU_High_Borders,
	ZAU_Low,
	ZAU_Low_Borders,
	ZID_High,
	ZID_Low,
	ZMP_High,
	ZMP_Low,
	ZOB_High,
	ZOB_Low,
} from './geojson.js';

const router = Router();

const DEFAULT_SECTOR = 35;
const sectors = {
	zau: [
		{
			id: '25',
			name: 'PMM',
			frequency: '126.125',
		},
		{
			id: '26',
			name: 'KUBBS',
			frequency: '133.200',
		},
		{
			id: '35',
			name: 'BEARZ',
			frequency: '134.875',
		},
		{
			id: '36',
			name: 'FWA',
			frequency: '126.325',
		},
		{
			id: '44',
			name: 'EON',
			frequency: '120.125',
		},
		{
			id: '46',
			name: 'BVT',
			frequency: '121.275',
		},
		{
			id: '51',
			name: 'PLANO',
			frequency: '135.150',
		},
		{
			id: '52',
			name: 'BDF',
			frequency: '132.225',
		},
		{
			id: '55',
			name: 'BRL',
			frequency: '118.750',
		},
		{
			id: '60',
			name: 'BAE',
			frequency: '126.875',
		},
		{
			id: '62',
			name: 'HARLY',
			frequency: '123.825',
		},
		{
			id: '63',
			name: 'DBQ',
			frequency: '133.950',
		},
		{
			id: '64',
			name: 'LNR',
			frequency: '133.300',
		},
		{
			id: '74',
			name: 'FARMM',
			frequency: '133.350',
		},
		{
			id: '75',
			name: 'COTON',
			frequency: '127.775',
		},
		{
			id: '77',
			name: 'MALTA',
			frequency: '134.825',
		},
		{
			id: '81',
			name: 'CRIBB',
			frequency: '120.350',
		},
		{
			id: '89',
			name: 'GIJ',
			frequency: '126.475',
		},
		{
			id: '94',
			name: 'IOW',
			frequency: '125.575',
		},
	],
	zmp: [
		{
			id: '05',
			name: 'ODI LO',
			frequency: '125.300',
		},
		{
			id: '11',
			name: 'AXN HI',
			frequency: '133.400',
		},
		{
			id: '64',
			name: 'ZMP TMU ORD',
			frequency: '123.450',
		},
		{
			id: '01',
			name: 'PLN LO',
			frequency: '134.600',
		},
		{
			id: '02',
			name: 'TVC LO',
			frequency: '132.900',
		},
		{
			id: '03',
			name: 'SAW LO',
			frequency: '133.550',
		},
		{
			id: '04',
			name: 'AUW LO',
			frequency: '124.400',
		},
		{
			id: '06',
			name: 'TWINZ LO',
			frequency: '134.300',
		},
		{
			id: '07',
			name: 'FGT LO',
			frequency: '132.350',
		},
		{
			id: '08',
			name: 'MKT LO',
			frequency: '135.000',
		},
		{
			id: '09',
			name: 'RWF LO',
			frequency: '125.500',
		},
		{
			id: '10',
			name: 'GEP LO',
			frequency: '121.050',
		},
		{
			id: '12',
			name: 'TVC HI',
			frequency: '132.425',
		},
		{
			id: '13',
			name: 'TKV HI',
			frequency: '133.175',
		},
		{
			id: '14',
			name: 'APN HI',
			frequency: '127.125',
		},
		{
			id: '15',
			name: 'ODI HI',
			frequency: '135.700',
		},
		{
			id: '16',
			name: 'EAU HI',
			frequency: '133.750',
		},
		{
			id: '17',
			name: 'MCW HI',
			frequency: '134.250',
		},
		{
			id: '18',
			name: 'OTG HI',
			frequency: '128.675',
		},
		{
			id: '19',
			name: 'FSD HI',
			frequency: '119.875',
		},
		{
			id: '20',
			name: 'PIR HI',
			frequency: '128.425',
		},
		{
			id: '21',
			name: 'RGK LO',
			frequency: '134.850',
		},
		{
			id: '22',
			name: 'FAR HI',
			frequency: '134.750',
		},
		{
			id: '23',
			name: 'DIK HI/LO',
			frequency: '127.600',
		},
		{
			id: '24',
			name: 'FAR HI/LO',
			frequency: '132.150',
		},
		{
			id: '25',
			name: 'DLH HI/LO',
			frequency: '134.550',
		},
		{
			id: '26',
			name: 'GRI LO',
			frequency: '119.400',
		},
		{
			id: '27',
			name: 'OMA LO',
			frequency: '119.600',
		},
		{
			id: '28',
			name: 'POLAR SUPER HI',
			frequency: '119.725',
		},
		{
			id: '29',
			name: 'ONL HI',
			frequency: '124.875',
		},
		{
			id: '30',
			name: 'FOD HI',
			frequency: '135.775',
		},
		{
			id: '32',
			name: 'VIKING SUPER HI',
			frequency: '133.075',
		},
		{
			id: '33',
			name: 'PIR LO',
			frequency: '125.100',
		},
		{
			id: '34',
			name: 'SAW HI',
			frequency: '132.725',
		},
		{
			id: '36',
			name: 'FOD LO',
			frequency: '134.000',
		},
		{
			id: '37',
			name: 'ONL LO',
			frequency: '128.000',
		},
		{
			id: '38',
			name: 'DSM HI',
			frequency: '123.975',
		},
		{
			id: '39',
			name: 'LNK HI',
			frequency: '135.100',
		},
		{
			id: '40',
			name: 'ARCTIC SUPER HI',
			frequency: '134.225',
		},
		{
			id: '42',
			name: 'WILD HI',
			frequency: '119.525',
		},
		{
			id: '43',
			name: 'HAWKEYE HI',
			frequency: '118.825',
		},
		{
			id: '44',
			name: 'MILLER SUPER HI',
			frequency: '120.050',
		},
		{
			id: '46',
			name: 'MCD SUPER HI',
			frequency: '125.825',
		},
		{
			id: '83',
			name: 'TVC LO W',
			frequency: '125.550',
		},
	],
	zob: [
		{
			id: '66',
			name: 'Bellaire',
			frequency: '125.425',
		},
		{
			id: '28',
			name: 'Detroit',
			frequency: '135.725',
		},
		{
			id: '37',
			name: 'Geneseo',
			frequency: '128.025',
		},
		{
			id: '53',
			name: 'Indian Head',
			frequency: '124.400',
		},
		{
			id: '02',
			name: 'Pandora',
			frequency: '128.625',
		},
		{
			id: '48',
			name: 'Ravenna',
			frequency: '119.875',
		},
		{
			id: '77',
			name: 'Warren',
			frequency: '134.125',
		},
		{
			id: '68',
			name: 'Allegheny',
			frequency: '133.075',
		},
		{
			id: '47',
			name: 'Bluffton',
			frequency: '119.325',
		},
		{
			id: '73',
			name: 'Bradford',
			frequency: '124.325',
		},
		{
			id: '57',
			name: 'Brecksville',
			frequency: '125.875',
		},
		{
			id: '06',
			name: 'Briggs',
			frequency: '120.600',
		},
		{
			id: '33',
			name: 'Buffalo',
			frequency: '125.200',
		},
		{
			id: '08',
			name: 'Carleton',
			frequency: '127.900',
		},
		{
			id: '50',
			name: 'Clarion',
			frequency: '126.725',
		},
		{
			id: '69',
			name: 'Clarksburg',
			frequency: '135.175',
		},
		{
			id: '36',
			name: 'Dansville',
			frequency: '118.625',
		},
		{
			id: '20',
			name: 'Dresden',
			frequency: '132.250',
		},
		{
			id: '70',
			name: 'Dunkirk',
			frequency: '127.075',
		},
		{
			id: '16',
			name: 'Flint',
			frequency: '127.700',
		},
		{
			id: '59',
			name: 'Franklin',
			frequency: '119.725',
		},
		{
			id: '19',
			name: 'Gamble',
			frequency: '126.525',
		},
		{
			id: '45',
			name: 'Geauga',
			frequency: '120.325',
		},
		{
			id: '27',
			name: 'Hudson',
			frequency: '134.775',
		},
		{
			id: '67',
			name: 'Imperial',
			frequency: '132.125',
		},
		{
			id: '14',
			name: 'Jackson',
			frequency: '120.450',
		},
		{
			id: '79',
			name: 'Jamestown',
			frequency: '132.925',
		},
		{
			id: '64',
			name: 'Keystone',
			frequency: '134.475',
		},
		{
			id: '26',
			name: 'Lake',
			frequency: '120.075',
		},
		{
			id: '12',
			name: 'Lansing',
			frequency: '126.750',
		},
		{
			id: '15',
			name: 'Litchfield',
			frequency: '134.650',
		},
		{
			id: '49',
			name: 'Lorain',
			frequency: '133.375',
		},
		{
			id: '04',
			name: 'Mansfield',
			frequency: '134.900',
		},
		{
			id: '46',
			name: 'Marblehead',
			frequency: '135.375',
		},
		{
			id: '03',
			name: 'Marion',
			frequency: '135.100',
		},
		{
			id: '55',
			name: 'Morgantown',
			frequency: '126.950',
		},
		{
			id: '38',
			name: 'Niagara',
			frequency: '120.625',
		},
		{
			id: '58',
			name: 'Palmer',
			frequency: '121.075',
		},
		{
			id: '18',
			name: 'Peck',
			frequency: '133.875',
		},
		{
			id: '31',
			name: 'Rochester',
			frequency: '127.475',
		},
		{
			id: '07',
			name: 'Sandusky',
			frequency: '127.675',
		},
		{
			id: '39',
			name: 'Steuben',
			frequency: '119.375',
		},
		{
			id: '29',
			name: 'Wayne',
			frequency: '133.525',
		},
		{
			id: '21',
			name: 'Windsor',
			frequency: '132.450',
		},
		{
			id: '75',
			name: 'Youngstown',
			frequency: '120.775',
		},
	],
	zid: [
		{
			id: '83',
			name: 'Falmouth',
			frequency: '128.225',
		},
		{
			id: '87',
			name: 'Appleton',
			frequency: '132.825',
		},
		{
			id: '86',
			name: 'Beckley',
			frequency: '124.575',
		},
		{
			id: '85',
			name: 'Charleston',
			frequency: '119.525',
		},
		{
			id: '30',
			name: 'Columbus',
			frequency: '124.450',
		},
		{
			id: '22',
			name: 'Covington',
			frequency: '123.925',
		},
		{
			id: '88',
			name: 'Dayton',
			frequency: '120.575',
		},
		{
			id: '17',
			name: 'Evansville',
			frequency: '128.300',
		},
		{
			id: '25',
			name: 'Hazard',
			frequency: '126.575',
		},
		{
			id: '89',
			name: 'Indy',
			frequency: '133.425',
		},
		{
			id: '80',
			name: 'King',
			frequency: '134.175',
		},
		{
			id: '20',
			name: 'Lexington',
			frequency: '126.375',
		},
		{
			id: '21',
			name: 'London',
			frequency: '124.625',
		},
		{
			id: '82',
			name: 'Louisville',
			frequency: '133.050',
		},
		{
			id: '31',
			name: 'Lytle',
			frequency: '120.475',
		},
		{
			id: '66',
			name: 'Madison',
			frequency: '128.375',
		},
		{
			id: '33',
			name: 'Muncie',
			frequency: '124.525',
		},
		{
			id: '18',
			name: 'Nabb',
			frequency: '124.775',
		},
		{
			id: '19',
			name: 'New Hope',
			frequency: '121.175',
		},
		{
			id: '24',
			name: 'Parkersburg',
			frequency: '125.550',
		},
		{
			id: '69',
			name: 'Pike',
			frequency: '135.575',
		},
		{
			id: '81',
			name: 'Pocket City',
			frequency: '132.525',
		},
		{
			id: '84',
			name: 'Rebel',
			frequency: '134.675',
		},
		{
			id: '26',
			name: 'River',
			frequency: '124.225',
		},
		{
			id: '32',
			name: 'Rosewood',
			frequency: '128.075',
		},
		{
			id: '75',
			name: 'Rushville',
			frequency: '125.125',
		},
		{
			id: '34',
			name: 'Shelbyville',
			frequency: '119.550',
		},
		{
			id: '35',
			name: 'Terre Haute',
			frequency: '132.200',
		},
		{
			id: '77',
			name: 'University',
			frequency: '125.075',
		},
	],
};

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
			zid: {
				high: ZID_High,
				low: ZID_Low,
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

router.get('/active', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const retval = {} as any;

		const keys = await req.app.redis.keys(`split:g:*`);

		if (keys.length === 0) {
			throwInternalServerErrorException('Split not set');
		}

		for (const key of keys) {
			const val = await req.app.redis.get(key);
			if (key.startsWith('split:g:high:')) {
				retval[key.replace('split:g:high:', '')] = val;
			} else if (key.startsWith('split:g:low:')) {
				retval[key.replace('split:g:low:', '')] = val;
			}
		}

		return res.status(status.OK).json({
			geojson: {
				high: ZAU_High,
				low: ZAU_Low,
			},
			ownership: retval,
		});
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
		zid: {},
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
		} else if (key.startsWith('split:i:')) {
			retval.zid[key.replace('split:i:', '')] = val;
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
