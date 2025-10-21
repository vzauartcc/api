import { Document, model, Schema } from 'mongoose';

interface IOption extends Document {
	text: string;
	isCorrect: boolean;
}

export interface IQuestion extends Document {
	text: string;
	isTrueFalse: boolean;
	options: IOption[];
}

const OptionSchema = new Schema<IOption>({
	text: { type: String, required: true },
	isCorrect: { type: Boolean, required: true },
});

export const QuestionSchema = new Schema<IQuestion>({
	text: { type: String, required: true },
	isTrueFalse: { type: Boolean, default: false, required: true },
	options: { type: [OptionSchema], required: true, default: [] },
});

export const QuestionModel = model<IQuestion>('Question', QuestionSchema);
