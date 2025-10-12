import { convertToReturnDetails } from 'app.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, validationResult } from 'express-validator';
import { hasRole } from 'middleware/auth.js';
import { ExamModel, type IExam } from 'models/exam.js';
import { ExamAttemptModel } from 'models/examAttempt.js';
import { QuestionModel, type IQuestion } from 'models/examQuestion.js';
import type { IUser } from 'models/user.js';
import getUser from '../middleware/user.js';

const router = Router();

const createExamValidation = [
	body('title').trim().notEmpty().withMessage('Title is required'),
	body('description').trim().optional(),
	body('questions.*.text').notEmpty().withMessage('Question text is required'),
	body('questions.*.isTrueFalse').isBoolean().withMessage('isTrueFalse must be a boolean'),
	body('questions.*.options.*.text').notEmpty().withMessage('Option text is required'),
	body('questions.*.options.*.isCorrect').isBoolean().withMessage('isCorrect must be a boolean'),
	body('timeLimit').isNumeric().withMessage('Time limit must be a number'),
	body('questionSubsetSize').isNumeric().withMessage('Question subset size must be a number'),
	// Custom validation logic here
	(req: Request, res: Response, next: NextFunction) => {
		const questions = req.body.questions || [];
		const errors: { msg: string }[] = [];

		questions.forEach((question: { isTrueFalse: any; options: any[] }, index: number) => {
			// Validate true/false questions
			if (question.isTrueFalse) {
				const trueOption = question.options.find(
					(option: { text: string }) => option.text.toLowerCase() === 'true',
				);
				const falseOption = question.options.find(
					(option: { text: string }) => option.text.toLowerCase() === 'false',
				);
				if (!trueOption || !falseOption || question.options.length > 2) {
					errors.push({
						msg: `Question ${index + 1}: True/False questions must have exactly one 'true' and one 'false' option`,
					});
				}
			} else {
				// Validate multiple-choice questions
				if (!question.options || question.options.length !== 4) {
					errors.push({
						msg: `Question ${index + 1}: Multiple-choice questions must have exactly four options`,
					});
				}
				const correctOptions = question.options.filter(
					(option: { isCorrect: unknown }) => option.isCorrect,
				);
				if (correctOptions.length !== 1) {
					errors.push({
						msg: `Question ${index + 1}: Multiple-choice questions must have exactly one correct option`,
					});
				}
			}
		});

		if (errors.length > 0) {
			return res.status(400).json({ errors });
		}

		next();
	},
];

// @TODO: convert to StandardResponse
// Create Exam
router.post(
	'/exams',
	getUser,
	hasRole(['atm', 'datm', 'ta']),
	createExamValidation,
	async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		// Inside your route, after validation passed
		if (req.body.questions.length < req.body.questionSubsetSize) {
			return res
				.status(400)
				.json({ message: 'Questions per test cannot exceed the total number of questions' });
		}

		try {
			const newExam = new ExamModel({
				title: req.body.title,
				description: req.body.description,
				questions: req.body.questions,
				timeLimit: req.body.timeLimit,
				questionSubsetSize: req.body.questionSubsetSize,
				createdBy: req.user!._id,
			});
			await newExam.save();
			res.status(201).json({ message: 'Exam created successfully', examId: newExam._id });
		} catch (error) {
			console.error('Error creating exam:', error);
			res.status(500).json({ message: 'Internal server error' });
		}
	},
);

// @TODO: convert to StandardResponse
// Update Exam
router.patch(
	'/exams/:examId',
	getUser,
	hasRole(['atm', 'datm', 'ta']),
	async (req: Request, res: Response) => {
		const { examId } = req.params; // Get the exam ID from the URL parameter
		const { title, description, questions, timeLimit, questionSubsetSize } = req.body; // Extract updated fields from the request body

		try {
			// Find the exam by ID and update it with new values
			// Using findByIdAndUpdate to find the exam and update it atomically
			const updatedExam = await ExamModel.findByIdAndUpdate(
				examId,
				{
					title,
					description,
					questions,
					timeLimit,
					questionSubsetSize,
					// createdBy field is not updated here, assuming it remains unchanged
				},
				{ new: true },
			); // { new: true } option returns the document after update

			if (!updatedExam) {
				return res.status(404).json({ message: 'Exam not found' });
			}

			// Respond with the updated exam information
			res.json({ message: 'Exam updated successfully', exam: updatedExam });
		} catch (error) {
			console.error('Error updating exam:', error);
			res.status(500).json({ message: 'Internal server error' });
		}
	},
);

