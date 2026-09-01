import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export interface IRatingRubricIndicator extends Document {
	name: string;
	deduction: number;
	maxOccurences: number;
	isActive: boolean;
	category: string;
	type: 'theory' | 'practical';
}

const RatingIndicatorSchema = new Schema<IRatingRubricIndicator>({
	name: { type: String, required: true },
	deduction: { type: Number, required: true },
	maxOccurences: { type: Number, required: true },
	isActive: { type: Boolean, required: true },
	category: { type: String, required: true },
	type: { type: String, enum: ['theory', 'practical'], required: true },
});

export interface IRatingRubric extends SoftDeleteDocument, ITimestamps {
	name: string;
	isActive: boolean;
	updatedBy: number;

	indicators: IRatingRubricIndicator[];

	// Virtuals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const RatingRubricSchema = new Schema<IRatingRubric>(
	{
		name: { type: String, required: true },
		isActive: { type: Boolean, required: true },
		indicators: { type: [RatingIndicatorSchema], required: true },
		updatedBy: { type: Number, required: true, ref: 'User' },
	},
	{
		collection: 'ratingRubric',
		timestamps: true,
	},
);

RatingRubricSchema.virtual('user', {
	ref: 'User',
	localField: 'updatedBy',
	foreignField: 'cid',
	justOne: true,
});

RatingRubricSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

export const RatingRubricModel = model<IRatingRubric, SoftDeleteModel<IRatingRubric>>(
	'RatingRubric',
	RatingRubricSchema,
);
