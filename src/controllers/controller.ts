import axios from 'axios';
import { Router, type Request, type Response } from 'express';
import { DateTime } from 'luxon';
import { convertToReturnDetails, uploadToS3, vatusaApi } from '../app.js';
import { sendMail } from '../mailer.js';
import { hasRole, isManagement, isStaff } from '../middleware/auth.js';
import internalAuth from '../middleware/internalAuth.js';
import getUser from '../middleware/user.js';
import { AbsenceModel } from '../models/absence.js';
import { ControllerHoursModel } from '../models/controllerHours.js';
import { NotificationModel } from '../models/notification.js';
import { RoleModel } from '../models/role.js';
import { UserModel, type IUser } from '../models/user.js';
import { VisitApplicationModel } from '../models/visitApplication.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
	try {
		const allUsers: IUser[] = await UserModel.find({})
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
				code: 503,
				message: 'Unable to retrieve controllers',
			};
		}

		res.stdRes.data = { home, visiting, removed };
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
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

router.get('/staff', async (req: Request, res: Response) => {
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

		res.stdRes.data = staff;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get('/role', async (req: Request, res: Response) => {
	try {
		const roles = await RoleModel.find().lean().exec();
		res.stdRes.data = roles;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.get('/oi', async (req: Request, res: Response) => {
	try {
		const oi = await UserModel.find({ deletedAt: null, member: true }).select('oi').lean().exec();

		if (!oi) {
			throw {
				code: 503,
				message: 'Unable to retrieve operating initials',
			};
		}

		res.stdRes.data = oi.map((oi) => oi.oi);
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.get('/visit', getUser, isManagement, async (req: Request, res: Response) => {
	try {
		const applications = await VisitApplicationModel.find({
			deletedAt: null,
			acceptedAt: null,
		})
			.lean()
			.exec();
		res.stdRes.data = applications;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.get('/absence', getUser, isManagement, async (req: Request, res: Response) => {
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

		res.stdRes.data = absences;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.post('/absence', getUser, isManagement, async (req: Request, res: Response) => {
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
			content: `You have been granted Leave of Absence until <b>${new Date(
				req.body.expirationDate,
			).toLocaleString('en-US', {
				month: 'long',
				day: 'numeric',
				year: 'numeric',
				timeZone: 'UTC',
			})}</b>.`,
		});

		await req.app.dossier.create({
			by: req.user!.cid,
			affected: req.body.controller,
			action: `%b added a leave of absence for %a: ${req.body.reason}`,
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.delete('/absence/:id', getUser, isManagement, async (req: Request, res: Response) => {
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

		await req.app.dossier.create({
			by: req.user!.cid,
			affected: absence.controller,
			action: `%b deleted the leave of absence for %a.`,
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.get('/log', getUser, isStaff, async (req: Request, res: Response) => {
	const page = +(req.query['page'] as string) || 1;
	const limit = +(req.query['limit'] as string) || 20;
	const amount = await req.app.dossier.countDocuments();

	try {
		const dossier = await req.app.dossier
			.find()
			.sort({
				createdAt: 'desc',
			})
			.skip(limit * (page - 1))
			.limit(limit)
			.populate('userBy', 'fname lname cid')
			.populate('userAffected', 'fname lname cid')
			.lean();

		res.stdRes.data = {
			dossier,
			amount,
		};
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	} finally {
		res.json(res.stdRes);
	}
});

router.get('/:cid', getUser, async (req: Request, res: Response) => {
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
				code: 404,
				message: 'Unable to find controller',
			};
		}

		if (req.user?.isSeniorStaff) {
			res.stdRes.data = user;
		} else {
			const { email, ...userNoEmail } = user;
			res.stdRes.data = userNoEmail;
		}
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.put('/:cid/rating', internalAuth, async (req: Request, res: Response) => {
	if (!req.body.rating) {
		throw {
			code: 400,
			message: 'Rating is required',
		};
	}

	try {
		const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();

		if (!user) {
			throw {
				code: 400,
				message: 'Unable to find user',
			};
		}

		if (user.rating !== req.body.rating) {
			user.rating = req.body.rating;

			await user.save();

			await req.app.dossier.create({
				by: -1,
				affected: req.params['cid'],
				action: `%a was set as Rating ${req.body.rating} by an external service.`,
			});
		}
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

// @TODO: fix this to remove the ts-ignore and structure the data properly
router.get('/stats/:cid', async (req: Request, res: Response) => {
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
		res.stdRes.data = hours;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.get('/visit/status', getUser, async (req: Request, res: Response) => {
	try {
		const count = await VisitApplicationModel.countDocuments({
			cid: req.user?.cid,
			deleted: false,
		}).exec();
		res.stdRes.data = count;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.put('/visit/:cid', getUser, hasRole(['atm', 'datm']), async (req, res) => {
	try {
		const application = await VisitApplicationModel.findOne({ cid: req.params['cid'] }).exec();
		if (!application) {
			throw {
				code: 404,
				message: 'Visiting Application Not Found.',
			};
		}

		await application.delete();

		const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();
		if (!user) {
			throw {
				code: 404,
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
			req.app.Sentry.captureMessage(`Unable to generate OIs for ${req.params['cid']}`);
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

		await vatusaApi.post(`/facility/ZAU/roster/manageVisitor/${req.params['cid']}`);

		sendMail({
			to: user.email,
			subject: `Visiting Application Accepted | Chicago ARTCC`,
			template: 'visitAccepted',
			context: {
				name: `${user.fname} ${user.lname}`,
			},
		});

		await req.app.dossier.create({
			by: req.user!.cid,
			affected: user.cid,
			action: `%b approved the visiting application for %a.`,
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.delete(
	'/visit/:cid',
	getUser,
	hasRole(['atm', 'datm']),
	async (req: Request, res: Response) => {
		try {
			const application = await VisitApplicationModel.findOne({ cid: req.params['cid'] }).exec();
			if (!application) {
				throw {
					code: 404,
					message: 'Visiting Application Not Found.',
				};
			}

			await application.delete();

			const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();
			if (!user) {
				throw {
					code: 404,
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

			await req.app.dossier.create({
				by: req.user!.cid,
				affected: user.cid,
				action: `%b rejected the visiting application for %a: ${req.body.reason}`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		}

		return res.json(res.stdRes);
	},
);

router.post('/:cid', internalAuth, async (req: Request, res: Response) => {
	try {
		const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();
		if (user) {
			throw {
				code: 409,
				message: 'This user already exists',
			};
		}

		if (!req.body) {
			throw {
				code: 400,
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

		await req.app.dossier.create({
			by: -1,
			affected: req.body.cid,
			action: `%a was created by an external service.`,
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.put('/:cid/member', internalAuth, async (req: Request, res: Response) => {
	try {
		const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();

		if (!user) {
			throw {
				code: 400,
				message: 'Unable to find user',
			};
		}

		const oi = await UserModel.find({ deletedAt: null, member: true }).select('oi').lean().exec();

		user.member = req.body.member;
		user.oi = req.body.member
			? generateOperatingInitials(
					user.fname,
					user.lname,
					oi.map((oi) => oi.oi || '').filter((oi) => oi !== ''),
				)
			: null;
		user.joinDate = req.body.member ? new Date() : null;
		user.removalDate = null;

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

		await req.app.dossier.create({
			by: -1,
			affected: req.params['cid'],
			action: `%a was ${req.body.member ? 'added to' : 'removed from'} the roster by an external service.`,
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.put('/:cid/visit', internalAuth, async (req: Request, res: Response) => {
	try {
		const user = await UserModel.findOne({ cid: req.params['cid'] }).exec();

		if (!user) {
			throw {
				code: 400,
				message: 'Unable to find user',
			};
		}

		user.vis = req.body.vis;
		user.joinDate = new Date();

		await user.save();

		await req.app.dossier.create({
			by: -1,
			affected: req.params['cid'],
			action: `%a was set as a ${req.body.vis ? 'visiting controller' : 'home controller'} by an external service.`,
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.put(
	'/:cid',
	getUser,
	hasRole(['atm', 'datm', 'ta', 'fe', 'ec', 'wm', 'ins', 'mtr']),
	async (req: Request, res: Response) => {
		try {
			if (!req.body.form) {
				throw {
					code: 400,
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
					code: 404,
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
			await req.app.dossier.create({
				by: req.user!.cid,
				affected: req.params['cid'],
				action: `%a was updated by %b.`,
			});
		} catch (e) {
			res.stdRes.ret_det = convertToReturnDetails(e);
			req.app.Sentry.captureException(e);
		}

		return res.json(res.stdRes);
	},
);

router.put('/remove-cert/:cid', internalAuth, async (req: Request, res: Response) => {
	try {
		// Find the user by CID
		const cid = req.params['cid'];
		const user = await UserModel.findOne({ cid }).exec();

		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		// Remove the user's certCodes and certificationDate
		user.certCodes = []; // Clear certCodes
		user.certificationDate = []; // Clear certificationDate (remove all certifications and gained dates)

		await user.save();

		return res.status(200).json({ message: 'Certs removed successfully' });
	} catch (error) {
		console.error('Error removing certs', error);
		return res.status(500).json({ message: 'Internal server error' });
	}
});

router.delete('/:cid', getUser, hasRole(['atm', 'datm']), async (req: Request, res: Response) => {
	try {
		if (!req.body.reason) {
			throw {
				code: 400,
				message: 'You must specify a reason',
			};
		}

		const user = await UserModel.findOneAndUpdate(
			{ cid: req.params['cid'] },
			{
				member: false,
				removalDate: new Date().toISOString(),
			},
		).exec();

		if (!user) {
			throw {
				code: 400,
				message: 'User not found.',
			};
		}

		if (user.vis) {
			await vatusaApi.delete(`/facility/ZAU/roster/manageVisitor/${req.params['cid']}`, {
				data: {
					reason: req.body.reason,
					by: req.user!.cid,
				},
			});
		} else {
			await vatusaApi.delete(`/facility/ZAU/roster/${req.params['cid']}`, {
				data: {
					reason: req.body.reason,
					by: req.user!.cid,
				},
			});
		}

		await req.app.dossier.create({
			by: req.user!.cid,
			affected: req.params['cid'],
			action: `%a was removed from the roster by %b: ${req.body.reason}`,
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

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
