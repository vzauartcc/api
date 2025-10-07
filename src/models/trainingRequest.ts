import { model, Schema, type Document, type PopulatedDoc } from 'mongoose';
import * as softDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';
import type { ITrainingRequestMilestone } from './trainingMilestone.js';
import type { IUser } from './user.js';

interface ITrainingRequest extends Document, ITimestamps {
	studentCid: number;
	instructorCid?: number;
	startTime: Date;
	endTime: Date;
	milestoneCode: string;
	remarks?: string;

	// Virutals
	milestone?: PopulatedDoc<ITrainingRequestMilestone & Document>;
	student?: PopulatedDoc<IUser & ITimestamps & Document>;
	instructor?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const TrainingRequestSchema = new Schema<ITrainingRequest>(
	{
		studentCid: { type: Number, required: true, ref: 'User' },
		instructorCid: { type: Number, ref: 'User' },
		startTime: { type: Date, required: true },
		endTime: { type: Date, required: true },
		milestoneCode: { type: String, required: true, ref: 'TrainingMilestone' },
		remarks: { type: String, default: '' },
	},
	{ collection: 'trainingRequests', timestamps: true },
);

TrainingRequestSchema.plugin(softDelete.default, {
	deletedAt: true,
});

TrainingRequestSchema.virtual('milestone', {
	ref: 'TrainingMilestone',
	localField: 'milestoneCode',
	foreignField: 'code',
	justOne: true,
});

TrainingRequestSchema.virtual('student', {
	ref: 'User',
	localField: 'studentCid',
	foreignField: 'cid',
	justOne: true,
});

TrainingRequestSchema.virtual('instructor', {
	ref: 'User',
	localField: 'instructorCid',
	foreignField: 'cid',
	justOne: true,
});

export const TrainingRequestModel = model<ITrainingRequest>(
	'TrainingRequest',
	TrainingRequestSchema,
);