// @TODO: Convert to StandardResponse
// Start Exam Attempt
router.post('/exams/:examId/start', getUser, async (req: Request, res: Response) => {
	const { examId } = req.params;
	const userId = req.user!._id;

	// Prevent starting another attempt if one is already in progress and not timed out
	const now = new Date();
	const existingAttempt = await ExamAttemptModel.findOne({
		exam: examId,
		user: userId,
		status: 'in_progress',
		endTime: { $gt: now }, // Check if the attempt is still within the time limit
	});

	if (existingAttempt) {
		// Calculate remaining time for the existing attempt
		const timeRemaining = existingAttempt.endTime.getTime() - now.getTime();
		return res.status(200).json({
			message: 'Existing exam attempt resumed.',
			attemptId: existingAttempt._id,
			timeRemaining,
		});
	}

	// Fetch the exam details
	const exam = await ExamModel.findById(examId);
	if (!exam) {
		return res.status(404).json({ message: 'Exam not found.' });
	}

	// Find the most recent attempt for this exam and user
	const latestAttempt = await ExamAttemptModel.findOne({ exam: examId, user: userId }).sort({
		createdAt: -1,
	}); // Assuming createdAt is a field that tracks when the attempt was made

	if (latestAttempt) {
		// Check if the maximum attempts have been reached
		if (latestAttempt.attemptNumber >= 3) {
			return res.status(400).json({ message: 'Maximum attempts reached.' });
		}

		// Check if 24 hours have passed since the last attempt
		const hoursSinceLastAttempt =
			(now.getTime() - latestAttempt.lastAttemptTime.getTime()) / (1000 * 60 * 60);
		if (hoursSinceLastAttempt < 24) {
			return res
				.status(400)
				.json({ message: '24-hour waiting period has not passed since your last attempt.' });
		}
	}

	// Fetch questions for the test type and randomly select the required subset
	// @TODO: figure out what testType was suppose to be
	// const allQuestions = await QuestionModel.find({ testType: exam.testType });
	const allQuestions = await QuestionModel.find({});
	const questionSubsetSize = exam.questionSubsetSize || 30; // Default to 30 if not specified
	const selectedQuestions = selectRandomSubset(allQuestions, questionSubsetSize);
	const questions = selectedQuestions.sort(() => 0.5 - Math.random());

	// Create the exam attempt
	const newAttempt = new ExamAttemptModel({
		exam: examId,
		user: userId,
		questionsOrder: questions.map((q) => q!._id),
		responses: questions.map((q) => ({
			question: q!._id,
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
	res
		.status(201)
		.json({ message: 'Exam started successfully', attemptId: newAttempt._id, timeRemaining });
});

// @TODO: Convert to StandardResponse
// Submit Exam Attempt
router.post('/exams/:examId/submit', getUser, async (req: Request, res: Response) => {
	try {
		const { responses } = req.body; // Expected format: [{ questionId, selectedOption }]
		const examId = req.params.examId;
		const userId = req.user!._id;

		const exam = await ExamModel.findById(examId).populate('questions');
		if (!exam) {
			return res.status(404).json({ message: 'Exam not found' });
		}

		// Initialize exam attempt
		let correctAnswers = 0;
		const questions = exam.questions; // Assuming this is an array of questions with correct options

		// Validate and score responses
		const scoredResponses = responses.map((response: { questionId: any; selectedOption: any }) => {
			const question = questions.find((q) => q.id!.equals(response.questionId));
			if (!question) {
				return { ...response, isCorrect: false };
			}

			const isCorrect = question.options.some(
				(option) => option!.id.equals(response.selectedOption) && option!.isCorrect,
			);
			if (isCorrect) correctAnswers++;
			return { ...response, isCorrect };
		});

		// Calculate score
		const score = (correctAnswers / questions.length) * 100;
		const passingScore = 80; // Define the passing score threshold
		const passed = score >= passingScore; // Correctly

		// Record the attempt
		const examAttempt = new ExamAttemptModel({
			exam: examId,
			user: userId,
			responses: scoredResponses,
			score,
			startTime: req.body.startTime, // Assuming startTime was passed in the request
			endTime: new Date(), // Mark the end time of the attempt
			passed,
			status: 'completed',
		});
		await examAttempt.save();

		// Respond with score and detailed results
		res.status(200).json({
			message: 'Exam submitted successfully',
			score,
			passed,
			responses: scoredResponses,
		});
	} catch (error) {
		console.error('Error submitting exam:', error);
		res.status(500).json({ message: 'Internal server error' });
	}
});

type PopulatedCreator = Pick<IUser, 'fname' | 'lname'>;
interface IExamPopulated extends Omit<IExam, 'createdBy'> {
	createdBy: PopulatedCreator;
}

// @TODO: convert to StandardRequest
router.get(
	'/exams',
	getUser,
	hasRole(['atm', 'datm', 'ta']),
	async (req: Request, res: Response) => {
		try {
			// Fetch all exams, populate createdBy, and exclude questions
			const exams = (await ExamModel.find()
				.populate('createdBy', 'fname lname')
				.lean()) as unknown as IExamPopulated[];

			// Transform exams to include questions count (assuming questions are embedded)
			const examsWithQuestionCountAndCreator = exams.map((exam) => ({
				...exam,
				questionsCount: exam.questions ? exam.questions.length : 0, // Add questions count
				createdBy: {
					// Only include fname and lname of the creator
					fname: exam.createdBy.fname,
					lname: exam.createdBy.lname,
				},
			}));

			res.stdRes.data = examsWithQuestionCountAndCreator;
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.get(
	'/exams/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta']),
	async (req: Request, res: Response) => {
		try {
			const exam = await ExamModel.findById(req.params.id).populate('createdBy', 'fname lname');
			if (!exam) {
				return res.status(404).json({ message: 'Exam not found' });
			}
			res.stdRes.data = exam;
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		} finally {
			return res.json(res.stdRes);
		}
	},
);

router.get('/exams/:id/results', getUser, async (req: Request, res: Response) => {
	try {
		const examAttempt = await ExamAttemptModel.findOne({
			exam: req.params.id,
			user: req.user!._id, // Ensure results are fetched for the logged-in user
		});
		if (!examAttempt) {
			return res.status(404).json({ message: 'Results not found' });
		}
		res.stdRes.data = examAttempt;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

// @TODO: convert to StandardResponse
router.patch(
	'/exams/:examId/questions/:questionId/time',
	getUser,
	async (req: Request, res: Response) => {
		const { examId, questionId } = req.params;
		const { additionalTimeSpent } = req.body; // The additional time spent on the question
		const userId = req.user!._id;

		try {
			// Find the exam attempt
			const attempt = await ExamAttemptModel.findOne({
				exam: examId,
				user: userId,
				status: 'in_progress', // Assuming you want to update an in-progress attempt
			});

			if (!attempt) {
				return res.status(404).json({ message: 'Exam attempt not found or not in progress.' });
			}

			// Find the response for the question and update time spent
			const response = attempt.responses.find((r) => r.question.toString() === questionId);
			if (response) {
				response.timeSpent += additionalTimeSpent; // Add the additional time to the current time spent
				await attempt.save(); // Save the updated attempt
				return res.status(200).json({ message: 'Time spent updated successfully.' });
			} else {
				return res.status(404).json({ message: 'Question not found in the current attempt.' });
			}
		} catch (error) {
			console.error('Error updating time spent:', error);
			return res.status(500).json({ message: 'Internal server error' });
		}
	},
);

router.put(
	'/exams/:examId/resetAttempts',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'ins']),
	/* eslint-disable no-unused-vars */
	async (req: Request, res: Response) => {
		const { examId } = req.params;
		const { userId } = req.body; // Assume the userId to reset attempts for is sent in the request

		// Reset attempts logic here
		// This could involve updating existing attempt documents or tracking attempts separately
	},
	/* eslint-enable no-unused-vars */
);

router.delete(
	'/exams/:id',
	getUser,
	hasRole(['atm', 'datm', 'ta']),
	async (req: Request, res: Response) => {
		try {
			// Attempt to find and delete the exam by ID
			const deletedExam = await ExamModel.findById(req.params.id);

			// If no exam was found and deleted, return a 404 error
			if (!deletedExam) {
				return res.status(404).json({ message: 'Exam not found' });
			}

			await deletedExam.delete();

			// Respond with success message
			res.json({ message: 'Exam successfully deleted', examId: req.params.id });
		} catch (error) {
			console.error('Error deleting exam:', error);
			res.status(500).json({ message: 'Internal server error' });
		}
	},
);

export default router;

function selectRandomSubset(allQuestions: IQuestion[], questionSubsetSize: number) {
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
}
