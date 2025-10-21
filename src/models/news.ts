import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

interface INews extends SoftDeleteDocument, ITimestamps {
	title: string;
	content: string;
	uriSlug: string;
	createdBy: number;

	// Virutals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const NewsSchema = new Schema<INews>(
	{
		title: { type: String, required: true },
		content: { type: String, required: true },
		uriSlug: { type: String, required: true },
		createdBy: { type: Number, ref: 'User' },
	},
	{ collection: 'news', timestamps: true },
);

NewsSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

NewsSchema.virtual('user', {
	ref: 'User',
	localField: 'createdBy',
	foreignField: 'cid',
	justOne: true,
});

export const NewsModel = model<INews, SoftDeleteModel<INews>>('News', NewsSchema);
