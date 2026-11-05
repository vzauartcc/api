import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, validationResult } from 'express-validator';
import { isValidObjectId } from 'mongoose';
import { getCacheInstance } from '../../app.js';
import { throwBadRequestException, throwNotFoundException } from '../../helpers/errors.js';
import { isInstructorAssistant } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { RatingExamModel, type IRatingExamIndicator } from '../../models/ratingExam.js';
import status from '../../types/status.js';
import ratingExamAttemptRouter from './ratingExamAttempt.js';

const router = Router();

router.use('/attempt', ratingExamAttemptRouter);

const createRatingExamValidation = [
	body('name')
		.trim()
		.notEmpty()
		.withMessage('Name is required')
		.isLength({ max: 100 })
		.withMessage('Name should not exceed 100 characters'),
	body('isActive').isBoolean().toBoolean().withMessage('isActive must be a boolean'),
	body('certCode')
		.trim()
		.notEmpty()
		.withMessage('Milestone is required')
		.isString()
		.withMessage('Milestone must be a string'),
	body('indicators')
		.isArray()
		.withMessage('Indicators must be an array')
		.isLength({ min: 1 })
		.withMessage('At least one indicator is required'),
	body('indicators.*.name')
		.trim()
		.notEmpty()
		.withMessage('Indicator name is required')
		.isLength({ max: 400 })
		.withMessage('Indicator name should not exceed 400 characters'),
	body('indicators.*.category')
		.trim()
		.notEmpty()
		.withMessage('Category name is required')
		.isLength({ max: 400 })
		.withMessage('Category name should not exceed 400 characters'),
	body('indicators.*.type')
		.trim()
		.notEmpty()
		.withMessage('Indicator type is required')
		.isIn(['theory', 'practical'])
		.withMessage("Indicator type should be either 'theory' or 'practical'"),
	body('indicators.*.failureThreshold')
		.isNumeric()
		.withMessage('Failure Threshold must be a number')
		.isInt({ min: 1 })
		.toInt()
		.withMessage('Failure Threshold must be a positive number'),
	body('indicators.*.deduction')
		.isNumeric()
		.withMessage('Deduction must be a number')
		.isInt({ min: 1 })
		.toInt()
		.withMessage('Deduction must be a positive number'),
	body('indicators.*.isActive').isBoolean().toBoolean().withMessage('isActive must be a boolean'),
];

router.get('/', getUser, async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const forms = await RatingExamModel.find({ deleted: { $ne: true } })
			.populate('user', 'cid fname lname')
			.populate('certification', 'name')
			.lean()
			.cache('10 minutes', 'rating-exams')
			.exec();

		return res.status(status.OK).json(forms);
	} catch (e) {
		return next(e);
	}
});

router.get('/:id', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const id = req.params['id'];
		if (!id || id === 'undefined' || !isValidObjectId(id)) {
			throwBadRequestException('Invalid ID');
		}

		const ratingExam = await RatingExamModel.findOne({ _id: id, deleted: { $ne: true } })
			.populate('user', 'cid fname lname')
			.populate('certification', 'name')
			.lean()
			.cache('10 minutes', `rating-exam-${id}`)
			.exec();
		if (!ratingExam) {
			throwNotFoundException('Rating Exam not found');
		}

		return res.status(status.OK).json(ratingExam);
	} catch (e) {
		return next(e);
	}
});

router.post(
	'/',
	getUser,
	isInstructorAssistant,
	createRatingExamValidation,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				throwBadRequestException(
					errors
						.array()
						.map((e) => e.msg)
						.join(', '),
				);
			}

			const rawIndicators: IRatingExamIndicator[] = req.body.indicators;

			const indicators = rawIndicators.map(
				({ category, deduction, isActive, failureThreshold, name, type }) => ({
					category,
					deduction,
					isActive,
					failureThreshold,
					name,
					type,
				}),
			);

			const form = await RatingExamModel.create({
				name: req.body.name,
				indicators: indicators,
				updatedBy: req.user.cid,
				certCode: req.body.certCode,
				isActive: req.body.isActive,
			});

			await getCacheInstance().clear('rating-exams');

			return res.status(status.CREATED).json(form);
		} catch (e) {
			return next(e);
		}
	},
);

router.patch(
	'/:id',
	getUser,
	isInstructorAssistant,
	createRatingExamValidation,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || !isValidObjectId(req.params['id'])) {
				throwBadRequestException('invalid id');
			}

			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				throwBadRequestException(
					errors
						.array()
						.map((e) => e.msg)
						.join(', '),
				);
			}

			const rawIndicators: IRatingExamIndicator[] = req.body.indicators;

			const indicators = rawIndicators.map(
				({ _id, category, deduction, isActive, failureThreshold, name, type }) => ({
					_id: _id || null,
					category,
					deduction,
					isActive,
					failureThreshold,
					name,
					type,
				}),
			);

			const form = await RatingExamModel.findOneAndUpdate(
				{ _id: req.params['id'], deleted: { $ne: true } },
				{
					name: req.body.name,
					isActive: req.body.isActive,
					indicators: indicators,
					updatedBy: req.user.cid,
					certCode: req.body.certCode,
				},
				{ new: true },
			).exec();

			if (!form) {
				throwNotFoundException('Rating Exam not found');
			}

			await getCacheInstance().clear('rating-exams');
			await getCacheInstance().clear(`rating-exam-${req.params['id']}`);

			return res.status(status.OK).json(form);
		} catch (e) {
			return next(e);
		}
	},
);

router.delete(
	'/:id',
	getUser,
	isInstructorAssistant,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || !isValidObjectId(req.params['id'])) {
				throwBadRequestException('invalid id');
			}

			const exam = await RatingExamModel.findOne({
				_id: req.params['id'],
				deleted: { $ne: true },
			}).exec();
			if (!exam) {
				throwNotFoundException('Rating Exam not found');
			}

			await exam.delete();

			await getCacheInstance().clear('rating-exams');
			await getCacheInstance().clear(`rating-exam-${req.params['id']}`);

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

export default router;
