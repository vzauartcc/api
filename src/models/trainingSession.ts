import { model, Schema, type Document, type PopulatedDoc } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';
import type { ITrainingRequestMilestone } from './trainingMilestone.js';
import type { IUser } from './user.js';

interface ITrainingSession extends SoftDeleteDocument, ITimestamps {
	studentCid: number;
	instructorCid: number;
	milestoneCode: string;
	position?: string;
	startTime: Date;
	endTime: Date;
	progress?: number;
	duration: string;
	movements?: number;
	location?: number;
	ots?: number;
	studentNotes?: string;
	insNotes?: string;
	submitted: boolean;
	synced?: boolean;

	// Virtuals
	milestone?: PopulatedDoc<ITrainingRequestMilestone & Document>;
	student?: PopulatedDoc<IUser & ITimestamps & Document>;
	instructor?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const TrainingSessionSchema = new Schema<ITrainingSession>(
	{
		studentCid: { type: Number, required: true, ref: 'User' },
		instructorCid: { type: Number, required: true, ref: 'User' },
		milestoneCode: { type: String, required: true, ref: 'TrainingMilestone' },
		position: { type: String },
		startTime: { type: Date, required: true },
		endTime: { type: Date, required: true },
		progress: { type: Number },
		duration: { type: String },
		movements: { type: Number },
		location: { type: Number },
		ots: { type: Number },
		studentNotes: { type: String },
		insNotes: { type: String },
		submitted: { type: Boolean, required: true },
		synced: { type: Boolean },
	},
	{ collection: 'trainingSessions', timestamps: true },
);

TrainingSessionSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

TrainingSessionSchema.virtual('milestone', {
	ref: 'TrainingMilestone',
	localField: 'milestoneCode',
	foreignField: 'code',
	justOne: true,
});

TrainingSessionSchema.virtual('student', {
	ref: 'User',
	localField: 'studentCid',
	foreignField: 'cid',
	justOne: true,
});

TrainingSessionSchema.virtual('instructor', {
	ref: 'User',
	localField: 'instructorCid',
	foreignField: 'cid',
	justOne: true,
});

export const TrainingSessionModel = model<ITrainingSession, SoftDeleteModel<ITrainingSession>>(
	'TrainingSession',
	TrainingSessionSchema,
);
