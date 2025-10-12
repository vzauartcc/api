import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/node';
import cookie from 'cookie-parser';
import cors from 'cors';
import env from 'dotenv';
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
import { DossierModel } from './models/dossier.js';
import type { ReturnDetails } from './types/StandardResponse.js';

env.config();

const app = express();

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
	Sentry.init({
		dsn: SENTRY_DSN,
		tracesSampleRate: 1.0,
	});
}

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

app.use(cookie());

app.use(express.json({ limit: '50mb' }));

app.use(
	express.urlencoded({
		limit: '50mb',
		extended: true,
		parameterLimit: 50000,
	}),
);

const REDIS_URI = process.env.REDIS_URI;

if (!REDIS_URI) {
	throw new Error('REDIS_URI is not set in environment variables.');
}

app.redis = new Redis(REDIS_URI);
app.redis.on('error', (err) => {
	throw new Error(`Failed to connect to Redis: ${err}`);
});
app.redis.on('connect', () => console.log('Successfully connected to Redis'));

const CORS_ORIGIN = process.env.CORS_ORIGIN;

if (!CORS_ORIGIN) {
	throw new Error('CORS_ORIGIN is not set in environment variables.');
}
const origins = CORS_ORIGIN.split('|');

app.use(
	cors({
		origin: origins,
		credentials: true,
	}),
);

app.use((_req: Request, res: Response, next: NextFunction) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
	res.setHeader('Access-Control-Allow-Credentials', 'true');
	next();
});

function getS3Prefix() {
	switch (process.env.S3_FOLDER_PREFIX) {
		case 'production':
			return 'production';
		case 'staging':
			return 'staging';
		default:
			return 'development';
	}
}

const S3_PREFIX = getS3Prefix(); // Get the correct environment folder

const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
	throw new Error(
		'AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is not set in environment variables.',
	);
}

app.s3 = new S3Client({
	endpoint: 'https://sfo3.digitaloceanspaces.com', // DigitalOcean Spaces or AWS S3
	region: 'us-east-1', // DigitalOcean Spaces requires a region (choose the closest one)
	credentials: {
		accessKeyId: AWS_ACCESS_KEY_ID,
		secretAccessKey: AWS_SECRET_ACCESS_KEY,
	},
});

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
	throw new Error('MONGO_URI is not est in environment variables.');
}

app.dossier = DossierModel;

// Connect to MongoDB
mongoose.set('toJSON', { virtuals: true });
mongoose.set('toObject', { virtuals: true });
mongoose.set('strictQuery', true);
mongoose.connect(MONGO_URI);
const db = mongoose.connection;
db.once('open', () => console.log('Successfully connected to MongoDB'));

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

if (process.env.NODE_ENV === 'production' && SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

app.listen(process.env.PORT, () => {
	console.log('Listening on port ' + process.env.PORT);
});

export function convertToReturnDetails(e: unknown): ReturnDetails {
	console.trace(e);
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

export function uploadToS3(filename: string, tmpFile: any, mime: string, options = {}) {
	return app.s3.send(
		new PutObjectCommand({
			...options,
			Bucket: 'zauartcc',
			Key: `${S3_PREFIX}/${filename}`,
			Body: tmpFile,
			ContentType: mime,
			ACL: 'public-read',
		}),
	);
}
