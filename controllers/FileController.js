import e from 'express';
const router = e.Router();
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import formidable from 'formidable';
import fs from 'fs/promises';
import Downloads from '../models/Download.js';
import Document from '../models/Document.js';
import getUser from '../middleware/getUser.js';
import auth from '../middleware/auth.js';

const s3 = new S3Client({
  endpoint: 'https://sfo3.digitaloceanspaces.com',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  region: 'us-west-1', // specify your region
});

// Downloads
router.get('/downloads', async (req, res) => {
  try {
    const downloads = await Downloads.find({ deletedAt: null }).sort({ category: "asc", name: "asc" }).lean();
    res.stdRes.data = downloads;
  } catch (e) {
    req.app.Sentry.captureException(e);
    res.stdRes.ret_det = e;
  }

  return res.json(res.stdRes);
});

router.get('/downloads/:id', async (req, res) => {
  try {
    const download = await Downloads.findById(req.params.id).lean();
    res.stdRes.data = download;
  } catch (e) {
    req.app.Sentry.captureException(e);
    res.stdRes.ret_det = e;
  }

  return res.json(res.stdRes);
});

router.post('/downloads', getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), async (req, res) => {
  const form = formidable();
  console.log('Received POST request to /downloads');
  
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      res.stdRes.ret_det.code = 500;
      res.stdRes.ret_det.message = 'Form parse error';
      return res.json(res.stdRes);
    }

    console.log('Form parsed successfully:', { fields, files });

    const name = Array.isArray(fields.name) ? fields.name[0] : fields.name;
    const category = Array.isArray(fields.category) ? fields.category[0] : fields.category;
    const description = Array.isArray(fields.description) ? fields.description[0] : fields.description;
    const author = Array.isArray(fields.author) ? fields.author[0] : fields.author;
   

    console.log('Parsed fields:', { name, category, description, author });

    try {
      if (!category) {
        res.stdRes.ret_det.code = 400;
        res.stdRes.ret_det.message = 'You must select a category';
        return res.json(res.stdRes);
      }

      const file = Array.isArray(files.download) ? files.download[0] : files.download;
      console.log('File to upload:', file);

      if (!file || !file.filepath) {
        res.stdRes.ret_det.code = 400;
        res.stdRes.ret_det.message = 'No file uploaded or file path is undefined';
        return res.json(res.stdRes);
      }

      console.log('File details:', file);

      if (file.size > (100 * 1024 * 1024)) { // 100MiB
        res.stdRes.ret_det.code = 400;
        res.stdRes.ret_det.message = 'File too large';
        return res.json(res.stdRes);
      }

      const tmpFile = await fs.readFile(file.filepath);
      const fileKey = `${Date.now()}-${file.originalFilename}`;
      await s3.send(new PutObjectCommand({
        Bucket: 'zauartcc',
        Key: `${process.env.S3_FOLDER_PREFIX}/downloads/${fileKey}`,
        Body: tmpFile,
        ContentType: file.mimetype,
        ACL: 'public-read',
      }));
      console.log('Uploaded file to S3');

      await Downloads.create({
        name: name,
        description: description,
        fileName: fileKey,
        category: category,
        author: author
      });
      console.log('Created download record in database');

      await req.app.dossier.create({
        by: res.user.cid,
        affected: -1,
        action: `%b created the file *${name}*.`
      });

      res.stdRes.ret_det.message = 'Download created successfully';
      return res.json(res.stdRes);

    } catch (e) {
      console.error('Error processing download:', e);
      req.app.Sentry.captureException(e);
      res.stdRes.ret_det.code = 500;
      res.stdRes.ret_det.message = 'Internal Server Error';
      res.stdRes.data = { details: e.message };
      return res.json(res.stdRes);
    }
  });
});

