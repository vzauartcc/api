import * as Sentry from '@sentry/node';
import cookie from 'cookie-parser';
import cors from 'cors';
import { Cron } from 'croner';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import helmet from 'helmet';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import cache from 'ts-cache-mongoose';
import controllerRouter from './controllers/controller/controller.js';
import discordRouter from './controllers/discord/discord.js';
import eventRouter from './controllers/event/event.js';
import examRouter from './controllers/exam/exam.js';
import feedbackRouter from './controllers/feedback/feedback.js';
import fileRouter from './controllers/file/file.js';
import idsRouter from './controllers/ids/ids.js';
import newsRouter from './controllers/news/news.js';
import onlineRouter from './controllers/online/online.js';
import splitRouter, { resetSplit } from './controllers/split/split.js';
import statsRouter from './controllers/stats/stats.js';
import trainingRouter from './controllers/training/training.js';
import userRouter from './controllers/user/user.js';
import vatusaRouter from './controllers/vatusa/vatusa.js';
import { clearCacheKeys, parseRedisConnectionString, setRedis } from './helpers/redis.js';
import { setupS3 } from './helpers/s3.js';
import zau from './helpers/zau.js';
import { soloExpiringNotifications, syncVatusaSoloEndorsements } from './tasks/solo.js';
import { syncVatusaTrainingRecords } from './tasks/trainingRecords.js';

console.log(`Starting application. . . .`);
const app = express();

app.set('trust proxy', true);

app.use(cookie());

app.use(express.json({ limit: '50mb' }));

app.use(
	express.urlencoded({
		limit: '50mb',
		extended: true,
		parameterLimit: 50000,
	}),
);

const REDIS_URI = process.env['REDIS_URI'];

if (!REDIS_URI) {
	throw new Error('REDIS_URI is not set in environment variables.');
}

console.log('Connecting to redis. . . .');
app.redis = new Redis(REDIS_URI, { family: 4, connectionName: 'api' });
app.redis.on('error', (err) => {
	throw new Error(`Redis error: ${err}`);
});
app.redis.on('connect', () => {
	console.log('Successfully connected to Redis');
	setRedis(app.redis);
	clearCacheKeys();
});

const CORS_ORIGIN = process.env['CORS_ORIGIN'];

if (!CORS_ORIGIN) {
	throw new Error('CORS_ORIGIN is not set in environment variables.');
}
const origins = CORS_ORIGIN.split('|');

console.log('Allowing CORS origins. . . .');
app.use(
	cors({
		origin: origins,
		credentials: true,
		maxAge: 86400,
		allowedHeaders: ['Content-Type', 'Accept', 'X-Requested-With'],
		methods: 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
	}),
);

app.use(helmet());

console.log('Connecting to S3 bucket. . . .');
setupS3();

const MONGO_URI = process.env['MONGO_URI'];

if (!MONGO_URI) {
	throw new Error('MONGO_URI is not est in environment variables.');
}

console.log('Connecting to MongoDB. . . .');
// Connect to MongoDB
mongoose.set('toJSON', { virtuals: true });
mongoose.set('toObject', { virtuals: true });
mongoose.set('strictQuery', true);
mongoose.connect(MONGO_URI, { family: 4 });
const db = mongoose.connection;
db.once('open', () => console.log('Successfully connected to MongoDB'));
db.on('error', (err) => {
	console.error('Mongoose error:', err);
});

// Set up MongoDB cache in Redis
const cacheInstance = cache.init(mongoose, {
	defaultTTL: '60 seconds',
	engine: 'redis',
	engineOptions: {
		...parseRedisConnectionString(REDIS_URI),
		connectionName: 'mongodb-cache',
		family: 4,
	},
	debug: zau.isDev,
});

export const getCacheInstance = () => {
	return cacheInstance;
};

// Sentry user middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
	const ips = req.headers['x-original-forwarded-for'];
	let clientIp = req.ip;

	if (typeof ips === 'string') {
		clientIp = ips.split(',')[0]?.trim();
	}

	if (req.user) {
		Sentry.getCurrentScope().setUser({
			id: req.user.cid,
			name: req.user.fname + ' ' + req.user.lname,
			ip: clientIp,
		});
	} else {
		Sentry.getCurrentScope().setUser({
			id: -1,
			name: 'Unauthenticated User',
			ip: clientIp,
		});
	}

	return next();
});

console.log('Setting up routes. . . .');
app.use('/online', onlineRouter);
app.use('/user', userRouter);
app.use('/controller', controllerRouter);
app.use('/news', newsRouter);
app.use('/event', eventRouter);
app.use('/file', fileRouter);
app.use('/feedback', feedbackRouter);
app.use('/ids', idsRouter);
app.use('/training', trainingRouter);
app.use('/discord', discordRouter);
app.use('/stats', statsRouter);
app.use('/exam', examRouter);
app.use('/vatusa', vatusaRouter);
app.use('/split', splitRouter);

// Sentry error capturing should be after all routes are registered.
if (process.env['NODE_ENV'] === 'production') {
	console.log('Setting up Sentry Express error handler. . . .');
	Sentry.setupExpressErrorHandler(app);
}
console.log('Is Sentry initialized and enabled', Sentry.isInitialized(), Sentry.isEnabled());

export function logException(e: any) {
	if (e.code) {
		return;
	}

	Sentry.captureException(e);
}
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
	if (res.headersSent) {
		return next(err);
	}

	if (err.status && typeof err.status !== 'number') {
		err.status = 500;
	}

	if (err.code && typeof err.code !== 'number') {
		err.code = 500;
	}

	res.status(err.status || err.code || 500).json({
		message: err.message || 'An internal server error occurred.',
	});
});

console.log('Starting Express listener. . . .');
app.listen(process.env['PORT'], () => {
	console.log('Listening on port ' + process.env['PORT']);
});

console.log(`Starting Reset Split task. . . .`);
new Cron('0 9 * * *', { name: 'Reset Split Map', timezone: 'Etc/UTC', catch: true }, () =>
	resetSplit(app.redis),
);

console.log(`Starting Solo Expiration Notification task. . . .`);
new Cron(
	'0 0 * * *',
	{ name: 'Solo Expiration Notifications', timezone: 'Etc/UTC', catch: true },
	() => soloExpiringNotifications(),
);

console.log(`Starting VATUSA Solo Endorsement Sync task. . . .`);
new Cron('0 * * * *', { name: 'Solo Endorsement Sync', catch: true }, () =>
	syncVatusaSoloEndorsements(),
);

if (process.env['NODE_ENV'] === 'production') {
	console.log(`Starting VATUSA Training Records Sync task. . . .`);
	new Cron(
		'0 6 * * *',
		{ name: 'Training Record Sync', timezone: 'America/Chicago', catch: true },
		() => syncVatusaTrainingRecords(),
	);
}

process.on('uncaughtException', (err: any, _origin) => {
	console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
	console.log('                 Uncaught Exception               ');
	console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
	console.error(err);
});

process.on('unhandledRejection', (reason) => {
	console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
	console.log('                Unhandled Rejection               ');
	console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
	console.error(reason);
});
