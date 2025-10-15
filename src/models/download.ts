import { Document, model, Schema, Types } from 'mongoose';
import type { ITimestamps } from './timestamps.js';

interface IDownload extends Document, ITimestamps {
	name: string;
	description: string;
	fileName: string;
	category: string;
	author: Types.ObjectId;
}

const DownloadSchema = new Schema<IDownload>(
	{
		name: { type: String, required: true },
		description: { type: String, required: true },
		fileName: { type: String, required: true },
		category: { type: String, required: true },
		author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
	},
	{
		collection: 'downloads',
		timestamps: true,
	},
);

export const DownloadModel = model<IDownload>('downloads', DownloadSchema);
