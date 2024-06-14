import express from 'express';
const router = express.Router();
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import getUser from '../middleware/getUser.js';
import auth from '../middleware/auth.js';
import { Exam, Question, ExamAttempt } from '../models/Exam.js'; // Adjust the path as needed
import TrainingProgress from '../models/TrainingProgress.js';
import { body, validationResult} from 'express-validator';
import microAuth from '../middleware/microAuth.js';

// Define validation chain for creating a new exam
const createExamValidation = [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').trim().optional(),
    body('questions.*.text').notEmpty().withMessage('Question text is required'),
    body('questions.*.isTrueFalse').isBoolean().withMessage('isTrueFalse must be a boolean'),
    body('questions.*.options.*.text').notEmpty().withMessage('Option text is required'),
    body('questions.*.options.*.isCorrect').isBoolean().withMessage('isCorrect must be a boolean'),
    body('timeLimit').isNumeric().withMessage('Time limit must be a number'),
    body('questionSubsetSize').isNumeric().withMessage('Question subset size must be a number').isInt().withMessage('Question subset size must be a whole number'),
    // Custom validation logic here
    (req, res, next) => {
        const questions = req.body.questions || [];
        const errors = [];
        
        questions.forEach((question, index) => {
            // Validate true/false questions
            if (question.isTrueFalse) {
                const trueOption = question.options.find(option => option.text.toLowerCase() === 'true');
                const falseOption = question.options.find(option => option.text.toLowerCase() === 'false');
                if (!trueOption || !falseOption || question.options.length > 2) {
                    errors.push({ msg: `Question ${index + 1}: True/False questions must have exactly one 'true' and one 'false' option` });
                }
            } else {
                // Validate multiple-choice questions
                if (!question.options || question.options.length !== 4) {
                    errors.push({ msg: `Question ${index + 1}: Multiple-choice questions must have exactly four options`});
                }
                const correctOptions = question.options.filter(option => option.isCorrect);
                if (correctOptions.length !== 1) {
                    errors.push({ msg: `Question ${index + 1}: Multiple-choice questions must have exactly one correct option` });
                }
            }
        });

        if (errors.length > 0) {
            return res.status(400).json({ errors });
        }
        
        next();
    },
];