router.put('/downloads/:id', getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), async (req, res) => {
  const form = formidable();
  console.log('Received PUT request to /downloads/:id');

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      res.stdRes.ret_det.code = 500;
      res.stdRes.ret_det.message = 'Form parse error';
      return res.json(res.stdRes);
    }

    console.log('Form parsed successfully:', { fields, files });

    try {
      const download = await Downloads.findById(req.params.id);
      if (!download) {
        res.stdRes.ret_det.code = 404;
        res.stdRes.ret_det.message = 'Download not found';
        return res.json(res.stdRes);
      }

      const name = Array.isArray(fields.name) ? fields.name[0] : fields.name;
      const category = Array.isArray(fields.category) ? fields.category[0] : fields.category;
      const description = Array.isArray(fields.description) ? fields.description[0] : fields.description;
      const oldFileName = Array.isArray(fields.oldFileName) ? fields.oldFileName[0] : fields.oldFileName;

      console.log('Parsed fields:', { name, category, description, oldFileName });

      if (!files.download) {
        // No file uploaded, update the document details
        await Downloads.findByIdAndUpdate(req.params.id, {
          name: name,
          description: description,
          category: category
        });
        console.log(`Updated download details for: ${name}`);
      } else {
        const file = Array.isArray(files.download) ? files.download[0] : files.download;
        if (file.size > (100 * 1024 * 1024)) { // 100MiB
          res.stdRes.ret_det.code = 400;
          res.stdRes.ret_det.message = 'File too large';
          return res.json(res.stdRes);
        }

        // Delete the old file from S3
        if (oldFileName) {
          await s3.send(new DeleteObjectCommand({
            Bucket: 'zauartcc',
            Key: `${process.env.S3_FOLDER_PREFIX}/downloads/${oldFileName}`
          }));
          console.log(`Deleted old file from S3: ${process.env.FOLDER_PREFIX}/downloads/${download.name}`);
        }

        const tmpFile = await fs.readFile(file.filepath);
        const fileKey = `${Date.now()}-${file.originalFilename}`;
        await s3.send(new PutObjectCommand({
          Bucket: 'zauartcc',
          Key: `${process.env.S3_FOLDER_PREFIX}/downloads/${fileKey}`,
          Body: tmpFile,
          ContentType: file.mimetype,
          ACL: 'public-read',
        }));
        console.log('Uploaded new file to S3');

        await Downloads.findByIdAndUpdate(req.params.id, {
          name: name,
          description: description,
          category: category,
          fileName: fileKey
        });
        console.log(`Updated download details and file for: ${name}`);
      }

      await req.app.dossier.create({
        by: res.user.cid,
        affected: -1,
        action: `%b updated the file *${name}*.`
      });

      res.stdRes.ret_det.message = 'Download updated successfully';
      return res.json(res.stdRes);

    } catch (e) {
      console.error('Error processing download update:', e);
      req.app.Sentry.captureException(e);
      res.stdRes.ret_det.code = 500;
      res.stdRes.ret_det.message = 'Internal Server Error';
      res.stdRes.data = { details: e.message };
      return res.json(res.stdRes);
    }
  });
});

router.delete('/downloads/:id', getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), async (req, res) => {
  try {
    const download = await Downloads.findByIdAndDelete(req.params.id).lean();

    // Delete the file from S3
    if (download.fileName) {
      await s3.send(new DeleteObjectCommand({
        Bucket: 'zauartcc',
        Key: `${process.env.S3_FOLDER_PREFIX}/downloads/${download.fileName}`
      }));
      console.log(`Deleted file from S3: ${process.env.FOLDER_PREFIX}/downloads/${download.fileName}`);
    }

    await req.app.dossier.create({
      by: res.user.cid,
      affected: -1,
      action: `%b deleted the file *${download.name}*.`
    });

    res.stdRes.ret_det.message = 'Download deleted successfully';
    return res.json(res.stdRes);

  } catch (e) {
    req.app.Sentry.captureException(e);
    res.stdRes.ret_det = e;
    return res.json(res.stdRes);
  }
});

// Documents
router.get('/documents', async (req, res) => {
  try {
    const documents = await Document.find({ deletedAt: null }).select('-content').sort({ category: "asc", name: 'asc' }).lean();
    res.stdRes.data = documents;
  } catch (e) {
    req.app.Sentry.captureException(e);
    res.stdRes.ret_det = e;
  }

  return res.json(res.stdRes);
});

router.get('/documents/:slug', async (req, res) => {
  try {
    const document = await Document.findOne({ slug: req.params.slug, deletedAt: null }).lean();
    res.stdRes.data = document;
  } catch (e) {
    req.app.Sentry.captureException(e);
    res.stdRes.ret_det = e;
  }

  return res.json(res.stdRes);
});

