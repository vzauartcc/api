import { captureException, captureMessage } from '@sentry/node';
import axios from 'axios';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DateTime } from 'luxon';
import { sendMail } from '../helpers/mailer.js';
import { uploadToS3 } from '../helpers/s3.js';
import { vatusaApi, type IVisitingStatus } from '../helpers/vatusa.js';
import { hasRole, isManagement, isStaff } from '../middleware/auth.js';
import internalAuth from '../middleware/internalAuth.js';
import getUser from '../middleware/user.js';
import { AbsenceModel } from '../models/absence.js';
import { ControllerHoursModel } from '../models/controllerHours.js';
import { DossierModel } from '../models/dossier.js';
import { NotificationModel } from '../models/notification.js';
import { RoleModel } from '../models/role.js';
import { UserModel } from '../models/user.js';
import { VisitApplicationModel } from '../models/visitApplication.js';
import status from '../types/status.js';

const router = Router();

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const allUsers = await UserModel.find({})
			.select('-email -idsToken -discordInfo -certificationDate -broadcast')
			.sort({
				lname: 'asc',
				fname: 'asc',
			})
			.populate([
				{
					path: 'certifications',
					options: {
						sort: { order: 'desc' },
					},
				},
				{
					path: 'roles',
					options: {
						sort: { order: 'asc' },
					},
				},
				{
					path: 'absence',
					match: {
						expirationDate: {
							$gte: new Date(),
						},
						deleted: false,
					},
					select: '-reason',
				},
			])
			.lean({ virtuals: true })
			.exec();

		const home = allUsers.filter((user) => user.vis === false && user.member === true);
		const visiting = allUsers.filter((user) => user.vis === true && user.member === true);
		const removed = allUsers.filter((user) => user.member === false);

		if (!home || !visiting || !removed) {
			throw {
				code: status.INTERNAL_SERVER_ERROR,
				message: 'Unable to retrieve controllers',
			};
		}

		return res.status(status.OK).json({ home, visiting, removed });
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

interface IUserLean {
	fname: string;
	lname: string;
	cid: number;
	roleCodes: string[];
}

interface IRoleGroup {
	title: string;
	code: string;
	users: IUserLean[];
}

interface IStaffDirectory {
	[key: string]: IRoleGroup;
}

