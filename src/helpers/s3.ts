import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

let client: S3Client | null = null;

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

export function uploadToS3(filename: string, file: Readable, mimeType: string, options = {}) {
	if (!client) {
		throw new Error('S3 not set up.');
	}

	return client.send(
		new PutObjectCommand({
			...options,
			Bucket: 'zauartcc',
			Key: `${S3_PREFIX}/${filename}`,
			Body: file,
			ContentType: mimeType,
			ACL: 'public-read',
		}),
	);
}

export function deleteFromS3(filename: string) {
	if (!client) {
		throw new Error('S3 not set up.');
	}

	return client.send(
		new DeleteObjectCommand({
			Bucket: 'zauartcc',
			Key: `${S3_PREFIX}/${filename}`,
		}),
	);
}
