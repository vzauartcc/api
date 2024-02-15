import m from 'mongoose';

const OptionSchema = new m.Schema({
    text: { type: String, required: true },
    isCorrect: { type: Boolean, required: true, default: false },
});

// Question schema to accommodate both types
const QuestionSchema = new m.Schema({
    text: { type: String, required: true },
    isTrueFalse: { type: Boolean, default: false },
    options: [OptionSchema],
});

const ExamSchema = new m.Schema({
    title: { type: String, required: true },
    description: String,
    questions: [QuestionSchema], // Embed the QuestionSchema here
    questionSubsetSize: { type: Number, required: true },
    timeLimit: { type: Number, required: true }, // Time limit in minutes
    createdBy: { type: m.Schema.Types.ObjectId, ref: 'User' }, // Reference to the user who created the exam
});

const ExamAttemptSchema = new m.Schema({
    exam: { type: m.Schema.Types.ObjectId, ref: 'Exam', required: true },
    user: { type: m.Schema.Types.ObjectId, ref: 'User', required: true },
    questionsOrder: [{ type: m.Schema.Types.ObjectId, ref: 'Question' }], // Ordered list of question IDs
    responses: [{
        question: { type: m.Schema.Types.ObjectId, ref: 'Question' },
        selectedOption: m.Schema.Types.ObjectId,
        timeSpent: Number, // Time spent on each question in seconds
        attemptOrder: Number, // Order in which the questions were attempted
        isCorrect: Boolean,
    }],
    startTime: Date,
    endTime: Date,
    totalScore: Number,
    passed: Boolean,
    attemptNumber: { type: Number, default: 1 },
    lastAttemptTime: Date,
    status: { type: String, enum: ['in_progress', 'completed', 'timed_out'] },
}, {
	collection: "examAttempts",
});


const Question = m.model('Question', QuestionSchema);
const Exam = m.model('Exam', ExamSchema);
const ExamAttempt = m.model('ExamAttempt', ExamAttemptSchema)

// ES6 syntax for exporting individually
export { Question, Exam, ExamAttempt };
