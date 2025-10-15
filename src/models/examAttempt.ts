import { Document, model, Schema, Types } from 'mongoose';

interface IResponse {
	question: Types.ObjectId;
	selectedOption: Types.ObjectId;
	timeSpent: number;
	attemptOrder: number;
	isCorrect: boolean;
}

interface IExamAttempt extends Document {
	exam: Types.ObjectId;
	user: Types.ObjectId;
	questionOrder: Types.ObjectId[];
	responses: IResponse[];
	startTime: Date;
	endTime: Date;
	totalScore: number;
	passed: boolean;
	attemptNumber: number;
	lastAttemptTime: Date;
	status: 'in_progress' | 'completed' | 'timed_out';
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
		exam: { type: Schema.Types.ObjectId, required: true, ref: 'Exam' },
		user: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
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
export const ExamAttemptModel = model<IExamAttempt>('ExamAttempt', ExamAttemptSchema);
