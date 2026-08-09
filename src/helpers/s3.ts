import {
	DeleteObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
	type CompleteMultipartUploadCommandInput,
	type CreateMultipartUploadCommandInput,
	type PutObjectCommandInput,
	type UploadPartCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';

let client: S3Client | null = null;

function getS3Bucket() {
	return `${process.env['S3_BUCKET_NAME']}`;
}

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
	options = {} as Partial<PutObjectCommandInput> &
		Partial<
			CreateMultipartUploadCommandInput &
				UploadPartCommandInput &
				CompleteMultipartUploadCommandInput
		>,
) {
	if (!client || !getS3Bucket()) {
		throw new Error('S3 not set up.');
	}

	return client.send(
		new PutObjectCommand({
			...options,
			Bucket: getS3Bucket(),
			Key: filename,
			Body: file,
			ContentType: mimeType,
			ACL: 'public-read',
		}),
	);
}

export function generateS3SignedUrl(
	fileName: string,
	contentType: string,
	fileSize: number,
): Promise<string> {
	if (!client || !getS3Bucket()) {
		throw new Error('S3 not set up.');
	}

	const cmd = new PutObjectCommand({
		Bucket: getS3Bucket(),
		Key: fileName,
		ContentType: contentType,
		ContentLength: fileSize,
		ACL: 'public-read',
	});

	return getSignedUrl(client, cmd, {
		expiresIn: 300,
		signableHeaders: new Set(['content-length', 'content-type', 'host', 'x-amz-acl']),
	});
}

export function deleteFromS3(filename: string) {
	if (!client || !getS3Bucket()) {
		throw new Error('S3 not set up.');
	}

	return client.send(
		new DeleteObjectCommand({
			Bucket: getS3Bucket(),
			Key: filename,
		}),
	);
}

export async function findInS3(filename: string) {
	if (!client || !getS3Bucket()) {
		throw new Error('S3 not set up.');
	}

	const command = new HeadObjectCommand({
		Bucket: getS3Bucket(),
		Key: filename,
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

export async function findPrefixInS3(partial: string) {
	if (!client || !getS3Bucket()) {
		throw new Error('S3 not set up.');
	}

	const allKeys = [];
	let isTruncated = true;
	let continuationToken = undefined;

	while (isTruncated) {
		const cmd: ListObjectsV2Command = new ListObjectsV2Command({
			Bucket: getS3Bucket(),
			Prefix: partial,
			ContinuationToken: continuationToken,
		});

		const response = await client.send(cmd);

		if (response.Contents) {
			const keys = response.Contents.map((obj) => obj.Key);
			allKeys.push(...keys);
		}

		isTruncated = response.IsTruncated || false;
		continuationToken = response.NextContinuationToken;
	}

	return allKeys;
}
