import { Document, model, Schema } from 'mongoose';
import softDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';

interface IStaffingRequest extends Document, ITimestamps {
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

StaffingRequestSchema.plugin(softDelete, {
	deletedAt: true,
});

export const StaffingRequestModel = model<IStaffingRequest>(
	'StaffingRequest',
	StaffingRequestSchema,
);
