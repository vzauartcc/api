import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, validationResult } from 'express-validator';
import { getCacheInstance, logException } from '../../app.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import { isInstructor, isSeniorStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { ExamModel, type IExam } from '../../models/exam.js';
import { ExamAttemptModel } from '../../models/examAttempt.js';
import { QuestionModel, type IQuestion } from '../../models/examQuestion.js';
import type { IUser } from '../../models/user.js';
import status from '../../types/status.js';

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
			return res.status(status.BAD_REQUEST).json({ errors });
		}

		return next();
	},
];

// Create Exam
router.post(
	'/',
	getUser,
	isSeniorStaff,
	createExamValidation,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				throw {
					code: status.BAD_REQUEST,
					message: errors.array().join(', '),
				};
			}

			// Inside your route, after validation passed
			if (req.body.questions.length < req.body.questionSubsetSize) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Questions per test cannot exceed the total number of questions',
				};
			}

			const newExam = new ExamModel({
				title: req.body.title,
				description: req.body.description,
				questions: req.body.questions,
				timeLimit: req.body.timeLimit,
				questionSubsetSize: req.body.questionSubsetSize,
				createdBy: req.user._id,
			});

			await newExam.save();
			await getCacheInstance().clear('exams');

			return res.status(status.CREATED).json({ examId: newExam.id });
		} catch (e) {
			logException(e);

			return next(e);
		}
	},
);

// Update Exam
router.patch(
	'/:examId',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
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
			).exec(); // { new: true } option returns the document after update
			await getCacheInstance().clear(`exam-${examId}`);
			await getCacheInstance().clear(`exams`);

			if (!updatedExam) {
				throw {
					code: status.NOT_FOUND,
					message: 'Exam not found',
				};
			}

			// Respond with the updated exam information
			return res
				.status(status.OK)
				.json({ message: 'Exam updated successfully', exam: updatedExam });
		} catch (e) {
			logException(e);

			return next(e);
		}
	},
);

// Start Exam Attempt
router.post('/:examId/start', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { examId } = req.params;
		const userId = req.user._id;

		// Prevent starting another attempt if one is already in progress and not timed out
		const now = new Date();
		const existingAttempt = await ExamAttemptModel.findOne({
			exam: examId,
			user: userId,
			status: 'in_progress',
			endTime: { $gt: now }, // Check if the attempt is still within the time limit
		})
			.cache('1 minute', `exam-attempt-${examId}-${userId}`)
			.exec();

		if (existingAttempt) {
			// Calculate remaining time for the existing attempt
			const timeRemaining = existingAttempt.endTime.getTime() - now.getTime();

			return res.status(status.OK).json({
				message: 'Existing exam attempt resumed.',
				attemptId: existingAttempt._id,
				timeRemaining,
			});
		}

		// Fetch the exam details
		const exam = await ExamModel.findById(examId).cache('1 minute', `exam-${examId}`).exec();
		if (!exam) {
			throw {
				code: status.NOT_FOUND,
				message: 'Exam not found',
			};
		}

		// Find the most recent attempt for this exam and user
		const latestAttempt = await ExamAttemptModel.findOne({ exam: examId, user: userId })
			.sort({
				createdAt: -1,
			})
			.cache('1 minute', `exam-attempt-${examId}-${userId}`)
			.exec(); // Assuming createdAt is a field that tracks when the attempt was made

		if (latestAttempt) {
			// Check if the maximum attempts have been reached
			if (latestAttempt.attemptNumber >= 3) {
				throw {
					code: status.TOO_MANY_REQUESTS,
					message: 'Maximum attempts reached',
				};
			}

			// Check if 24 hours have passed since the last attempt
			const hoursSinceLastAttempt =
				(now.getTime() - latestAttempt.lastAttemptTime.getTime()) / (1000 * 60 * 60);
			if (hoursSinceLastAttempt < 24) {
				throw {
					code: status.BAD_REQUEST,
					message: '24-hour waiting period has not elapsed since your last attempt',
				};
			}
		}

		// Fetch questions for the test type and randomly select the required subset
		// @TODO: figure out what testType was suppose to be
		// const allQuestions = await QuestionModel.find({ testType: exam.testType }).exec();
		const allQuestions = await QuestionModel.find({}).cache().exec();
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
		await getCacheInstance().clear(`exam-attempt-${examId}-${userId}`);
		// Send back the time remaining along with attempt details
		const timeRemaining = newAttempt.endTime.getTime() - Date.now();

		return res
			.status(status.CREATED)
			.json({ message: 'Exam started successfully', attemptId: newAttempt.id, timeRemaining });
	} catch (e) {
		logException(e);

		return next(e);
	}
});

