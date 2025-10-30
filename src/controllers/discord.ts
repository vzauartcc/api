import { captureException } from '@sentry/node';
import Discord from 'discord-oauth2';
import { Router, type Request, type Response } from 'express';
import { convertToReturnDetails } from '../app.js';
import discord from '../helpers/discord.js';
import internalAuth from '../middleware/internalAuth.js';
import getUser from '../middleware/user.js';
import { DossierModel } from '../models/dossier.js';
import { UserModel } from '../models/user.js';

const router = Router();

router.get('/users', internalAuth, async (_req: Request, res: Response) => {
	try {
		const users = await UserModel.find({ discordInfo: { $ne: null } })
			.select('fname lname cid discordInfo roleCodes oi rating member vis')
			.exec();

		res.stdRes.data = users;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.get('/user', getUser, async (req: Request, res: Response) => {
	try {
		res.stdRes.data = !!req.user?.discordInfo?.clientId;
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.post('/info', async (req: Request, res: Response) => {
	try {
		if (
			!process.env['DISCORD_CLIENT_ID'] ||
			!process.env['DISCORD_CLIENT_SECRET'] ||
			!process.env['DISCORD_REDIRECT_URI']
		) {
			throw {
				code: 500,
				message: 'Internal Server Error',
			};
		}

		if (!req.body.code || !req.body.cid) {
			throw {
				code: 400,
				message: 'Incomplete request',
			};
		}

		const { cid, code } = req.body;
		const user = await UserModel.findOne({ cid }).exec();

		if (!user) {
			throw {
				code: 401,
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
				code: 403,
				message: 'Unable to authenticate with Discord',
			};
		}

		const response = await discord.getCurrentUser();

		if (!response || !response.data) {
			throw {
				code: 403,
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
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

router.delete('/user', getUser, async (req: Request, res: Response) => {
	try {
		await UserModel.updateOne({ cid: req.user!.cid }, { $unset: { discord: '', discordInfo: '' } });
	} catch (e) {
		res.stdRes.ret_det = convertToReturnDetails(e);
		captureException(e);
	} finally {
		return res.json(res.stdRes);
	}
});

export default router;
