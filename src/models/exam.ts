import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import type { ICertification } from './certification.js';
import { QuestionSchema, type IQuestion } from './examQuestion.js';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export interface IExam extends SoftDeleteDocument, ITimestamps {
	title: string;
	description: string;
	questions: IQuestion[];
	createdBy: number;
	certCode: string;

	// Virtuals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
	certification?: PopulatedDoc<ICertification & Document>;
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

ExamSchema.virtual('certification', {
	ref: 'Certification',
	localField: 'certCode',
	foreignField: 'code',
	justOne: true,
});

ExamSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

export const ExamModel = model<IExam, SoftDeleteModel<IExam>>('Exam', ExamSchema);
