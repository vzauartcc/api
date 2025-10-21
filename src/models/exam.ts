import { model, Schema, Types } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import { QuestionSchema, type IQuestion } from './examQuestion.js';

export interface IExam extends SoftDeleteDocument {
	title: string;
	description: string;
	questions: IQuestion[];
	questionSubsetSize: number;
	timeLimit: number;
	createdBy: Types.ObjectId;
}

const ExamSchema = new Schema<IExam>({
	title: { type: String, required: true },
	description: { type: String },
	questions: [QuestionSchema],
	questionSubsetSize: { type: Number, required: true },
	timeLimit: { type: Number, required: true },
	createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
});

ExamSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

export const ExamModel = model<IExam, SoftDeleteModel<IExam>>('Exam', ExamSchema);
