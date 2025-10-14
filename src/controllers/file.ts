import { Router, type Request, type Response } from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import { convertToReturnDetails, deleteFromS3, uploadToS3 } from '../app.js';
import { hasRole } from '../middleware/auth.js';
import getUser from '../middleware/user.js';
import { DocumentModel } from '../models/document.js';
import { DownloadModel } from '../models/download.js';

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
router.get('/downloads', async (req: Request, res: Response) => {
	try {
		const downloads = await DownloadModel.find({ deletedAt: null })
			.sort({ category: 'asc', name: 'asc' })
			.lean()
			.exec();
		res.stdRes.data = downloads;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get('/downloads/:id', async (req: Request, res: Response) => {
	try {
		const download = await DownloadModel.findById(req.params['id']).lean().exec();
		res.stdRes.data = download;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.post(
	'/downloads',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	upload.single('download'),
	async (req: Request, res: Response) => {
		try {
			if (!req.body.category) {
				throw {
					code: 400,
					message: 'You must select a category',
				};
			}
			if (!req.file) {
				throw {
					code: 400,
					message: 'Missing file',
				};
			}

			if (req.file.size > 100 * 1024 * 1024) {
				// 100MiB
				throw {
					code: 400,
					message: 'File too large',
				};
			}
			const tmpFile = await fs.readFile(req.file!.path);

			await uploadToS3(`downloads/${req.file.filename}`, tmpFile, req.file.mimetype);

			await DownloadModel.create({
				name: req.body.name,
				description: req.body.description,
				fileName: req.file.filename,
				category: req.body.category,
				author: req.body.author,
			});

			await req.app.dossier.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b created the file *${req.body.name}*.`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.put(
	'/downloads/:id',
	upload.single('download'),
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	async (req: Request, res: Response) => {
		try {
			const download = await DownloadModel.findById(req.params['id']).exec();
			if (!download) {
				throw { code: 404, message: 'Download not found' };
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
					throw { code: 400, message: 'File too large' };
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
			await req.app.dossier.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b updated the file *${req.body.name}*.`,
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
	'/downloads/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	async (req: Request, res: Response) => {
		try {
			// 🚀 **Step 1: Fetch the file info from the database**
			const download = await DownloadModel.findById(req.params['id']).lean().exec();
			if (!download) {
				return res.status(404).json({ error: 'File not found' });
			}

			// 🗑️ **Step 2: Delete the file from S3 if it exists**
			if (download.fileName) {
				await deleteFromS3(`downloads/${download.fileName}`);
			}

			// ❌ **Step 3: Delete the database entry**
			await DownloadModel.findByIdAndDelete(req.params['id']).exec();

			// ✅ Log deletion in dossier
			await req.app.dossier.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b deleted the file *${download.name}*.`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

// Documents
router.get('/documents', async (req: Request, res: Response) => {
	try {
		const documents = await DocumentModel.find({ deletedAt: null })
			.select('-content')
			.sort({ category: 'asc' })
			.sort({ name: 'asc' })
			.lean()
			.exec();
		res.stdRes.data = documents;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get('/documents/:slug', async (req: Request, res: Response) => {
	try {
		const document = await DocumentModel.findOne({ slug: req.params['slug'], deletedAt: null })
			.lean()
			.exec();
		res.stdRes.data = document;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.post(
	'/documents',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	upload.single('download'),
	async (req: Request, res: Response) => {
		try {
			const { name, category, description, content, type } = req.body;
			if (!category) {
				throw {
					code: 400,
					message: 'You must select a category',
				};
			}

			if (!content && type === 'doc') {
				throw {
					code: 400,
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
					throw { code: 400, message: 'File required' };
				}
				if (req.file.size > 100 * 1024 * 1024) {
					// 100MiB
					throw {
						code: 400,
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

			await req.app.dossier.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b created the document *${req.body.name}*.`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.put(
	'/documents/:slug',
	upload.single('download'),
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	async (req: Request, res: Response) => {
		try {
			const document = await DocumentModel.findOne({ slug: req.params['slug'] }).exec();
			if (!document) {
				return res.status(404).json({ error: 'Document not found' });
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
						throw { code: 400, message: 'File too large.' };
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
			await req.app.dossier.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b updated the document *${name}*.`,
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
	'/documents/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'wm']),
	async (req: Request, res: Response) => {
		try {
			// 🚀 **Step 1: Fetch the document from the database**
			const doc = await DocumentModel.findById(req.params['id']).lean().exec();
			if (!doc) {
				return res.status(404).json({ error: 'Document not found' });
			}

			// 🗑️ **Step 2: Delete the file from S3 if it exists**
			if (doc.fileName) {
				deleteFromS3(`documents/${doc.fileName}`);
			}

			// ❌ **Step 3: Delete the database entry**
			await DocumentModel.findByIdAndDelete(req.params['id']).exec();

			// ✅ Log deletion in dossier
			await req.app.dossier.create({
				by: req.user!.cid,
				affected: -1,
				action: `%b deleted the document *${doc.name}*.`,
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
