import { Document, model, Schema, Types, type PopulatedDoc } from 'mongoose';
import type { SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import mongooseLeanVirtuals from 'mongoose-lean-virtuals';
import type { IExam } from './exam.js';
import { QuestionSchema, type IQuestion } from './examQuestion.js';
import { ResponseSchema, type IResponse } from './examQuestionResponse.js';
import type { ITimestamps } from './timestamps.js';

import type { IUser } from './user.js';

export interface IExamAttempt extends Document, ITimestamps {
	examId: Types.ObjectId;
	student: number;
	questionOrder: IQuestion[];
	responses: IResponse[];
	startTime?: Date;
	endTime?: Date;
	totalScore?: number;
	grade?: number;
	totalTime?: number;
	passed?: boolean;
	attemptNumber: number;
	status: 'not_started' | 'in_progress' | 'completed' | 'timed_out';

	// Virtuals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
	exam?: PopulatedDoc<IExam & ITimestamps & Document>;
	isComplete: boolean;
}

const ExamAttemptSchema = new Schema<IExamAttempt>(
	{
		examId: { type: Schema.Types.ObjectId, required: true, ref: 'Exam' },
		student: { type: Number, required: true, ref: 'User' },
		questionOrder: [{ type: QuestionSchema }],
		responses: [ResponseSchema],
		startTime: { type: Date },
		endTime: { type: Date },
		totalScore: { type: Number },
		grade: { type: Number },
		totalTime: { type: Number },
		passed: { type: Boolean },
		attemptNumber: { type: Number, required: true },
		status: {
			type: String,
			enum: ['not_started', 'in_progress', 'completed', 'timed_out'],
			required: true,
		},
	},
	{ collection: 'examAttempts', timestamps: true },
);

ExamAttemptSchema.plugin(mongooseLeanVirtuals);

ExamAttemptSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

ExamAttemptSchema.virtual('isComplete').get(function (this: IExamAttempt) {
	return this.status === 'completed' || this.status === 'timed_out';
});

ExamAttemptSchema.virtual('user', {
	ref: 'User',
	localField: 'student',
	foreignField: 'cid',
	justOne: true,
});

ExamAttemptSchema.virtual('exam', {
	ref: 'Exam',
	localField: 'examId',
	foreignField: '_id',
	justOne: true,
});

export const ExamAttemptModel = model<IExamAttempt, SoftDeleteModel<IExamAttempt>>(
	'ExamAttempt',
	ExamAttemptSchema,
);
