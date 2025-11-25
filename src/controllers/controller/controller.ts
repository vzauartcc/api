import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DateTime } from 'luxon';
import { getCacheInstance } from '../../app.js';
import { sendMail } from '../../helpers/mailer.js';
import { getUsersWithPrivacy } from '../../helpers/mongodb.js';
import { vatusaApi } from '../../helpers/vatusa.js';
import zau from '../../helpers/zau.js';
import {
	hasRole,
	isManagement,
	isNotSelf,
	isStaff,
	userOrInternal,
} from '../../middleware/auth.js';
import internalAuth from '../../middleware/internalAuth.js';
import getUser from '../../middleware/user.js';
import { CertificationModel } from '../../models/certification.js';
import { ControllerHoursModel } from '../../models/controllerHours.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { RoleModel } from '../../models/role.js';
import { UserModel, type IUser } from '../../models/user.js';
import status from '../../types/status.js';
import absenceRouter from './absence.js';
import { checkOI, clearUserCache, grantCerts, uploadAvatar } from './utils.js';
import visitRouter from './visitapplications.js';

const router = Router();

router.use('/absence', absenceRouter);
router.use('/visit', visitRouter);

router.get('/', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const allUsers = await getUsersWithPrivacy(req.user, { member: true });

		const home = allUsers.filter((user) => user.vis === false);
		const visiting = allUsers.filter((user) => user.vis === true);

		if (!home || !visiting) {
			throw {
				code: status.INTERNAL_SERVER_ERROR,
				message: 'Unable to retrieve controllers',
			};
		}

		return res.status(status.OK).json({ home, visiting });
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}

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
			.cache('10 minutes')
			.exec();

		if (!users) {
			throw {
				code: status.SERVICE_UNAVAILABLE,
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
				code: 'events',
				users: [],
			},
			wm: {
				title: 'Web Team',
				code: 'wm',
				users: [],
			},
			fe: {
				title: 'Facility Engineering Team',
				code: 'facilities',
				users: [],
			},
			ins: {
				title: 'Instructors',
				code: 'training',
				users: [],
			},
			ia: {
				title: 'Instructor Assistants',
				code: 'training',
				users: [],
			},
			mtr: {
				title: 'Mentors',
				code: 'training',
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
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/role', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const roles = await RoleModel.find().lean().cache('5 minutes').exec();

		return res.status(status.OK).json(roles);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/certifications', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const certifications = await CertificationModel.find().lean().cache('10 minutes').exec();

		return res.status(status.OK).json(certifications);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/oi', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const oi = await UserModel.find({ deletedAt: null, member: true })
			.select('oi')
			.lean()
			.cache('5 minutes', 'operating-initials')
			.exec();

		if (!oi) {
			throw {
				code: status.INTERNAL_SERVER_ERROR,
				message: 'Unable to retrieve operating initials',
			};
		}

		return res.status(status.OK).json(oi.map((o) => o.oi));
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/log', getUser, isStaff, async (req: Request, res: Response, next: NextFunction) => {
	const page = +(req.query['page'] as string) || 1;
	const limit = +(req.query['limit'] as string) || 20;
	const action = +(req.query['action'] as string);

	const actionQuery = {} as any;
	if (!isNaN(action) && action > 0) {
		actionQuery.actionType = action;
	}

	const amount = await DossierModel.countDocuments(actionQuery).cache('5 minutes').exec();

	try {
		const dossier = await DossierModel.find(actionQuery)
			.sort({
				createdAt: 'desc',
			})
			.skip(limit * (page - 1))
			.limit(limit)
			.populate('userBy', 'fname lname cid')
			.populate('userAffected', 'fname lname cid')
			.lean()
			.cache()
			.exec();

		return res.status(status.OK).json({ amount, dossier });
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get(
	'/log/types',
	getUser,
	isStaff,
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			return res
				.status(status.OK)
				.json([
					'All Actions',
					'Created User',
					'Updated User',
					'Removed User',
					'Updated Bio',
					'Set Membership',
					'Set Visit Status',
					'Created LOA',
					'Removed LOA',
					'Set Rating',
					'Approved Visit Application',
					'Rejected Visit Application',
					'Created Event Signup',
					'Deleted Event Signup',
					'Created Manual Event Signup',
					'Deleted Manual Event Signup',
					'Assigned Event Position',
					'Unassigned Event Position',
					'Created Event',
					'Updated Event',
					'Deleted Event',
					'Sent Notification for Event',
					'Approved Staffing Request',
					'Rejected Staffing Request',
					'Submitted Feedback',
					'Approved Feedback',
					'Rejected Feedback',
					'Created Document',
					'Updated Document',
					'Deleted Document',
					'Created File',
					'Updated File',
					'Deleted File',
					'Created News',
					'Updated News',
					'Deleted News',
					'Issued Solo Endorsement',
					'Extended Solo Endorsement',
					'Deleted Solo Endorsement',
					'Generated IDS Token',
					'Connected Discord',
					'Disconnect Discord',
					'Requested GDRP Data',
					'Erase User Data',
				]);
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.get('/:cid', userOrInternal, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (
			!req.params['cid'] ||
			req.params['cid'] === 'undefined' ||
			isNaN(Number(req.params['cid']))
		) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid CID.',
			};
		}

		let user: IUser[] = [];
		if (req.internal === true) {
			user = await getUsersWithPrivacy(
				{ isStaff: true, isTrainingStaff: true, rating: 12 } as IUser,
				{
					cid: Number(req.params['cid']),
				},
			);
		} else {
			user = await getUsersWithPrivacy(req.user, {
				cid: Number(req.params['cid']),
			});
		}

		if (!user || user.length === 0) {
			throw {
				code: status.NOT_FOUND,
				message: 'Unable to find controller',
			};
		}

		return res.status(status.OK).json(user[0]);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.patch(
	'/:cid/rating',
	internalAuth,
	async (req: Request, res: Response, next: NextFunction) => {
		if (!req.body.rating) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid Rating',
			};
		}

		if (
			!req.params['cid'] ||
			req.params['cid'] === 'undefined' ||
			isNaN(Number(req.params['cid']))
		) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid CID.',
			};
		}

		try {
			const user = await UserModel.findOne({ cid: req.params['cid'] })
				.cache('10 minutes', `user-${req.params['cid']}`)
				.exec();

			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'Unable to find user',
				};
			}

			if (user.rating !== req.body.rating) {
				user.rating = req.body.rating;

				const certDates = grantCerts(user.rating, user.certificationDate);

				user.certCodes = certDates.map((c) => c.code);
				user.certificationDate = certDates;

				await user.save();
				clearUserCache(user.cid);

				await DossierModel.create({
					by: -1,
					affected: req.params['cid'],
					action: `%a was set as Rating ${req.body.rating} by an external service.`,
					actionType: ACTION_TYPE.SET_RATING,
				});
			}

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

