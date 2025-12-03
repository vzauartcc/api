import axios from 'axios';
import { randomUUID } from 'crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { getCacheInstance, logException } from '../../app.js';
import { uploadToS3 } from '../../helpers/s3.js';
import zau from '../../helpers/zau.js';
import { userOrInternal } from '../../middleware/auth.js';
import internalAuth from '../../middleware/internalAuth.js';
import getUser, { deleteAuthCookie, type UserPayload } from '../../middleware/user.js';
import oAuth from '../../middleware/vatsim.js';
import { ControllerHoursModel } from '../../models/controllerHours.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { NotificationModel } from '../../models/notification.js';
import { TrainingSessionModel } from '../../models/trainingSession.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';
import { clearUserCache } from '../controller/utils.js';
import gdrpRouter from './gdrp.js';

const router = Router();

router.use('/gdrp', gdrpRouter);

router.get('/', userOrInternal, async (req: Request, res: Response, next: NextFunction) => {
	try {
		let allUsers = [];
		if (req.internal === true) {
			allUsers = await UserModel.find({})
				.populate([
					{
						path: 'certifications',
						options: {
							sort: { order: 'desc' },
						},
					},
				])
				.lean({ virtuals: true })
				.cache('10 minutes', 'users-users-internal')
				.exec();
		} else {
			let select = '-discordInfo -idsToken';
			if (!req.user.isStaff) {
				select += ' -broadcast -prefName -email -discord';
			}
			allUsers = await UserModel.find({})
				.select(select)
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
				.cache('10 minutes', 'users-users-user')
				.exec();
		}

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
		logException(e);

		return next(e);
	}
});

// Logged in check
router.get('/self', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.cookies['token']) {
			throw {
				code: status.UNAUTHORIZED,
				message: 'Token cookie not found',
			};
		}

		const decoded = jwt.verify(req.cookies['token'], process.env['JWT_SECRET']!) as UserPayload;

		const user = await UserModel.findOne({ cid: decoded.cid })
			.select('-createdAt -updatedAt')
			.populate('roles absence certifications')
			.lean({ virtuals: true })
			.cache('10 minutes', `users-user-${decoded.cid}`)
			.exec();

		if (!user) {
			deleteAuthCookie(res);
			throw {
				code: status.NOT_FOUND,
				message: 'User not found.',
			};
		}

		return res.status(status.OK).json(user);
	} catch (e) {
		deleteAuthCookie(res);

		if ((e as any).name !== 'JsonWebTokenError') {
			logException(e);
		}

		return next(e);
	}
});

router.post('/idsToken', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.cookies['token']) {
			throw {
				code: status.UNAUTHORIZED,
				message: 'Not logged in',
			};
		}

		const idsToken = randomUUID();
		req.user.idsToken = idsToken;

		await UserModel.findOneAndUpdate({ cid: req.user.cid }, { idsToken }).exec();

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b generated a new IDS Token.`,
			actionType: ACTION_TYPE.GENERATE_IDS_TOKEN,
		});

		return res.status(status.CREATED).json(idsToken);
	} catch (e) {
		logException(e);

		return next(e);
	}
});

//#region Login/Logout
// Endpoint to preform user login, uses oAuth middleware to retrieve an access token
router.post('/login', oAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.oauth) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Bad request',
			};
		}

		const { access_token } = req.oauth;

		// Use access token to attempt to get user data.
		let { data: vatsimUserData } = await axios.get(
			`${process.env['VATSIM_AUTH_ENDPOINT']}/api/user`,
			{
				headers: { Authorization: `Bearer ${access_token}` },
			},
		);

		//let vatsimUserData = await vatsimApiHelper.getUserInformation(access_token);

		// VATSIM API returns 200 codes on some errors, use CID as a check to see if there was an error.
		if (vatsimUserData?.data?.cid === null) {
			let error = vatsimUserData;
			throw error;
		} else {
			vatsimUserData = vatsimUserData.data;
		}
		const userData = {
			email: vatsimUserData.personal.email,
			firstName: vatsimUserData.personal.name_first,
			lastName: vatsimUserData.personal.name_last,
			cid: vatsimUserData.cid,
			ratingId: vatsimUserData.vatsim.rating.id,
		};

		// If the user did not authorize all requested data from the AUTH login, we may have null parameters
		// If that is the case throw a BadRequest exception.
		if (Object.values(userData).some((x) => x === null || x === '')) {
			throw {
				code: status.BAD_REQUEST,
				message: 'User must authorize all requested VATSIM data. [Authorize Data]',
			};
		}

		let user = await UserModel.findOne({ cid: userData.cid })
			.cache('10 minutes', `user-${userData.cid}`)
			.exec();

		if (!user) {
			user = await UserModel.create({
				cid: userData.cid,
				fname: userData.firstName,
				lname: userData.lastName,
				email: userData.email,
				rating: userData.ratingId,
				oi: null,
				broadcast: false,
				member: false,
				vis: false,
			});
		} else {
			if (!user.email || user.email !== userData.email) {
				user.email = userData.email;
			}
			if (!user.fname || user.lname !== userData.firstName) {
				user.fname = userData.firstName;
			}
			if (!user.lname || user.lname !== userData.lastName) {
				user.lname = userData.lastName;
			}
			user.rating = userData.ratingId;
		}

		if (user.oi && !user.avatar) {
			const { data } = await axios.get(
				`https://ui-avatars.com/api/?name=${user.oi}&size=256&background=122049&color=ffffff`,
				{ responseType: 'arraybuffer' },
			);

			await uploadToS3(`avatars/${user.cid}-default.png`, data, 'image/png', {
				ContentDisposition: 'inline',
			});

			user.avatar = `${user.cid}-default.png`;
		}

		await user.save();
		clearUserCache(user.cid);

		const apiToken = jwt.sign({ cid: userData.cid }, process.env['JWT_SECRET']!, {
			expiresIn: '30d',
		});

		res.cookie('token', apiToken, {
			httpOnly: true,
			maxAge: 2592000000,
			sameSite: true,
			domain: process.env['DOMAIN'],
		}); // Expires in 30 days

		return res.status(status.OK).json();
	} catch (e) {
		logException(e);

		return next(e);
	}
});

