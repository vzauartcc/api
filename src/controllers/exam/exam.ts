import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, validationResult } from 'express-validator';
import { isValidObjectId } from 'mongoose';
import { getCacheInstance } from '../../app.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import { isInstructor, isTrainingStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { ExamModel } from '../../models/exam.js';
import { ExamAttemptModel } from '../../models/examAttempt.js';
import { NotificationModel } from '../../models/notification.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';
import examAttemptRouter from './attempt.js';

const router = Router();

const createExamValidation = [
	body('title').trim().notEmpty().withMessage('Title is required'),
	body('title').trim().isLength({ max: 100 }).withMessage('Title should not exceed 100 characters'),
	body('description').trim().optional(),
	body('description')
		.trim()
		.isLength({ max: 1000 })
		.withMessage('Description should not exceed 1000 characters'),
	body('certCode').trim().notEmpty().withMessage('Milestone is required'),
	body('questions.*.text').notEmpty().withMessage('Question text is required'),
	body('questions.*.text')
		.trim()
		.isLength({ max: 400 })
		.withMessage('Question text should not exceed 400 characters'),
	body('questions.*.isActive').isBoolean().withMessage('isActive must be a boolean'),
	body('questions.*.options.*.text').notEmpty().withMessage('Option text is required'),
	body('questions.*.options.*.text')
		.trim()
		.isLength({ max: 100 })
		.withMessage('Option text should not exceed 100 characters'),
	body('questions.*.options.*.isCorrect').isBoolean().withMessage('isCorrect must be a boolean'),
	// Custom validation logic here
	(req: Request, res: Response, next: NextFunction) => {
		const questions = req.body.questions || [];
		const errors: string[] = [];

		questions.forEach((question: { options: any[] }, index: number) => {
			if (!question.options || question.options.length < 2) {
				errors.push(`Question ${index + 1}: questions must at least two options`);
			}
			const correctOptions = question.options.filter(
				(option: { isCorrect: unknown }) => option.isCorrect,
			);
			if (correctOptions.length < 1) {
				errors.push(`Question ${index + 1}: questions must have at least one correct option`);
			}
		});

		if (errors.length > 0) {
			return res.status(status.BAD_REQUEST).json(errors.join(', '));
		}

		return next();
	},
];

function isExamEditor(req: Request, res: Response, next: NextFunction) {
	if (req.user && req.user.roleCodes.some((v: string) => ['atm', 'datm', 'ta', 'ia'].includes(v))) {
		return next();
	}

	return res.status(status.FORBIDDEN).json();
}

router.use('/attempt', examAttemptRouter);

router.get(
	'/',
	getUser,
	isTrainingStaff,
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			// Fetch all exams, populate createdBy, and exclude questions
			const exams = await ExamModel.find({ deleted: false })
				.populate('user', 'fname lname')
				.populate('certification', 'name')
				.lean({ virtuals: true })
				.cache('10 minutes', 'exams')
				.exec();

			return res.status(status.OK).json(exams);
		} catch (e) {
			return next(e);
		}
	},
);

// Create Exam
router.post(
	'/',
	getUser,
	isExamEditor,
	createExamValidation,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				throw {
					code: status.BAD_REQUEST,
					message: errors
						.array()
						.map((e) => e.msg)
						.join(', '),
				};
			}

			const exam = await ExamModel.create({
				title: req.body.title,
				description: req.body.description,
				certCode: req.body.certCode,
				questions: req.body.questions,
				createdBy: req.user.cid,
				isActive: true,
			});

			await getCacheInstance().clear('exams');

			return res.status(status.CREATED).json({ examId: exam.id });
		} catch (e) {
			return next(e);
		}
	},
);

// Update Exam
router.patch(
	'/:id',
	getUser,
	isExamEditor,
	createExamValidation,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { id } = req.params;

			if (!isValidObjectId(id)) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid exam ID',
				};
			}

			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				throw {
					code: status.BAD_REQUEST,
					message: errors
						.array()
						.map((e) => e.msg)
						.join(', '),
				};
			}

			const exam = await ExamModel.findById(id).populate('user').populate('certification').exec();

			if (!exam || exam.deleted === true) {
				throw {
					code: status.NOT_FOUND,
					message: 'Exam not found',
				};
			}

			exam.title = req.body.title;
			exam.description = req.body.description;
			exam.certCode = req.body.certCode;
			exam.questions = req.body.questions;
			exam.isActive = req.body.isActive;

			const updated = await exam.save();

			await getCacheInstance().clear(`exam-${id}`);
			await getCacheInstance().clear(`exams`);

			return res.status(status.OK).json({ message: 'Exam updated successfully', exam: updated });
		} catch (e) {
			return next(e);
		}
	},
);

