import { Document, model, Schema } from 'mongoose';

export interface IRole extends Document {
	code: string;
	order: number;
	name: string;
	class: string;
}

const RoleSchema = new Schema<IRole>({
	code: { type: String, required: true },
	order: { type: Number, required: true },
	name: { type: String, required: true },
	class: { type: String, required: true },
});

export const RoleModel = model<IRole>('Role', RoleSchema);
