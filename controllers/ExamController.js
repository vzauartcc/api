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
import TrainingModule from '../models/TrainingModule.js';

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
router.post('/start/:examId', getUser, async (req, res) => {
    const { examId } = req.params;
    const userId = res.user._id;
    const now = new Date();

    try {
        console.log('Received request to start exam:', { examId, userId });

        let existingAttempt = await ExamAttempt.findOne({
            exam: examId,
            user: userId,
            status: 'in_progress',
            endTime: { $gt: now }
        });

        if (existingAttempt) {
            const exam = await Exam.findById(existingAttempt.exam);
            if (!exam) {
                console.log('Exam not found:', examId);
                return res.status(404).json({ message: "Exam not found." });
            }

            const questions = existingAttempt.responses.map(response => {
                const question = exam.questions.find(q => q._id.equals(response.question));
                if (question) {
                    return {
                        _id: question._id,
                        text: question.text,
                        isTrueFalse: question.isTrueFalse,
                        options: question.options.map(opt => ({
                            _id: opt._id,
                            text: opt.text
                        })),
                        selectedOption: response.selectedOption
                    };
                }
                console.log('No question found for response:', response);
                return null;
            }).filter(q => q !== null); // Filter out null values

            const timeRemaining = existingAttempt.endTime.getTime() - now.getTime();
            console.log('Resuming existing exam attempt:', existingAttempt);

            return res.status(200).json({
                message: "Existing exam attempt resumed.",
                attemptId: existingAttempt._id,
                endTime: existingAttempt.endTime,
                exam: exam.title, 
                timeRemaining,
                questions,
            });
        }

        const exam = await Exam.findById(examId);
        if (!exam) {
            console.log('Exam not found:', examId);
            return res.status(404).json({ message: "Exam not found." });
        }

        const allQuestions = exam.questions; // Use questions from the exam
        if (!Array.isArray(allQuestions) || allQuestions.length === 0) {
            console.log('No questions found for the exam:', examId);
            return res.status(404).json({ message: "No questions found for the exam." });
        }

        const questionSubsetSize = exam.questionSubsetSize || 30;

        // Function to select a random subset of questions
        const selectRandomSubset = (array, subsetSize) => {
            if (!Array.isArray(array)) {
                console.log('Error: input is not an array:', array);
                return [];
            }
            
            if (array.length <= subsetSize) {
                return array;
            }

            const shuffled = array.sort(() => 0.5 - Math.random());
            return shuffled.slice(0, subsetSize);
        };

        const selectedQuestions = selectRandomSubset(allQuestions, questionSubsetSize);

        // Ensure selectedQuestions is an array
        if (!Array.isArray(selectedQuestions)) {
            console.log('Error: selectRandomSubset did not return an array:', selectedQuestions);
            return res.status(500).json({ message: "Error selecting questions for the exam." });
        }

        const questions = selectedQuestions.sort(() => 0.5 - Math.random());
        console.log('Selected questions for exam:', selectedQuestions);

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
            endTime: new Date(new Date().getTime() + exam.timeLimit * 60000),
            status: 'in_progress',
        });

        await newAttempt.save();
        const timeRemaining = newAttempt.endTime.getTime() - Date.now();

        // Schedule auto-submit at the end of the exam
        scheduleAutoSubmit(newAttempt._id, newAttempt.endTime);

        console.log('New exam attempt created:', newAttempt);

        res.status(201).json({ 
            message: "Exam started successfully", 
            attemptId: newAttempt._id, 
            endTime: newAttempt.endTime,
            title: exam.title, 
            timeRemaining,
            questions: questions.map(q => ({
                _id: q._id,
                text: q.text,
                options: q.options.map(opt => ({
                    _id: opt._id,
                    text: opt.text
                }))
            })) 
        });
    } catch (error) {
        console.error("Error starting exam:", error);
        res.status(500).json({ message: "Internal server error", error: error.toString() });
    }
});

// Save Exam Progress
router.patch('/save/:attemptId', getUser, async (req, res) => {
    const { attemptId } = req.params;
    const userId = res.user._id;
    const { responses } = req.body;

    try {
        let examAttempt = await ExamAttempt.findOne({
            _id: attemptId,
            user: userId,
            status: 'in_progress'
        });

        if (!examAttempt) {
            return res.status(404).json({ message: "Exam attempt not found or already submitted." });
        }

        if (responses && Array.isArray(responses)) {
            responses.forEach(response => {
                let attemptResponse = examAttempt.responses.find(r => r.question.toString() === response.questionId);
                if (attemptResponse) {
                    if (response.selectedOption) {
                        attemptResponse.selectedOption = response.selectedOption;
                    }
                    if (response.timeSpent && !isNaN(response.timeSpent)) {
                        attemptResponse.timeSpent = (attemptResponse.timeSpent || 0) + response.timeSpent;
                    } else {
                        attemptResponse.timeSpent = attemptResponse.timeSpent || 0; // Initialize if not set
                    }
                }
            });
        }

        await examAttempt.save();
        res.status(200).json({ message: "Progress saved successfully." });
    } catch (error) {
        console.error("Error saving progress:", error);
        res.status(500).json({ message: "Internal server error", error: error.toString() });
    }
});

