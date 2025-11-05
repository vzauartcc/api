import { captureException } from '@sentry/node';
import Discord from 'discord-oauth2';
import { Router, type NextFunction, type Request, type Response } from 'express';
import discord from '../helpers/discord.js';
import internalAuth from '../middleware/internalAuth.js';
import getUser from '../middleware/user.js';
import { DossierModel } from '../models/dossier.js';
import { UserModel } from '../models/user.js';
import status from '../types/status.js';

const router = Router();

router.get('/users', internalAuth, async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const users = await UserModel.find({ discordInfo: { $ne: null } })
			.select('fname lname cid discordInfo roleCodes oi rating member vis')
			.exec();

		return res.status(status.OK).json(users);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.get('/user', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		return res.status(status.OK).json(!!req.user.discordInfo?.clientId);
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.post('/info', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (
			!process.env['DISCORD_CLIENT_ID'] ||
			!process.env['DISCORD_CLIENT_SECRET'] ||
			!process.env['DISCORD_REDIRECT_URI']
		) {
			throw {
				code: status.INTERNAL_SERVER_ERROR,
				message: 'Internal Server Error',
			};
		}

		if (!req.body.code || !req.body.cid) {
			throw {
				code: status.BAD_REQUEST,
				message: 'Incomplete request',
			};
		}

		const { cid, code } = req.body;
		const user = await UserModel.findOne({ cid }).exec();

		if (!user) {
			throw {
				code: status.UNAUTHORIZED,
				message: 'User not found',
			};
		}

		const oauth = new Discord();
		const token = await oauth
			.tokenRequest({
				clientId: process.env['DISCORD_CLIENT_ID'],
				clientSecret: process.env['DISCORD_CLIENT_SECRET'],
				redirectUri: process.env['DISCORD_REDIRECT_URI'],
				grantType: 'authorization_code',
				code,
				scope: 'identify',
			})
			.catch((err) => {
				captureException(err);
				return null;
			});

		if (!token) {
			throw {
				code: status.FORBIDDEN,
				message: 'Unable to authenticate with Discord',
			};
		}

		const response = await discord.getCurrentUser(token.token_type, token.access_token);

		if (!response || !response.data) {
			throw {
				code: status.FORBIDDEN,
				message: 'Unable to retrieve Discord info',
			};
		}

		const discordUser = response.data;

		user.discordInfo = {
			clientId: discordUser.id,
			accessToken: token.access_token,
			refreshToken: token.refresh_token,
			tokenType: token.token_type,
			expires: new Date(Date.now() + token.expires_in * 1000),
		};

		user.discord = discordUser.id;

		let nickname = `${user.fname} ${user.lname} | ${user.ratingShort}`;
		await req.app.redis
			.lpush('newUser4512', JSON.stringify([discordUser.id, token.access_token, nickname]))
			.then(() => console.log('Task sent to queue', discordUser.id))
			.catch((err) => console.error('Error sending task', err));

		await user.save();

		await DossierModel.create({
			by: user.cid,
			affected: -1,
			action: `%b connected their Discord.`,
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

router.delete('/user', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		await UserModel.updateOne({ cid: req.user.cid }, { $unset: { discord: '', discordInfo: '' } });

		res.status(status.OK).json();
	} catch (e) {
		captureException(e);

		return next(e);
	}
});

export default router;
