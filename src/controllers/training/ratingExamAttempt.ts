import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, validationResult } from 'express-validator';
import { isValidObjectId, Types } from 'mongoose';
import { getCacheInstance } from '../../app.js';
import {
	throwBadRequestException,
	throwForbiddenException,
	throwNotFoundException,
} from '../../helpers/errors.js';
import { isInstructor } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { RatingExamModel, type IRatingExam } from '../../models/ratingExam.js';
import {
	RatingExamAttemptModel,
	type IRatingExamAttemptIndicator,
} from '../../models/ratingExamAttempt.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();

const createAttemptValidation = [
	body('studentCid')
		.isNumeric()
		.isInt({ min: 1 })
		.toInt()
		.withMessage('Student CID must be a number'),
	body('ratingExamId').isMongoId().withMessage('Rating Exam ID Invalid'),
	body('notes')
		.optional()
		.trim()
		.isLength({ max: 4000 })
		.withMessage('Notes should not exceed 4000 characters'),
	body('indicators')
		.isArray()
		.withMessage('Indicators must be an array')
		.isLength({ min: 1 })
		.withMessage('At least one indicator is required'),
	body('indicators.*.indicatorId').isMongoId().withMessage('Invalid Indicator ID'),
	body('indicators.*.name')
		.trim()
		.notEmpty()
		.withMessage('Performance Indicator name is required')
		.isLength({ max: 400 })
		.withMessage('Performance Indicator name should not exceed 400 characters'),
	body('indicators.*.occurrences')
		.isNumeric()
		.isInt({ min: 0 })
		.toInt()
		.withMessage('Occurrences must be a number'),
	body('indicators.*.performance')
		.trim()
		.notEmpty()
		.withMessage('Performance Grade is required')
		.isIn(['satisfactory', 'unsatisfactory'])
		.withMessage("Performance Grade must either 'satisfactory' or 'unsatisfactory'"),
	body('indicators.*.notes')
		.optional()
		.trim()
		.isLength({ max: 4000 })
		.withMessage('Notes should not exceed 4000 characters'),
	body('theoryNotes')
		.optional()
		.trim()
		.isLength({ max: 4000 })
		.withMessage('Theory Comments should not exceed 4000 characters'),
	body('practicalNotes')
		.optional()
		.trim()
		.isLength({ max: 4000 })
		.withMessage('Practical Comments should not exceed 4000 characters'),
];

router.get('/', getUser, isInstructor, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 10;
		const ratingExamId = (req.query['exam'] as string) || '';
		const student = +(req.query['user'] as string) || 0;

		const query = {} as any;

		if (!isNaN(student) && student > 0) {
			query.studentCid = student;
		}

		if (ratingExamId && ratingExamId !== '') {
			if (!isValidObjectId(ratingExamId)) {
				throwBadRequestException('Invalid Rating Exam ID');
			}

			query.ratingExamId = new Types.ObjectId(ratingExamId);
		}

		const count = await RatingExamAttemptModel.countDocuments(query).exec();

		let attempts: any[] = [];

		if (count > 0) {
			attempts = await RatingExamAttemptModel.find(query)
				.skip(limit * (page - 1))
				.limit(limit)
				.populate({ path: 'student', select: 'fname lname' })
				.populate({ path: 'instructor', select: 'fname lname' })
				.populate({
					path: 'ratingExam',
					select: 'name certCode',
					populate: {
						path: 'certification',
					},
				})
				.sort({ updatedAt: 'desc' })
				.lean({ virtuals: true })
				.exec();
		}

		const students = await RatingExamAttemptModel.find({})
			.select('studentCid')
			.populate({ path: 'student', select: 'fname lname' })
			.lean({ virtuals: true })
			.exec();

		return res.status(status.OK).json({
			amount: count,
			attempts: attempts,
			students: [...new Map(students.map((item) => [item.studentCid.toString(), item])).values()],
		});
	} catch (e) {
		return next(e);
	}
});

