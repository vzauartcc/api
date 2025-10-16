import { Document, model, Schema } from 'mongoose';

interface IPirep extends Document {
	reportTime: Date;
	location: string;
	aircraft: string;
	flightLevel: string;
	skyCond?: string;
	turbulence?: string;
	icing?: string;
	vis?: string;
	temp?: string;
	wind?: string;
	urgent: boolean;
	raw: string;
	manual: boolean;
}

const PirepSchema = new Schema<IPirep>(
	{
		reportTime: { type: Date, required: true },
		location: { type: String, required: true },
		aircraft: { type: String, required: true },
		flightLevel: { type: String, required: true },
		skyCond: { type: String },
		turbulence: { type: String },
		icing: { type: String },
		vis: { type: String },
		temp: { type: String },
		wind: { type: String },
		urgent: { type: Boolean, required: true, default: false },
		raw: { type: String, required: true },
		manual: { type: Boolean, required: true, default: false },
	},
	{ collection: 'pirep' },
);

export const PirepModel = model<IPirep>('pirep', PirepSchema);