router.post('/documents', getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), async (req, res) => {
  console.log('Received request to /documents');

  if (req.headers['content-type'].includes('application/json')) {
    // Handle JSON request
    const { name, category, description, content, type } = req.body;

    console.log('Parsed JSON body:', { name, category, description, content, type });

    if (!category) {
      res.stdRes.ret_det.code = 400;
      res.stdRes.ret_det.message = 'You must select a category';
      return res.json(res.stdRes);
    }

    if (typeof name !== 'string') {
      res.stdRes.ret_det.code = 400;
      res.stdRes.ret_det.message = 'Name must be a string';
      return res.json(res.stdRes);
    }

    const slug = name.replace(/\s+/g, '-').toLowerCase().replace(/^-+|-+(?=-|$)/g, '').replace(/[^a-zA-Z0-9-_]/g, '') + '-' + Date.now().toString().slice(-5);
    console.log('Generated slug:', slug);

    try {
      if (type === "doc") {
        await handleDocumentUpload({ name, category, description, content, slug, req, res });
      } else {
        res.stdRes.ret_det.code = 400;
        res.stdRes.ret_det.message = 'Invalid document type';
        return res.json(res.stdRes);
      }
    } catch (e) {
      console.error('Error processing document:', e);
      req.app.Sentry.captureException(e);
      res.stdRes.ret_det.code = 500;
      res.stdRes.ret_det.message = 'Internal Server Error';
      res.stdRes.data = { details: e.message };
      return res.json(res.stdRes);
    }
  } else {
    // Handle multipart/form-data request
    const form = formidable({
      multiples: true,
      keepExtensions: true,
      maxFileSize: 200 * 1024 * 1024, // 200 MB
      maxFieldsSize: 10 * 1024 * 1024, // 10 MB
      maxFields: 1000,
      allowEmptyFiles: true,
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Form parse error:', err);
        res.stdRes.ret_det.code = 500;
        res.stdRes.ret_det.message = 'Form parse error';
        return res.json(res.stdRes);
      }

      console.log('Form parsed successfully:', { fields, files });

      // Extract the first element from the arrays
      const name = Array.isArray(fields.name) ? fields.name[0] : fields.name;
      const category = Array.isArray(fields.category) ? fields.category[0] : fields.category;
      const description = Array.isArray(fields.description) ? fields.description[0] : fields.description;
      const content = fields.content ? (Array.isArray(fields.content) ? fields.content[0] : fields.content) : null;
      const type = Array.isArray(fields.type) ? fields.type[0] : fields.type;

      console.log('Parsed fields:', { name, category, description, content, type });

      if (!category) {
        res.stdRes.ret_det.code = 400;
        res.stdRes.ret_det.message = 'You must select a category';
        return res.json(res.stdRes);
      }

      if (typeof name !== 'string') {
        res.stdRes.ret_det.code = 400;
        res.stdRes.ret_det.message = 'Name must be a string';
        return res.json(res.stdRes);
      }

      const slug = name.replace(/\s+/g, '-').toLowerCase().replace(/^-+|-+(?=-|$)/g, '').replace(/[^a-zA-Z0-9-_]/g, '') + '-' + Date.now().toString().slice(-5);
      console.log('Generated slug:', slug);

      try {
        if (type === "file") {
          await handleFileUpload({ name, category, description, slug, files, req, res });
        } else if (type === "doc") {
          await handleDocumentUpload({ name, category, description, content, slug, req, res });
        } else {
          res.stdRes.ret_det.code = 400;
          res.stdRes.ret_det.message = 'Invalid document type';
          return res.json(res.stdRes);
        }
      } catch (e) {
        console.error('Error processing document:', e);
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det.code = 500;
        res.stdRes.ret_det.message = 'Internal Server Error';
        res.stdRes.data = { details: e.message };
        return res.json(res.stdRes);
      }
    });
  }
});

