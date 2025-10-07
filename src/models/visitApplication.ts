import { Document, model, Schema } from 'mongoose';
import * as softDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';

interface IVisitApplication extends Document, ITimestamps {
	cid: number;
	fname: string;
	lname: string;
	rating: string;
	email: string;
	home?: string;
	reason: string;
}

const VisitApplicationSchema = new Schema<IVisitApplication>(
	{
		cid: { type: Number, required: true },
		fname: { type: String, required: true },
		lname: { type: String, required: true },
		rating: { type: String },
		email: { type: String, required: true },
		home: { type: String },
		reason: { type: String },
	},
	{ collection: 'visitApplications', timestamps: true },
);

VisitApplicationSchema.plugin(softDelete.default, {
	deletedAt: true,
});

export const VisitApplicationModel = model<IVisitApplication>(
	'VisitApplication',
	VisitApplicationSchema,
);
