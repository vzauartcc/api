import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance } from '../../app.js';
import { throwBadRequestException, throwNotFoundException } from '../../helpers/errors.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import { deleteFromS3, generateS3SignedUrl } from '../../helpers/s3.js';
import { isStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { DocumentModel } from '../../models/document.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import status from '../../types/status.js';

const router = Router();

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const documents = await DocumentModel.find({ deletedAt: null })
			.select('-content')
			.sort({ category: 'asc' })
			.sort({ name: 'asc' })
			.lean()
			.cache('5 minutes', 'documents')
			.exec();

		return res.status(status.OK).json(documents);
	} catch (e) {
		return next(e);
	}
});

router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['slug'] || req.params['slug'] === 'undefined') {
			throwBadRequestException('Invalid slug');
		}

		const document = await DocumentModel.findOne({ slug: req.params['slug'], deletedAt: null })
			.lean()
			.cache('5 minutes', `documents-${req.params['slug']}`)
			.exec();

		if (!document) {
			throwNotFoundException('Document Not Found');
		}

		return res.status(status.OK).json(document);
	} catch (e) {
		return next(e);
	}
});

router.post('/', getUser, isStaff, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { name, category, description, content, type, fileType } = req.body;
		if (!category) {
			throwBadRequestException('Invalid category');
		}

		if (!content && type === 'doc') {
			throwBadRequestException('Invalid content');
		}

		const slug =
			name
				.replace(/\s+/g, '-')
				.toLowerCase()
				.replace(/^-+|-+(?=-|$)/g, '')
				.replace(/[^a-zA-Z0-9-_]/g, '') +
			'-' +
			Date.now().toString().slice(-5);

		let s3Url = '';
		if (type === 'file') {
			if (!fileType) {
				throwBadRequestException('File is required');
			}

			const allowedTypes = [
				'image/jpg',
				'image/jpeg',
				'image/png',
				'image/gif',
				'application/pdf',
				'application/zip',
				'application/x-zip-compressed',
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			];

			if (!fileType || !allowedTypes.includes(fileType)) {
				throwBadRequestException('File type is not supported');
			}

			if (!req.body.fileName) {
				throwBadRequestException('File name is required');
			}

			const fileName = `${Date.now()}-${req.body.fileName}`;
			s3Url = await generateS3SignedUrl(`documents/${fileName}`, fileType);

			await DocumentModel.create({
				name,
				category,
				description,
				slug,
				author: req.user.cid,
				type: 'file',
				fileName: fileName,
			});
		} else {
			await DocumentModel.create({
				name,
				category,
				description,
				content,
				slug,
				author: req.user.cid,
				type: 'doc',
			});
		}

		await getCacheInstance().clear('documents');

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b created the document *${req.body.name}*.`,
			actionType: ACTION_TYPE.CREATE_DOCUMENT,
		});

		return res.status(status.CREATED).json({ url: s3Url });
	} catch (e) {
		return next(e);
	}
});

router.put('/:slug', getUser, isStaff, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['slug'] || req.params['slug'] === 'undefined') {
			throwBadRequestException('Invalid slug');
		}

		const document = await DocumentModel.findOne({ slug: req.params['slug'] })
			.cache('5 minutes', `documents-${req.params['slug']}`)
			.exec();
		if (!document) {
			throwNotFoundException('Document Not Found');
		}

		console.log(req.body);

		const { name, category, description, content, type, fileType } = req.body;

		if (document.name !== name) {
			document.name = name;
			document.slug =
				name
					.replace(/\s+/g, '-')
					.toLowerCase()
					.replace(/^-+|-+(?=-|$)/g, '')
					.replace(/[^a-zA-Z0-9-_]/g, '') +
				'-' +
				Date.now().toString().slice(-5);
		}

		let s3Url = '';

		if (type === 'doc') {
			document.type = 'doc';
			document.category = category;
			document.description = description;
			document.content = content;
			delete document.fileName;

			await document.save();
		} else {
			const allowedTypes = [
				'image/jpg',
				'image/jpeg',
				'image/png',
				'image/gif',
				'application/pdf',
				'application/zip',
				'application/x-zip-compressed',
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			];

			if (fileType && req.body.fileName) {
				if (!allowedTypes.includes(fileType)) {
					throwBadRequestException('File type is not supported');
				}

				if (!req.body.fileName) {
					throwBadRequestException('File name is required');
				}

				if (document.fileName) {
					await deleteFromS3(`documents/${document.fileName}`);
				}

				const fileName = `${Date.now()}-${req.body.fileName}`;
				s3Url = await generateS3SignedUrl(`documents/${fileName}`, fileType);

				document.fileName = fileName;
				document.type = 'file';
				document.name = name;
				document.description = description;
				document.category = category;

				await document.save();
			} else {
				document.type = 'file';
				document.category = category;
				document.description = description;
				document.name = name;

				await document.save();
			}
		}

		await clearCachePrefix('document');

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b updated the document *${name}*.`,
			actionType: ACTION_TYPE.UPDATE_DOCUMENT,
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

		const doc = await DocumentModel.findById(req.params['id']).lean().exec();
		if (!doc) {
			throwNotFoundException('Document Not Found');
		}

		if (doc.fileName) {
			deleteFromS3(`documents/${doc.fileName}`);
		}

		await DocumentModel.findByIdAndDelete(req.params['id']).exec();

		await clearCachePrefix('document');

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b deleted the document *${doc.name}*.`,
			actionType: ACTION_TYPE.DELETE_DOCUMENT,
		});

		return res.status(status.NO_CONTENT).json();
	} catch (e) {
		return next(e);
	}
});

export default router;
