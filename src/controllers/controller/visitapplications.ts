import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance, logException } from '../../app.js';
import { sendMail } from '../../helpers/mailer.js';
import { vatusaApi, type IVisitingStatus } from '../../helpers/vatusa.js';
import { isManagement } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { UserModel } from '../../models/user.js';
import { VisitApplicationModel } from '../../models/visitApplication.js';
import status from '../../types/status.js';
import { checkOI, clearUserCache, grantCerts } from './utils.js';

const router = Router();

router.get('/', getUser, isManagement, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const applications = await VisitApplicationModel.find({
			deleted: false,
		})
			.lean()
			.cache('10 minutes', 'visit-applications')
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
		logException(req, e);

		return next(e);
	}
});

router.post('/', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
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
		await getCacheInstance().clear('visit-applications');

		sendMail({
			to: req.body.email,
			subject: `Visiting Application Received | Chicago ARTCC`,
			template: 'visitReceived',
			context: {
				name: req.user.name,
			},
		});
		sendMail({
			to: 'atm@zauartcc.org, datm@zauartcc.org',
			from: {
				name: 'Chicago ARTCC',
				address: 'no-reply@zauartcc.org',
			},
			subject: `New Visiting Application: ${req.user.name} | Chicago ARTCC`,
			template: 'staffNewVisit',
			context: {
				user: userData,
			},
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		logException(req, e);

		return next(e);
	}
});

router.get('/status', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const count = await VisitApplicationModel.countDocuments({
			cid: req.user.cid,
			deleted: false,
		})
			.cache('5 minutes')
			.exec();

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
		logException(req, e);

		return next(e);
	}
});

router.put(
	'/:cid',
	getUser,
	isManagement,
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

			const application = await VisitApplicationModel.findOne({ cid: req.params['cid'] })
				.cache()
				.exec();
			if (!application) {
				throw {
					code: status.NOT_FOUND,
					message: 'Visiting Application Not Found.',
				};
			}

			await vatusaApi.post(`/facility/ZAU/roster/manageVisitor/${req.params['cid']}`);

			await application.delete();
			await getCacheInstance().clear('visit-applications');

			const user = await UserModel.findOne({ cid: req.params['cid'] })
				.cache('10 minutes', `user-${req.params['cid']}`)
				.exec();
			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'User not found',
				};
			}

			const userOi = await checkOI(user);
			if (!userOi) {
				throw {
					code: status.INTERNAL_SERVER_ERROR,
					message: 'Unable to generate Operating Initials',
				};
			}

			user.member = true;
			user.vis = true;
			user.oi = userOi;

			const certDates = grantCerts(user.rating, user.certificationDate);

			user.certCodes = certDates.map((c) => c.code);
			user.certificationDate = certDates;

			await user.save();
			clearUserCache(user.cid);

			sendMail({
				to: user.email,
				subject: `Visiting Application Accepted | Chicago ARTCC`,
				template: 'visitAccepted',
				context: {
					name: `${user.name}`,
				},
			});

			DossierModel.create({
				by: req.user.cid,
				affected: user.cid,
				action: `%b approved the visiting application for %a.`,
				actionType: ACTION_TYPE.APPROVE_VISIT,
			});

			return res.status(status.OK).json();
		} catch (e) {
			logException(req, e);

			return next(e);
		}
	},
);

router.delete(
	'/:cid',
	getUser,
	isManagement,
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

			const application = await VisitApplicationModel.findOne({ cid: req.params['cid'] })
				.cache()
				.exec();
			if (!application) {
				throw {
					code: status.NOT_FOUND,
					message: 'Visiting Application Not Found.',
				};
			}

			await application.delete();
			await getCacheInstance().clear('visit-applications');

			const user = await UserModel.findOne({ cid: req.params['cid'] })
				.cache('10 minutes', `user-${req.params['cid']}`)
				.exec();
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
					name: `${user.name}`,
					reason: req.body.reason,
				},
			});

			await DossierModel.create({
				by: req.user.cid,
				affected: user.cid,
				action: `%b rejected the visiting application for %a: ${req.body.reason}`,
				type: ACTION_TYPE.REJECT_VISIT,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			logException(req, e);

			return next(e);
		}
	},
);

export default router;
