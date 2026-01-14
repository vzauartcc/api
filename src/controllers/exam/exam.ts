import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, validationResult } from 'express-validator';
import { isValidObjectId } from 'mongoose';
import { getCacheInstance } from '../../app.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import getUser from '../../middleware/user.js';
import { ExamModel } from '../../models/exam.js';
import status from '../../types/status.js';
import examAttemptRouter from './attempt.js';

const router = Router();

const createExamValidation = [
	body('title').trim().notEmpty().withMessage('Title is required'),
	body('description').trim().optional(),
	body('certCode').trim().notEmpty().withMessage('Milestone is required'),
	body('questions.*.text').notEmpty().withMessage('Question text is required'),
	body('questions.*.isActive').isBoolean().withMessage('isActive must be a boolean'),
	body('questions.*.options.*.text').notEmpty().withMessage('Option text is required'),
	body('questions.*.options.*.isCorrect').isBoolean().withMessage('isCorrect must be a boolean'),
	// Custom validation logic here
	(req: Request, res: Response, next: NextFunction) => {
		const questions = req.body.questions || [];
		const errors: string[] = [];

		questions.forEach((question: { options: any[] }, index: number) => {
			if (!question.options || question.options.length < 2) {
				errors.push(`Question ${index + 1}: questions must have either two or four options`);
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

router.get('/', getUser, isExamEditor, async (_req: Request, res: Response, next: NextFunction) => {
	try {
		// Fetch all exams, populate createdBy, and exclude questions
		const exams = await ExamModel.find({})
			.populate('user', 'fname lname')
			.lean({ virtuals: true })
			.cache('10 minutes', 'exams')
			.exec();

		const examsWithQuestionCountAndCreator = exams.map((exam) => ({
			...exam,
			questionsCount: exam.questions ? exam.questions.length : 0,
		}));

		return res.status(status.OK).json(examsWithQuestionCountAndCreator);
	} catch (e) {
		return next(e);
	}
});

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
					message: errors.array().join(', '),
				};
			}

			const exam = await ExamModel.findById(id);

			if (!exam || exam.deleted) {
				throw {
					code: status.NOT_FOUND,
					message: 'Exam not found',
				};
			}

			exam.title = req.body.title;
			exam.description = req.body.description;
			exam.certCode = req.body.certCode;
			exam.questions = req.body.questions;

			const updated = await exam.save();

			await getCacheInstance().clear(`exam-${id}`);
			await getCacheInstance().clear(`exams`);

			return res.status(status.OK).json({ message: 'Exam updated successfully', exam: updated });
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
