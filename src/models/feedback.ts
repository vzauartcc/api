import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import * as softDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

interface IFeedback extends Document, ITimestamps {
	name: string;
	email: string;
	submitter: number;
	controllerCid: number;
	rating: number;
	position: string;
	comments: string;
	anonymous: boolean;
	approved: boolean;

	// Virtuals
	controller?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const FeedbackSchema = new Schema<IFeedback>(
	{
		name: { type: String, required: true },
		email: { type: String, required: true },
		submitter: { type: Number, required: true },
		controllerCid: { type: Number, required: true, ref: 'User' },
		rating: { type: Number, required: true },
		position: { type: String, required: true },
		comments: { type: String, required: true },
		anonymous: { type: Boolean, default: false, required: true },
		approved: { type: Boolean, default: false, required: true },
	},
	{ collection: 'feedback', timestamps: true },
);

FeedbackSchema.plugin(softDelete.default, {
	deletedAt: true,
});

FeedbackSchema.virtual('controller', {
	ref: 'User',
	localField: 'controllerCid',
	foreignField: 'cid',
	justOne: true,
});

export const FeedbackModel = model<IFeedback>('feedback', FeedbackSchema);