// Submit Exam Attempt
router.patch('/submit/:attemptId', getUser, async (req, res) => {
    const { attemptId } = req.params;
    const userId = res.user._id;
    const { responses } = req.body;

    console.log(`User ${userId} is submitting exam attempt ${attemptId} with responses:`, responses);

    try {
        let examAttempt = await ExamAttempt.findOne({
            _id: attemptId,
            user: userId,
            status: 'in_progress'
        }).populate('exam');

        if (!examAttempt) {
            console.log(`Exam attempt ${attemptId} not found or already submitted.`);
            return res.status(404).json({ message: "Exam attempt not found or already submitted." });
        }

        console.log(`Exam attempt found:`, examAttempt);

        if (responses && Array.isArray(responses)) {
            responses.forEach(response => {
                let attemptResponse = examAttempt.responses.find(r => r.question.toString() === response.question);
                if (attemptResponse) {
                    if (response.selectedOption) {
                        attemptResponse.selectedOption = response.selectedOption;
                    }
                    if (response.timeSpent !== undefined) {
                        attemptResponse.timeSpent = response.timeSpent; // Use timeSpent directly
                    }
                }
            });
        }

        console.log(`Updated responses in exam attempt:`, examAttempt.responses);

        examAttempt.status = 'completed';
        examAttempt.endTime = new Date();

        const exam = await Exam.findById(examAttempt.exam).populate({
            path: 'questions',
            populate: { path: 'options' }
        });
        
        if (!exam) {
            console.log(`Exam ${examAttempt.exam} not found.`);
            return res.status(404).json({ message: "Exam not found." });
        }

        console.log(`Exam details fetched:`, exam);

        let correctAnswers = 0;
        const scoredQuestions = [];
        examAttempt.responses.forEach(response => {
            const question = exam.questions.find(q => q._id.equals(response.question));
            if (question) {
                const isCorrect = question.options.some(option => option._id.equals(response.selectedOption) && option.isCorrect);
                if (isCorrect) correctAnswers++;
                response.isCorrect = isCorrect;

                scoredQuestions.push({
                    _id: question._id,
                    text: question.text,
                    options: question.options,
                    selectedOption: response.selectedOption,
                    isCorrect: isCorrect
                });
            }
        });

        const score = ((correctAnswers / examAttempt.responses.length) * 100).toFixed(2);
        examAttempt.score = parseFloat(score); // Store the rounded score as a number
        examAttempt.passed = examAttempt.score >= 80;

        console.log(`Exam attempt grading complete. Score: ${score}, Passed: ${examAttempt.passed}`);

        await examAttempt.save();

        res.status(200).json({
            message: "Exam submitted successfully",
            score: examAttempt.score,
            passed: examAttempt.passed,
            questions: scoredQuestions
        });
    } catch (error) {
        console.error("Error submitting exam:", error);
        res.status(500).json({ message: "Internal server error", error: error.toString() });
    }
});


