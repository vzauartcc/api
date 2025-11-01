import * as Sentry from '@sentry/node';
import cookie from 'cookie-parser';
import cors from 'cors';
import { Cron } from 'croner';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import controllerRouter from './controllers/controller.js';
import discordRouter from './controllers/discord.js';
import eventRouter from './controllers/event.js';
import examRouter from './controllers/exam.js';
import feedbackRouter from './controllers/feedback.js';
import fileRouter from './controllers/file.js';
import idsRouter from './controllers/ids.js';
import newsRouter from './controllers/news.js';
import onlineRouter from './controllers/online.js';
import statsRouter from './controllers/stats.js';
import trainingRouter from './controllers/training.js';
import userRouter from './controllers/user.js';
import vatusaRouter from './controllers/vatusa.js';
import { setupS3 } from './helpers/s3.js';
import { soloExpiringNotifications, syncVatusaSoloEndorsements } from './tasks/solo.js';
import { syncVatusaTrainingRecords } from './tasks/trainingRecords.js';
import type { ReturnDetails } from './types/StandardResponse.js';

console.log(`Starting application. . . .`);
const app = express();

app.use((_req: Request, res: Response, next: NextFunction) => {
	res.stdRes = {
		ret_det: {
			code: 200,
			message: '',
		},
		data: {},
	};

	next();
});

console.log('Enabling cookie parsing. . . .');
app.use(cookie());

console.log('Setting JSON and URL Encode limits. . . .');
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
app.redis = new Redis(REDIS_URI);
app.redis.on('error', (err) => {
	throw new Error(`Failed to connect to Redis: ${err}`);
});
app.redis.on('connect', () => console.log('Successfully connected to Redis'));

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
	}),
);

console.log('Setting Access Control headers. . . .');
app.use((_req: Request, res: Response, next: NextFunction) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
	res.setHeader('Access-Control-Allow-Credentials', 'true');
	next();
});

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
mongoose.connect(MONGO_URI);
const db = mongoose.connection;
db.once('open', () => console.log('Successfully connected to MongoDB'));

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

// Sentry error capturing should be after all routes are registered.
if (process.env['NODE_ENV'] === 'production') {
	console.log('Setting up Sentry Express error handler. . . .');
	Sentry.setupExpressErrorHandler(app);
}
console.log('Is Sentry initialized and enabled', Sentry.isInitialized(), Sentry.isEnabled());

// Future use: Fallback express error handler
// app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
// 	if (res.headersSent) {
// 		return next(err);
// 	}

// 	res.status(err.status || 500).json({
// 		message: 'An internal server error occurred.',
// 	});
// });

console.log('Starting Express listener. . . .');
app.listen(process.env['PORT'], () => {
	console.log('Listening on port ' + process.env['PORT']);
});

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

export function convertToReturnDetails(e: unknown): ReturnDetails {
	// 1. Check if 'e' is a standard Error object
	if (e instanceof Error) {
		// Return a generic error structure
		return {
			code: 500, // Use a standard server error code
			message: e.message || 'An unexpected server error occurred.',
		};
	}

	// 2. Check if 'e' is an object that already looks like ReturnDetails (e.g., a thrown response object)
	else if (
		typeof e === 'object' &&
		e !== null &&
		'code' in e &&
		'message' in e &&
		typeof (e as any).code === 'number' &&
		typeof (e as any).message === 'string'
	) {
		// If it's a known, structured object, use its properties
		return e as ReturnDetails;
	}

	// 3. Fallback for primitive/unknown types (e.g., throw "a string")
	else {
		return {
			code: 500,
			message: `An unexpected error occurred: ${String(e)}`,
		};
	}
}
