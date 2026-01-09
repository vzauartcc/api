import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance, logException } from '../../app.js';
import { sendMail } from '../../helpers/mailer.js';
import { isEventsTeam } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { StaffingRequestModel } from '../../models/staffingRequest.js';
import status from '../../types/status.js';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 10;

		const count = await StaffingRequestModel.countDocuments({ deleted: false })
			.cache('5 minutes', 'count-staffing-requests')
			.exec();
		let requests: any[] = [];

		if (count > 0) {
			requests = await StaffingRequestModel.find({ deleted: false })
				.skip(limit * (page - 1))
				.limit(limit)
				.sort({ date: 'desc' })
				.lean()
				.cache()
				.exec();
		}

		return res.status(status.OK).json({ amount: count, requests });
	} catch (e) {
		logException(req, e);

		return next(e);
	}
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['id'] || req.params['id'] === 'undefined') {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid ID.',
			};
		}

		const staffingRequest = await StaffingRequestModel.findById(req.params['id'])
			.cache('10 minutes', `staffing-request-${req.params['id']}`)
			.exec();

		if (!staffingRequest) {
			throw {
				code: status.NOT_FOUND,
				message: 'Staffing request not found',
			};
		}
		return res.status(status.OK).json(staffingRequest);
	} catch (e) {
		logException(req, e);

		return next(e);
	}
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
	// Submit staffing request
	try {
		if (
			!req.body.vaName ||
			!req.body.name ||
			!req.body.email ||
			!req.body.date ||
			!req.body.pilots ||
			!req.body.route ||
			!req.body.description
		) {
			// Validation
			throw {
				code: status.BAD_REQUEST,
				message: 'You must fill out all required fields',
			};
		}

		if (isNaN(req.body.pilots)) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Pilots must be a number',
			};
		}

		const count = await StaffingRequestModel.countDocuments({
			accepted: false,
			name: req.body.name,
			email: req.body.email,
		})
			.cache('5 minutes', `staffing-requests-submitted-${req.body.email}`)
			.exec();

		if (count >= 3) {
			throw {
				code: status.TOO_MANY_REQUESTS,
				message: 'You have reached the maximum limit of staffing requests with a pending status.',
			};
		}

		const newRequest = await StaffingRequestModel.create({
			vaName: req.body.vaName,
			name: req.body.name,
			email: req.body.email,
			date: req.body.date,
			pilots: req.body.pilots,
			route: req.body.route,
			description: req.body.description,
			accepted: false,
		});

		await getCacheInstance().clear(`staffing-requests-submitted-${req.body.email}`);
		await getCacheInstance().clear(`count-staffing-requests`);

		// Send an email notification to the specified email address
		sendMail({
			to: 'ec@zauartcc.org, aec@zauartcc.org',
			subject: `New Staffing Request from ${req.body.vaName} | Chicago ARTCC`,
			template: `staffingRequest`,
			context: {
				vaName: req.body.vaName,
				name: req.body.name,
				email: req.body.email,
				date: req.body.date,
				pilots: req.body.pilots,
				route: req.body.route,
				description: req.body.description,
				slug: newRequest.id,
			},
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		logException(req, e);

		return next(e);
	}
});

router.put(
	'/:id',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid ID.',
				};
			}

			const staffingRequest = await StaffingRequestModel.findById(req.params['id'])
				.cache('1 minute', `staffing-request-${req.params['id']}`)
				.exec();

			if (!staffingRequest) {
				throw {
					code: status.NOT_FOUND,
					message: 'Staffing request not found',
				};
			}

			staffingRequest.vaName = req.body.vaName;
			staffingRequest.name = req.body.name;
			staffingRequest.email = req.body.email;
			staffingRequest.date = req.body.date;
			staffingRequest.pilots = req.body.pilots;
			staffingRequest.route = req.body.route;
			staffingRequest.description = req.body.description;
			staffingRequest.accepted = req.body.accepted;

			await staffingRequest.save();
			await getCacheInstance().clear(`staffing-request-${staffingRequest.id}`);

			if (req.body.accepted) {
				sendMail({
					to: req.body.email,
					subject: `Staffing Request for ${req.body.vaName} accepted | Chicago ARTCC`,
					template: `staffingRequestAccepted`,
					context: {
						vaName: req.body.vaName,
						name: req.body.name,
						email: req.body.email,
						date: req.body.date,
						pilots: req.body.pilots,
						route: req.body.route,
						description: req.body.description,
					},
				});

				await DossierModel.create({
					by: req.user.cid,
					affected: -1,
					action: `%b approved a staffing request for ${req.body.vaName}.`,
					actionType: ACTION_TYPE.APPROVE_STAFFING_REQUEST,
				});
			} else {
				await DossierModel.create({
					by: req.user.cid,
					affected: -1,
					action: `%b rejected a staffing request for ${req.body.vaName}.`,
					actionType: ACTION_TYPE.REJECT_STAFFING_REQUEST,
				});
			}

			return res.status(status.OK).json();
		} catch (e) {
			logException(req, e);

			return next(e);
		}
	},
);

router.delete(
	'/:id',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid ID.',
				};
			}

			const staffingRequest = await StaffingRequestModel.findById(req.params['id'])
				.cache('1 minute', `staffing-request-${req.params['id']}`)
				.exec();

			if (!staffingRequest) {
				throw {
					code: status.NOT_FOUND,
					message: 'Staffing request not found',
				};
			}

			await staffingRequest.delete();
			await getCacheInstance().clear(`staffing-request-${staffingRequest.id}`);

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			logException(req, e);

			return next(e);
		}
	},
);

export default router;