// @TODO: fix this to remove the ts-ignore and structure the data properly
router.get('/stats/:cid', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (
			!req.params['cid'] ||
			req.params['cid'] === 'undefined' ||
			isNaN(Number(req.params['cid']))
		) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid CID.',
			};
		}

		const controllerHours = await ControllerHoursModel.find({ cid: req.params['cid'] })
			.cache('5 minutes')
			.exec();

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
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.post('/:cid', internalAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (
			!req.params['cid'] ||
			req.params['cid'] === 'undefined' ||
			isNaN(Number(req.params['cid']))
		) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid CID.',
			};
		}

		const user = await UserModel.findOne({ cid: req.params['cid'] })
			.cache('10 minutes', `user-${req.params['cid']}`)
			.exec();
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

		const rating = Number(req.body.rating);

		const certDates = grantCerts(rating, []);

		const userOi = await checkOI({ fname: req.body.fname, lname: req.body.lname, oi: '' } as IUser);
		if (!userOi) {
			throw {
				code: status.INTERNAL_SERVER_ERROR,
				message: 'Unable to generate Operating Initials',
			};
		}

		await UserModel.create({
			...req.body,
			oi: userOi,
			avatar: `${req.body.cid}-default.png`,
			certCodes: certDates.map((c) => c.code),
			certificationDate: certDates,
		});
		await getCacheInstance().clear('users');

		sendMail({
			to: 'atm@zauartcc.org, datm@zauartcc.org, ta@zauartcc.org',
			subject: `New ${req.body.vis ? 'Visitor' : 'Member'}: ${req.body.fname} ${req.body.lname} | Chicago ARTCC`,
			template: 'newController',
			context: {
				name: `${req.body.fname} ${req.body.lname}`,
				email: req.body.email,
				cid: req.body.cid,
				rating: zau.ratingsShort[req.body.rating],
				vis: req.body.vis,
				type: req.body.vis ? 'visitor' : 'member',
				home: req.body.vis ? req.body.homeFacility : 'ZAU',
			},
		});

		await DossierModel.create({
			by: -1,
			affected: req.body.cid,
			action: `%a was created by an external service.`,
			actionType: ACTION_TYPE.CREATE_USER,
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.patch(
	'/:cid/member',
	internalAuth,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.params['cid'] ||
				req.params['cid'] === 'undefined' ||
				isNaN(Number(req.params['cid']))
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid CID.',
				};
			}

			const user = await UserModel.findOne({ cid: req.params['cid'] })
				.cache('10 minutes', `user-${req.params['cid']}`)
				.exec();

			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'Unable to find user',
				};
			}

			if (req.body.member === true) {
				const userOi = await checkOI(user);

				if (!userOi) {
					throw {
						code: status.INTERNAL_SERVER_ERROR,
						message: 'Unable to generate Operating Initials',
					};
				}

				user.oi = userOi;

				user.joinDate = req.body.joinDate || new Date();
				user.removalDate = null;

				const certDates = grantCerts(user.rating, user.certificationDate);

				user.certCodes = certDates.map((c) => c.code);
				user.certificationDate = certDates;
			} else {
				user.history.push({
					start: user.joinDate!,
					end: new Date(),
					reason: `Removed from roster by an external service.`,
				});
				user.joinDate = null;
				user.removalDate = new Date();
				user.oi = '';
			}
			user.member = req.body.member;

			await user.save();
			clearUserCache(user.cid);

			if (req.body.member || req.body.vis) {
				sendMail({
					to: 'atm@zauartcc.org, datm@zauartcc.org, ta@zauartcc.org',
					subject: `New ${user.vis ? 'Visitor' : 'Member'}: ${user.name} | Chicago ARTCC`,
					template: 'newController',
					context: {
						name: `${user.name}`,
						email: user.email,
						cid: user.cid,
						rating: zau.ratingsShort[user.rating],
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
				actionType: ACTION_TYPE.SET_MEMBERSHIP,
			});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.patch(
	'/:cid/visit',
	internalAuth,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.params['cid'] ||
				req.params['cid'] === 'undefined' ||
				isNaN(Number(req.params['cid']))
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid CID.',
				};
			}

			const user = await UserModel.findOne({ cid: req.params['cid'] })
				.cache('10 minutes', `user-${req.params['cid']}`)
				.exec();

			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'Unable to find user',
				};
			}

			user.vis = req.body.vis;

			if (req.body.vis === true) {
				const certDates = grantCerts(user.rating, user.certificationDate);

				user.certCodes = certDates.map((c) => c.code);
				user.certificationDate = certDates;

				const userOi = await checkOI(user);
				if (!userOi) {
					throw {
						code: status.INTERNAL_SERVER_ERROR,
						message: 'Unable to generate Operating Initials',
					};
				}

				user.oi = userOi;
			}

			await user.save();
			clearUserCache(user.cid);

			await DossierModel.create({
				by: -1,
				affected: req.params['cid'],
				action: `%a was set as a ${req.body.vis ? 'visiting controller' : 'home controller'} by an external service.`,
				actionType: ACTION_TYPE.SET_VISIT_STATUS,
			});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.put(
	'/:cid',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'ec', 'wm', 'ins', 'mtr']),
	isNotSelf(),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.body.form) {
				throw {
					code: status.BAD_REQUEST,
					message: 'No user data included',
				};
			}

			if (
				!req.params['cid'] ||
				req.params['cid'] === 'undefined' ||
				isNaN(Number(req.params['cid']))
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid CID.',
				};
			}

			// Find the existing user
			const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();

			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'User not found',
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

			await uploadAvatar(user, oi);

			user.fname = fname;
			user.lname = lname;
			user.email = email;
			user.oi = oi;
			user.vis = vis;
			user.roleCodes = toApply.roles;
			user.certCodes = updatedCertificationDate.map((c) => c.code);
			user.certificationDate = updatedCertificationDate;

			await user.save();
			clearUserCache(user.cid);

			await DossierModel.create({
				by: req.user.cid,
				affected: req.params['cid'],
				action: `%a was updated by %b.`,
				actionType: ACTION_TYPE.UPDATE_USER,
			});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.patch(
	'/:cid/remove-cert',
	internalAuth,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (
				!req.params['cid'] ||
				req.params['cid'] === 'undefined' ||
				isNaN(Number(req.params['cid']))
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid CID.',
				};
			}

			const user = await UserModel.findOne({ cid: req.params['cid'] })
				.cache('10 minutes', `user-${req.params['cid']}`)
				.exec();

			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'User not found',
				};
			}

			user.certCodes = [];
			user.certificationDate = [];

			await user.save();
			clearUserCache(user.cid);

			return res.status(status.OK).json({ message: 'Certs removed successfully' });
		} catch (e) {
			console.error('Error removing certs', e);

			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.delete(
	'/:cid',
	getUser,
	isManagement,
	isNotSelf(false),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.body.reason) {
				throw {
					code: status.BAD_REQUEST,
					message: 'You must specify a reason',
				};
			}

			if (
				!req.params['cid'] ||
				req.params['cid'] === 'undefined' ||
				isNaN(Number(req.params['cid']))
			) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid CID.',
				};
			}

			const user = await UserModel.findOne({ cid: req.params['cid'] })
				.cache('10 minutes', `user-${req.params['cid']}`)
				.exec();

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
			user.oi = '';

			await user.save();
			clearUserCache(user.cid);

			await DossierModel.create({
				by: req.user.cid,
				affected: req.params['cid'],
				action: `%a was removed from the roster by %b, reason: ${req.body.reason}`,
				actionType: ACTION_TYPE.DELETE_USER,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

export default router;
