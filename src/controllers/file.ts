import type { Progress } from '@aws-sdk/lib-storage';
import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import * as fs from 'fs';
import multer from 'multer';
import { getCacheInstance } from '../app.js';
import { deleteFromS3, getUploadStatus, setUploadStatus, uploadToS3 } from '../helpers/s3.js';
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
	limits: {
		fileSize: 250 * 1024 * 1024, // 250MiB
	},
});

router.get('/checkStatus/:id', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['id']) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Missing id',
			};
		}

		const progress = getUploadStatus(req.params['id']);

		if (!progress) {
			throw {
				code: status.NOT_FOUND,
				message: 'Not found',
			};
		}

		return res.status(status.OK).json({ progress });
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}

		return next(e);
	}
});

//#region Downloads
router.get('/downloads', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const downloads = await DownloadModel.find({ deletedAt: null })
			.sort({ category: 'asc', name: 'asc' })
			.lean()
			.cache('5 minutes', 'downloads')
			.exec();

		return res.status(status.OK).json(downloads);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/downloads/:id', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const download = await DownloadModel.findById(req.params['id'])
			.lean()
			.cache('5 minutes', `download-${req.params['id']}`)
			.exec();

		if (!download) {
			throw {
				code: status.NOT_FOUND,
				message: 'Download not found',
			};
		}

		return res.status(status.OK).json(download);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
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

			setUploadStatus(req.body.uploadId, 0);

			res.status(status.ACCEPTED).json();

			const filePath = req.file.path;
			let fileStream: fs.ReadStream | undefined;

			try {
				fileStream = fs.createReadStream(filePath);

				await uploadToS3(
					`downloads/${req.file.filename}`,
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
				captureException(e);

				setUploadStatus(req.body.uploadId, -1);

				throw {
					code: status.INTERNAL_SERVER_ERROR,
					message: 'Error streaming file to storage',
				};
			} finally {
				try {
					fileStream?.close();
					fs.unlinkSync(filePath);
				} catch (_err) {
					// Do nothing, we don't care about this error
				}
			}

			await DownloadModel.create({
				name: req.body.name,
				description: req.body.description,
				fileName: req.file.filename,
				category: req.body.category,
				author: req.body.author,
			});

			await getCacheInstance().clear('downloads');

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b created the file *${req.body.name}*.`,
			});

			return res.status(status.CREATED).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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
			const download = await DownloadModel.findById(req.params['id'])
				.cache('5 minutes', `download-${req.params['id']}`)
				.exec();
			if (!download) {
				throw { code: status.NOT_FOUND, message: 'Download not found' };
			}

			if (!req.file) {
				await DownloadModel.findByIdAndUpdate(req.params['id'], {
					name: req.body.name,
					description: req.body.description,
					category: req.body.category,
				}).exec();
			} else {
				if (download.fileName) {
					deleteFromS3(`downloads/${download.fileName}`);
				}

				setUploadStatus(req.body.uploadId, 0);

				res.status(status.ACCEPTED).json();

				const filePath = req.file.path;
				let fileStream: fs.ReadStream | undefined;

				try {
					fileStream = fs.createReadStream(filePath);

					await uploadToS3(
						`downloads/${req.file.filename}`,
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
					captureException(e);

					setUploadStatus(req.body.uploadId, -1);

					throw {
						code: status.INTERNAL_SERVER_ERROR,
						message: 'Error streaming file to storage',
					};
				} finally {
					try {
						fileStream?.close();
						fs.unlinkSync(filePath);
					} catch (_err) {
						// Do nothing, we don't care about this error
					}
				}

				await DownloadModel.findByIdAndUpdate(req.params['id'], {
					name: req.body.name,
					description: req.body.description,
					category: req.body.category,
					fileName: req.file.filename,
				}).exec();
			}

			await getCacheInstance().clear(`download-${req.params['id']}`);
			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b updated the file *${req.body.name}*.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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
			await getCacheInstance().clear('downloads');

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b deleted the file *${download.name}*.`,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);
//#endregion

//#region Documents
router.get('/documents', async (_req: Request, res: Response, next: NextFunction) => {
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
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/documents/:slug', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const document = await DocumentModel.findOne({ slug: req.params['slug'], deletedAt: null })
			.lean()
			.cache('5 minutes', `documents-${req.params['slug']}`)
			.exec();

		if (!document) {
			throw {
				code: status.NOT_FOUND,
				message: 'Document not found',
			};
		}

		return res.status(status.OK).json(document);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
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
					captureException(e);

					setUploadStatus(req.body.uploadId, -1);

					throw {
						code: status.INTERNAL_SERVER_ERROR,
						message: 'Error streaming file to storage',
					};
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
			});

			return res.status(status.CREATED).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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
			const document = await DocumentModel.findOne({ slug: req.params['slug'] })
				.cache('5 minutes', `documents-${req.params['slug']}`)
				.exec();
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
						captureException(e);

						setUploadStatus(req.body.uploadId, -1);

						throw {
							code: status.INTERNAL_SERVER_ERROR,
							message: 'Error streaming file to storage',
						};
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

			await getCacheInstance().clear(`document-${req.params['slug']}`);

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b updated the document *${name}*.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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
			const doc = await DocumentModel.findById(req.params['id']).lean().exec();
			if (!doc) {
				throw {
					code: status.NOT_FOUND,
					message: 'Document not found',
				};
			}

			if (doc.fileName) {
				deleteFromS3(`documents/${doc.fileName}`);
			}

			await DocumentModel.findByIdAndDelete(req.params['id']).exec();
			await getCacheInstance().clear('documents');

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b deleted the document *${doc.name}*.`,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);
//#endregion

export default router;
