/**
 * Any changes to this model should be reflected to both the api and data-parser repositories.
 **/

import { Document, model, Schema } from 'mongoose';
import type { IUser } from './user.js';

interface IControllerHours extends Document {
	cid: number;
	timeStart: Date;
	timeEnd: Date;
	position: string;
	isStudent: boolean;
	isInstructor: boolean;

	// Virtuals
	user?: IUser;
}

const ControllerHoursSchema = new Schema<IControllerHours>(
	{
		cid: { type: Number, required: true, ref: 'User' },
		timeStart: { type: Date, required: true },
		timeEnd: { type: Date, required: true },
		position: { type: String, required: true },
		isStudent: { type: Boolean, required: true },
		isInstructor: { type: Boolean, required: true },
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
