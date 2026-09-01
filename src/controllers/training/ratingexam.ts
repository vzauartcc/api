import { getCacheInstance } from 'app.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, validationResult } from 'express-validator';
import { throwBadRequestException } from 'helpers/errors.js';
import { RatingRubricModel } from 'models/ratingRubric.js';
import { isValidObjectId } from 'mongoose';
import { isSeniorStaff, isTrainingStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import status from '../../types/status.js';
import ratingAttemptRouter from './ratingattempt.js';

const router = Router();

router.use('/attempt', ratingAttemptRouter);

const createRubricValidation = [
	body('name')
		.trim()
		.notEmpty()
		.withMessage('Name is required')
		.isLength({ max: 100 })
		.withMessage('Name should not exceed 100 characters'),
	body('isActive')
		.notEmpty()
		.withMessage('isActive is required')
		.isBoolean()
		.withMessage('isActive must be a boolean'),
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
		.notEmpty()
		.withMessage('Indicator type is required')
		.isIn(['theory', 'practical'])
		.withMessage("Indicator type should be either 'theory' or 'practical'"),
	body('indicators.*.name')
		.trim()
		.notEmpty()
		.withMessage('Performance Indicator text is required')
		.isLength({ max: 400 })
		.withMessage('Performance Indicator text should not exceed 400 characters'),
	body('indicators.*.maxDeduction')
		.notEmpty()
		.withMessage('Max Deduction is required')
		.isNumeric()
		.withMessage('Max Deduction must be a number')
		.isFloat({ min: 0 })
		.withMessage('Max Deduction must be a positive number'),
	body('indicators.*.deduction')
		.notEmpty()
		.withMessage('Deduction is required')
		.isNumeric()
		.withMessage('Deduction must be a number')
		.isFloat({ min: 0 })
		.withMessage('Deduction must be a positive number'),
	body('indicators.*.isActive')
		.notEmpty()
		.withMessage('isActive is required')
		.isBoolean()
		.withMessage('isActive must be a boolean'),
];

router.get(
	'/',
	getUser,
	isTrainingStaff,
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			const forms = await RatingRubricModel.find({ active: true })
				.lean()
				.cache('10 minutes', 'rating-rubrics')
				.exec();

			return res.status(status.OK).json(forms);
		} catch (e) {
			return next(e);
		}
	},
);

router.post(
	'/',
	getUser,
	isSeniorStaff,
	createRubricValidation,
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

			const form = await RatingRubricModel.create({
				name: req.body.name,
				active: req.body.isActive,
				categories: req.body.categories,
				updatedBy: req.user.cid,
			});

			await getCacheInstance().clear('rating-rubrics');

			return res.status(status.CREATED).json(form);
		} catch (e) {
			return next(e);
		}
	},
);

router.patch(
	'/:id',
	getUser,
	isSeniorStaff,
	createRubricValidation,
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

			const form = await RatingRubricModel.findByIdAndUpdate(
				req.params['id'],
				{
					name: req.body.name,
					active: req.body.isActive,
					categories: req.body.categories,
					updatedBy: req.user.cid,
				},
				{ new: true },
			).exec();

			await getCacheInstance().clear('rating-rubrics');

			return res.status(status.OK).json(form);
		} catch (e) {
			return next(e);
		}
	},
);

router.delete(
	'/:id',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || !isValidObjectId(req.params['id'])) {
				throwBadRequestException('invalid id');
			}

			await RatingRubricModel.findByIdAndDelete(req.params['id']).exec();

			await getCacheInstance().clear('rating-rubrics');

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

export default router;
