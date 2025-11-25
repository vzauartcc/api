import { Document, model, Schema, Types, type PopulatedDoc } from 'mongoose';
import type { IExam } from './exam.js';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

interface IResponse {
	question: Types.ObjectId;
	selectedOption: Types.ObjectId;
	timeSpent: number;
	attemptOrder: number;
	isCorrect: boolean;
}

interface IExamAttempt extends Document {
	examId: Types.ObjectId;
	student: number;
	questionOrder: Types.ObjectId[];
	responses: IResponse[];
	startTime: Date;
	endTime: Date;
	totalScore: number;
	passed: boolean;
	attemptNumber: number;
	lastAttemptTime: Date;
	status: 'in_progress' | 'completed' | 'timed_out';

	// Virtuals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
	exam?: PopulatedDoc<IExam & ITimestamps & Document>;
}

const ResponseSchema = new Schema<IResponse>(
	{
		question: { type: Schema.Types.ObjectId, ref: 'Question' },
		selectedOption: { type: Schema.Types.ObjectId },
		timeSpent: Number,
		attemptOrder: Number,
		isCorrect: Boolean,
	},
	{ _id: false },
);

const ExamAttemptSchema = new Schema<IExamAttempt>(
	{
		examId: { type: Schema.Types.ObjectId, required: true, ref: 'Exam' },
		student: { type: Number, required: true, ref: 'User' },
		questionOrder: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
		responses: [ResponseSchema],
		startTime: { type: Date, required: true },
		endTime: { type: Date },
		totalScore: { type: Number },
		passed: { type: Boolean },
		attemptNumber: { type: Number },
		lastAttemptTime: { type: Date },
		status: {
			type: String,
			enum: ['in_progress', 'completed', 'timed_out'],
			required: true,
		},
	},
	{ collection: 'examAttempts' },
);

ExamAttemptSchema.virtual('user', {
	ref: 'User',
	localField: 'student',
	foreignField: 'cid',
	justOne: true,
});

ExamAttemptSchema.virtual('exam', {
	ref: 'User',
	localField: 'exam',
	foreignField: '_id',
	justOne: true,
});

export const ExamAttemptModel = model<IExamAttempt>('ExamAttempt', ExamAttemptSchema);
