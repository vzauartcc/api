import { Document, model, Schema } from 'mongoose';
import mongooseLeanVirtuals from 'mongoose-lean-virtuals';
import zau from '../zau.js';

interface IAtcOnline extends Document {
	cid: number;
	name: string;
	rating: number;
	pos: string;
	timeStart: number;
	atis: string;
	frequency: number;

	// Virtuals
	ratingShort: string;
	ratingLong: string;
}

const AtcOnlineSchema = new Schema<IAtcOnline>({
	cid: { type: Number, required: true },
	name: { type: String, required: true },
	rating: { type: Number, required: true },
	pos: { type: String, required: true },
	timeStart: { type: Number, required: true },
	atis: { type: String, required: true, default: '' },
	frequency: { type: Number, required: true },
});

AtcOnlineSchema.virtual('ratingShort').get(function (this: IAtcOnline) {
	return zau.ratingsShort[this.rating];
});

AtcOnlineSchema.virtual('ratingLong').get(function (this: IAtcOnline) {
	return zau.ratingsLong[this.rating];
});

AtcOnlineSchema.plugin(mongooseLeanVirtuals);

export const AtcOnlineModel = model<IAtcOnline>('AtcOnline', AtcOnlineSchema);
