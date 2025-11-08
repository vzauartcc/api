import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { hasRole } from '../middleware/auth.js';
import getUser from '../middleware/user.js';
import { DossierModel } from '../models/dossier.js';
import { NewsModel } from '../models/news.js';
import status from '../types/status.js';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 20;

		const amount = await NewsModel.countDocuments({ deleted: false }).exec();
		const news = await NewsModel.find({ deleted: false })
			.sort({ createdAt: 'desc' })
			.skip(limit * (page - 1))
			.limit(limit)
			.populate('user', ['fname', 'lname'])
			.lean()
			.exec();

		return res.status(status.OK).json({ amount, news });
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.post(
	'/',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ec', 'fe', 'wm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.body || !req.body.title || !req.body.content) {
				throw {
					code: status.BAD_REQUEST,
					message: 'You must fill out all required forms',
				};
			}
			const { title, content, createdBy } = req.body;
			const uriSlug =
				title
					.replace(/\s+/g, '-')
					.toLowerCase()
					.replace(/^-+|-+(?=-|$)/g, '')
					.replace(/[^a-zA-Z0-9-_]/g, '') +
				'-' +
				Date.now().toString().slice(-5);

			const news = await NewsModel.create({
				title,
				content,
				uriSlug,
				createdBy,
			});

			if (!news) {
				throw {
					code: status.INTERNAL_SERVER_ERROR,
					message: 'Something went wrong, please try again',
				};
			}

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b created the news item *${req.body.title}*.`,
			});

			return res.status(status.CREATED).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const newsItem = await NewsModel.findOne({ uriSlug: req.params['slug'] })
			.populate('user', 'fname lname')
			.lean()
			.exec();

		if (!newsItem) {
			throw {
				code: status.NOT_FOUND,
				message: 'News item not found',
			};
		}

		return res.status(status.OK).json(newsItem);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.put(
	'/:slug',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ec', 'fe', 'wm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { title, content } = req.body;
			const newsItem = await NewsModel.findOne({ uriSlug: req.params['slug'] }).exec();
			if (!newsItem) {
				throw {
					code: status.NOT_FOUND,
					message: 'News Not Found',
				};
			}

			if (newsItem.title !== title) {
				newsItem.title = title;
				newsItem.uriSlug =
					title
						.replace(/\s+/g, '-')
						.toLowerCase()
						.replace(/^-+|-+(?=-|$)/g, '')
						.replace(/[^a-zA-Z0-9-_]/g, '') +
					'-' +
					Date.now().toString().slice(-5);
			}

			newsItem.content = content;
			await newsItem.save();

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b updated the news item *${newsItem.title}*.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.delete(
	'/:slug',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ec', 'fe', 'wm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const newsItem = await NewsModel.findOne({ uriSlug: req.params['slug'] }).exec();
			if (!newsItem) {
				throw {
					code: status.NOT_FOUND,
					message: 'News Not Found',
				};
			}

			const deleted = await newsItem.delete();

			if (!deleted) {
				throw {
					code: status.INTERNAL_SERVER_ERROR,
					message: 'Something went wrong, please try again',
				};
			}

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b deleted the news item *${newsItem.title}*.`,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

export default router;
