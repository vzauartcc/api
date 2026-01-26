import type { Progress } from '@aws-sdk/lib-storage';
import { Router, type NextFunction, type Request, type Response } from 'express';
import * as fs from 'fs';
import multer from 'multer';
import { getCacheInstance } from '../../app.js';
import {
	throwBadRequestException,
	throwInternalServerErrorException,
	throwNotFoundException,
} from '../../helpers/errors.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import { deleteFromS3, setUploadStatus, uploadToS3 } from '../../helpers/s3.js';
import { isStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { DocumentModel } from '../../models/document.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import status from '../../types/status.js';

const router = Router();

const upload = multer({
	storage: multer.diskStorage({
		destination: (_req, _file, cb) => {
			cb(null, '/tmp');
		},
		filename: (_req, file, cb) => {
			cb(null, `${Date.now()}-${file.originalname}`);
		},
	}),
	limits: {
		fileSize: 250 * 1024 * 1024, // 250MiB
	},
});

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

router.post(
	'/',
	getUser,
	isStaff,
	upload.single('download'),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { name, category, description, content, type } = req.body;
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

			if (type === 'file') {
				if (!req.file) {
					throwBadRequestException('File is required');
				}

				setUploadStatus(req.body.uploadId, 0);

				res.status(status.ACCEPTED).json();

				const filePath = req.file.path;
				let fileStream: fs.ReadStream | undefined;

				try {
					fileStream = fs.createReadStream(filePath);

					await uploadToS3(
						`documents/${req.file.filename}`,
						fileStream,
						req.file.mimetype,
						{},
						(progress: Progress) => {
							const total = progress.total || 0;
							const percent = total > 0 ? Math.round(((progress.loaded || 0) / total) * 100) : 0;
							setUploadStatus(req.body.uploadId, percent);
						},
					);
				} catch (e) {
					setUploadStatus(req.body.uploadId, -1);

					throwInternalServerErrorException('Error streaming file to storage');
				} finally {
					try {
						fileStream?.close();
						fs.unlinkSync(filePath);
					} catch (_err) {
						// Do nothing, we don't care about this error
					}
				}

				await DocumentModel.create({
					name,
					category,
					description,
					slug,
					author: req.user.cid,
					type: 'file',
					fileName: req.file.filename,
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

			return res.status(status.CREATED).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.put(
	'/:slug',
	upload.single('download'),
	getUser,
	isStaff,
	async (req: Request, res: Response, next: NextFunction) => {
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

			const { name, category, description, content, type } = req.body;

			if (type === 'doc') {
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

				document.type = 'doc';
				document.category = category;
				document.description = description;
				document.content = content;

				await document.save();
			} else {
				if (!req.file) {
					await DocumentModel.findOneAndUpdate(
						{ slug: req.params['slug'] },
						{
							name,
							description,
							category,
							type: 'file',
						},
					).exec();
				} else {
					if (document.fileName) {
						await deleteFromS3(`documents/${document.fileName}`);
					}

					setUploadStatus(req.body.uploadId, 0);

					res.status(status.ACCEPTED).json();

					const filePath = req.file.path;
					let fileStream: fs.ReadStream | undefined;

					try {
						fileStream = fs.createReadStream(filePath);

						await uploadToS3(
							`documents/${req.file.filename}`,
							fileStream,
							req.file.mimetype,
							{},
							(progress: Progress) => {
								const total = progress.total || 0;
								const percent = total > 0 ? Math.round(((progress.loaded || 0) / total) * 100) : 0;
								setUploadStatus(req.body.uploadId, percent);
							},
						);
					} catch (e) {
						setUploadStatus(req.body.uploadId, -1);

						throwInternalServerErrorException('Error streaming file to storage');
					} finally {
						try {
							fileStream?.close();
							fs.unlinkSync(filePath);
						} catch (_err) {
							// Do nothing, we don't care about this error
						}
					}

					await DocumentModel.findOneAndUpdate(
						{ slug: req.params['slug'] },
						{
							name,
							description,
							category,
							fileName: req.file.filename,
							type: 'file',
						},
					).exec();
				}
			}

			await clearCachePrefix('document');

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b updated the document *${name}*.`,
				actionType: ACTION_TYPE.UPDATE_DOCUMENT,
			});

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

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
