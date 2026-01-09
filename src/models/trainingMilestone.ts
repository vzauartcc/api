import { Document, model, Schema } from 'mongoose';

export interface ITrainingRequestMilestone extends Document {
	code: string;
	name: string;
	rating: number;
	certCode: string;
	isActive: boolean;
	order: number;
}

const TrainingRequestMilestoneSchema = new Schema<ITrainingRequestMilestone>(
	{
		code: { type: String, required: true, unique: true },
		name: { type: String, required: true },
		rating: { type: Number, required: true },
		certCode: { type: String, required: true },
		isActive: { type: Boolean, required: true },
		order: { type: Number, required: true },
	},
	{ collection: 'trainingMilestones' },
);

export const TrainingRequestMilestoneModel = model<ITrainingRequestMilestone>(
	'TrainingMilestone',
	TrainingRequestMilestoneSchema,
);
