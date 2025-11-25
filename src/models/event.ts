import { type PopulatedDoc, Document, model, Schema } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import { type IEventPosition, EventPositionSchema } from './eventPosition.js';
import { type IEventSignup, EventSignupSchema } from './eventSignup.js';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

interface IEvent extends SoftDeleteDocument {
	name: string;
	description: string;
	url: string;
	bannerUrl: string;
	eventStart: Date;
	eventEnd: Date;
	createdBy: number;
	positions: IEventPosition[];
	signups: IEventSignup[];
	open: boolean;
	submitted: boolean;
	discordId?: string;

	// Virtuals
	user?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const EventSchema = new Schema<IEvent>(
	{
		name: { type: String, required: true },
		description: { type: String, required: true },
		url: { type: String, required: true },
		bannerUrl: { type: String },
		eventStart: { type: Date, required: true },
		eventEnd: { type: Date, required: true },
		createdBy: { type: Number, required: true, ref: 'User' },
		positions: {
			type: [EventPositionSchema],
			required: true,
			default: [],
		},
		signups: { type: [EventSignupSchema], required: true, default: [] },
		open: { type: Boolean, required: true },
		submitted: { type: Boolean, required: true },
		discordId: { type: String },
	},
	{
		timestamps: true,
	},
);

EventSchema.virtual('user', {
	ref: 'User',
	localField: 'createdBy',
	foreignField: 'cid',
	justOne: true,
});

EventSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

const EventModel = model<IEvent, SoftDeleteModel<IEvent>>('Event', EventSchema);

export default EventModel;
