import { Document, model, Schema } from 'mongoose';

interface IAtisOnline extends Document {
	cid: number;
	airport: string;
	callsign: string;
	code: string;
	text: string;
}

const AtisOnlineSchema = new Schema<IAtisOnline>(
	{
		cid: { type: Number, required: true },
		airport: { type: String, required: true },
		callsign: { type: String, required: true },
		code: { type: String, required: true },
		text: { type: String, required: true },
	},
	{
		collection: 'atisOnline',
	},
);

export const AtisOnlineModel = model<IAtisOnline>('AtisOnline', AtisOnlineSchema);
