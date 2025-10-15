import { model, Schema } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';

interface IVisitApplication extends SoftDeleteDocument, ITimestamps {
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

VisitApplicationSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

export const VisitApplicationModel = model<IVisitApplication, SoftDeleteModel<IVisitApplication>>(
	'VisitApplication',
	VisitApplicationSchema,
);
