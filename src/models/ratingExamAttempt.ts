import { Document, model, Schema, Types, type PopulatedDoc } from 'mongoose';
import mongooseLeanVirtuals from 'mongoose-lean-virtuals';
import type { ICertification } from './certification.js';
import type { IRatingExam, IRatingExamIndicator } from './ratingExam.js';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export interface IRatingExamAttemptIndicator extends IRatingExamIndicator {
	indicatorId: Types.ObjectId;
	performance: 'satisfactory' | 'unsatisfactory';
	occurrences: number;
	notes?: string;
}

const RatingExamAttemptIndicatorSchema = new Schema<IRatingExamAttemptIndicator>({
	name: { type: String, required: true },
	deduction: { type: Number, required: true },
	failureThreshold: { type: Number, required: true },
	isActive: { type: Boolean, required: true },
	category: { type: String, required: true },
	type: { type: String, enum: ['theory', 'practical'], required: true },

	indicatorId: { type: Schema.Types.ObjectId, required: true },
	occurrences: { type: Number, default: 0, required: true },
	performance: { type: String, enum: ['satisfactory', 'unsatisfactory'], required: true },
	notes: { type: String },
});

export interface IRatingExamAttempt extends ITimestamps {
	ratingExamId: Types.ObjectId;
	studentCid: number;
	instructorCid: number;

	indicators: IRatingExamAttemptIndicator[];

	theoryPassed: boolean;
	practicalPassed: boolean;
	passed: boolean;

	practicalScore: number;

	notes?: string;
	theoryNotes?: string;
	practicalNotes?: string;

	attempt: number;

	// Virtuals
	student?: PopulatedDoc<IUser & ITimestamps & Document>;
	instructor?: PopulatedDoc<IUser & ITimestamps & Document>;
	ratingExam?: PopulatedDoc<IRatingExam & ITimestamps & Document>;
	certification?: PopulatedDoc<ICertification & Document>;
}

const RatingExamAttemptSchema = new Schema<IRatingExamAttempt>(
	{
		ratingExamId: { type: Schema.Types.ObjectId, required: true, ref: 'RatingExam', index: true },
		indicators: { type: [RatingExamAttemptIndicatorSchema], required: true },

		studentCid: { type: Number, required: true, ref: 'User', index: true },
		instructorCid: { type: Number, required: true, ref: 'User' },

		theoryPassed: { type: Boolean, required: true },
		practicalPassed: { type: Boolean, required: true },
		passed: { type: Boolean, required: true },

		practicalScore: { type: Number, required: true },

		notes: { type: String },
		theoryNotes: { type: String },
		practicalNotes: { type: String },

		attempt: { type: Number, required: true },
	},
	{
		collection: 'ratingExamAttempts',
		timestamps: true,
	},
);

RatingExamAttemptSchema.index({ ratingExamId: 1, studentCid: 1 });

RatingExamAttemptSchema.plugin(mongooseLeanVirtuals);

RatingExamAttemptSchema.virtual('ratingExam', {
	ref: 'RatingExam',
	localField: 'ratingExamId',
	foreignField: '_id',
	justOne: true,
});

RatingExamAttemptSchema.virtual('student', {
	ref: 'User',
	localField: 'studentCid',
	foreignField: 'cid',
	justOne: true,
});

RatingExamAttemptSchema.virtual('instructor', {
	ref: 'User',
	localField: 'instructorCid',
	foreignField: 'cid',
	justOne: true,
});

export const RatingExamAttemptModel = model<IRatingExamAttempt>(
	'RatingExamAttempt',
	RatingExamAttemptSchema,
);
