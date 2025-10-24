import { model, Schema } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

interface ISoloEndorsement extends SoftDeleteDocument, ITimestamps {
	studentCid: number;
	instructorCid: number;
	endTime: Date;
	position: string;
	vatusaId: number;

	// Virutals
	student?: IUser;
	instructor?: IUser;
}

const SoloEndorsementSchema = new Schema<ISoloEndorsement>(
	{
		studentCid: { type: Number, required: true, ref: 'User' },
		instructorCid: { type: Number, required: true, ref: 'User' },
		endTime: { type: Date, required: true },
		position: { type: String, required: true },
		vatusaId: { type: Number, required: true },
	},
	{ collection: 'soloEndorsements', timestamps: true },
);

SoloEndorsementSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

SoloEndorsementSchema.virtual('student', {
	ref: 'User',
	localField: 'studentCid',
	foreignField: 'cid',
	justOne: true,
});

SoloEndorsementSchema.virtual('instructor', {
	ref: 'User',
	localField: 'instructorCid',
	foreignField: 'cid',
	justOne: true,
});

export const SoloEndorsementModel = model<ISoloEndorsement, SoftDeleteModel<ISoloEndorsement>>(
	'SoloEndorsement',
	SoloEndorsementSchema,
);
