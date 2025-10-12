import { model, Schema } from 'mongoose';
import MongooseDelete, { type SoftDeleteDocument, type SoftDeleteModel } from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';

export interface IStaffingRequest extends SoftDeleteDocument, ITimestamps {
	vaName: string;
	name: string;
	email: string;
	date: Date;
	pilots: number;
	route: string;
	description: string;
	accepted: boolean;
}

const StaffingRequestSchema = new Schema<IStaffingRequest>(
	{
		vaName: { type: String, required: true },
		name: { type: String, required: true },
		email: { type: String, required: true },
		date: { type: Date, required: true },
		pilots: { type: Number, required: true },
		route: { type: String, required: true },
		description: { type: String, required: true },
		accepted: { type: Boolean, default: false, required: true },
	},
	{ timestamps: true, collection: 'staffingRequests' },
);

StaffingRequestSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

export const StaffingRequestModel = model<IStaffingRequest, SoftDeleteModel<IStaffingRequest>>(
	'StaffingRequest',
	StaffingRequestSchema,
);
