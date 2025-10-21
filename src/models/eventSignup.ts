import { Document, Schema, type PopulatedDoc } from 'mongoose';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export interface IEventSignup extends Document, ITimestamps {
	cid: number;
	requests: string[];

	// Virtual
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
}

export const EventSignupSchema = new Schema<IEventSignup>(
	{
		cid: { type: Number, ref: 'User' },
		requests: [{ type: String, required: true, default: [] }],
	},
	{ timestamps: true },
);

EventSignupSchema.virtual('user', {
	ref: 'User',
	localField: 'cid',
	foreignField: 'cid',
	justOne: true,
});