router.get('/logout', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.cookies['token']) {
			throw {
				code: status.UNAUTHORIZED,
				message: 'User not logged in',
			};
		}

		deleteAuthCookie(res);

		return res.status(status.OK).json();
	} catch (e) {
		logException(e);

		return next(e);
	}
});
//#endregion

router.get('/sessions', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const sessions = await ControllerHoursModel.find({
			cid: req.user.cid,
			timeStart: { $gt: zau.activity.period.startOfCurrent },
		})
			.sort({ timeStart: -1 })
			.lean()
			.cache('10 minutes')
			.exec();

		const trainings = await TrainingSessionModel.find({
			studentCid: req.user.cid,
			startTime: { $gt: zau.activity.period.startOfCurrent },
		})
			.sort({ startTime: -1 })
			.lean()
			.cache('10 minutes')
			.exec();

		return res.status(status.OK).json({
			sessions,
			trainings,
			period: zau.activity.period,
			requirements: zau.activity.requirements,
		});
	} catch (e) {
		logException(e);

		return next(e);
	}
});

//#region Notifications
router.get('/notifications', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 10;

		const unread = await NotificationModel.countDocuments({
			deleted: false,
			recipient: req.user.cid,
			read: false,
		})
			.cache('10 minutes', `notifications-unread-${req.user.cid}`)
			.exec();

		const amount = await NotificationModel.countDocuments({
			deleted: false,
			recipient: req.user.cid,
		})
			.cache('10 minutes', `notifications-count-${req.user.cid}`)
			.exec();

		const notif = await NotificationModel.find({
			recipient: req.user.cid,
			deleted: false,
		})
			.skip(limit * (page - 1))
			.limit(limit)
			.sort({ createdAt: 'desc' })
			.lean()
			.cache()
			.exec();

		return res.status(status.OK).json({
			unread,
			amount,
			notif,
		});
	} catch (e) {
		logException(e);

		return next(e);
	}
});

router.put(
	'/notifications/read/all',
	getUser,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			await NotificationModel.updateMany(
				{ recipient: req.user.cid },
				{
					read: true,
				},
			).exec();

			await getCacheInstance().clear(`notifications-unread-${req.user.cid}`);

			return res.status(status.OK).json();
		} catch (e) {
			logException(e);

			return next(e);
		}
	},
);

router.put(
	'/notifications/read/:id',
	getUser,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['id'] || req.params['id'] === 'undefined') {
				throw {
					code: status.BAD_REQUEST,
					message: 'Invalid ID.',
				};
			}
			await NotificationModel.findByIdAndUpdate(req.params['id'], {
				read: true,
			}).exec();

			await getCacheInstance().clear(`notifications-unread-${req.user.cid}`);

			return res.status(status.OK).json();
		} catch (e) {
			logException(e);

			return next(e);
		}
	},
);

router.delete(
	'/notifications',
	getUser,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			await NotificationModel.deleteMany({ recipient: req.user.cid }).exec();

			await getCacheInstance().clear(`notifications-count-${req.user.cid}`);
			await getCacheInstance().clear(`notifications-unread-${req.user.cid}`);

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			logException(e);

			return next(e);
		}
	},
);
//#endregion

router.patch('/profile', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { bio } = req.body;

		if (bio.length > 500) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Bio too long',
			};
		}

		await UserModel.findOneAndUpdate(
			{ cid: req.user.cid },
			{
				bio,
			},
		).exec();

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b updated their profile.`,
			actionType: ACTION_TYPE.UPDATE_SELF,
		});

		return res.status(status.OK).json();
	} catch (e) {
		logException(e);

		return next(e);
	}
});

router.patch('/:cid', internalAuth, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.body || !req.params['cid'] || req.params['cid'] === 'undefined') {
			throw {
				code: status.BAD_REQUEST,
				message: 'Invalid CID.',
			};
		}

		await UserModel.findOneAndUpdate(
			{ cid: req.params['cid'] },
			{
				...req.body,
			},
		);

		return res.status(status.OK).json();
	} catch (e) {
		logException(e);

		return next(e);
	}
});

export default router;
