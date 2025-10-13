// Core imports
import express from 'express';
import * as Sentry from '@sentry/node';
import * as Tracing from '@sentry/tracing';
import cookie from 'cookie-parser';
import cors from 'cors';
import env from 'dotenv';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import { S3Client } from '@aws-sdk/client-s3';

// Route Controllers
import UserController from './controllers/UserController.js';
import ControllerController from './controllers/ControllerController.js';
import OnlineController from './controllers/OnlineController.js';
import NewsController from './controllers/NewsController.js';
import EventController from './controllers/EventController.js';
import FileController from './controllers/FileController.js';
import FeedbackController from './controllers/FeedbackController.js';
import IdsController from './controllers/IdsController.js';
import TrainingController from './controllers/TrainingController.js';
import DiscordController from './controllers/DiscordController.js';
import StatsController from './controllers/StatsController.js';
import ExamController from './controllers/ExamController.js';

// Global Dossier Model
import Dossier from './models/Dossier.js';

env.config();

// Setup Express
const app = express();

app.use((req, res, next) => {
	if (
		req.originalUrl.includes('favicon') ||
		req.originalUrl.includes('/online') ||
		req.originalUrl.includes('/ids/')
	)
		return next();

	const start = process.hrtime.bigint();

	const logRequestDuration = () => {
		const durationNs = process.hrtime.bigint() - start;

		const durationMs = Number(durationNs) / 1_000_000;

		console.log(
			`[Timer] ${req.method} ${req.originalUrl} - Status ${res.statusCode} - ${durationMs.toFixed(3)}ms`,
		);

		res.removeListener('finish', logRequestDuration);
		res.removeListener('close', logRequestDuration);
	};

	res.on('finish', logRequestDuration);
	res.on('close', logRequestDuration);

	next();
});

if (process.env.NODE_ENV === 'production') {
	Sentry.init({
		environment: 'production',
		dsn: 'https://8adabf3b372b4ca6ba303c6271c85288@o4504206002094080.ingest.sentry.io/4504223524847617',
		integrations: [
			new Sentry.Integrations.Http({ tracing: true }),
			new Tracing.Integrations.Express({
				app,
			}),
		],
		tracesSampleRate: 0.5,
	});

	app.use(Sentry.Handlers.requestHandler());
	app.use(Sentry.Handlers.tracingHandler());
} else {
	app.Sentry = {
		captureException(e) {
			console.log(e);
		},
		captureMessage(m) {
			console.log(m);
		},
	};
}

if (process.env.NODE_ENV === 'bet') {
	Sentry.init({
		environment: 'staging',
		dsn: 'https://8adabf3b372b4ca6ba303c6271c85288@o4504206002094080.ingest.sentry.io/4504223524847617',
		integrations: [
			new Sentry.Integrations.Http({ tracing: true }),
			new Tracing.Integrations.Express({
				app,
			}),
		],
		tracesSampleRate: 0.5,
	});

	app.use(Sentry.Handlers.requestHandler());
	app.use(Sentry.Handlers.tracingHandler());
} else {
	app.Sentry = {
		captureException(e) {
			console.log(e);
		},
		captureMessage(m) {
			console.log(m);
		},
	};
}

app.use((req, res, next) => {
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

app.redis = new Redis(process.env.REDIS_URI);

app.redis.on('error', (err) => {
	throw new Error(`Failed to connect to Redis: ${err}`);
});
app.redis.on('connect', () => console.log('Successfully connected to Redis'));

const origins = process.env.CORS_ORIGIN.split('|');

app.use(
	cors({
		origin: origins,
		credentials: true,
	}),
);

app.use((req, res, next) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
	res.setHeader('Access-Control-Allow-Credentials', true);
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

const prefix = getS3Prefix(); // Get the correct environment folder

app.s3 = new S3Client({
	endpoint: 'https://sfo3.digitaloceanspaces.com', // DigitalOcean Spaces or AWS S3
	region: 'us-east-1', // DigitalOcean Spaces requires a region (choose the closest one)
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	},
});

app.s3.defaultBucket = 'zauartcc'; // ✅ Store the default bucket globally
app.s3.folderPrefix = prefix; // ✅ Store prefix separately

app.dossier = Dossier;

// Connect to MongoDB
mongoose.set('toJSON', { virtuals: true });
mongoose.set('toObject', { virtuals: true });
mongoose.set('strictQuery', true);
mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;
db.once('open', () => console.log('Successfully connected to MongoDB'));

app.use('/online', OnlineController);
app.use('/user', UserController);
app.use('/controller', ControllerController);
app.use('/news', NewsController);
app.use('/event', EventController);
app.use('/file', FileController);
app.use('/feedback', FeedbackController);
app.use('/ids', IdsController);
app.use('/training', TrainingController);
app.use('/discord', DiscordController);
app.use('/stats', StatsController);
app.use('/exam', ExamController);

if (process.env.NODE_ENV === 'production') app.use(Sentry.Handlers.errorHandler());

app.listen(process.env.PORT, () => {
	console.log('Listening on port ' + process.env.PORT);
});