router.get('/by-user/:cid', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { cid } = req.params;

		if (Number(cid) !== req.user.cid) {
			if (!req.user.isInstructor) {
				throwForbiddenException("You are not authorized to view this user's exam attempts.");
			}
		}

		const attempts = await RatingExamAttemptModel.find({ studentCid: cid })
			.sort({ createdAt: 'desc' })
			.populate({ path: 'student', select: 'fname lname' })
			.populate({ path: 'instructor', select: 'fname lname' })
			.populate({
				path: 'ratingExam',
				select: 'name certCode',
				populate: {
					path: 'certification',
				},
			})
			.lean({ virtuals: true })
			.cache('10 minutes', `rating-attempts-${cid}`)
			.exec();

		return res.status(status.OK).json(attempts);
	} catch (e) {
		return next(e);
	}
});

router.get('/:id', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['id'] || !isValidObjectId(req.params['id'])) {
			throwBadRequestException('invalid id');
		}

		const id = req.params['id'];

		const attempt = await RatingExamAttemptModel.findById(id)
			.populate('student', 'fname lname')
			.populate('instructor', 'fname lname')
			.populate({
				path: 'ratingExam',
				select: 'name certCode',
				populate: {
					path: 'certification',
				},
			})
			.lean({ virtuals: true })
			.cache('10 minutes', `rating-attempt-${id}`)
			.exec();

		if (!attempt) {
			throwNotFoundException('Attempt not found');
		}

		if (req.user.cid !== attempt.studentCid && !req.user.isInstructor) {
			throwForbiddenException('You are not authorized to view this attempt');
		}

		return res.status(status.OK).json(attempt);
	} catch (e) {
		return next(e);
	}
});

interface IRatingAttemptBody {
	studentCid: number;
	ratingExamId: string;
	notes: string;
	indicators: {
		indicatorId: string;
		performance: 'unsatisfactory' | 'satisfactory';
		notes: string;
		occurrences: number;
	}[];
	theoryNotes: string;
	practicalNotes: string;
}

router.post(
	'/',
	getUser,
	isInstructor,
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

			if (body.studentCid === req.user.cid) {
				throwForbiddenException('Student cannot be yourself.');
			}

			const ratingExam = await RatingExamModel.findOne({
				_id: body.ratingExamId,
				isActive: true,
				deleted: { $ne: true },
			}).exec();
			if (!ratingExam) {
				throwBadRequestException('Rating Exam not found');
			}

			if (
				!ratingExam.indicators
					.filter((i) => i.isActive)
					.every((i) => body.indicators.find((j) => i._id.toString() === j.indicatorId))
			) {
				throwBadRequestException('Missing indicators');
			}

			const student = await UserModel.findOne({ cid: body.studentCid }).exec();
			if (!student) {
				throwBadRequestException('Student not found');
			}

			const data = processAttempt(ratingExam, body);

			const previousAttempts = await RatingExamAttemptModel.countDocuments({
				studentCid: student.cid,
				ratingExamId: body.ratingExamId,
			}).exec();

			const form = await RatingExamAttemptModel.create({
				...data,
				studentCid: student.cid,
				instructorCid: req.user.cid,
				notes: body.notes || '',
				theoryNotes: body.theoryNotes || '',
				practicalNotes: body.practicalNotes || '',
				attempt: previousAttempts + 1,
			});

			await getCacheInstance().clear(`rating-attempts-${body.studentCid}`);

			return res.status(status.CREATED).json(form);
		} catch (e) {
			return next(e);
		}
	},
);

