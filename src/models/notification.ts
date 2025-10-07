import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import * as softDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

interface INotification extends Document, ITimestamps {
	recipient: number;
	read: boolean;
	title: string;
	content: string;
	link?: string;

	// Virutals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const NotificationSchema = new Schema<INotification>(
	{
		recipient: { type: Number, ref: 'User', required: true },
		read: { type: Boolean, default: false, required: true },
		title: { type: String, required: true },
		content: { type: String, required: true },
		link: { type: String },
	},
	{ timestamps: true },
);

NotificationSchema.plugin(softDelete.default, {
	deletedAt: true,
});

NotificationSchema.virtual('user', {
	ref: 'User',
	localField: 'recipient',
	foreignField: 'cid',
	justOne: true,
});

export const NotificationModel = model<INotification>('Notification', NotificationSchema);
