import { getCacheInstance } from 'app.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, validationResult } from 'express-validator';
import { throwBadRequestException } from 'helpers/errors.js';
import { RatingAttemptModel, type IRatingAttemptIndicator } from 'models/ratingAttempt.js';
import { RatingRubricModel } from 'models/ratingRubric.js';
import { UserModel } from 'models/user.js';
import { isValidObjectId, Types } from 'mongoose';
import { isTrainingStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import status from '../../types/status.js';

const router = Router();

const createAttemptValidation = [
	body('cid').notEmpty().isNumeric().withMessage('Student CID is required'),
	body('notes')
		.trim()
		.isLength({ max: 4000 })
		.withMessage('Notes should not exceed 4000 characters'),
	body('indicators.*._id')
		.notEmpty()
		.isString()
		.trim()
		.isLength({ min: 1 })
		.withMessage('Invalid Indicator'),
	body('indicators.*.name')
		.notEmpty()
		.withMessage('Performance Indicator text is required')
		.trim()
		.isLength({ max: 400 })
		.withMessage('Performance Indicator text should not exceed 400 characters'),
	body('indicators.*.occurences')
		.notEmpty()
		.withMessage('Deduction is required')
		.isNumeric()
		.withMessage('Deduction must be a number')
		.isFloat({ min: 0 })
		.withMessage('Deduction must be a positive number'),
	body('indicators.*.performance')
		.notEmpty()
		.withMessage('Performance Grade is required')
		.isIn(['satisfactory', 'unsatisfactory'])
		.withMessage("Performance Grade must either 'satisfactory' or 'unsatisfactory'"),
	body('indicators.*.notes')
		.trim()
		.isLength({ max: 4000 })
		.withMessage('Notes should not exceed 4000 characters'),
];

router.get(
	'/:id',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || !isValidObjectId(req.params['id'])) {
				throwBadRequestException('invalid id');
			}

			const attempt = await RatingAttemptModel.findById(req.params['id'])
				.lean()
				.cache('10 minutes', `rating-attempt-${req.params['id']}`)
				.exec();

			return res.status(status.OK).json(attempt);
		} catch (e) {
			return next(e);
		}
	},
);

interface IRatingAttemptBody {
	studentCid: number;
	rubricId: Types.ObjectId;
	notes: string;
	indicators: {
		_id: Types.ObjectId;
		performance: 'unsatisfactory' | 'satisfactory';
		notes: string;
		occurences: number;
	}[];
}

router.post(
	'/',
	getUser,
	isTrainingStaff,
	createAttemptValidation,
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

			const body: IRatingAttemptBody = req.body as IRatingAttemptBody;

			const rubric = await RatingRubricModel.findById(body.rubricId).exec();
			if (!rubric) {
				throwBadRequestException('Rubric not found');
			}

			const student = await UserModel.findOne({ cid: body.studentCid }).exec();
			if (!student) {
				throwBadRequestException('Student not found');
			}

			const theorySection = {
				indicators: rubric.indicators.filter((c: any) => c.type === 'theory'),
				deductions: 0,
				passed: true,
			};

			const practicalSection = {
				indicators: rubric.indicators.filter((c: any) => c.type === 'practical'),
				deductions: 0,
				passed: true,
			};

			const indicators: IRatingAttemptIndicator[] = [];

			for (const indicator of rubric.indicators) {
				const indicatorAttempt = body.indicators.find((i) => i._id === indicator._id);
				if (!indicatorAttempt) {
					throwBadRequestException('Missing indicators');
				}

				let deduction = 0;

				if (indicatorAttempt.performance === 'unsatisfactory') {
					deduction += indicator.deduction * indicatorAttempt.occurences;
				}

				if (indicatorAttempt.occurences >= indicator.maxOccurences) {
					if (indicator.type === 'theory') {
						theorySection.passed = false;
					} else {
						practicalSection.passed = false;
					}
				}

				indicators.push({
					indicatorId: indicator._id,
					notes: indicatorAttempt.notes,
					performance: indicatorAttempt.performance,
					occurences: indicatorAttempt.occurences,

					name: indicator.name,
					deduction: indicator.deduction,
					maxOccurences: indicator.maxOccurences,
					category: indicator.category,
					type: indicator.type,
				} as IRatingAttemptIndicator);
			}

			if (!rubric.indicators.every((i) => indicators.find((j) => j.indicatorId === i._id))) {
				throwBadRequestException('Missing indicator');
			}

			const form = await RatingAttemptModel.create({
				name: req.body.name,
				active: req.body.isActive,
				indicators: indicators,
				updatedBy: req.user.cid,
				studentCid: student.cid,
				instructorCid: req.user.cid,
				theoryPassed: theorySection.passed,
				practicalPassed: practicalSection.passed,
				totalScore: 100 - theorySection.deductions - practicalSection.deductions,

				notes: req.body.notes || '',
			});

			await getCacheInstance().clear('rating-rubrics');

			return res.status(status.CREATED).json(form);
		} catch (e) {
			return next(e);
		}
	},
);

export default router;
