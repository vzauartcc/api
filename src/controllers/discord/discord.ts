import { Router, type NextFunction, type Request, type Response } from 'express';
import { logException } from '../../app.js';
import discord from '../../helpers/discord.js';
import internalAuth from '../../middleware/internalAuth.js';
import getUser from '../../middleware/user.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';
import { clearUserCache } from '../controller/utils.js';

const router = Router();

router.get('/users', internalAuth, async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const users = await UserModel.find({ discordInfo: { $ne: null } })
			.select('fname lname cid discordInfo roleCodes oi rating member vis')
			.exec();

		return res.status(status.OK).json(users);
	} catch (e) {
		logException(e);

		return next(e);
	}
});

router.get('/user', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		return res.status(status.OK).json(!!req.user.discordInfo?.clientId);
	} catch (e) {
		logException(e);

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

		const token = await requestToken({
			clientId: process.env['DISCORD_CLIENT_ID'],
			clientSecret: process.env['DISCORD_CLIENT_SECRET'],
			redirectUri: process.env['DISCORD_REDIRECT_URI'],
			grantType: 'authorization_code',
			code,
			scope: 'identify',
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

		let nickname = `${user.name} | ${user.ratingShort}`;
		await req.app.redis
			.lpush('newUser4512', JSON.stringify([discordUser.id, token.access_token, nickname]))
			.then(() => console.log('Task sent to queue', discordUser.id))
			.catch((err) => console.error('Error sending task', err));

		await user.save();
		clearUserCache(user.cid);

		await DossierModel.create({
			by: user.cid,
			affected: -1,
			action: `%b connected their Discord.`,
			actionType: ACTION_TYPE.CONNECT_DISCORD,
		});

		return res.status(status.CREATED).json();
	} catch (e) {
		logException(e);

		return next(e);
	}
});

router.delete('/user', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		await UserModel.updateOne({ cid: req.user.cid }, { $unset: { discord: '', discordInfo: '' } });
		clearUserCache(req.user.cid);

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b disconnected their Discord.`,
			actionType: ACTION_TYPE.DISCONNECT_DISCORD,
		});

		res.status(status.OK).json();
	} catch (e) {
		logException(e);

		return next(e);
	}
});

interface DiscordOptions {
	clientId: string;
	clientSecret: string;
	grantType: string;
	refreshToken?: string;
	scope: string | string[];
	redirectUri: string;
	code: string;
}

interface DiscordToken {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	token_type: string;
	scope: string;
}

async function requestToken(options = {} as DiscordOptions): Promise<DiscordToken> {
	interface DiscordApiOptions {
		client_id: string;
		client_secret: string;
		grant_type: string | undefined;
		code: string | undefined;
		refresh_token: string | undefined;
		redirect_uri: string;
		scope: string | string[];
	}
	function encode(obj: Object) {
		let string = '';

		for (const [key, value] of Object.entries(obj)) {
			if (!value) continue;
			string += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
		}

		return string.substring(1);
	}

	const obj: DiscordApiOptions = {
		client_id: options.clientId,
		client_secret: options.clientSecret,
		grant_type: undefined,
		code: undefined,
		refresh_token: undefined,
		redirect_uri: options.redirectUri,
		scope: options.scope instanceof Array ? options.scope.join(' ') : options.scope,
	};

	if (options.grantType === 'authorization_code') {
		obj.code = options.code;
		obj.grant_type = options.grantType;
	} else if (options.grantType === 'refresh_token') {
		obj.refresh_token = options.refreshToken;
		obj.grant_type = options.grantType;
	} else
		throw new Error(
			'Invalid grant_type provided, it must be either authorization_code or refresh_token',
		);

	const encoded_string = encode(obj);

	const response = await fetch('https://discord.com/api/oauth2/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'User-Agent': 'vZAU ARTCC Discord OAuth Integration',
		},
		body: encoded_string,
	});

	if (!response.ok) {
		const errorData = await response.json();
		throw {
			code: response.status,
			message: errorData,
		};
	}

	const tokenData = await response.json();

	return tokenData as DiscordToken;
}

export default router;
