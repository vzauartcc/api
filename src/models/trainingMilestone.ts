import { Document, model, Schema } from 'mongoose';

export interface ITrainingRequestMilestone extends Document {
	code: string;
	name: string;
	rating: number;
	certCode: string;
}

const TrainingRequestMilestoneSchema = new Schema<ITrainingRequestMilestone>(
	{
		code: { type: String, required: true },
		name: { type: String, required: true },
		rating: { type: Number, required: true },
		certCode: { type: String, required: true },
	},
	{ collection: 'trainingMilestones' },
);

export const TrainingRequestMilestoneModel = model<ITrainingRequestMilestone>(
	'TrainingMilestone',
	TrainingRequestMilestoneSchema,
);
