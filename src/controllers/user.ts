import axios from 'axios';
import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { convertToReturnDetails, uploadToS3 } from '../app.js';
import getUser, { deleteAuthCookie, type UserPayload } from '../middleware/user.js';
import oAuth from '../middleware/vatsim.js';
import { ControllerHoursModel } from '../models/controllerHours.js';
import { NotificationModel } from '../models/notification.js';
import { UserModel } from '../models/user.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
	try {
		if (!req.cookies.token) {
			throw {
				code: 401,
				message: 'Token cookie not found',
			};
		}

		const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET!) as UserPayload;

		const user = await UserModel.findOne({ cid: decoded.cid })
			.select('-createdAt -updatedAt')
			.populate('roles absence')
			.lean({ virtuals: true });

		if (!user) {
			deleteAuthCookie(res);
			throw {
				code: 401,
				message: 'User not found.',
			};
		}

		res.stdRes.data = user;
	} catch (e) {
		deleteAuthCookie(res);
		res.stdRes.ret_det = convertToReturnDetails(e);
		// req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.post('/idsToken', getUser, async (req: Request, res: Response) => {
	try {
		if (!req.cookies.token) {
			throw {
				code: 401,
				message: 'Not logged in',
			};
		}

		const idsToken = randomUUID();
		req.user!.idsToken = idsToken;

		await UserModel.findOneAndUpdate({ cid: req.user!.cid }, { idsToken });

		await req.app.dossier.create({
			by: req.user!.cid,
			affected: -1,
			action: `%b generated a new IDS Token.`,
		});

		res.stdRes.data = idsToken;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

// Endpoint to preform user login, uses oAuth middleware to retrieve an access token
router.post('/login', oAuth, async (req: Request, res: Response) => {
	try {
		if (!req.oauth) {
			throw {
				code: 400,
				message: 'Bad request.',
			};
		}

		const { access_token } = req.oauth;

		// Use access token to attempt to get user data.
		let { data: vatsimUserData } = await axios.get(`${process.env.VATSIM_AUTH_ENDPOINT}/api/user`, {
			headers: { Authorization: `Bearer ${access_token}` },
		});

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
				code: 400,
				message: 'User must authorize all requested VATSIM data. [Authorize Data]',
			};
		}

		let user = await UserModel.findOne({ cid: userData.cid });

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
			if (!user.email) {
				user.email = userData.email;
			}
			if (!(user.prefName ?? true)) {
				user.fname = userData.firstName;
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

		const apiToken = jwt.sign({ cid: userData.cid }, process.env.JWT_SECRET!, {
			expiresIn: '30d',
		});

		res.cookie('token', apiToken, {
			httpOnly: true,
			maxAge: 2592000000,
			sameSite: true,
			domain: process.env.DOMAIN,
		}); // Expires in 30 days
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
		res.status(500);
	}

	return res.json(res.stdRes);
});

router.get('/logout', async (req: Request, res: Response) => {
	try {
		if (!req.cookies.token) {
			throw {
				code: 400,
				message: 'User not logged in',
			};
		}

		deleteAuthCookie(res);
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.get('/sessions', getUser, async (req: Request, res: Response) => {
	try {
		const sessions = await ControllerHoursModel.find({ cid: req.user!.cid })
			.sort({ timeStart: -1 })
			.limit(20)
			.lean();
		res.stdRes.data = sessions;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.get('/notifications', getUser, async (req: Request, res: Response) => {
	try {
		const page = +(req.query.page as string) || 1;
		const limit = +(req.query.limit as string) || 10;

		const unread = await NotificationModel.countDocuments({
			deleted: false,
			recipient: req.user!.cid,
			read: false,
		});
		const amount = await NotificationModel.countDocuments({
			deleted: false,
			recipient: req.user!.cid,
		});
		const notif = await NotificationModel.find({
			recipient: req.user!.cid,
			deleted: false,
		})
			.skip(limit * (page - 1))
			.limit(limit)
			.sort({ createdAt: 'desc' })
			.lean();

		res.stdRes.data = {
			unread,
			amount,
			notif,
		};
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.put('/notifications/read/all', getUser, async (req: Request, res: Response) => {
	try {
		await NotificationModel.updateMany(
			{ recipient: req.user!.cid },
			{
				read: true,
			},
		);
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.put('/notifications/read/:id', async (req: Request, res: Response) => {
	try {
		if (!req.params.id) {
			throw {
				code: 400,
				message: 'Incomplete request',
			};
		}
		await NotificationModel.findByIdAndUpdate(req.params.id, {
			read: true,
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.delete('/notifications', getUser, async (req: Request, res: Response) => {
	try {
		await NotificationModel.deleteMany({ recipient: req.user!.cid });
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

router.put('/profile', getUser, async (req: Request, res: Response) => {
	try {
		const { bio } = req.body;

		await UserModel.findOneAndUpdate(
			{ cid: req.user!.cid },
			{
				bio,
			},
		);

		await req.app.dossier.create({
			by: req.user!.cid,
			affected: -1,
			action: `%b updated their profile.`,
		});
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		req.app.Sentry.captureException(e);
	}

	return res.json(res.stdRes);
});

export default router;
