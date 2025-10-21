import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export interface IAbsence extends SoftDeleteDocument, ITimestamps {
	controller: number;
	expirationDate: Date;
	reason: string;

	// Virtuals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const AbsenceSchema = new Schema<IAbsence>(
	{
		controller: { type: Number, required: true, ref: 'User' },
		expirationDate: { type: Date, required: true },
		reason: { type: String, required: true },
	},
	{
		timestamps: true,
	},
);

AbsenceSchema.virtual('user', {
	ref: 'User',
	localField: 'controller',
	foreignField: 'cid',
	justOne: true,
});

AbsenceSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

export const AbsenceModel = model<IAbsence, SoftDeleteModel<IAbsence>>('Absence', AbsenceSchema);
