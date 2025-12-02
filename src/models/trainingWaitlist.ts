import { model, Schema, type Document, type PopulatedDoc } from 'mongoose';
import type { ICertification } from './certification.js';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

interface ITrainingWaitlist extends ITimestamps {
	studentCid: number;
	certCode: string;
	availability: string[];
	instructorCid: number;
	assignedDate?: Date | null;

	// Virtuals
	certification?: PopulatedDoc<ICertification & Document>;
	student?: PopulatedDoc<IUser & ITimestamps & Document>;
	instructor?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const TrainingWaitlistSchema = new Schema<ITrainingWaitlist>(
	{
		studentCid: { type: Number, required: true, ref: 'User' },
		certCode: { type: String, required: true, ref: 'Certification' },
		availability: [{ type: String }],
		instructorCid: { type: Number, required: true, default: -1, ref: 'User' },
		assignedDate: { type: Date },
	},
	{ collection: 'trainingWaitlist', timestamps: true },
);

TrainingWaitlistSchema.virtual('certification', {
	ref: 'Certification',
	localField: 'certCode',
	foreignField: 'code',
	justOne: true,
});

TrainingWaitlistSchema.virtual('student', {
	ref: 'User',
	localField: 'studentCid',
	foreignField: 'cid',
	justOne: true,
});

TrainingWaitlistSchema.virtual('instructor', {
	ref: 'User',
	localField: 'instructorCid',
	foreignField: 'cid',
	justOne: true,
});

export const TrainingWaitlistModel = model<ITrainingWaitlist>(
	'TrainingWaitlist',
	TrainingWaitlistSchema,
);