// Check Exam Status
router.get('/status/:examId', getUser, async (req, res) => {
    const { examId } = req.params;
    const userId = req.user._id;
    const now = new Date();

    try {
        const inProgressAttempt = await ExamAttempt.findOne({
            exam: examId,
            user: userId,
            status: 'in_progress',
            endTime: { $gt: now }
        });

        if (inProgressAttempt) {
            const timeRemaining = inProgressAttempt.endTime.getTime() - now.getTime();
            return res.status(200).json({
                message: "Exam in progress.",
                status: 'in_progress',
                attemptId: inProgressAttempt._id,
                endTime: inProgressAttempt.endTime,
                timeRemaining,
            });
        }

        const trainingProgress = await TrainingProgress.findOne({ cid: userId });
        const courseProgress = trainingProgress.modulesInProgress.find(module =>
            module.courses.some(course => course.exams.some(exam => exam.examId.equals(examId)))
        );
        const examProgress = courseProgress.courses.find(course => 
            course.exams.some(exam => exam.examId.equals(examId))
        );

        if (examProgress) {
            const hoursSinceLastAttempt = (now - examProgress.lastAttemptTime) / (1000 * 60 * 60);
            if (hoursSinceLastAttempt < 22) {
                const cooldownEndTime = examProgress.nextEligibleRetestDate;
                return res.status(200).json({
                    message: "Exam cooldown.",
                    status: 'cooldown',
                    attemptId: null,
                    endTime: null,
                    cooldownEndTime: cooldownEndTime.toISOString(),
                });
            }
        }

        res.status(200).json({
            message: "No active exam.",
            status: 'not_attempted',
            attemptId: null,
            endTime: null,
            cooldownEndTime: null,
        });
    } catch (error) {
        console.error("Error fetching exam status:", error);
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

router.get('training-progress/:userId', getUser, async (req, res) => {
    const { userId } = req.params;
    const now = new Date();

    try {
        const trainingProgress = await TrainingProgress.findOne({ cid: userId })
            .populate('modulesInProgress.courses.exams.examId')
            .exec();

        if (!trainingProgress) {
            return res.status(404).json({ message: "Training progress not found." });
        }

        const examAttempts = [];

        trainingProgress.modulesInProgress.forEach(module => {
            module.courses.forEach(course => {
                course.exams.forEach(exam => {
                    const lastAttemptTime = exam.lastAttemptTime || new Date(0); // Default to epoch if null
                    const cooldownEndTime = new Date(lastAttemptTime.getTime() + 22 * 60 * 60 * 1000);
                    let status;
                    let timeRemaining = 0;

                    // Check if there's an in-progress attempt
                    const inProgressAttempt = ExamAttempt.findOne({
                        exam: exam.examId._id,
                        user: userId,
                        status: 'in_progress',
                        endTime: { $gt: now }
                    });

                    if (inProgressAttempt) {
                        status = 'in_progress';
                        timeRemaining = inProgressAttempt.endTime.getTime() - now.getTime();
                    } else if (exam.passed) {
                        status = 'completed';
                    } else if (now < exam.nextEligibleRetestDate) {
                        status = 'cooldown';
                        timeRemaining = exam.nextEligibleRetestDate - now;
                    } else {
                        status = 'not_attempted';
                    }

                    examAttempts.push({
                        examId: exam.examId._id,
                        examTitle: exam.examId.title,
                        attempts: exam.attempts,
                        lastAttemptTime,
                        highestScore: exam.highestScore,
                        nextEligibleRetestDate: exam.nextEligibleRetestDate,
                        passed: exam.passed,
                        status,
                        timeRemaining,
                    });
                });
            });
        });

        res.status(200).json({ examAttempts });
    } catch (error) {
        console.error("Error fetching exam attempts:", error);
        res.status(500).json({ message: "Internal server error", error: error.toString() });
    }
});

const autoSubmitExam = async (attemptId) => {
    try {
        const attempt = await ExamAttempt.findById(attemptId).populate('exam');
        if (!attempt || attempt.status !== 'in_progress') return;

        attempt.status = 'completed';
        attempt.endTime = new Date();

        const exam = attempt.exam;
        let correctAnswers = 0;

        attempt.responses.forEach(response => {
            const question = exam.questions.find(q => q._id.equals(response.question));
            if (question) {
                const isCorrect = question.options.some(option => option._id.equals(response.selectedOption) && option.isCorrect);
                if (isCorrect) correctAnswers++;
                response.isCorrect = isCorrect;
            }
        });

        const score = (correctAnswers / attempt.responses.length) * 100;
        attempt.score = score;
        attempt.passed = score >= 80;

        await attempt.save();

        // Update the training progress for the user
        const trainingProgress = await TrainingProgress.findOne({ cid: attempt.user });
        const courseProgress = trainingProgress.modulesInProgress.find(module =>
            module.courses.some(course => course.exams.some(exam => exam.examId.equals(attempt.exam)))
        );
        const examProgress = courseProgress.courses.find(course => 
            course.exams.some(exam => exam.examId.equals(attempt.exam))
        );

        examProgress.attempts += 1;
        examProgress.lastAttemptTime = attempt.endTime;
        if (attempt.passed) {
            examProgress.highestScore = Math.max(examProgress.highestScore, score);
            examProgress.passed = true;
            examProgress.nextEligibleRetestDate = null;
        } else {
            examProgress.nextEligibleRetestDate = new Date(attempt.endTime.getTime() + 22 * 60 * 60 * 1000);
        }

        await trainingProgress.save();

        const cooldownEndTime = new Date(attempt.endTime.getTime() + 22 * 60 * 60 * 1000);

        console.log(`Exam attempt ${attemptId} completed. Status: ${attempt.passed ? 'Passed' : 'Failed'}. Cooldown end time: ${cooldownEndTime}`);
    } catch (error) {
        console.error(`Error in auto-submitting exam attempt ${attemptId}:`, error);
    }
};

// Schedule auto-submission
const scheduleAutoSubmit = (attemptId, endTime) => {
    const delay = new Date(endTime).getTime() - Date.now();
    if (delay > 0) {
        setTimeout(() => autoSubmitExam(attemptId), delay);
    }
};

export default router;
