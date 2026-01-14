import { Document, Schema } from 'mongoose';

interface IOption extends Document {
	text: string;
	isCorrect: boolean;
}

export interface IQuestion extends Document {
	text: string;
	isActive: boolean;
	options: IOption[];
}

const OptionSchema = new Schema<IOption>({
	text: { type: String, required: true },
	isCorrect: { type: Boolean, required: true },
});

export const QuestionSchema = new Schema<IQuestion>({
	text: { type: String, required: true },
	isActive: { type: Boolean, default: true, required: true },
	options: { type: [OptionSchema], required: true, default: [] },
});
