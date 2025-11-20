import { captureException } from '@sentry/node';
import axios from 'axios';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Redis } from 'ioredis';
import zau from '../../helpers/zau.js';
import { ConfigModel } from '../../models/config.js';
import { PirepModel } from '../../models/pirep.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();

router.post('/checktoken', async (req: Request, res: Response, next: NextFunction) => {
	const idsToken = req.body.token;
	try {
		if (!idsToken) {
			throw {
				code: status.BAD_REQUEST,
				message: 'No IDS token specified',
			};
		}

		const user = await UserModel.findOne({ idsToken: idsToken })
			.select('-email -idsToken')
			.lean()
			.cache('10 minutes', `ids-${idsToken}`)
			.exec();
		if (!user) {
			throw {
				code: status.FORBIDDEN,
				message: 'Invalid IDS token',
			};
		}

		return res.status(status.OK).json(user);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		e;

		return next(e);
	}
});

router.get('/aircraft', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const pilots = (await req.app.redis.get('pilots')) || '';

		return res.status(status.OK).json(pilots.split('|'));
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/aircraft/feed', (req: Request, res: Response, next: NextFunction) => {
	try {
		const sub = new Redis(process.env['REDIS_URI']!);

		res.writeHead(status.OK, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		});

		sub.subscribe('PILOT:UPDATE', 'PILOT:DELETE');
		sub.on('message', async (channel: string, message: any) => {
			if (channel === 'PILOT:UPDATE') {
				let data = await req.app.redis.hgetall(`PILOT:${message}`);
				data['type'] = 'update';
				res.write(`data: ${JSON.stringify(data)}\n\n`);
			}
			if (channel === 'PILOT:DELETE') {
				res.write(
					`data: ${JSON.stringify({
						type: 'delete',
						callsign: message,
					})}\n\n`,
				);
			}
		});

		res.on('close', () => {
			sub.disconnect();
		});
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/aircraft/:callsign', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const data = await req.app.redis.hgetall(`PILOT:${req.params['callsign']}`);

		return res.status(status.OK).json(data);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/atis', (req: Request, res: Response, next: NextFunction) => {
	try {
		const sub = new Redis(process.env['REDIS_URI']!);

		res.writeHead(status.OK, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		});

		sub.subscribe('ATIS:UPDATE', 'ATIS:DELETE');
		sub.on('message', async (channel, message) => {
			if (channel === 'ATIS:UPDATE') {
				let data = await req.app.redis.hgetall(`ATIS:${message}`);
				data['type'] = 'update';
				res.write(`data: ${JSON.stringify(data)}\n\n`);
			}
			if (channel === 'ATIS:DELETE') {
				res.write(
					`data: ${JSON.stringify({
						type: 'delete',
						station: message,
					})}\n\n`,
				);
			}
		});

		res.on('close', () => {
			// sub.unsubscribe('ATIS:UPDATE', 'ATIS:DELETE');
			sub.disconnect();
		});
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

const acceptableAirports = zau.airports;
router.post('/vatis', async (req: Request, res: Response, next: NextFunction) => {
	try {
		console.log('Received POST request at /vatis');
		console.log('Request body: ', req.body);

		const { Facility, Preset, AtisLetter, AirportConditions, Notams, Timestamp, Version } =
			req.body;

		// check that all required fields are present
		if (!Facility || !Preset || !AtisLetter || !AirportConditions) {
			console.log('Missing required fields');
			return res.status(status.BAD_REQUEST).send({ error: 'Missing required fields' });
		}

		// check that Facility is in the list of acceptable airports
		if (!acceptableAirports.includes(Facility)) {
			console.log(`Invalid airport: ${Facility}`);
			return res.status(status.BAD_REQUEST).send({ error: `Invalid airport: ${Facility}` });
		}
		console.log('Facility is present and acceptable');

		let redisAtis: string | null | string[] = await req.app.redis.get('AtisLetter');
		console.log('Retrieved ATIS from Redis: ', redisAtis);

		redisAtis = redisAtis && redisAtis.length ? redisAtis.split('|') : [];
		redisAtis.push(Facility);
		req.app.redis.set('atis', redisAtis.join('|'));
		req.app.redis.expire(`atis`, 65);

		req.app.redis.hmset(
			`ATIS:${Facility}`,
			'station',
			Facility,
			'letter',
			AtisLetter,
			'preset',
			Preset,
			'airport_conditions',
			AirportConditions,
			'notams',
			Notams,
			'timestamp',
			Timestamp,
			'version',
			Version,
		);
		req.app.redis.expire(`atis`, 65);
		req.app.redis.publish('ATIS:UPDATE', Facility);

		console.log('Successfully processed the request and set the ATIS in Redis');
		return res.status(status.OK).json();
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/stations', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const airports = await req.app.redis.get('airports');
		if (!airports) return res.json([]);

		return res.status(status.OK).json(airports.split('|'));
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/stations/:station', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const station = req.params['station']!;
		const metar = await req.app.redis.get(`METAR:${station.toUpperCase()}`);
		const atisInfo = await req.app.redis.hgetall(`ATIS:${station}`);

		return res.status(status.OK).json({
			metar,
			dep: atisInfo['dep'] || null,
			arr: atisInfo['arr'] || null,
			letter: atisInfo['letter'] || null,
		});
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/neighbors', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const neighbors = (await req.app.redis.get('neighbors')) || '';

		return res.status(status.OK).json(neighbors.length ? neighbors.split('|') : '');
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/pireps', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const pirep = await PirepModel.find().sort('-reportTime').lean().exec();

		return res.status(status.OK).json(pirep);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/vatsim-data', (_req: Request, res: Response, next: NextFunction) => {
	try {
		axios
			.get('https://status.vatsim.net/status.json')
			.then((response) => {
				const apiUrl = response.data.data.v3[0];
				axios
					.get(apiUrl)
					.then((vatsimResponse) => {
						res.status(status.OK).json(vatsimResponse.data);
					})
					.catch((error) => {
						console.error(error);
						res.status(status.INTERNAL_SERVER_ERROR).send('Error fetching data from external API.');
					});
			})
			.catch((error) => {
				console.error(error);
				res.status(status.INTERNAL_SERVER_ERROR).send('Error fetching data from external API.');
			});
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/charts/:airportCode', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const airportCode = req.params['airportCode']!.toUpperCase();
		const response = await axios.get(`https://api.aviationapi.com/v1/charts?apt=${airportCode}`);
		const charts = response.data[airportCode];

		return res.status(status.OK).json(charts);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.post('/pireps', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (req.body.ua === undefined || req.body.ov === undefined) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Missing UA or OV',
			};
		}

		await PirepModel.create({
			reportTime: new Date().getTime(),
			location: req.body.ov,
			aircraft: req.body.tp,
			flightLevel: req.body.fl,
			skyCond: req.body.sk,
			turbulence: req.body.tb,
			icing: req.body.ic,
			vis: req.body.wx,
			temp: req.body.ta,
			wind: req.body.wv,
			urgent: req.body.ua === 'UUA' ? true : false,
			manual: true,
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.delete('/pireps/:id', async (req: Request, res: Response, next: NextFunction) => {
	try {
		await PirepModel.findByIdAndDelete(req.params['id']).exec();

		return res.status(status.NO_CONTENT).json();
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.put('/config/:id', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const updatedConfig = await ConfigModel.findOneAndUpdate({ _id: req.params['id'] }, req.body, {
			new: true,
		}).exec();

		if (!updatedConfig) {
			throw {
				code: status.NOT_FOUND,
				message: 'Config not found',
			};
		}

		return res.status(status.OK).json(updatedConfig);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/config/:id', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const config = await ConfigModel.findOne({ _id: req.params['id'] }).exec();
		if (!config) {
			throw {
				code: status.NOT_FOUND,
				message: 'Config not found',
			};
		}

		return res.status(status.OK).json(config);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

export default router;
