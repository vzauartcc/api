import { Document, model, Schema, Types } from 'mongoose';
import { QuestionSchema, type IQuestion } from './examQuestion.js';

interface IExam extends Document {
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

export const ExamModel = model<IExam>('Exam', ExamSchema);
