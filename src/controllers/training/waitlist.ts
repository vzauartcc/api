import { Router, type NextFunction, type Request, type Response } from 'express';
import { body, validationResult } from 'express-validator';
import { isValidObjectId } from 'mongoose';
import discord from '../../helpers/discord.js';
import {
	throwBadRequestException,
	throwNotFoundException,
	throwTooManyRequestsException,
} from '../../helpers/errors.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import { isMember, isSeniorStaff, isTrainingStaff } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { TrainingRequestMilestoneModel as TrainingMilestoneModel } from '../../models/trainingMilestone.js';
import { TrainingWaitlistModel } from '../../models/trainingWaitlist.js';
import { UserModel, type IUser } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();

const createValidation = [
	body('certification').trim().notEmpty().withMessage('Milestone is required'),
	body('availability')
		.isArray()
		.withMessage('Availability is required')
		.isLength({ min: 1 })
		.withMessage('At least one availability option is required'),
];

const createPatchValidation = [
	...createValidation,
	body('instructor').isNumeric().isInt().toInt().withMessage('Instructor CID must be a number'),
	body('notes')
		.trim()
		.optional()
		.isLength({ max: 4000 })
		.withMessage('Notes must not exceed 4000 characters'),
];

const createManualValidation = [
	...createPatchValidation,
	body('student').isNumeric().isInt({ min: 1 }).toInt().withMessage('Student CID must be a number'),
];

router.get('/', getUser, isMember, async (req: Request, res: Response, next: NextFunction) => {
	try {
		let waitlist = await TrainingWaitlistModel.find({})
			.sort({ createdAt: 'asc' })
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

		if (!req.user.isSeniorStaff) {
			waitlist = waitlist.map((i: any) => {
				delete i.notes;
				return i;
			});
		}

		return res.status(status.OK).json(waitlist);
	} catch (e) {
		return next(e);
	}
});

