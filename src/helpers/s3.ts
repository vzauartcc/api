import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'stream';

const BUCKET = 'zauartcc';

let client: S3Client | null = null;

const uploadMap = new Map<string, number>();
const EXPIRATION_TIME = 5 * 60 * 1000;

export const setUploadStatus = (id: string, progress: number) => {
	uploadMap.set(id, progress);

	setTimeout(() => {
		if (uploadMap.has(id)) {
			uploadMap.delete(id);
		}
	}, EXPIRATION_TIME);
};
export const getUploadStatus = (id: string) => uploadMap.get(id);

function getS3Prefix() {
	switch (process.env['S3_FOLDER_PREFIX']) {
		case 'production':
			return 'production';
		case 'staging':
			return 'staging';
		default:
			return 'development';
	}
}

const S3_PREFIX = getS3Prefix(); // Get the correct environment folder

export function setupS3() {
	const AWS_ACCESS_KEY_ID = process.env['AWS_ACCESS_KEY_ID'];
	const AWS_SECRET_ACCESS_KEY = process.env['AWS_SECRET_ACCESS_KEY'];

	if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
		throw new Error(
			'"AWS_ACCESS_KEY_ID" or "AWS_SECRET_ACCESS_KEY" is not set in environment variables.',
		);
	}

	client = new S3Client({
		endpoint: 'https://sfo3.digitaloceanspaces.com', // DigitalOcean Spaces or AWS S3
		region: 'us-east-1', // DigitalOcean Spaces requires a region (choose the closest one)
		credentials: {
			accessKeyId: AWS_ACCESS_KEY_ID,
			secretAccessKey: AWS_SECRET_ACCESS_KEY,
		},
	});
}

export function uploadToS3(
	filename: string,
	file: Readable,
	mimeType: string,
	options = {},
	progressHandler?: any,
) {
	if (!client) {
		throw new Error('S3 not set up.');
	}

	const upload = new Upload({
		client: client,
		params: {
			...options,
			Bucket: BUCKET,
			Key: `${S3_PREFIX}/${filename}`,
			Body: file,
			ContentType: mimeType,
			ACL: 'public-read',
		},
		queueSize: 4,
		partSize: 5242880, // 5MB
	});

	if (progressHandler) {
		upload.on('httpUploadProgress', progressHandler);
	}

	return upload.done();
}

export function deleteFromS3(filename: string) {
	if (!client) {
		throw new Error('S3 not set up.');
	}

	return client.send(
		new DeleteObjectCommand({
			Bucket: BUCKET,
			Key: `${S3_PREFIX}/${filename}`,
		}),
	);
}

export async function findInS3(filename: string) {
	if (!client) {
		throw new Error('S3 not set up.');
	}

	const command = new HeadObjectCommand({
		Bucket: BUCKET,
		Key: `${S3_PREFIX}/${filename}`,
	});

	try {
		await client.send(command);

		return true;
	} catch (e) {
		if ((e as any).name === 'NotFound') {
			return false;
		}

		throw e;
	}
}
