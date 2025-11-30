import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

interface IDownload extends Document, ITimestamps {
	name: string;
	description?: string;
	fileName: string;
	category: string;
	author: number;

	// Virtuals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const DownloadSchema = new Schema<IDownload>(
	{
		name: { type: String, required: true },
		description: { type: String },
		fileName: { type: String, required: true },
		category: { type: String, required: true },
		author: { type: Number, ref: 'User', required: true },
	},
	{
		collection: 'downloads',
		timestamps: true,
	},
);

DownloadSchema.virtual('user', {
	ref: 'User',
	localField: 'author',
	foreignField: 'cid',
	justOne: true,
});

export const DownloadModel = model<IDownload>('downloads', DownloadSchema);
