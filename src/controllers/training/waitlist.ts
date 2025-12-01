import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance } from '../../app.js';
import { isMember, isSeniorStaff, isTrainingStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { CertificationModel } from '../../models/certification.js';
import { TrainingWaitlistModel } from '../../models/trainingWaitlist.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();

router.get('/', getUser, isMember, async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const waitlist = await TrainingWaitlistModel.find({})
			.populate([
				{
					path: 'student',
					select: 'fname lname cid rating certCodes certifications',
					populate: {
						path: 'certifications',
						select: 'code name order class',
					},
				},
			])
			.populate('instructor', 'fname lname cid')
			.populate('certification', 'name code order')
			.lean()
			.cache('10 minutes', 'waitlist')
			.exec();

		return res.status(status.OK).json(waitlist);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}

		return next(e);
	}
});

router.post('/', getUser, isMember, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (
			!req.body ||
			!req.body.certification ||
			!Array.isArray(req.body.availability) ||
			!req.body.availability.length ||
			req.body.availability.length < 1
		) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Certification code is required.',
			};
		}

		const certification = await CertificationModel.findOne({ code: req.body.certification })
			.lean()
			.exec();

		if (!certification) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Certification code not found.',
			};
		}

		const existing = await TrainingWaitlistModel.find({ studentCid: req.user.cid }).lean().exec();

		if (existing && existing.length > 0) {
			throw {
				code: status.TOO_MANY_REQUESTS,
				message: 'You are already on the waitlist.',
			};
		}

		await TrainingWaitlistModel.create({
			studentCid: req.user.cid,
			instructorCid: -1,
			certCode: certification.code,
			availability: req.body.availability,
		});

		clearCache('');

		return res.status(status.CREATED).json();
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}

		return next(e);
	}
});

router.post(
	'/manual',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.body ||
				!req.body.student ||
				req.body.student === 'undefined' ||
				isNaN(Number(req.body.student)) ||
				!req.body.instructor ||
				req.body.instructor === 'undefined' ||
				isNaN(Number(req.body.instructor)) ||
				!req.body.certification ||
				!Array.isArray(req.body.availability) ||
				!req.body.availability.length ||
				req.body.availability.length < 1
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid Request.',
				};
			}

			const student = await UserModel.findOne({ cid: req.body.student }).lean().exec();
			if (!student) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Student not found.',
				};
			}

			const instructor = await UserModel.findOne({ cid: req.body.instructor }).lean().exec();
			if (!instructor && Number(req.body.instructor) !== -1) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Instructor not found.',
				};
			}

			const certification = await CertificationModel.findOne({
				code: req.body.certification,
			})
				.lean()
				.exec();
			if (!certification) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Certification not found.',
				};
			}

			const existing = await TrainingWaitlistModel.find({ studentCid: student.cid }).lean().exec();
			if (existing.length > 0) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Student is already on the waitlist.',
				};
			}

			await TrainingWaitlistModel.create({
				studentCid: student.cid,
				instructorCid: req.body.instructor,
				assignedDate: +req.body.instructor !== -1 ? new Date() : null,
				certCode: certification.code,
				availability: req.body.availability,
			});

			clearCache('');

			return res.status(status.CREATED).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}

			return next(e);
		}
	},
);

router.patch(
	'/:id',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.params['id'] ||
				req.params['id'] === 'undefined' ||
				!req.body.instructor ||
				!req.body.certification
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid Request.',
				};
			}

			const waitlist = await TrainingWaitlistModel.findById(req.params['id'])
				.populate('student', 'fname lname cid rating')
				.populate('instructor', 'fname lname cid')
				.populate('certification', 'name code')
				.exec();

			if (!waitlist) {
				throw {
					code: status.NOT_FOUND,
					message: 'Waitlist entry not found.',
				};
			}

			if (`${waitlist.instructorCid}` === req.body.instructor) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid Request.',
				};
			}

			waitlist.instructorCid = req.body.instructor;
			waitlist.certCode = req.body.certification;
			waitlist.assignedDate =
				+req.body.instructor === -1 ? null : waitlist.assignedDate || new Date();
			await waitlist.save();

			clearCache(req.params['id']);

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}

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
			if (!req.params['id']) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid Request.',
				};
			}

			const waitlist = await TrainingWaitlistModel.findByIdAndDelete(req.params['id']).exec();

			if (!waitlist) {
				throw {
					code: status.NOT_FOUND,
					message: 'Waitlist entry not found.',
				};
			}

			clearCache(req.params['id']);

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}

			return next(e);
		}
	},
);

router.get('/instructors', getUser, async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const instructors = await UserModel.find({ roleCodes: { $in: ['ins', 'mtr'] } })
			.select('fname lname cid')
			.cache('10 minutes', 'waitlist-instructors')
			.exec();

		return res.status(status.OK).json(instructors);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}

		return next(e);
	}
});

router.get(
	'/instructor/:cid',
	getUser,
	isTrainingStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.params['cid'] ||
				req.params['cid'] === 'undefined' ||
				isNaN(Number(req.params['cid']))
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid Request.',
				};
			}

			const waitlist = await TrainingWaitlistModel.find({ instructorCid: req.params['cid'] })
				.populate('student', 'fname lname cid rating')
				.populate('instructor', 'fname lname cid')
				.populate('certification', 'name code')
				.sort({ assignedDate: 'desc' })
				.cache()
				.exec();

			return res.status(status.OK).json(waitlist);
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}

			return next(e);
		}
	},
);

export default router;

function clearCache(id: string) {
	getCacheInstance().clear('waitlist');
	getCacheInstance().clear(`waitlist-${id}`);
}