router.post(
	'/',
	getUser,
	isMember,
	createValidation,
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

			const certification = await TrainingMilestoneModel.findOne({ code: req.body.certification })
				.lean()
				.exec();

			if (!certification) {
				throwNotFoundException('Milestone Not Found');
			}

			const existing = await TrainingWaitlistModel.find({ studentCid: req.user.cid }).lean().exec();

			if (existing && existing.length > 0) {
				throwTooManyRequestsException('You are already on the waitlist');
			}

			await TrainingWaitlistModel.create({
				studentCid: req.user.cid,
				instructorCid: -1,
				certCode: certification.code,
				availability: req.body.availability,
				notes: '',
			});

			await DossierModel.create({
				affected: -1,
				by: req.user.cid,
				action: '%b joined the training waitlist.',
				actionType: ACTION_TYPE.CREATE_WAITLIST_SIGNUP,
			});

			clearCachePrefix('waitlist');

			return res.status(status.CREATED).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.post(
	'/manual',
	getUser,
	isSeniorStaff,
	createManualValidation,
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

			const student = await UserModel.findOne({ cid: req.body.student }).lean().exec();
			if (!student) {
				throwBadRequestException('Student not found');
			}

			const instructor = await UserModel.findOne({ cid: req.body.instructor }).lean().exec();
			if (!instructor && Number(req.body.instructor) !== -1) {
				throwBadRequestException('Instructor not found');
			}

			const certification = await TrainingMilestoneModel.findOne({
				code: req.body.certification,
			})
				.lean()
				.exec();
			if (!certification) {
				throwBadRequestException('Milestone not found');
			}

			const existing = await TrainingWaitlistModel.find({ studentCid: student.cid }).lean().exec();
			if (existing.length > 0) {
				throwBadRequestException('Student already waitlisted');
			}

			await TrainingWaitlistModel.create({
				studentCid: student.cid,
				instructorCid: req.body.instructor,
				assignedDate: +req.body.instructor !== -1 ? new Date() : null,
				certCode: certification.code,
				availability: req.body.availability,
				notes: req.body.notes || '',
			});

			await DossierModel.create({
				affected: student.cid,
				by: req.user.cid,
				action: '%a was added to the training waitlist by %b',
				actionType: ACTION_TYPE.MANUAL_WAITLIST_SIGNUP,
			});

			clearCachePrefix('waitlist');

			if (student?.discord) {
				if (Number(req.body.instructor) > 0) {
					await req.app.redis.lpush(
						'dbot:student_assignment',
						JSON.stringify({
							studentId: student.discord,
							instructorCid: Number(req.body.instructor),
							added: true,
						}),
					);
				}
			} else {
				await discord.sendMessage('1107470185218199562', {
					content: `<@&1215950778120933467> ${student.name}'s Discord account is not linked. Automatic training roles not applied.`,
				});
			}

			return res.status(status.CREATED).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.patch(
	'/:id',
	getUser,
	isSeniorStaff,
	createPatchValidation,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.params['id'] ||
				req.params['id'] === 'undefined' ||
				!isValidObjectId(req.params['id'])
			) {
				throwBadRequestException('Invalid ID');
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

			const waitlist = await TrainingWaitlistModel.findById(req.params['id'])
				.populate('student', 'fname lname cid rating discord')
				.populate('instructor', 'fname lname cid')
				.populate('certification', 'name code')
				.exec();

			if (!waitlist) {
				throwNotFoundException('Waitlist Entry Not Found');
			}

			const certification = await TrainingMilestoneModel.findOne({
				code: req.body.certification,
			})
				.lean()
				.exec();
			if (!certification) {
				throwBadRequestException('Milestone not found');
			}

			const instructor = await UserModel.findOne({ cid: req.body.instructor }).lean().exec();
			if (!instructor && Number(req.body.instructor) !== -1) {
				throwBadRequestException('Instructor not found');
			}

			const oldInstructor = waitlist.instructorCid.toString();

			waitlist.instructorCid = req.body.instructor;
			waitlist.certCode = req.body.certification;
			waitlist.availability = req.body.availability;
			waitlist.assignedDate =
				+req.body.instructor === -1 ? null : waitlist.assignedDate || new Date();
			waitlist.notes = req.body.notes ?? waitlist.notes;

			await waitlist.save();

			await DossierModel.create({
				affected: waitlist.studentCid,
				by: req.user.cid,
				action: 'Training waitlist signup for %a was updated by %b.',
				actionType: ACTION_TYPE.EDIT_WAITLIST_SIGNUP,
			});

			const student = waitlist.student as IUser;

			if (student?.discord) {
				if (Number(oldInstructor) === waitlist.instructorCid) return;

				if (Number(oldInstructor) > 0) {
					await req.app.redis.lpush(
						'dbot:student_assignment',
						JSON.stringify({
							studentId: student.discord,
							instructorCid: Number(oldInstructor),
							added: false,
						}),
					);
				}

				if (waitlist.instructorCid > 0) {
					await req.app.redis.lpush(
						'dbot:student_assignment',
						JSON.stringify({
							studentId: student.discord,
							instructorCid: waitlist.instructorCid,
							added: true,
						}),
					);
				}
			} else {
				await discord.sendMessage('1107470185218199562', {
					content: `<@&1215950778120933467> ${student.name}'s Discord account is not linked. Automatic training roles not applied.`,
				});
			}

			clearCachePrefix('waitlist');

			return res.status(status.OK).json();
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
			if (!isValidObjectId(req.params['id'])) {
				throwBadRequestException('Invalid ID');
			}

			const waitlist = await TrainingWaitlistModel.findByIdAndDelete(req.params['id']).exec();

			if (!waitlist) {
				throwNotFoundException('Waitlist Entry Not Found');
			}

			await DossierModel.create({
				affected: waitlist.studentCid,
				by: req.user.cid,
				action: '%b deleted training waitlist signup for %a.',
				actionType: ACTION_TYPE.DELETE_WAITLIST_SIGNUP,
			});

			clearCachePrefix('waitlist');

			const student = await UserModel.findOne({ cid: waitlist.studentCid })
				.select('cid discord')
				.lean()
				.exec();

			if (student?.discord && waitlist.instructorCid > 0) {
				await req.app.redis.lpush(
					'dbot:student_assignment',
					JSON.stringify({
						studentId: student.discord,
						instructorCid: waitlist.instructorCid,
						added: false,
					}),
				);
			}

			return res.sendStatus(status.NO_CONTENT);
		} catch (e) {
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

		return res.status(status.OK).json(instructors.sort((a, b) => a.cid - b.cid));
	} catch (e) {
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
				throwBadRequestException('Invalid CID');
			}

			const waitlist = await TrainingWaitlistModel.find({ instructorCid: req.params['cid'] })
				.populate('student', 'fname lname cid rating')
				.populate('instructor', 'fname lname cid')
				.populate('certification', 'name code')
				.sort({ assignedDate: 'desc' })
				.cache('10 minutes', `waitlist-instructor-${req.params['cid']}`)
				.exec();

			return res.status(status.OK).json(waitlist);
		} catch (e) {
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
			if (!isValidObjectId(req.params['id'])) {
				throwBadRequestException('Missing ID');
			}

			const data = await TrainingWaitlistModel.findById(req.params['id'])
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
				.lean({ virtuals: true })
				.exec();

			return res.status(status.OK).json(data);
		} catch (e) {
			return next(e);
		}
	},
);

export default router;
