import { Document, model, Schema } from 'mongoose';

interface IPilotOnline extends Document {
	cid: number;
	name: string;
	callsign: string;
	aircraft: string;
	dep?: string;
	dest?: string;
	code?: string;
	lat: number;
	lng: number;
	altitude: number;
	heading: number;
	speed: number;
	planned_cruise: string;
	route?: string;
	remarks?: string;
}

const PilotOnlineSchema = new Schema<IPilotOnline>(
	{
		cid: { type: Number, required: true },
		name: { type: String, required: true },
		callsign: { type: String, required: true },
		aircraft: { type: String, required: true },
		dep: { type: String },
		dest: { type: String },
		code: { type: String },
		lat: { type: Number, required: true },
		lng: { type: Number, required: true },
		altitude: { type: Number, required: true },
		heading: { type: Number, required: true },
		speed: { type: Number, required: true },
		planned_cruise: { type: String },
		route: { type: String },
		remarks: { type: String },
	},
	{ collection: 'pilotsOnline' },
);

export const PilotOnlineModel = model<IPilotOnline>('PilotOnline', PilotOnlineSchema);
