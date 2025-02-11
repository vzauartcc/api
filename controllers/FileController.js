import e from 'express';
const router = e.Router();
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import multer from 'multer';
import fs from 'fs/promises';
import Downloads from '../models/Download.js';
import Document from '../models/Document.js';
import getUser from '../middleware/getUser.js';
import auth from '../middleware/auth.js';

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, '/tmp');
            },
        filename: (req, file, cb) => {
            cb(null, `${Date.now()}-${file.originalname}`);
        }
    })
})

// Downloads
router.get('/downloads', async ({res}) => {
    try {
        const downloads = await Downloads.find({deletedAt: null}).sort({category: "asc", name: "asc"}).lean();
        res.stdRes.data = downloads;
    } catch(e) {
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
});

router.get('/downloads/:id', async (req, res) => {
    try {
        const download = await Downloads.findById(req.params.id).lean();
        res.stdRes.data = download;
    } catch(e) {
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
});

router.post('/downloads', getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), upload.single('download'), async (req, res) => {
    try {
        if(!req.body.category) {
            throw {
                code: 400,
                message: 'You must select a category'
            }
        }
        if(req.file.size > (100 * 1024 * 1024)) {	// 100MiB
            throw {
                code: 400,
                message: 'File too large'
            }
        }
        const tmpFile = await fs.readFile(req.file.path);
        await req.app.s3.send(new PutObjectCommand({
            Bucket: req.app.s3.defaultBucket,
            Key: `${req.app.s3.folderPrefix}/downloads/${req.file.filename}`,
            Body: tmpFile,
            ContentType: req.file.mimetype,
            ACL: "public-read",
        }));

        await Downloads.create({
            name: req.body.name,
            description: req.body.description,
            fileName: req.file.filename,
            category: req.body.category,
            author: req.body.author
        });

        await req.app.dossier.create({
            by: res.user.cid,
            affected: -1,
            action: `%b created the file *${req.body.name}*.`
        });
    } catch(e) {
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
});

router.put('/downloads/:id', upload.single('download'), getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), async (req, res) => {
    try {
        const download = await Downloads.findById(req.params.id);
        if (!download) {
            throw { code: 404, message: "Download not found" };
        }

        if (!req.file) { // ✅ No updated file, just update metadata
            await Downloads.findByIdAndUpdate(req.params.id, {
                name: req.body.name,
                description: req.body.description,
                category: req.body.category
            });
        } else {
            // ✅ File size check (100MiB limit)
            if (req.file.size > (100 * 1024 * 1024)) {
                throw { code: 400, message: "File too large" };
            }

            // 🚨 **Step 1: Delete Old File from S3 (if it exists)**
            if (download.fileName) {
                console.log(`🗑️ Deleting old file from S3: downloads/${download.fileName}`);
                await req.app.s3.send(new DeleteObjectCommand({
                    Bucket: req.app.s3.defaultBucket,
                    Key: `${req.app.s3.folderPrefix}/downloads/${download.fileName}`,
                }));
            }

            // 🚀 **Step 2: Upload New File to S3**
            const tmpFile = await fs.readFile(req.file.path);
            await req.app.s3.send(new PutObjectCommand({
                Bucket: req.app.s3.defaultBucket,
                Key: `${req.app.s3.folderPrefix}/downloads/${req.file.filename}`,
                Body: tmpFile,
                ContentType: req.file.mimetype,
                ACL: "public-read",
            }));

            // ✅ **Step 3: Update Database with New File Name**
            await Downloads.findByIdAndUpdate(req.params.id, {
                name: req.body.name,
                description: req.body.description,
                category: req.body.category,
                fileName: req.file.filename // ✅ Save the new file reference
            });
        }

        // ✅ Log the update in dossier
        await req.app.dossier.create({
            by: res.user.cid,
            affected: -1,
            action: `%b updated the file *${req.body.name}*.`
        });

    } catch (e) {
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
});


router.delete('/downloads/:id', getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), async (req, res) => {
    try {
        // 🚀 **Step 1: Fetch the file info from the database**
        const download = await Downloads.findById(req.params.id).lean();
        if (!download) {
            return res.status(404).json({ error: "File not found" });
        }

        // 🗑️ **Step 2: Delete the file from S3 if it exists**
        if (download.fileName) {
            console.log(`🗑️ Deleting file from S3: downloads/${download.fileName}`);
            await req.app.s3.send(new DeleteObjectCommand({
                Bucket: req.app.s3.defaultBucket,
                Key: `${req.app.s3.folderPrefix}/downloads/${download.fileName}`,
            }));
        }

        // ❌ **Step 3: Delete the database entry**
        await Downloads.findByIdAndDelete(req.params.id);

        // ✅ Log deletion in dossier
        await req.app.dossier.create({
            by: res.user.cid,
            affected: -1,
            action: `%b deleted the file *${download.name}*.`
        });

    } catch (e) {
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
});

// Documents
router.get('/documents', async ({res}) => {
    try {
        const documents = await Document.find({deletedAt: null}).select('-content').sort({category: "asc"}).sort({name: 'asc'}).lean();
        res.stdRes.data = documents;
    } catch(e) {
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
});

router.get('/documents/:slug', async (req, res) => {
    try {
        const document = await Document.findOne({slug: req.params.slug, deletedAt: null}).lean();
        res.stdRes.data = document;
    } catch(e) {
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
});

router.post('/documents', getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), upload.single('download'), async (req, res) => {
    try {
        const {name, category, description, content, type} = req.body;
        if(!category) {
            throw {
                code: 400,
                message: 'You must select a category'
            }
        }

        if(!content && type === 'doc') {
            throw {
                code: 400,
                message: 'You must include content'
            }
        }

        const slug = name.replace(/\s+/g, '-').toLowerCase().replace(/^-+|-+(?=-|$)/g, '').replace(/[^a-zA-Z0-9-_]/g, '') + '-' + Date.now().toString().slice(-5);

        if(type === "file") {
            if(req.file.size > (100 * 1024 * 1024)) {	// 100MiB
                throw {
                    code: 400,
                    message: 'File too large'
                }
            }

            const tmpFile = await fs.readFile(req.file.path);

            console.log("✅ S3 Bucket:", req.app.s3.defaultBucket);
		    if (!req.app.s3.defaultBucket) {
  		        return res.status(500).json({ error: "S3 default bucket is not set" });
		    }

            await req.app.s3.send(new PutObjectCommand({
                Bucket: req.app.s3.defaultBucket,
                Key: `${req.app.s3.folderPrefix}/documents/${req.file.filename}`,
                Body: tmpFile,
                ContentType: req.file.mimetype,
                ACL: "public-read",
            }));

            await Document.create({
                name,
                category,
                description,
                slug,
                author: res.user.cid,
                type: 'file',
                fileName: req.file.filename
            });
        } else {
            await Document.create({
                name,
                category,
                description,
                content,
                slug,
                author: res.user.cid,
                type: 'doc'
            });
        }

        await req.app.dossier.create({
            by: res.user.cid,
            affected: -1,
            action: `%b created the document *${req.body.name}*.`
        });

    } catch(e) {
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
});

router.put('/documents/:slug', upload.single('download'), getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), async (req, res) => {
    try {
        const document = await Document.findOne({ slug: req.params.slug });
        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        const { name, category, description, content, type } = req.body;

        if (type === 'doc') {
            if (document.name !== name) {
                document.name = name;
                document.slug = name.replace(/\s+/g, '-')
                    .toLowerCase()
                    .replace(/^-+|-+(?=-|$)/g, '')
                    .replace(/[^a-zA-Z0-9-_]/g, '') + '-' + Date.now().toString().slice(-5);
            }

            document.type = 'doc';
            document.category = category;
            document.description = description;
            document.content = content;

            await document.save();
        } else {
            if (!req.file) { // ✅ No new file, just update metadata
                await Document.findOneAndUpdate({ slug: req.params.slug }, {
                    name,
                    description,
                    category,
                    type: 'file'
                });
            } else {
                // ✅ File size check (100MiB limit)
                if (req.file.size > (100 * 1024 * 1024)) {
                    throw { code: 400, message: "File too large." };
                }

                // 🚨 **Step 1: Delete Old File from S3 (if it exists)**
                if (document.fileName) {
                    console.log(`🗑️ Deleting old file from S3: documents/${document.fileName}`);
                    await req.app.s3.send(new DeleteObjectCommand({
                        Bucket: req.app.s3.defaultBucket,
                        Key: `${req.app.s3.folderPrefix}/documents/${document.fileName}`,
                    }));
                }

                // 🚀 **Step 2: Upload New File to S3**
                const tmpFile = await fs.readFile(req.file.path);
                await req.app.s3.send(new PutObjectCommand({
                    Bucket: req.app.s3.defaultBucket,
                    Key: `${req.app.s3.folderPrefix}/documents/${req.file.filename}`,
                    Body: tmpFile,
                    ContentType: req.file.mimetype,
                    ACL: "public-read",
                }));

                // ✅ **Step 3: Update Database with New File Name**
                await Document.findOneAndUpdate({ slug: req.params.slug }, {
                    name,
                    description,
                    category,
                    fileName: req.file.filename,
                    type: 'file'
                });
            }
        }

        // ✅ Log update in dossier
        await req.app.dossier.create({
            by: res.user.cid,
            affected: -1,
            action: `%b updated the document *${name}*.`,
        });

    } catch (e) {
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
});

router.delete('/documents/:id', getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), async (req, res) => {
    try {
        // 🚀 **Step 1: Fetch the document from the database**
        const doc = await Document.findById(req.params.id).lean();
        if (!doc) {
            return res.status(404).json({ error: "Document not found" });
        }

        // 🗑️ **Step 2: Delete the file from S3 if it exists**
        if (doc.fileName) {
            console.log(`🗑️ Deleting file from S3: documents/${doc.fileName}`);
            await req.app.s3.send(new DeleteObjectCommand({
                Bucket: req.app.s3.defaultBucket,
                Key: `${req.app.s3.folderPrefix}/documents/${doc.fileName}`,
            }));
        }

        // ❌ **Step 3: Delete the database entry**
        await Document.findByIdAndDelete(req.params.id);

        // ✅ Log deletion in dossier
        await req.app.dossier.create({
            by: res.user.cid,
            affected: -1,
            action: `%b deleted the document *${doc.name}*.`,
        });

    } catch (e) {
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
});

export default router;