async function handleFileUpload({ name, category, description, slug, files, req, res }) {
  const file = Array.isArray(files.download) ? files.download[0] : files.download;
  console.log('File to upload:', file);

  // Ensure the file object and file path are defined
  if (!file || !file.filepath) {
    throw {
      code: 400,
      message: 'No file uploaded or file path is undefined'
    };
  }

  console.log('File details:', file);

  if (file.size > (100 * 1024 * 1024)) { // 100MiB
    throw {
      code: 400,
      message: 'File too large'
    };
  }

  const tmpFile = await fs.readFile(file.filepath);
  console.log('Read temp file');

  const fileKey = `${Date.now()}-${file.originalFilename}`;
  await s3.send(new PutObjectCommand({
    Bucket: 'zauartcc', // Correct bucket name without slash
    Key: `${process.env.S3_FOLDER_PREFIX}/documents/${fileKey}`,
    Body: tmpFile,
    ContentType: file.mimetype,
    ACL: 'public-read',
  }));
  console.log('Uploaded file to S3');

  await Document.create({
    name,
    category,
    description,
    slug,
    author: res.user.cid,
    type: 'file',
    fileName: fileKey // Save the key used in S3
  });
  console.log('Created document in database');

  await req.app.dossier.create({
    by: res.user.cid,
    affected: -1,
    action: `%b created the document *${name}*.`
  });
  console.log('Created dossier entry');

  res.stdRes.ret_det.message = 'Document created successfully';
  return res.json(res.stdRes);
}

async function handleDocumentUpload({ name, category, description, content, slug, req, res }) {
  console.log('Handling document upload');

  if (!content) {
    res.stdRes.ret_det.code = 400;
    res.stdRes.ret_det.message = 'You must include content for document type';
    return res.json(res.stdRes);
  }

  await Document.create({
    name,
    category,
    description,
    content,
    slug,
    author: res.user.cid,
    type: 'doc'
  });
  console.log('Created document in database');

  await req.app.dossier.create({
    by: res.user.cid,
    affected: -1,
    action: `%b created the document *${name}*.`
  });
  console.log('Created dossier entry');

  res.stdRes.ret_det.message = 'Text Document created successfully';
  return res.json(res.stdRes);
}

