import { Document, Schema, type PopulatedDoc } from 'mongoose';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export interface IEventPosition {
	pos: string;
	type: string;
	code: string;
	takenBy?: number;

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
	{ _id: false },
);

EventPositionSchema.virtual('user', {
	ref: 'User',
	localField: 'takenBy',
	foreignField: 'cid',
	justOne: true,
});