// Create Exam
router.post('/exams', getUser, auth(['atm', 'datm', 'ta']), createExamValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    // Inside your route, after validation passed
    if (req.body.questions.length < req.body.questionSubsetSize) {
        return res.status(400).json({ message: "Questions per test cannot exceed the total number of questions" });
    }
    
    try {
        const newExam = new Exam({
            title: req.body.title,
            description: req.body.description,
            questions: req.body.questions,
            timeLimit: req.body.timeLimit,
            questionSubsetSize: req.body.questionSubsetSize,
            createdBy: res.user._id,
        });
        await newExam.save();
        res.status(201).json({ message: "Exam created successfully", examId: newExam._id });
    } catch (error) {
        console.error("Error creating exam:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Update Exam
router.patch('/exams/:examId', getUser, auth(['atm', 'datm', 'ta']), async (req, res) => {
    const { examId } = req.params; // Get the exam ID from the URL parameter
    const { title, description, questions, timeLimit, questionSubsetSize } = req.body; // Extract updated fields from the request body

    try {
        // Find the exam by ID and update it with new values
        // Using findByIdAndUpdate to find the exam and update it atomically
        const updatedExam = await Exam.findByIdAndUpdate(examId, {
            title,
            description,
            questions,
            timeLimit,
            questionSubsetSize,
            // createdBy field is not updated here, assuming it remains unchanged
        }, { new: true }); // { new: true } option returns the document after update

        if (!updatedExam) {
            return res.status(404).json({ message: "Exam not found" });
        }

        // Respond with the updated exam information
        res.json({ message: "Exam updated successfully", exam: updatedExam });
    } catch (error) {
        console.error("Error updating exam:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


// Start Exam Attempt
router.post('/exams/:examId/start', getUser, async (req, res) => {
    const { examId } = req.params;
    const userId = req.user._id;

    // Prevent starting another attempt if one is already in progress and not timed out
    const now = new Date();
    const existingAttempt = await ExamAttempt.findOne({
        exam: examId,
        user: userId,
        status: 'in_progress',
        endTime: { $gt: now } // Check if the attempt is still within the time limit
    });

    if (existingAttempt) {
        // Calculate remaining time for the existing attempt
        const timeRemaining = existingAttempt.endTime.getTime() - now.getTime();
        return res.status(200).json({
            message: "Existing exam attempt resumed.",
            attemptId: existingAttempt._id,
            timeRemaining,
        });
    }

    // Fetch the exam details
    const exam = await Exam.findById(examId);
    if (!exam) {
        return res.status(404).json({ message: "Exam not found." });
    }

    // Find the most recent attempt for this exam and user
    const latestAttempt = await ExamAttempt.findOne({ exam: examId, user: userId })
        .sort({ createdAt: -1 }); // Assuming createdAt is a field that tracks when the attempt was made

    if (latestAttempt) {
        // Check if the maximum attempts have been reached
        if (latestAttempt.attemptNumber >= 3) {
            return res.status(400).json({ message: "Maximum attempts reached." });
        }

        // Check if 24 hours have passed since the last attempt
        const hoursSinceLastAttempt = (now - latestAttempt.lastAttemptTime) / (1000 * 60 * 60);
        if (hoursSinceLastAttempt < 24) {
            return res.status(400).json({ message: "24-hour waiting period has not passed since your last attempt." });
        }
    }

    // Fetch questions for the test type and randomly select the required subset
    const allQuestions = await Question.find({ testType: exam.testType });
    const questionSubsetSize = exam.questionSubsetSize || 30; // Default to 30 if not specified
    const selectedQuestions = selectRandomSubset(allQuestions, questionSubsetSize);
    const questions = selectedQuestions.sort(() => 0.5 - Math.random());

    // Create the exam attempt
    const newAttempt = new ExamAttempt({
        exam: examId,
        user: userId,
        questionsOrder: questions.map(q => q._id),
        responses: questions.map(q => ({
            question: q._id,
            selectedOption: null,
            isCorrect: null,
        })),
        startTime: new Date(),
        endTime: new Date(new Date().getTime() + exam.timeLimit * 60000), // Calculate end time based on timeLimit
        status: 'in_progress',
    });

    await newAttempt.save();
    // Send back the time remaining along with attempt details
    const timeRemaining = newAttempt.endTime.getTime() - Date.now();
    res.status(201).json({ message: "Exam started successfully", attemptId: newAttempt._id, timeRemaining });
});

// Patch Exam Attempt (update answers, time spent, and submit)
router.patch('/exams/:examId/attempt', getUser, async (req, res) => {
    const { examId } = req.params;
    const userId = req.user._id;
    const { responses, submit } = req.body; // `submit` indicates if this is a final submission

    try {
        // Fetch the existing exam attempt
        let examAttempt = await ExamAttempt.findOne({
            exam: examId,
            user: userId,
            status: { $in: ['in_progress'] }
        });

        if (!examAttempt) {
            return res.status(404).json({ message: "Exam attempt not found or already submitted." });
        }

        // If responses are provided, update them
        if (responses && Array.isArray(responses)) {
            responses.forEach(response => {
                // Find the matching question in the attempt and update it
                let attemptResponse = examAttempt.responses.find(r => r.question.toString() === response.questionId);
                if (attemptResponse) {
                    if (response.selectedOption) {
                        attemptResponse.selectedOption = response.selectedOption;
                    }
                    if (response.timeSpent) {
                        attemptResponse.timeSpent += response.timeSpent; // Accumulate time spent
                    }
                    // Update correctness based on the new answer, if needed
                    // This requires fetching the question details or having that information available
                }
            });
        }

        // If this is a final submission, update the attempt's status and potentially calculate the score
        if (submit) {
            examAttempt.status = 'completed';
            examAttempt.endTime = new Date();
        
            // Load the exam document to access the questions and their options
            const exam = await Exam.findById(examAttempt.exam).exec();
            if (!exam) {
                return res.status(404).json({ message: "Exam not found." });
            }
        
            let correctAnswers = 0;
        
            // Iterate over the responses in the exam attempt
            examAttempt.responses.forEach(response => {
                // Find the corresponding question in the exam document
                const question = exam.questions.find(q => q._id.equals(response.question));
        
                if (question) {
                    // Use the adjusted calculateCorrectness function
                    const isCorrect = calculateCorrectness(question.options, response.selectedOption);
                    if (isCorrect) correctAnswers++;
        
                    // Update the correctness status in the response object if necessary
                    response.isCorrect = isCorrect;
                }
            });
        
            const score = (correctAnswers / examAttempt.responses.length) * 100;
            examAttempt.score = score;
            examAttempt.passed = score >= 80; // Assuming 80 is the passing score
        }

        await examAttempt.save();

        res.json({
            message: submit ? "Exam submitted successfully" : "Exam attempt updated",
            examAttemptId: examAttempt._id,
            status: examAttempt.status,
            ...(submit && { score: examAttempt.score, passed: examAttempt.passed }) // Include score and passed only on submission
        });
    } catch (error) {
        console.error("Error updating exam attempt:", error);
        res.status(500).json({ message: "Internal server error", error: error.toString() });
    }
});

router.get('/exams', getUser, auth(['atm', 'datm', 'ta']), async (req, res) => {
    try {
        // Fetch all exams, populate createdBy, and exclude questions
        const exams = await Exam.find().populate('createdBy', 'fname lname').lean();

        // Transform exams to include questions count (assuming questions are embedded)
        const examsWithQuestionCountAndCreator = exams.map(exam => ({
            ...exam,
            questionsCount: exam.questions ? exam.questions.length : 0, // Add questions count
            createdBy: { // Only include fname and lname of the creator
                fname: exam.createdBy.fname,
                lname: exam.createdBy.lname
            }
        }));

        res.stdRes.data = examsWithQuestionCountAndCreator;

    } catch (e) {
        console.error("Error fetching exams:", e);
        res.status(500).json({ message: "Internal server error" });
    }

    return res.json(res.stdRes);
});


router.get('/exams/:id', getUser, auth(["atm", "datm", "ta"]), async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id).populate('createdBy', 'fname lname');
        if (!exam) {
            return res.status(404).json({ message: "Exam not found" });
        }
        res.stdRes.data = exam;

        res.json(res.stdRes);
    } catch (error) {
        console.error("Error fetching exam details:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

router.get('/exams/:id/results', getUser, async (req, res) => {
    try {
        const examAttempt = await ExamAttempt.findOne({
            exam: req.params.id,
            user: req.user._id, // Ensure results are fetched for the logged-in user
        });
        if (!examAttempt) {
            return res.status(404).json({ message: "Results not found" });
        }
        res.json(examAttempt);
    } catch (error) {
        console.error("Error fetching exam results:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

router.put('/exams/:examId/resetAttempts', getUser, auth(['atm', 'datm', 'ta', 'ins']), async (req, res) => {
    const { examId } = req.params;
    const { userId } = req.body; // Assume the userId to reset attempts for is sent in the request

    // Reset attempts logic here
    // This could involve updating existing attempt documents or tracking attempts separately
});

router.delete('/exams/:id', getUser, auth(["atm", "datm", "ta"]), async (req, res) => {
    try {
        // Attempt to find and delete the exam by ID
        const deletedExam = await Exam.findByIdAndDelete(req.params.id);

        // If no exam was found and deleted, return a 404 error
        if (!deletedExam) {
            return res.status(404).json({ message: "Exam not found" });
        }

        // Respond with success message
        res.json({ message: "Exam successfully deleted", examId: req.params.id });
    } catch (error) {
        console.error("Error deleting exam:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

async function selectRandomSubset(allQuestions, questionSubsetSize) {
    const itemsCopy = [...allQuestions];
    let subset = [];
  
    if (questionSubsetSize > itemsCopy.length) {
      questionSubsetSize = itemsCopy.length;
    }
  
    while (subset.length < questionSubsetSize) {
      const randomIndex = Math.floor(Math.random() * itemsCopy.length);
      subset.push(itemsCopy[randomIndex]);
      itemsCopy.splice(randomIndex, 1);
    }
  
    return subset;
};

function calculateCorrectness(options, selectedOptionId) {
    // Assuming `options` is an array of option objects from the question
    // and `selectedOptionId` is the ID of the option selected by the user
    const selectedOption = options.find(option => option._id.equals(selectedOptionId));
    return Boolean(selectedOption && selectedOption.isCorrect);
}

export default router;
