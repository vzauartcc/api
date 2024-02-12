import m from 'mongoose';

const OptionSchema = new m.Schema({
    text: { type: String, required: true },
    isCorrect: { type: Boolean, required: true, default: false },
});

const QuestionSchema = new m.Schema({
    text: { type: String, required: true },
    options: [OptionSchema], // Embed the OptionSchema here  
    testType: { type: String, required: true },
});

const ExamSchema = new m.Schema({
    title: { type: String, required: true },
    description: String,
    testType: { type: String, required: true }, // Ensure the exam is associated with a test type
    questions: [QuestionSchema], // Embed the QuestionSchema here
    timeLimit: { type: Number, required: true }, // Time limit in minutes
    createdBy: { type: m.Schema.Types.ObjectId, ref: 'User' }, // Reference to the user who created the exam
});

const ExamAttemptSchema = new m.Schema({
    exam: { type: m.Schema.Types.ObjectId, ref: 'Exam', required: true },
    user: { type: m.Schema.Types.ObjectId, ref: 'User', required: true },
    responses: [{
        question: { type: m.Schema.Types.ObjectId, ref: 'Question' },
        selectedOption: m.Schema.Types.ObjectId, // Assuming options have unique IDs
        isCorrect: Boolean,
    }],
    startTime: Date,
    endTime: Date,
    score: Number,
    status: { type: String, enum: ['in_progress', 'completed', 'timed_out'] },
});


const Question = m.model('Question', QuestionSchema);
const Exam = m.model('Exam', ExamSchema);
const ExamAttempt = m.model('ExamAttempt', ExamAttemptSchema)

// Export the models
module.exports = { Question, Exam, ExamAttempt };
