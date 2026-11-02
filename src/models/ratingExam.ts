import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import type { ICertification } from './certification.js';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export interface IRatingExamIndicator extends Document {
	name: string;
	deduction: number;
	failureThreshold: number;
	isActive: boolean;
	category: string;
	type: 'theory' | 'practical';
}

const RatingIndicatorSchema = new Schema<IRatingExamIndicator>({
	name: { type: String, required: true },
	deduction: { type: Number, required: true },
	failureThreshold: { type: Number, required: true },
	isActive: { type: Boolean, required: true },
	category: { type: String, required: true },
	type: { type: String, enum: ['theory', 'practical'], required: true },
});

export interface IRatingExam extends SoftDeleteDocument, ITimestamps {
	name: string;
	isActive: boolean;
	updatedBy: number;
	certCode: string;

	indicators: IRatingExamIndicator[];

	// Virtuals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
	certification?: PopulatedDoc<ICertification & Document>;
}

const RatingExamSchema = new Schema<IRatingExam>(
	{
		name: { type: String, required: true },
		isActive: { type: Boolean, required: true },
		indicators: { type: [RatingIndicatorSchema], required: true },
		updatedBy: { type: Number, required: true, ref: 'User' },
		certCode: { type: String, required: true },
	},
	{
		collection: 'ratingExams',
		timestamps: true,
	},
);

RatingExamSchema.virtual('user', {
	ref: 'User',
	localField: 'updatedBy',
	foreignField: 'cid',
	justOne: true,
});

RatingExamSchema.virtual('certification', {
	ref: 'Certification',
	localField: 'certCode',
	foreignField: 'code',
	justOne: true,
});

RatingExamSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

export const RatingExamModel = model<IRatingExam, SoftDeleteModel<IRatingExam>>(
	'RatingExam',
	RatingExamSchema,
);
