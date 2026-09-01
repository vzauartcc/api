import { Document, model, Schema, Types, type PopulatedDoc } from 'mongoose';
import mongooseLeanVirtuals from 'mongoose-lean-virtuals';
import type { IRatingRubric } from './ratingRubric.js';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export interface IRatingAttemptIndicator extends Document {
	indicatorId: Types.ObjectId;
	performance: 'satisfactory' | 'unsatisfactory';
	occurences: number;
	notes: string;

	name: string;
	deduction: number;
	maxOccurences: number;
	isActive: boolean;
	category: string;
	type: 'theory' | 'practical';
}

const RatingAttemptIndicatorSchema = new Schema<IRatingAttemptIndicator>({
	indicatorId: { type: Schema.Types.ObjectId, required: true },
	name: { type: String, required: true },
	deduction: { type: Number, required: true },
	maxOccurences: { type: Number, required: true },
	isActive: { type: Boolean, required: true },
	category: { type: String, required: true },
	type: { type: String, enum: ['theory', 'practical'], required: true },
	occurences: { type: Number, default: 0 },

	performance: { type: String, enum: ['satisfactory', 'unsatisfactory'] },
	notes: { type: String },
});

export interface IRatingAttempt extends ITimestamps {
	rubricId: Types.ObjectId;
	studentCid: number;
	instructorCid: number;

	indicators: IRatingAttemptIndicator[];

	theoryPassed: boolean;
	practicalPassed: boolean;

	theoryScore: number;
	practicalScore: number;
	totalScore: number;

	notes?: string;

	// Virtuals
	student?: PopulatedDoc<IUser & ITimestamps & Document>;
	instructor?: PopulatedDoc<IUser & ITimestamps & Document>;
	rubric?: PopulatedDoc<IRatingRubric & ITimestamps & Document>;
}

const RatingAttemptSchema = new Schema<IRatingAttempt>(
	{
		rubricId: { type: Schema.Types.ObjectId, required: true, ref: 'RatingRubric' },
		indicators: { type: [RatingAttemptIndicatorSchema], required: true },

		studentCid: { type: Number, required: true, ref: 'User' },
		instructorCid: { type: Number, required: true, ref: 'User' },

		theoryPassed: { type: Boolean, required: true },
		practicalPassed: { type: Boolean, required: true },

		theoryScore: { type: Number, required: true },
		practicalScore: { type: Number, required: true },
		totalScore: { type: Number, required: true },

		notes: { type: String },
	},
	{
		collection: 'ratingAttempt',
		timestamps: true,
	},
);

RatingAttemptSchema.plugin(mongooseLeanVirtuals);

RatingAttemptSchema.virtual('rubric', {
	ref: 'RatingRubric',
	localField: 'rubricId',
	foreignField: '_id',
	justOne: true,
});

RatingAttemptSchema.virtual('student', {
	ref: 'User',
	localField: 'studentCid',
	foreignField: 'cid',
	justOne: true,
});

RatingAttemptSchema.virtual('instructor', {
	ref: 'User',
	localField: 'instructorCid',
	foreignField: 'cid',
	justOne: true,
});

export const RatingAttemptModel = model<IRatingAttempt>('RatingAttempt', RatingAttemptSchema);
