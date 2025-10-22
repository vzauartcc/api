import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

interface IDossier extends Document, ITimestamps {
	by: number;
	affected: number;
	action: string;

	// Virtuals
	userBy?: PopulatedDoc<IUser & ITimestamps & Document>;
	userAffected?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const DossierSchema = new Schema<IDossier>(
	{
		by: { type: Number, ref: 'User' },
		affected: { type: Number, ref: 'User' },
		action: { type: String },
	},
	{
		collection: 'dossier',
		timestamps: true,
	},
);

DossierSchema.virtual('userBy', {
	ref: 'User',
	localField: 'by',
	foreignField: 'cid',
	justOne: true,
});

DossierSchema.virtual('userAffected', {
	ref: 'User',
	localField: 'affected',
	foreignField: 'cid',
	justOne: true,
});
export const DossierModel = model<IDossier>('dossier', DossierSchema);
