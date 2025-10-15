import { Document, model, Schema } from 'mongoose';

interface IPirep extends Document {
	reportTime: Date;
	location: string;
	aircraft: string;
	flightLevel: string;
	skyCond: string;
	turbulence: string;
	icing: string;
	vis: string;
	temp: string;
	wind: string;
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
		skyCond: { type: String, required: true },
		turbulence: { type: String, required: true },
		icing: { type: String, required: true },
		vis: { type: String, required: true },
		temp: { type: String, required: true },
		wind: { type: String, required: true },
		urgent: { type: Boolean, default: false, required: true },
		raw: { type: String, required: true },
		manual: { type: Boolean, default: false, required: true },
	},
	{ collection: 'pirep' },
);

export const PirepModel = model<IPirep>('pirep', PirepSchema);
