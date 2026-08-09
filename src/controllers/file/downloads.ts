import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance } from '../../app.js';
import {
	throwBadRequestException,
	throwForbiddenException,
	throwNotFoundException,
} from '../../helpers/errors.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import { deleteFromS3, generateS3SignedUrl } from '../../helpers/s3.js';
import { isStaff } from '../../middleware/auth.js';
import getUser, { isUserValid } from '../../middleware/user.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { DownloadModel } from '../../models/download.js';
import status from '../../types/status.js';

const router = Router();
const DOWNLOAD_SIZE_LIMIT = 500 * 1024 * 1024;

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const downloads = await DownloadModel.find({ deletedAt: null })
			.sort({ category: 'asc', name: 'asc' })
			.lean()
			.cache('5 minutes', 'downloads')
			.exec();

		// Load user onto req, if logged in
		await isUserValid(req);

		if (req.user && req.user.isTrainingStaff) {
			return res.status(status.OK).json(downloads);
		}

		return res
			.status(status.OK)
			.json(downloads.filter((d) => d.category !== 'ins' && d.category !== 'insguides'));
	} catch (e) {
		return next(e);
	}
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['id'] || req.params['slug'] === 'undefined') {
			throwBadRequestException('Invalid ID');
		}

		const download = await DownloadModel.findById(req.params['id'])
			.lean()
			.cache('5 minutes', `download-${req.params['id']}`)
			.exec();

		if (!download) {
			throwNotFoundException('Download Not Found');
		}

		// Load user onto req, if logged in
		await isUserValid(req);

		if (
			(download.category === 'ins' || download.category === 'insguides') &&
			req.user &&
			!req.user.isTrainingStaff
		) {
			throwForbiddenException('You are not authorized to access this');
		}

		return res.status(status.OK).json(download);
	} catch (e) {
		return next(e);
	}
});

router.post('/', getUser, isStaff, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.body.category) {
			throwBadRequestException('Invalid category');
		}
		if (!req.body.fileType) {
			throwBadRequestException('Missing file');
		}

		const allowedTypes = [
			'application/pdf',
			'application/zip',
			'application/x-zip-compressed',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		];

		if (!req.body.fileType || !allowedTypes.includes(req.body.fileType)) {
			throwBadRequestException('File type is not supported');
		}

		if (!req.body.fileName) {
			throwBadRequestException('File name is required');
		}

		if (!req.body.fileSize) {
			throwBadRequestException('File size is required');
		}

		if (!/^\d+$/.test(String(req.body.fileSize))) {
			throwBadRequestException('Invalid file size');
		}

		const fileSize = Number(String(req.body.fileSize));
		if (fileSize < 1 || fileSize >= DOWNLOAD_SIZE_LIMIT) {
			throwBadRequestException(`File must be less than ${DOWNLOAD_SIZE_LIMIT / 1024 / 1024} MB`);
		}

		const fileName = `${Date.now()}-${req.body.fileName}`;
		const s3Url = await generateS3SignedUrl(`downloads/${fileName}`, req.body.fileType, fileSize);

		await DownloadModel.create({
			name: req.body.name,
			description: req.body.description,
			fileName: fileName,
			category: req.body.category,
			author: req.user.cid,
		});

		await getCacheInstance().clear('downloads');

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b created the file *${req.body.name}*.`,
			actionType: ACTION_TYPE.CREATE_FILE,
		});

		return res.status(status.CREATED).json({ url: s3Url });
	} catch (e) {
		return next(e);
	}
});

router.patch('/:id', getUser, isStaff, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['id'] || req.params['id'] === 'undefined') {
			throwBadRequestException('Invalid ID');
		}

		const download = await DownloadModel.findById(req.params['id'])
			.cache('5 minutes', `download-${req.params['id']}`)
			.exec();
		if (!download) {
			throwNotFoundException('Download Not Found');
		}

		let s3Url = '';

		if (!req.body.fileType) {
			await DownloadModel.findByIdAndUpdate(req.params['id'], {
				name: req.body.name,
				description: req.body.description,
				category: req.body.category,
				author: req.user.cid,
			}).exec();
		} else {
			const allowedTypes = [
				'application/pdf',
				'application/zip',
				'application/x-zip-compressed',
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			];

			if (!req.body.fileType || !allowedTypes.includes(req.body.fileType)) {
				throwBadRequestException('File type is not supported');
			}

			if (!req.body.fileName) {
				throwBadRequestException('File name is required');
			}

			if (!req.body.fileSize) {
				throwBadRequestException('File size is required');
			}

			if (!/^\d+$/.test(String(req.body.fileSize))) {
				throwBadRequestException('Invalid file size');
			}

			const fileSize = Number(String(req.body.fileSize));
			if (fileSize < 1 || fileSize >= DOWNLOAD_SIZE_LIMIT) {
				throwBadRequestException(`File must be less than ${DOWNLOAD_SIZE_LIMIT / 1024 / 1024} MB`);
			}

			if (download.fileName) {
				deleteFromS3(`downloads/${download.fileName}`);
			}

			const fileName = `${Date.now()}-${req.body.fileName}`;
			s3Url = await generateS3SignedUrl(`downloads/${fileName}`, req.body.fileType, fileSize);

			await DownloadModel.findByIdAndUpdate(req.params['id'], {
				name: req.body.name,
				description: req.body.description,
				category: req.body.category,
				fileName: fileName,
				author: req.user.cid,
			}).exec();
		}

		await clearCachePrefix('download');

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b updated the file *${req.body.name}*.`,
			actionType: ACTION_TYPE.UPDATE_FILE,
		});

		return res.status(status.OK).json({ url: s3Url });
	} catch (e) {
		return next(e);
	}
});

router.delete('/:id', getUser, isStaff, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['id'] || req.params['id'] === 'undefined') {
			throwBadRequestException('Invalid ID');
		}

		const download = await DownloadModel.findById(req.params['id'])
			.lean()
			.cache('5 minutes', `download-${req.params['id']}`)
			.exec();
		if (!download) {
			return res.status(status.NOT_FOUND).json({ error: 'File not found' });
		}

		if (download.fileName) {
			await deleteFromS3(`downloads/${download.fileName}`);
		}

		await DownloadModel.findByIdAndDelete(req.params['id']).exec();

		await clearCachePrefix('download');

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b deleted the file *${download.name}*.`,
			actionType: ACTION_TYPE.DELETE_FILE,
		});

		return res.status(status.NO_CONTENT).json();
	} catch (e) {
		return next(e);
	}
});

export default router;
