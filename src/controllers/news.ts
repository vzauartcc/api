import { Router, type Request, type Response } from 'express';
import { convertToReturnDetails } from '../app.js';
import { hasRole } from '../middleware/auth.js';
import getUser from '../middleware/user.js';
import { NewsModel } from '../models/news.js';

const router = Router();

// @TODO: convert to StandardResponse
router.get('/', async (req: Request, res: Response) => {
	const page = +(req.query.page as string) || 1;
	const limit = +(req.query.limit as string) || 20;

	const amount = await NewsModel.countDocuments({ deleted: false }).exec();
	const news = await NewsModel.find({ deleted: false })
		.sort({ createdAt: 'desc' })
		.skip(limit * (page - 1))
		.limit(limit)
		.populate('user', ['fname', 'lname'])
		.lean()
		.exec();

	res.stdRes.data = {
		amount,
		data: news,
	};

	return res.json(res.stdRes);
});

router.post(
	'/',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ec', 'fe', 'wm']),
	async (req: Request, res: Response) => {
		try {
			if (!req.body || !req.body.title || !req.body.content) {
				throw {
					code: 400,
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
					code: 500,
					message: 'Something went wrong, please try again',
				};
			}

			await req.app.dossier.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b created the news item *${req.body.title}*.`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.get('/:slug', async (req, res) => {
	try {
		const newsItem = await NewsModel.findOne({ uriSlug: req.params.slug })
			.populate('user', 'fname lname')
			.lean()
			.exec();

		res.stdRes.data = newsItem;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.put(
	'/:slug',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ec', 'fe', 'wm']),
	async (req: Request, res: Response) => {
		try {
			const { title, content } = req.body;
			const newsItem = await NewsModel.findOne({ uriSlug: req.params.slug }).exec();
			if (!newsItem) {
				throw {
					code: 404,
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
			await req.app.dossier.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b updated the news item *${newsItem.title}*.`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.delete(
	'/:slug',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ec', 'fe', 'wm']),
	async (req: Request, res: Response) => {
		try {
			const newsItem = await NewsModel.findOne({ uriSlug: req.params.slug }).exec();
			if (!newsItem) {
				throw {
					code: 404,
					message: 'News Not Found',
				};
			}

			const status = await newsItem.delete();

			if (!status) {
				throw {
					code: 500,
					message: 'Something went wrong, please try again',
				};
			}

			await req.app.dossier.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b deleted the news item *${newsItem.title}*.`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

export default router;