// Submit Exam Attempt
router.post('/:examId/submit', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { responses } = req.body; // Expected format: [{ questionId, selectedOption }]
		const examId = req.params['examId'];
		const userId = req.user._id;

		const exam = await ExamModel.findById(examId)
			.populate('questions')
			.cache('1 minute', `exam-attempt-${examId}-${req.user._id}`)
			.exec();
		if (!exam) {
			throw {
				code: status.NOT_FOUND,
				message: 'Exam not found',
			};
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
		await getCacheInstance().clear(`exam-attempt-${examId}-${req.user._id}`);

		// Respond with score and detailed results
		return res.status(status.CREATED).json({
			message: 'Exam submitted successfully',
			score,
			passed,
			responses: scoredResponses,
		});
	} catch (e) {
		logException(e);

		return next(e);
	}
});

type PopulatedCreator = Pick<IUser, 'fname' | 'lname'>;
interface IExamPopulated extends Omit<IExam, 'createdBy'> {
	createdBy: PopulatedCreator;
}

router.get(
	'/',
	getUser,
	isSeniorStaff,
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			// Fetch all exams, populate createdBy, and exclude questions
			const exams = (await ExamModel.find()
				.populate('createdBy', 'fname lname')
				.lean()
				.cache('1 minute', `exams`)
				.exec()) as unknown as IExamPopulated[];

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

			return res.status(status.OK).json(examsWithQuestionCountAndCreator);
		} catch (e) {
			logException(e);

			return next(e);
		}
	},
);

router.get(
	'/:id',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const exam = await ExamModel.findById(req.params['id'])
				.populate('createdBy', 'fname lname')
				.lean()
				.cache('1 minute', `exam-${req.params['id']}`)
				.exec();
			if (!exam) {
				throw {
					code: status.NOT_FOUND,
					message: 'Exam not found',
				};
			}

			return res.status(status.OK).json(exam);
		} catch (e) {
			logException(e);

			return next(e);
		}
	},
);

router.get('/:id/results', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const examAttempt = await ExamAttemptModel.findOne({
			exam: req.params['id'],
			user: req.user._id, // Ensure results are fetched for the logged-in user
		})
			.lean()
			.cache()
			.exec();

		if (!examAttempt) {
			throw {
				code: status.NOT_FOUND,
				message: 'Results not found',
			};
		}

		return res.status(status.OK).json(examAttempt);
	} catch (e) {
		logException(e);

		return next(e);
	}
});

router.patch(
	'/:examId/questions/:questionId/time',
	getUser,
	async (req: Request, res: Response, next: NextFunction) => {
		const { examId, questionId } = req.params;
		const { additionalTimeSpent } = req.body; // The additional time spent on the question
		const userId = req.user._id;

		try {
			// Find the exam attempt
			const attempt = await ExamAttemptModel.findOne({
				exam: examId,
				user: userId,
				status: 'in_progress', // Assuming you want to update an in-progress attempt
			})
				.cache('1 minute', `exam-attempt-${examId}-${userId}`)
				.exec();

			if (!attempt) {
				throw {
					code: status.NOT_FOUND,
					message: 'Exam attempt not found or not in progress',
				};
			}

			// Find the response for the question and update time spent
			const response = attempt.responses.find((r) => r.question.toString() === questionId);
			if (response) {
				response.timeSpent += additionalTimeSpent; // Add the additional time to the current time spent
				await attempt.save(); // Save the updated attempt
				await getCacheInstance().clear(`exam-attempt-${examId}-${userId}`);

				return res.status(status.OK).json({ message: 'Time spent updated successfully.' });
			} else {
				return res
					.status(status.BAD_REQUEST)
					.json({ message: 'Question not found in the current attempt.' });
			}
		} catch (e) {
			logException(e);

			return next(e);
		}
	},
);

router.put(
	'/:examId/resetAttempts',
	getUser,
	isInstructor,
	/* eslint-disable no-unused-vars */
	async (_req: Request, _res: Response, _next: NextFunction) => {
		// const { examId } = req.params;
		// const { userId } = req.body; // Assume the userId to reset attempts for is sent in the request
		// Reset attempts logic here
		// This could involve updating existing attempt documents or tracking attempts separately
	},
	/* eslint-enable no-unused-vars */
);

router.delete(
	'/:id',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			// Attempt to find and delete the exam by ID
			const deletedExam = await ExamModel.findById(req.params['id'])
				.cache('1 minute', `exam-${req.params['id']}`)
				.exec();

			// If no exam was found and deleted, return a 404 error
			if (!deletedExam) {
				throw {
					code: status.NOT_FOUND,
					message: 'Exam not found',
				};
			}

			await deletedExam.delete();

			await clearCachePrefix('exam');

			return res.status(status.NO_CONTENT).json();
			// Respond with success message
		} catch (e) {
			logException(e);

			return next(e);
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
