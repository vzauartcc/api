import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

interface IDocument extends Document, ITimestamps {
	name: string;
	category: string;
	description?: string;
	content?: string;
	slug: string;
	author: number;
	type: string;
	fileName: string;

	// Virtuals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const DocumentSchema = new Schema<IDocument>(
	{
		name: { type: String, required: true },
		category: { type: String, required: true },
		description: { type: String },
		content: { type: String },
		slug: { type: String, required: true },
		author: { type: Number, required: true, ref: 'User' },
		type: { type: String, required: true },
		fileName: { type: String, required: true },
	},
	{
		collection: 'documents',
		timestamps: true,
	},
);

DocumentSchema.virtual('user', {
	ref: 'User',
	localField: 'author',
	foreignField: 'cid',
	justOne: true,
});

export const DocumentModel = model<IDocument>('documents', DocumentSchema);
