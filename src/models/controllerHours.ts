import { Document, model, Schema } from 'mongoose';
import type { IUser } from './user.js';

interface IControllerHours extends Document {
	cid: number;
	timeStart: Date;
	timeEnd?: Date;
	position: string;

	// Virtuals
	user?: IUser;
}

const ControllerHoursSchema = new Schema<IControllerHours>(
	{
		cid: { type: Number, required: true, ref: 'User' },
		timeStart: { type: Date, required: true },
		timeEnd: { type: Date },
		position: { type: String, required: true },
	},
	{
		collection: 'controllerHours',
	},
);

ControllerHoursSchema.virtual('user', {
	ref: 'User',
	localField: 'cid',
	foreignField: 'cid',
	justOne: true,
});

export const ControllerHoursModel = model<IControllerHours>(
	'ControllerHours',
	ControllerHoursSchema,
);