router.get('/staff', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const users = await UserModel.find()
			.select('fname lname cid roleCodes')
			.sort({ lname: 'asc', fname: 'asc' })
			.lean<IUserLean[]>()
			.exec();

		if (!users) {
			throw {
				code: 503,
				message: 'Unable to retrieve staff members',
			};
		}

		const staff: IStaffDirectory = {
			atm: {
				title: 'Air Traffic Manager',
				code: 'atm',
				users: [],
			},
			datm: {
				title: 'Deputy Air Traffic Manager',
				code: 'datm',
				users: [],
			},
			ta: {
				title: 'Training Administrator',
				code: 'ta',
				users: [],
			},
			ec: {
				title: 'Events Team',
				code: 'ec',
				users: [],
			},
			wm: {
				title: 'Web Team',
				code: 'wm',
				users: [],
			},
			fe: {
				title: 'Facility Engineering Team',
				code: 'fe',
				users: [],
			},
			ins: {
				title: 'Instructors',
				code: 'instructors',
				users: [],
			},
			ia: {
				title: 'Instructor Assistants',
				code: 'ia',
				users: [],
			},
			mtr: {
				title: 'Mentors',
				code: 'instructors',
				users: [],
			},
		};
		(users as IUserLean[]).forEach((user) => {
			user.roleCodes.forEach((roleCode) => {
				if (staff[roleCode as keyof IStaffDirectory]) {
					staff[roleCode as keyof IStaffDirectory]!.users.push(user);
				}
			});
		});

		return res.status(status.OK).json(staff);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.get('/role', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const roles = await RoleModel.find().lean().exec();

		return res.status(status.OK).json(roles);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.get('/oi', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const oi = await UserModel.find({ deletedAt: null, member: true }).select('oi').lean().exec();

		if (!oi) {
			throw {
				code: status.INTERNAL_SERVER_ERROR,
				message: 'Unable to retrieve operating initials',
			};
		}

		return res.status(status.OK).json(oi.map((o) => o.oi));
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.get(
	'/visit',
	getUser,
	isManagement,
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			const applications = await VisitApplicationModel.find({
				deleted: false,
			})
				.lean()
				.exec();

			let retval = [];
			for (const app of applications) {
				try {
					let vatusaData = {} as IVisitingStatus;
					if (process.env['NODE_ENV'] === 'development') {
						vatusaData = {
							visiting: true,
							recentlyRostered: false,
							hasRating: true,
							ratingConsolidation: true,
							needsBasic: false,
							promo: false,
							visitingDays: 0,
							hasHome: true,
							ratingHours: 0,
							promoDays: 0,
						};
					} else {
						const { data } = await vatusaApi.get(`/user/${app.cid}/transfer/checklist`);
						vatusaData = {
							visiting: data.data.visiting,
							recentlyRostered: data.data['60days'],
							hasRating: data.data.hasRating,
							ratingConsolidation: data.data['50hrs'],
							needsBasic: data.data.needbasic,
							promo: data.data.promo,
							visitingDays: data.data.visitingDays,
							hasHome: data.data.hasHome,
							ratingHours: data.data.ratingHours,
							promoDays: data.data.promoDays,
						};
					}

					retval.push({
						application: app,
						statusChecks: vatusaData,
					});
				} catch (_e) {
					retval.push({
						application: app,
						statusChecks: null,
					});
				}
			}

			return res.status(status.OK).json(retval);
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.get(
	'/absence',
	getUser,
	isManagement,
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			const absences = await AbsenceModel.find({
				expirationDate: {
					$gte: new Date(),
				},
				deleted: false,
			})
				.populate('user', 'fname lname cid')
				.sort({
					expirationDate: 'asc',
				})
				.lean()
				.exec();

			return res.status(status.OK).json(absences);
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.post(
	'/absence',
	getUser,
	isManagement,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.body ||
				req.body.controller === '' ||
				req.body.expirationDate === 'T00:00:00.000Z' ||
				req.body.reason === ''
			) {
				throw {
					code: 400,
					message: 'You must fill out all required fields',
				};
			}

			if (new Date(req.body.expirationDate) < new Date()) {
				throw {
					code: 400,
					message: 'Expiration date must be in the future',
				};
			}

			await AbsenceModel.create(req.body);

			await NotificationModel.create({
				recipient: req.body.controller,
				title: 'Leave of Absence granted',
				read: false,
				content: `You have been granted a Leave of Absence until <b>${new Date(
					req.body.expirationDate,
				).toLocaleString('en-US', {
					month: 'long',
					day: 'numeric',
					year: 'numeric',
					timeZone: 'UTC',
				})}</b>.`,
			});

			await DossierModel.create({
				by: req.user.cid,
				affected: req.body.controller,
				action: `%b added a leave of absence for %a until ${new Date(req.body.expirationDate).toLocaleDateString()}: ${req.body.reason}`,
			});

			return res.status(status.CREATED).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.delete(
	'/absence/:id',
	getUser,
	isManagement,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id']) {
				throw {
					code: 400,
					message: 'Invalid request',
				};
			}

			const absence = await AbsenceModel.findOne({ _id: req.params['id'] }).exec();
			if (!absence) {
				throw {
					code: 400,
					message: 'Unable to locate absence.',
				};
			}

			await absence.delete();

			await DossierModel.create({
				by: req.user.cid,
				affected: absence.controller,
				action: `%b deleted the leave of absence for %a.`,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.get('/log', getUser, isStaff, async (req: Request, res: Response, next: NextFunction) => {
	const page = +(req.query['page'] as string) || 1;
	const limit = +(req.query['limit'] as string) || 20;
	const amount = await DossierModel.countDocuments();

	try {
		const dossier = await DossierModel.find()
			.sort({
				createdAt: 'desc',
			})
			.skip(limit * (page - 1))
			.limit(limit)
			.populate('userBy', 'fname lname cid')
			.populate('userAffected', 'fname lname cid')
			.lean();

		return res.status(200).json({ amount, dossier });
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.get('/:cid', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const user = await UserModel.findOne({
			cid: req.params['cid'],
		})
			.select('-idsToken -discordInfo -discord -certificationDate -broadcast')
			.populate([
				{
					path: 'certifications',
					options: {
						sort: { order: 'desc' },
					},
				},
				{
					path: 'roles',
					options: {
						sort: { order: 'asc' },
					},
				},
				{
					path: 'absence',
					match: {
						expirationDate: {
							$gte: new Date(),
						},
						deleted: false,
					},
					select: '-reason',
				},
			])
			.lean({ virtuals: true })
			.exec();

		if (!user) {
			throw {
				code: status.NOT_FOUND,
				message: 'Unable to find controller',
			};
		}

		if (req.user.isSeniorStaff) {
			return res.status(status.OK).json(user);
		} else {
			const { email, ...userNoEmail } = user;
			return res.status(status.OK).json(userNoEmail);
		}
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.put(
	'/:cid/rating',
	internalAuth,
	async (req: Request, res: Response, next: NextFunction) => {
		if (!req.body.rating) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Rating is required',
			};
		}

		try {
			const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();

			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'Unable to find user',
				};
			}

			if (user.rating !== req.body.rating) {
				user.rating = req.body.rating;

				await user.save();

				await DossierModel.create({
					by: -1,
					affected: req.params['cid'],
					action: `%a was set as Rating ${req.body.rating} by an external service.`,
				});
			}

			return res.status(status.OK).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

// @TODO: fix this to remove the ts-ignore and structure the data properly
router.get('/stats/:cid', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const controllerHours = await ControllerHoursModel.find({ cid: req.params['cid'] }).exec();

		const hours = {
			gtyear: {
				del: 0,
				gnd: 0,
				twr: 0,
				app: 0,
				ctr: 0,
			},
			total: {
				del: 0,
				gnd: 0,
				twr: 0,
				app: 0,
				ctr: 0,
			},
			sessionCount: controllerHours.length,
			sessionAvg: 0,
			months: [],
		};
		const pos = {
			del: 'del',
			gnd: 'gnd',
			twr: 'twr',
			dep: 'app',
			app: 'app',
			ctr: 'ctr',
		};
		const today = DateTime.utc();

		const getMonthYearString = (date: DateTime<true> | DateTime<false>) =>
			date.toFormat('LLL yyyy');

		for (let i = 0; i < 12; i++) {
			const theMonth = today.minus({ months: i });
			const ms = getMonthYearString(theMonth);
			// @ts-ignore
			hours[ms] = {
				del: 0,
				gnd: 0,
				twr: 0,
				app: 0,
				ctr: 0,
			};

			// @ts-ignore
			hours.months.push(ms);
		}

		for (const sess of controllerHours) {
			if (!sess.timeEnd) continue;

			const thePos = sess.position.toLowerCase().match(/([a-z]{3})$/);

			if (thePos && thePos[1]) {
				const start = DateTime.fromJSDate(sess.timeStart).toUTC();
				const end = DateTime.fromJSDate(sess.timeEnd).toUTC();

				// @ts-ignore
				const type = pos[thePos[1]];
				const length = Number(end.diff(start)) / 1000;
				let ms = getMonthYearString(start);

				// @ts-ignore
				if (!hours[ms]) {
					ms = 'gtyear';
				}

				// @ts-ignore
				hours[ms][type] += length;

				// @ts-ignore
				hours.total[type] += length;
			}
		}

		hours.sessionAvg = Math.round(
			Object.values(hours.total).reduce((acc, cv) => acc + cv) / hours.sessionCount,
		);

		return res.status(status.OK).json(hours);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.post('/visit', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.user) {
			throw {
				code: status.UNAUTHORIZED,
				message: 'Unable to verify user',
			};
		}

		const userData = {
			cid: req.user.cid,
			fname: req.user.fname,
			lname: req.user.lname,
			rating: req.user.ratingLong,
			email: req.body.email,
			home: req.body.facility,
			reason: req.body.reason,
		};

		await VisitApplicationModel.create(userData);

		sendMail({
			to: req.body.email,
			subject: `Visiting Application Received | Chicago ARTCC`,
			template: 'visitReceived',
			context: {
				name: `${req.user.fname} ${req.user.lname}`,
			},
		});
		sendMail({
			to: 'atm@zauartcc.org, datm@zauartcc.org',
			from: {
				name: 'Chicago ARTCC',
				address: 'no-reply@zauartcc.org',
			},
			subject: `New Visiting Application: ${req.user.fname} ${req.user.lname} | Chicago ARTCC`,
			template: 'staffNewVisit',
			context: {
				user: userData,
			},
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.get('/visit/status', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const count = await VisitApplicationModel.countDocuments({
			cid: req.user.cid,
			deleted: false,
		}).exec();

		const { data: vatusaData } = await vatusaApi.get(`/user/${req.user.cid}/transfer/checklist`);

		return res.status(status.OK).json({
			count,
			status: {
				hasHome: vatusaData.data.hasHome,
				hasRating: vatusaData.data.hasRating,
				visiting: vatusaData.data.visiting,
				recentlyRostered: vatusaData.data['60days'],
				ratingConsolidation: vatusaData.data['50hrs'],
				needsBasic: vatusaData.data.needbasic,
				promo: vatusaData.data.promo,
				visitingDays: vatusaData.data.visitingDays,
				promoDays: vatusaData.data.promoDays,
				ratingHours: vatusaData.data.ratingHours,
			} as IVisitingStatus,
		});
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.put(
	'/visit/:cid',
	getUser,
	hasRole(['atm', 'datm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const application = await VisitApplicationModel.findOne({ cid: req.params['cid'] }).exec();
			if (!application) {
				throw {
					code: status.NOT_FOUND,
					message: 'Visiting Application Not Found.',
				};
			}

			await vatusaApi.post(`/facility/ZAU/roster/manageVisitor/${req.params['cid']}`);

			await application.delete();

			const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();
			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'User not found',
				};
			}

			const oi = await UserModel.find({ deletedAt: null, member: true }).select('oi').lean().exec();
			if (!oi || oi.length === 0) {
				throw {
					code: 500,
					message: 'Unable to generate Operating Initials',
				};
			}

			const userOi = generateOperatingInitials(
				user.fname,
				user.lname,
				oi.map((oi) => oi.oi || '').filter((oi) => oi !== ''),
			);

			if (userOi === '') {
				captureMessage(`Unable to generate OIs for ${req.params['cid']}`);
			}

			user.member = true;
			user.vis = true;
			user.oi = userOi;

			// Assign certCodes based on rating removed right now due to policy change. I will leave this here in case future policy is changed.
			/*let certCodes = [];
		if (user.rating >= 2) {
		  certCodes.push('gnd', 'del');
		}
		if (user.rating >= 3) {
		  certCodes.push('twr');
		}
		if (user.rating >= 4) {
		  certCodes.push('app');
		}
		user.certCodes = certCodes;*/

			await user.save();

			sendMail({
				to: user.email,
				subject: `Visiting Application Accepted | Chicago ARTCC`,
				template: 'visitAccepted',
				context: {
					name: `${user.fname} ${user.lname}`,
				},
			});

			DossierModel.create({
				by: req.user.cid,
				affected: user.cid,
				action: `%b approved the visiting application for %a.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.delete(
	'/visit/:cid',
	getUser,
	hasRole(['atm', 'datm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const application = await VisitApplicationModel.findOne({ cid: req.params['cid'] }).exec();
			if (!application) {
				throw {
					code: status.NOT_FOUND,
					message: 'Visiting Application Not Found.',
				};
			}

			await application.delete();

			const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();
			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'User not found',
				};
			}

			sendMail({
				to: user.email,
				subject: `Visiting Application Rejected | Chicago ARTCC`,
				template: 'visitRejected',
				context: {
					name: `${user.fname} ${user.lname}`,
					reason: req.body.reason,
				},
			});

			await DossierModel.create({
				by: req.user.cid,
				affected: user.cid,
				action: `%b rejected the visiting application for %a: ${req.body.reason}`,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.post('/:cid', internalAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();
		if (user) {
			throw {
				code: status.CONFLICT,
				message: 'This user already exists',
			};
		}

		if (!req.body) {
			throw {
				code: status.BAD_REQUEST,
				message: 'No user data provided',
			};
		}

		const oi = await UserModel.find({ deletedAt: null, member: true }).select('oi').lean().exec();
		const userOi = generateOperatingInitials(
			req.body.fname,
			req.body.lname,
			oi.map((oi) => oi.oi || '').filter((oi) => oi !== ''),
		);

		const { data } = await axios.get(
			`https://ui-avatars.com/api/?name=${userOi}&size=256&background=122049&color=ffffff`,
			{ responseType: 'arraybuffer' },
		);

		await uploadToS3(`avatars/${req.body.cid}-default.png`, data, 'image/png', {
			ContentDisposition: 'inline',
		});

		await UserModel.create({
			...req.body,
			oi: userOi,
			avatar: `${req.body.cid}-default.png`,
		});

		const ratings = [
			'Unknown',
			'OBS',
			'S1',
			'S2',
			'S3',
			'C1',
			'C2',
			'C3',
			'I1',
			'I2',
			'I3',
			'SUP',
			'ADM',
		];

		sendMail({
			to: 'atm@zauartcc.org, datm@zauartcc.org, ta@zauartcc.org',
			subject: `New ${req.body.vis ? 'Visitor' : 'Member'}: ${req.body.fname} ${req.body.lname} | Chicago ARTCC`,
			template: 'newController',
			context: {
				name: `${req.body.fname} ${req.body.lname}`,
				email: req.body.email,
				cid: req.body.cid,
				rating: ratings[req.body.rating],
				vis: req.body.vis,
				type: req.body.vis ? 'visitor' : 'member',
				home: req.body.vis ? req.body.homeFacility : 'ZAU',
			},
		});

		await DossierModel.create({
			by: -1,
			affected: req.body.cid,
			action: `%a was created by an external service.`,
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.put(
	'/:cid/member',
	internalAuth,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();

			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'Unable to find user',
				};
			}

			let assignedOi: string | null = null;
			if (req.body.member === true) {
				const oi = await UserModel.find({ deletedAt: null, member: true })
					.select('oi')
					.lean()
					.exec();
				assignedOi = generateOperatingInitials(
					user.fname,
					user.lname,
					oi.map((oi) => oi.oi || '').filter((oi) => oi !== ''),
				);

				user.joinDate = req.body.joinDate || new Date();
				user.removalDate = null;
			} else {
				user.history.push({
					start: user.joinDate!,
					end: new Date(),
					reason: `Removed from roster by an external service.`,
				});
				user.joinDate = null;
				user.removalDate = new Date();
			}
			user.member = req.body.member;
			user.oi = assignedOi;

			await user.save();
			const ratings = [
				'Unknown',
				'OBS',
				'S1',
				'S2',
				'S3',
				'C1',
				'C2',
				'C3',
				'I1',
				'I2',
				'I3',
				'SUP',
				'ADM',
			];
			if (req.body.member || req.body.vis) {
				sendMail({
					to: 'atm@zauartcc.org, datm@zauartcc.org, ta@zauartcc.org',
					subject: `New ${user.vis ? 'Visitor' : 'Member'}: ${user.fname} ${user.lname} | Chicago ARTCC`,
					template: 'newController',
					context: {
						name: `${user.fname} ${user.lname}`,
						email: user.email,
						cid: user.cid,
						rating: ratings[user.rating],
						vis: user.vis,
						type: user.vis ? 'visitor' : 'member',
						home: 'NA',
					},
				});
			}

			await DossierModel.create({
				by: -1,
				affected: req.params['cid'],
				action: `%a was ${req.body.member ? 'added to' : 'removed from'} the roster by an external service.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.put('/:cid/visit', internalAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();

		if (!user) {
			throw {
				code: status.NOT_FOUND,
				message: 'Unable to find user',
			};
		}

		user.vis = req.body.vis;

		await user.save();

		await DossierModel.create({
			by: -1,
			affected: req.params['cid'],
			action: `%a was set as a ${req.body.vis ? 'visiting controller' : 'home controller'} by an external service.`,
		});

		return res.status(status.OK).json();
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.put(
	'/:cid',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'ec', 'wm', 'ins', 'mtr']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.body.form) {
				throw {
					code: status.BAD_REQUEST,
					message: 'No user data included',
				};
			}

			const { fname, lname, email, oi, roles, certs, vis } = req.body.form;
			const toApply = {
				roles: [] as string[],
			};

			// Prepare roles to update
			for (const [code, set] of Object.entries(roles)) {
				if (set) {
					toApply.roles.push(code);
				}
			}

			// Find the existing user
			const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();

			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'User not found',
				};
			}

			// Handle certifications (certCodes and certificationDate)
			const existingCertMap = new Map(user.certificationDate.map((cert) => [cert.code, cert]));
			const updatedCertificationDate = [];

			for (const [code, set] of Object.entries(certs)) {
				if (set) {
					if (existingCertMap.has(code)) {
						// Keep the existing gainedDate if certification already exists
						updatedCertificationDate.push({
							code,
							gainedDate: existingCertMap.get(code)!.gainedDate,
						});
					} else {
						// If it's a new certification, add with today's date
						updatedCertificationDate.push({
							code,
							gainedDate: new Date(), // Assign current date as gainedDate
						});
					}
				}
			}

			const { data } = await axios.get(
				`https://ui-avatars.com/api/?name=${oi}&size=256&background=122049&color=ffffff`,
				{ responseType: 'arraybuffer' },
			);

			await uploadToS3(`avatars/${req.params['cid']}-default.png`, data, 'image/png', {
				ContentDisposition: 'inline',
			});

			// Use findOneAndUpdate to update the user document
			await UserModel.findOneAndUpdate(
				{ cid: req.params['cid'] }, // Find the user by their CID
				{
					fname,
					lname,
					email,
					oi,
					vis,
					roleCodes: toApply.roles, // Update roles
					certCodes: updatedCertificationDate.map((cert) => cert.code), // Update certCodes
					certificationDate: updatedCertificationDate, // Update certificationDate with gainedDate
				},
				{ new: true }, // Return the updated document after applying changes
			).exec();

			// Log the update in the user's dossier
			await DossierModel.create({
				by: req.user.cid,
				affected: req.params['cid'],
				action: `%a was updated by %b.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

router.put(
	'/remove-cert/:cid',
	internalAuth,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			// Find the user by CID
			const cid = req.params['cid'];
			const user = await UserModel.findOne({ cid }).exec();

			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'User not found',
				};
			}

			// Remove the user's certCodes and certificationDate
			user.certCodes = []; // Clear certCodes
			user.certificationDate = []; // Clear certificationDate (remove all certifications and gained dates)

			await user.save();

			return res.status(status.OK).json({ message: 'Certs removed successfully' });
		} catch (e) {
			console.error('Error removing certs', e);
			captureException(e);

			return next(e);
		}
	},
);

router.delete(
	'/:cid',
	getUser,
	hasRole(['atm', 'datm']),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.body.reason) {
				throw {
					code: status.BAD_REQUEST,
					message: 'You must specify a reason',
				};
			}

			const user = await UserModel.findOne({ cid: req.params['cid'] });

			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'User not found',
				};
			}

			if (user.vis) {
				await vatusaApi.delete(`/facility/ZAU/roster/manageVisitor/${req.params['cid']}`, {
					data: {
						reason: req.body.reason,
						by: req.user.cid,
					},
				});
			} else {
				await vatusaApi.delete(`/facility/ZAU/roster/${req.params['cid']}`, {
					data: {
						reason: req.body.reason,
						by: req.user.cid,
					},
				});
			}

			user.member = false;
			user.removalDate = new Date();
			user.history.push({
				start: user.joinDate!,
				end: new Date(),
				reason: req.body.reason,
			});
			user.joinDate = null;

			await user.save();

			await DossierModel.create({
				by: req.user.cid,
				affected: req.params['cid'],
				action: `%a was removed from the roster by %b, reason: ${req.body.reason}`,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			captureException(e);

			return next(e);
		}
	},
);

export default router;

function generateOperatingInitials(fname: string, lname: string, usedOi: string[]): string {
	let operatingInitials = '';
	const MAX_TRIES = 10;

	// First initial Last initial
	operatingInitials = `${fname.charAt(0).toUpperCase()}${lname.charAt(0).toUpperCase()}`;

	if (!usedOi.includes(operatingInitials)) {
		return operatingInitials;
	}

	// Last initial First initial
	operatingInitials = `${lname.charAt(0).toUpperCase()}${fname.charAt(0).toUpperCase()}`;

	if (!usedOi.includes(operatingInitials)) {
		return operatingInitials;
	}

	// Combine first name and last name, start looking for any available OIs.
	const chars = `${lname.toUpperCase()}${fname.toUpperCase()}`;

	let tries = 0;

	do {
		operatingInitials = random(chars, 2);
		tries++;
	} while (usedOi.includes(operatingInitials) || tries > MAX_TRIES);

	if (!usedOi.includes(operatingInitials)) {
		return operatingInitials;
	}

	// Pick any available two letters in the alphabet to find available OIs.
	tries = 0;

	do {
		operatingInitials = random('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 2);
		tries++;
	} while (usedOi.includes(operatingInitials) || tries > MAX_TRIES);

	if (!usedOi.includes(operatingInitials)) {
		return operatingInitials;
	}

	return operatingInitials;
}

const random = (str: string, len: number) => {
	let ret = '';
	for (let i = 0; i < len; i++) {
		ret = `${ret}${str.charAt(Math.floor(Math.random() * str.length))}`;
	}
	return ret;
};
