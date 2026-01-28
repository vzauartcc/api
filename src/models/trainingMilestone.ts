import { Document, model, Schema } from 'mongoose';

export const milestoneTypes = ['session', 'waitlist'] as const;

type MilestoneType = (typeof milestoneTypes)[number];

export interface ITrainingRequestMilestone extends Document {
	code: string;
	name: string;
	rating: number;
	certCode: string;
	isActive: boolean;
	order: number;
	type: MilestoneType;
}

const TrainingRequestMilestoneSchema = new Schema<ITrainingRequestMilestone>(
	{
		code: { type: String, required: true, unique: true },
		name: { type: String, required: true },
		rating: { type: Number, required: true },
		certCode: { type: String, required: true },
		isActive: { type: Boolean, required: true },
		order: { type: Number, required: true },
		type: { type: String, enum: milestoneTypes, required: true },
	},
	{ collection: 'trainingMilestones' },
);

export const TrainingRequestMilestoneModel = model<ITrainingRequestMilestone>(
	'TrainingMilestone',
	TrainingRequestMilestoneSchema,
);
