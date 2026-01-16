import { Router, type NextFunction, type Request, type Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { getCacheInstance } from '../../app.js';
import getUser from '../../middleware/user.js';
import { ExamAttemptModel } from '../../models/examAttempt.js';
import status from '../../types/status.js';

const router = Router();

router.get('/by-user/:cid', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { cid } = req.params;

		if (Number(cid) !== req.user.cid) {
			if (!req.user.isTrainingStaff) {
				throw {
					code: status.FORBIDDEN,
					message: 'Forbidden',
				};
			}
		}

		const attempts = await ExamAttemptModel.find({ student: cid })
			.populate({
				path: 'exam',
				select: 'title certCode',
				populate: {
					path: 'certification',
				},
			})
			.lean({ virtuals: true })
			.exec();

		if (req.user.cid === Number(cid)) {
			attempts.forEach((attempt) => {
				(attempt.questionOrder as any) = attempt.questionOrder.map((q) => ({
					...q,
					options: q.options.map(({ isCorrect, ...rest }) => rest),
				}));
			});
		}

		return res.status(status.OK).json(attempts);
	} catch (e) {
		return next(e);
	}
});

router.get('/:attemptId', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { attemptId } = req.params;

		if (!isValidObjectId(attemptId)) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid attempt ID',
			};
		}

		const attempt = await ExamAttemptModel.findById(attemptId)
			.populate('exam')
			.populate('user')
			.lean({ virtuals: true })
			.cache('10 minutes', `exam-attempt-${attemptId}`)
			.exec();

		if (!attempt) {
			throw {
				code: status.NOT_FOUND,
				message: 'Attempt not found',
			};
		}

		if (req.user.cid !== attempt.student || !req.user.isTrainingStaff) {
			throw {
				code: status.FORBIDDEN,
				message: 'Forbidden',
			};
		}

		if (req.user.cid === attempt.student) {
			attempt.responses = attempt.responses.map(({ isCorrect, ...rest }) => rest);
			(attempt.questionOrder as any) = attempt.questionOrder.map((q) => ({
				...q,
				options: q.options.map(({ isCorrect, ...rest }) => rest),
			}));
		}

		return res.status(status.OK).json(attempt);
	} catch (e) {
		return next(e);
	}
});

// Start Exam Attempt
router.post('/:id/start', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { id } = req.params;

		const existingAttempt = await ExamAttemptModel.findOne({
			_id: id,
			user: req.user.cid,
			$or: [{ status: 'in_progress' }, { status: 'not_started' }],
		})
			.cache('1 minute', `exam-attempt-${id}`)
			.exec();

		if (!existingAttempt) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Attempt not found or already in progress',
			};
		}

		return res.status(status.OK).json();
	} catch (e) {
		return next(e);
	}
});

router.patch('/:id', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { id } = req.params;
		const { questionId, selectedOptions, timeSpent } = req.body;

		if (
			!questionId ||
			!isValidObjectId(questionId) ||
			!selectedOptions ||
			!Array.isArray(selectedOptions) ||
			selectedOptions.some((x) => !isValidObjectId(x))
		) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid request',
			};
		}

		if (!isValidObjectId(id)) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid attempt ID',
			};
		}

		const attempt = await ExamAttemptModel.findOne({ _id: id, student: req.user.cid }).exec();
		if (!attempt) {
			throw {
				code: status.NOT_FOUND,
				message: 'Exam Attempt not found',
			};
		}

		const keepResponses = attempt.responses.filter((r) => r.questionId.toString() !== questionId);

		let existingTime = 0;
		const duplicate = attempt.responses.find((r) => r.questionId.toString() === questionId);
		if (duplicate) {
			existingTime = duplicate.timeSpent;
		}

		attempt.responses = [
			...keepResponses,
			{
				questionId: questionId,
				selectedOptions: selectedOptions,
				timeSpent: (timeSpent || 0) + existingTime,
			},
		];

		const updated = await attempt.save();

		getCacheInstance().clear(`exam-attempt-${id}`);

		return res.status(status.OK).json(updated);
	} catch (e) {
		return next(e);
	}
});

// Submit Exam Attempt
router.post('/:id/submit', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { id } = req.params;

		const attempt = await ExamAttemptModel.findOne({ _id: id, student: req.user.cid }).exec();
		if (!attempt) {
			throw {
				code: status.NOT_FOUND,
				message: 'Attempt not found',
			};
		}

		let correctAnswers = 0;
		const questions = attempt.questionOrder;
		let totalTime = 0;

		if (!questions.every((q) => attempt.responses.some((r) => r.questionId.toString() === q.id))) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Not all questions are answered',
			};
		}

		// Validate and score responses
		const scoredResponses = attempt.responses.map((response) => {
			totalTime += response.timeSpent;
			const question = questions.find((q) => q.id!.equals(response.questionId));
			if (!question) {
				return { ...response, isCorrect: false };
			}

			const correctOptions = question.options.filter((x) => x.isCorrect === true).map((x) => x._id);

			const isCorrect = correctOptions.every((x) =>
				response.selectedOptions.some((y) => y._id === x),
			);
			if (isCorrect) correctAnswers++;
			return { ...response, isCorrect };
		});

		const score = (correctAnswers / questions.length) * 100;
		const passingScore = 80;
		const passed = score >= passingScore;

		attempt.responses = scoredResponses;
		attempt.totalScore = score;
		attempt.passed = passed;
		attempt.endTime = new Date();
		attempt.status = 'completed';

		await attempt.save();
		await getCacheInstance().clear(`exam-attempt-${id}`);

		// Respond with score and detailed results
		return res.status(status.OK).json({
			message: 'Exam submitted successfully',
			score,
			passed,
			responses: scoredResponses,
		});
	} catch (e) {
		return next(e);
	}
});

export default router;