router.post(
	'/:id/assign',
	getUser,
	isInstructor,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { id } = req.params;

			if (!isValidObjectId(id)) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid exam ID',
				};
			}

			const exam = await ExamModel.findById(id)
				.populate('questions')
				.cache('10 minutes', `exam-${id}`)
				.exec();
			if (!exam) {
				throw {
					code: status.NOT_FOUND,
					message: 'Exam not found',
				};
			}

			const student = await UserModel.findOne({ cid: req.body.cid }).exec();
			if (!student) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Student not found',
				};
			}

			const attempts = await ExamAttemptModel.find({ examId: id, student: student.cid })
				.lean({ virtuals: true })
				.exec();
			if (
				attempts.length > 0 &&
				attempts.some(
					(attempt) =>
						(attempt.endTime &&
							attempt.endTime.getTime() >= Date.now() - 25 * 60 * 60 * 1000 &&
							attempt.status !== 'timed_out') ||
						!attempt.isComplete,
				)
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Exam attempted in the past 24 hours or there is an outstanding attempt',
				};
			}

			const availableQuestions = exam.questions.filter((q) => q.isActive);

			const attempt = await ExamAttemptModel.create({
				examId: exam._id,
				student: req.body.cid,
				questionOrder: shuffleArray(availableQuestions),
				responses: [],
				attemptNumber: attempts.length + 1,
				status: 'in_progress',
			});

			await NotificationModel.create({
				recipient: student.cid,
				title: 'New Exam Assigned',
				content: `You have been assigned the <b>${exam.title}</b> exam.`,
				link: `/dash/training/exams`,
			});

			clearCachePrefix(`notifications-${student.cid}`);

			await DossierModel.create({
				by: req.user.cid,
				affected: student.cid,
				action: `%b assigned exam ${exam.title} to %a`,
				actionType: ACTION_TYPE.ASSIGN_EXAM,
			});

			return res.status(status.CREATED).json(attempt._id);
		} catch (e) {
			return next(e);
		}
	},
);

router.get(
	'/:id',
	getUser,
	isExamEditor,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid ID',
				};
			}

			const exam = await ExamModel.findById(req.params['id'])
				.lean({ virtuals: true })
				.cache('10 minutes', `exam-${req.params['id']}`)
				.exec();
			if (!exam) {
				throw {
					code: status.NOT_FOUND,
					message: 'Exam not found',
				};
			}

			return res.status(status.OK).json(exam);
		} catch (e) {
			return next(e);
		}
	},
);

router.delete(
	'/:id',
	getUser,
	isExamEditor,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid ID',
				};
			}

			const deletedExam = await ExamModel.findById(req.params['id'])
				.cache('10 minutes', `exam-${req.params['id']}`)
				.exec();

			if (!deletedExam) {
				throw {
					code: status.NOT_FOUND,
					message: 'Exam not found',
				};
			}

			await deletedExam.delete();

			await clearCachePrefix('exam');

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			return next(e);
		}
	},
);

export default router;

const shuffleArray = <T>(array: T[]): T[] => {
	const shuffled = [...array];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));

		const itemI = shuffled[i]!;
		const itemJ = shuffled[j]!;

		// Shuffle options too if not T/F
		if (itemI && typeof itemI === 'object' && 'options' in itemI) {
			const obj = itemI as any; // Cast to access dynamic property
			if (Array.isArray(obj.options) && obj.options.length > 2) {
				obj.options = shuffleArray(obj.options);
			}
		}

		if (itemJ && typeof itemJ === 'object' && 'options' in itemJ) {
			const obj = itemJ as any;
			if (Array.isArray(obj.options) && obj.options.length > 2) {
				obj.options = shuffleArray(obj.options);
			}
		}

		shuffled[i] = itemJ;
		shuffled[j] = itemI;
	}
	return shuffled;
};