router.put('/documents/:slug', getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), async (req, res) => {
  console.log('Received PUT request to /documents/:slug');

  if (req.is('multipart/form-data')) {
    const form = formidable();
    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Form parse error:', err);
        res.stdRes.ret_det.code = 500;
        res.stdRes.ret_det.message = 'Form parse error';
        return res.json(res.stdRes);
      }
    
      console.log('Form parsed successfully:', { fields, files });
    
      try {
        const document = await Document.findOne({ slug: req.params.slug });
        console.log('Document found:', document);
        if (!document) {
          res.stdRes.ret_det.code = 404;
          res.stdRes.ret_det.message = 'Document not found';
          return res.json(res.stdRes);
        }
    
        // Ensure fields are correctly extracted
        const name = Array.isArray(fields.name) ? fields.name[0] : fields.name;
        const category = Array.isArray(fields.category) ? fields.category[0] : fields.category;
        const description = Array.isArray(fields.description) ? fields.description[0] : fields.description;
        const type = Array.isArray(fields.type) ? fields.type[0] : fields.type;
        const oldFileName = Array.isArray(fields.oldFileName) ? fields.oldFileName[0] : fields.oldFileName;
        const file = files.download ? (Array.isArray(files.download) ? files.download[0] : files.download) : null;
    
        console.log('Parsed fields:', { name, category, description, type, oldFileName });
        console.log('Parsed file:', file);

        if (type === 'file' && file) {
          console.log('Processing file upload');

          if (file.size > (100 * 1024 * 1024)) { // 100MiB
            console.error('File too large');
            res.stdRes.ret_det.code = 400;
            res.stdRes.ret_det.message = 'File too large';
            return res.json(res.stdRes);
          }

          // Delete the old file from S3 if an old file name is provided
          if (oldFileName) {
            console.log(`Deleting old file from S3: documents/${oldFileName}`);
            await s3.send(new DeleteObjectCommand({
              Bucket: 'zauartcc',
              Key: `${process.env.S3_FOLDER_PREFIX}/documents/${oldFileName}`
            }));
            console.log(`Deleted old file from S3: documents/${oldFileName}`);
          }

          console.log('Reading temp file');
          const tmpFile = await fs.readFile(file.filepath);
          console.log('Read temp file');

          const fileKey = `${Date.now()}-${file.originalFilename}`;
          console.log('Uploading new file to S3 with key:', fileKey);
          await s3.send(new PutObjectCommand({
            Bucket: 'zauartcc',
            Key: `${process.env.S3_FOLDER_PREFIX}/documents/${fileKey}`,
            Body: tmpFile,
            ContentType: file.mimetype,
            ACL: 'public-read',
          }));
          console.log('Uploaded new file to S3');

          document.name = name;
          document.category = category;
          document.description = description;
          document.fileName = fileKey;
          document.type = 'file';

          console.log('Saving updated document to database');
          await document.save();
          console.log('Updated document in database');

          await req.app.dossier.create({
            by: res.user.cid,
            affected: -1,
            action: `%b updated the document *${name}*.`
          });
          console.log('Created dossier entry');

          res.stdRes.ret_det.message = 'Document updated successfully';
          return res.json(res.stdRes);
        } else {
          console.error('Invalid document type for form-data');
          res.stdRes.ret_det.code = 400;
          res.stdRes.ret_det.message = 'Invalid document type for form-data';
          return res.json(res.stdRes);
        }
      } catch (e) {
        console.error('Error processing document:', e);
        req.app.Sentry.captureException(e);
        res.stdRes.ret_det.code = 500;
        res.stdRes.ret_det.message = 'Internal Server Error';
        res.stdRes.data = { details: e.message };
        return res.json(res.stdRes);
      }
    });
  } else if (req.is('application/json')) {
    try {
      console.log('Processing JSON request');
      const document = await Document.findOne({ slug: req.params.slug });
      console.log('Document found:', document);
      if (!document) {
        res.stdRes.ret_det.code = 404;
        res.stdRes.ret_det.message = 'Document not found';
        return res.json(res.stdRes);
      }

      const { name, category, description, content, type } = req.body;
      console.log('Parsed JSON fields:', { name, category, description, content, type });

      if (type === 'doc') {
        document.name = name;
        document.slug = name.replace(/\s+/g, '-').toLowerCase().replace(/^-+|-+(?=-|$)/g, '').replace(/[^a-zA-Z0-9-_]/g, '') + '-' + Date.now().toString().slice(-5);
        document.category = category;
        document.description = description;
        document.content = content;
        document.type = 'doc';

        console.log('Saving updated document to database');
        await document.save();
        console.log('Updated document in database');

        await req.app.dossier.create({
          by: res.user.cid,
          affected: -1,
          action: `%b updated the document *${name}*.`
        });
        console.log('Created dossier entry');

        res.stdRes.ret_det.message = 'Document updated successfully';
        return res.json(res.stdRes);
      } else {
        console.error('Invalid document type for JSON');
        res.stdRes.ret_det.code = 400;
        res.stdRes.ret_det.message = 'Invalid document type for JSON';
        return res.json(res.stdRes);
      }
    } catch (e) {
      console.error('Error processing document:', e);
      req.app.Sentry.captureException(e);
      res.stdRes.ret_det.code = 500;
      res.stdRes.ret_det.message = 'Internal Server Error';
      res.stdRes.data = { details: e.message };
      return res.json(res.stdRes);
    }
  } else {
    console.error('Unsupported content type');
    res.stdRes.ret_det.code = 400;
    res.stdRes.ret_det.message = 'Unsupported content type';
    return res.json(res.stdRes);
  }
});

router.delete('/documents/:id', getUser, auth(['atm', 'datm', 'ta', 'fe', 'wm']), async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    
    if (!doc) {
      res.stdRes.ret_det.code = 404;
      res.stdRes.ret_det.message = 'Document not found';
      return res.json(res.stdRes);
    }

    // Check if the document is a file and delete it from S3
    if (doc.type === 'file' && doc.fileName) {
      const deleteParams = {
        Bucket: 'zauartcc',
        Key: `${process.env.S3_FOLDER_PREFIX}/documents/${doc.fileName}`
      };
      await s3.send(new DeleteObjectCommand(deleteParams));
      console.log('Deleted file from S3');
    }

    await Document.findByIdAndDelete(req.params.id);
    await req.app.dossier.create({
      by: res.user.cid,
      affected: -1,
      action: `%b deleted the document *${doc.name}*.`
    });

    res.stdRes.ret_det.message = 'Document deleted successfully';
  } catch (e) {
    console.error('Error deleting document:', e);
    req.app.Sentry.captureException(e);
    res.stdRes.ret_det.code = 500;
    res.stdRes.ret_det.message = 'Internal Server Error';
    res.stdRes.data = { details: e.message };
  }

  return res.json(res.stdRes);
});

export default router;