import { Document, Schema, type PopulatedDoc } from 'mongoose';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export interface IEventPositionData {
	pos: string;
	type: string;
	code: string;
	takenBy?: number;
}

export interface IEventPosition extends IEventPositionData, Document {
	// Virtual
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
}

export const EventPositionSchema = new Schema<IEventPosition>(
	{
		pos: { type: String, required: true },
		type: { type: String, required: true },
		code: { type: String, required: true },
		takenBy: { type: Number },
	},
	{ timestamps: true },
);

EventPositionSchema.virtual('user', {
	ref: 'User',
	localField: 'takenBy',
	foreignField: 'cid',
	justOne: true,
});
