import { Router, type NextFunction, type Request, type Response } from 'express';
import { sanitizeInput } from '../../helpers/html.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import { isStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { NewsModel } from '../../models/news.js';
import status from '../../types/status.js';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 20;

		const amount = await NewsModel.countDocuments({ deleted: false })
			.cache('5 minutes', 'news-count')
			.exec();
		const news = await NewsModel.find({ deleted: false })
			.sort({ createdAt: 'desc' })
			.skip(limit * (page - 1))
			.limit(limit)
			.populate('user', ['fname', 'lname'])
			.lean()
			.cache('10 minutes')
			.exec();

		return res.status(status.OK).json({ amount, news });
	} catch (e) {
		return next(e);
	}
});

router.post('/', getUser, isStaff, async (req: Request, res: Response, next: NextFunction) => {
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
			content: sanitizeInput(content),
			uriSlug,
			createdBy,
		});

		await clearCachePrefix('news');

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
			actionType: ACTION_TYPE.CREATE_NEWS,
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		return next(e);
	}
});

router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['slug'] || req.params['slug'] === 'undefined') {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid news slug.',
			};
		}

		const newsItem = await NewsModel.findOne({ uriSlug: req.params['slug'] })
			.populate('user', 'fname lname')
			.lean()
			.cache('10 minutes', `news-${req.params['slug']}`)
			.exec();

		if (!newsItem) {
			throw {
				code: status.NOT_FOUND,
				message: 'News item not found',
			};
		}

		return res.status(status.OK).json(newsItem);
	} catch (e) {
		return next(e);
	}
});

router.patch(
	'/:slug',
	getUser,
	isStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['slug'] || req.params['slug'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid news slug.',
				};
			}

			const { title, content } = req.body;
			const newsItem = await NewsModel.findOne({ uriSlug: req.params['slug'] })
				.cache('10 minutes', `news-${req.params['slug']}`)
				.exec();
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

			newsItem.content = sanitizeInput(content);
			await newsItem.save();

			await clearCachePrefix('news');

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b updated the news item *${newsItem.title}*.`,
				actionType: ACTION_TYPE.UPDATE_NEWS,
			});

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.delete(
	'/:slug',
	getUser,
	isStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['slug'] || req.params['slug'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid news slug.',
				};
			}

			const newsItem = await NewsModel.findOne({ uriSlug: req.params['slug'] })
				.cache('10 minutes', `news-${req.params['slug']}`)
				.exec();
			if (!newsItem) {
				throw {
					code: status.NOT_FOUND,
					message: 'News Not Found',
				};
			}

			const deleted = await newsItem.delete();

			await clearCachePrefix('news');

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
				actionType: ACTION_TYPE.DELETE_NEWS,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			return next(e);
		}
	},
);

export default router;
