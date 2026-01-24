import { Schema, Types } from 'mongoose';

export interface IResponse {
	questionId: Types.ObjectId;
	selectedOptions: Types.ObjectId[];
	timeSpent: number;
	isCorrect?: boolean;
}

export const ResponseSchema = new Schema<IResponse>(
	{
		questionId: { type: Schema.Types.ObjectId, ref: 'ExamQuestion' },
		selectedOptions: [{ type: Schema.Types.ObjectId, required: true }],
		timeSpent: { type: Number, default: 0, required: true },
		isCorrect: { type: Boolean },
	},
	{ _id: false },
);
ResponseSchema.virtual('question', {
	ref: 'ExamQuestion',
	localField: 'questionId',
	foreignField: '_id',
	justOne: true,
});
