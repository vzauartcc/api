import { Document, model, Schema } from 'mongoose';

export interface ICertification extends Document {
	code: string;
	order: number;
	name: string;
	class: string;
	facility: string;
}

const CertificationSchema = new Schema<ICertification>({
	code: { type: String, required: true },
	order: { type: Number, required: true },
	name: { type: String, required: true },
	class: { type: String, required: true },
	facility: { type: String, required: true },
});

export const CertificationModel = model<ICertification>('Certification', CertificationSchema);
