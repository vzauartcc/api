import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import { deleteFromS3, uploadToS3 } from '../helpers/s3.js';
import { hasRole } from '../middleware/auth.js';
import getUser from '../middleware/user.js';
import { DocumentModel } from '../models/document.js';
import { DossierModel } from '../models/dossier.js';
import { DownloadModel } from '../models/download.js';
import status from '../types/status.js';

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
});

// Downloads
router.get('/downloads', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const downloads = await DownloadModel.find({ deletedAt: null })
			.sort({ category: 'asc', name: 'asc' })
			.lean()
			.exec();

		return res.status(status.OK).json(downloads);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.get('/downloads/:id', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const download = await DownloadModel.findById(req.params['id']).lean().exec();

		if (!download) {
			throw {
				code: status.NOT_FOUND,
				message: 'Download not found',
			};
		}

		return res.status(status.OK).json(download);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.post(
	'/downloads',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	upload.single('download'),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.body.category) {
				throw {
					code: status.BAD_REQUEST,
					message: 'You must select a category',
				};
			}
			if (!req.file) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Missing file',
				};
			}

			if (req.file.size > 100 * 1024 * 1024) {
				// 100MiB
				throw {
					code: status.BAD_REQUEST,
					message: 'File too large',
				};
			}
			const tmpFile = await fs.readFile(req.file.path);

			await uploadToS3(`downloads/${req.file.filename}`, tmpFile, req.file.mimetype);

			await DownloadModel.create({
				name: req.body.name,
				description: req.body.description,
				fileName: req.file.filename,
				category: req.body.category,
				author: req.body.author,
			});

			await DossierModel.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b created the file *${req.body.name}*.`,
			});

			return res.status(status.CREATED).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.put(
	'/downloads/:id',
	upload.single('download'),
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const download = await DownloadModel.findById(req.params['id']).exec();
			if (!download) {
				throw { code: status.NOT_FOUND, message: 'Download not found' };
			}

			if (!req.file) {
				// ✅ No updated file, just update metadata
				await DownloadModel.findByIdAndUpdate(req.params['id'], {
					name: req.body.name,
					description: req.body.description,
					category: req.body.category,
				}).exec();
			} else {
				// ✅ File size check (100MiB limit)
				if (req.file.size > 100 * 1024 * 1024) {
					throw { code: status.BAD_REQUEST, message: 'File too large' };
				}

				// 🚨 **Step 1: Delete Old File from S3 (if it exists)**
				if (download.fileName) {
					deleteFromS3(`downloads/${download.fileName}`);
				}

				// 🚀 **Step 2: Upload New File to S3**
				const tmpFile = await fs.readFile(req.file.path);
				await uploadToS3(`downloads/${req.file.filename}`, tmpFile, req.file.mimetype);

				// ✅ **Step 3: Update Database with New File Name**
				await DownloadModel.findByIdAndUpdate(req.params['id'], {
					name: req.body.name,
					description: req.body.description,
					category: req.body.category,
					fileName: req.file.filename, // ✅ Save the new file reference
				}).exec();
			}

			// ✅ Log the update in dossier
			await DossierModel.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b updated the file *${req.body.name}*.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.delete(
	'/downloads/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			// 🚀 **Step 1: Fetch the file info from the database**
			const download = await DownloadModel.findById(req.params['id']).lean().exec();
			if (!download) {
				return res.status(status.NOT_FOUND).json({ error: 'File not found' });
			}

			// 🗑️ **Step 2: Delete the file from S3 if it exists**
			if (download.fileName) {
				await deleteFromS3(`downloads/${download.fileName}`);
			}

			// ❌ **Step 3: Delete the database entry**
			await DownloadModel.findByIdAndDelete(req.params['id']).exec();

			// ✅ Log deletion in dossier
			await DossierModel.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b deleted the file *${download.name}*.`,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

// Documents
router.get('/documents', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const documents = await DocumentModel.find({ deletedAt: null })
			.select('-content')
			.sort({ category: 'asc' })
			.sort({ name: 'asc' })
			.lean()
			.exec();

		return res.status(status.OK).json(documents);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.get('/documents/:slug', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const document = await DocumentModel.findOne({ slug: req.params['slug'], deletedAt: null })
			.lean()
			.exec();

		if (!document) {
			throw {
				code: status.NOT_FOUND,
				message: 'Document not found',
			};
		}

		return res.status(status.OK).json(document);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.post(
	'/documents',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	upload.single('download'),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { name, category, description, content, type } = req.body;
			if (!category) {
				throw {
					code: status.BAD_REQUEST,
					message: 'You must select a category',
				};
			}

			if (!content && type === 'doc') {
				throw {
					code: status.BAD_REQUEST,
					message: 'You must include content',
				};
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
					throw { code: status.BAD_REQUEST, message: 'File required' };
				}
				if (req.file.size > 100 * 1024 * 1024) {
					// 100MiB
					throw {
						code: status.BAD_REQUEST,
						message: 'File too large',
					};
				}

				const tmpFile = await fs.readFile(req.file.path);

				await uploadToS3(`documents/${req.file.filename}`, tmpFile, req.file.mimetype);

				await DocumentModel.create({
					name,
					category,
					description,
					slug,
					author: req.user!.cid,
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
					author: req.user!.cid,
					type: 'doc',
				});
			}

			await DossierModel.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b created the document *${req.body.name}*.`,
			});

			return res.status(status.CREATED).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.put(
	'/documents/:slug',
	upload.single('download'),
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const document = await DocumentModel.findOne({ slug: req.params['slug'] }).exec();
			if (!document) {
				throw {
					code: status.NOT_FOUND,
					message: 'Document not found',
				};
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
					// ✅ No new file, just update metadata
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
					// ✅ File size check (100MiB limit)
					if (req.file.size > 100 * 1024 * 1024) {
						throw { code: status.BAD_REQUEST, message: 'File too large.' };
					}

					// 🚨 **Step 1: Delete Old File from S3 (if it exists)**
					if (document.fileName) {
						await deleteFromS3(`documents/${document.fileName}`);
					}

					// 🚀 **Step 2: Upload New File to S3**
					const tmpFile = await fs.readFile(req.file.path);
					await uploadToS3(`documents/${req.file.filename}`, tmpFile, req.file.mimetype);

					// ✅ **Step 3: Update Database with New File Name**
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

			// ✅ Log update in dossier
			await DossierModel.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b updated the document *${name}*.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.delete(
	'/documents/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			// 🚀 **Step 1: Fetch the document from the database**
			const doc = await DocumentModel.findById(req.params['id']).lean().exec();
			if (!doc) {
				throw {
					code: status.NOT_FOUND,
					message: 'Document not found',
				};
			}

			// 🗑️ **Step 2: Delete the file from S3 if it exists**
			if (doc.fileName) {
				deleteFromS3(`documents/${doc.fileName}`);
			}

			// ❌ **Step 3: Delete the database entry**
			await DocumentModel.findByIdAndDelete(req.params['id']).exec();

			// ✅ Log deletion in dossier
			await DossierModel.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b deleted the document *${doc.name}*.`,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

export default router;