router.patch(
	'/:id',
	getUser,
	isInstructor,
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

			if (
				!req.params['id'] ||
				req.params['id'] === 'undefined' ||
				!isValidObjectId(req.params['id'])
			) {
				throwBadRequestException('Invalid ID');
			}

			const id = req.params['id'];

			const attempt = await RatingExamAttemptModel.findById(id.toString())
				.populate('ratingExam')
				.populate('student')
				.populate('instructor')
				.cache('10 minutes', `rating-attempt-${id}`)
				.exec();
			if (!attempt) {
				throwNotFoundException('Attempt not found');
			}

			if (attempt.studentCid === req.user.cid) {
				throwForbiddenException('Cannot edit own rating exam');
			}

			// Attempts can only be edited in the first 24 hours.
			if (Date.now() - attempt.createdAt.getTime() > 24 * 60 * 60 * 1000) {
				throwForbiddenException('Attempt no longer editable');
			}

			const body: IRatingAttemptBody = req.body as IRatingAttemptBody;

			if (
				attempt.studentCid !== body.studentCid ||
				attempt.ratingExamId.toString() !== body.ratingExamId
			) {
				throwBadRequestException('Invalid attempt');
			}

			if (
				!attempt.indicators
					.filter((i) => i.isActive)
					.every((i) => body.indicators.find((j) => i._id.toString() === j.indicatorId))
			) {
				throwBadRequestException('Missing indicators');
			}

			const ratingExam = {} as IRatingExam;
			ratingExam.indicators = attempt.indicators;

			const data = processAttempt(ratingExam, body);

			attempt.indicators = data.indicators;

			attempt.theoryPassed = data.theoryPassed;
			attempt.practicalPassed = data.practicalPassed;
			attempt.passed = data.passed;

			attempt.practicalScore = data.practicalScore;

			attempt.notes = body.notes || '';
			attempt.theoryNotes = body.theoryNotes || '';
			attempt.practicalNotes = body.practicalNotes || '';

			await attempt.save();

			await getCacheInstance().clear(`rating-attempt-${id}`);
			await getCacheInstance().clear(`rating-attempts-${attempt.studentCid}`);

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

function processAttempt(ratingExam: IRatingExam, body: IRatingAttemptBody) {
	const examIndicators = ratingExam.indicators.filter((i) => i.isActive);

	if (examIndicators.length === 0) {
		throwBadRequestException('No active indicators');
	}

	const theorySection = {
		indicators: examIndicators.filter((i) => i.type === 'theory'),
		passed: true,
	};
	const practicalSection = {
		indicators: examIndicators.filter((i) => i.type === 'practical'),
		passed: true,
		deductions: 0,
	};

	const indicators: IRatingExamAttemptIndicator[] = [];

	for (const indicator of examIndicators) {
		const indicatorAttempt = body.indicators.find(
			(i) => indicator._id.toString() === i.indicatorId,
		);
		if (!indicatorAttempt) {
			throwBadRequestException('Missing indicator');
		}

		if (indicator.type === 'theory') {
			if (indicatorAttempt.performance === 'unsatisfactory') {
				theorySection.passed = false;
			}
		} else {
			practicalSection.deductions += indicator.deduction * indicatorAttempt.occurrences;

			if (indicatorAttempt.occurrences >= indicator.failureThreshold) {
				practicalSection.passed = false;
			}
		}

		indicators.push({
			indicatorId: indicator._id,
			notes: indicatorAttempt.notes,
			performance: indicatorAttempt.performance,
			occurrences: indicatorAttempt.occurrences,
			category: indicator.category,
			type: indicator.type,
			name: indicator.name,
			deduction: indicator.deduction,
			failureThreshold: indicator.failureThreshold,
			isActive: indicator.isActive,
		} as IRatingExamAttemptIndicator);
	}

	const practicalActualScore = Math.max(0, 100 - practicalSection.deductions);
	const practicalPassed = practicalActualScore / 100 >= 0.8;

	return {
		ratingExamId: body.ratingExamId,
		indicators: indicators,

		theoryPassed: theorySection.passed,
		practicalPassed: practicalSection.passed && practicalPassed,
		passed: theorySection.passed && practicalSection.passed && practicalPassed,

		practicalScore: practicalActualScore,
	};
}

export default router;
