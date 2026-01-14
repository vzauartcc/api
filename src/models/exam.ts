import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import { QuestionSchema, type IQuestion } from './examQuestion.js';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export interface IExam extends SoftDeleteDocument, ITimestamps {
	title: string;
	description: string;
	questions: IQuestion[];
	createdBy: number;

	// Virtuals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const ExamSchema = new Schema<IExam>({
	title: { type: String, required: true },
	description: { type: String },
	questions: [QuestionSchema],
	createdBy: { type: Number, ref: 'User', required: true },
});

ExamSchema.virtual('user', {
	ref: 'User',
	localField: 'createdBy',
	foreignField: 'cid',
	justOne: true,
});

ExamSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

export const ExamModel = model<IExam, SoftDeleteModel<IExam>>('Exam', ExamSchema);
