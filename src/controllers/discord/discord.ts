import { Router, type NextFunction, type Request, type Response } from 'express';
import discord from '../../helpers/discord.js';
import {
	throwBadRequestException,
	throwForbiddenException,
	throwInternalServerErrorException,
	throwUnauthorizedException,
} from '../../helpers/errors.js';
import zau from '../../helpers/zau.js';
import internalAuth from '../../middleware/internalAuth.js';
import getUser from '../../middleware/user.js';
import { ControllerHoursModel } from '../../models/controllerHours.js';
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
		return next(e);
	}
});

router.get('/user', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		return res.status(status.OK).json(!!req.user.discordInfo?.clientId);
	} catch (e) {
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
			throwInternalServerErrorException('Internal Server Error');
		}

		if (!req.body.code || !req.body.cid) {
			throwBadRequestException('Invalid request');
		}

		const { cid, code } = req.body;
		const user = await UserModel.findOne({ cid }).exec();

		if (!user) {
			throwUnauthorizedException('User Not Found');
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
			throwForbiddenException('Unable to Authenticate with Discord');
		}

		const response = await discord.getCurrentUser(token.token_type, token.access_token);

		if (!response || !response.data) {
			throwForbiddenException('Unable to Retrieve Discord Information');
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
		return next(e);
	}
});

router.get('/ironmic', internalAuth, async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const results = await ControllerHoursModel.aggregate([
			{
				$match: {
					$and: [
						{
							timeStart: { $gte: zau.activity.period.startOfCurrent },
						},
						{ timeStart: { $lte: zau.activity.period.endOfCurrent } },
					],
					position: { $not: /OBS/ },
				},
			},
			{
				$lookup: {
					from: 'users',
					localField: 'cid',
					foreignField: 'cid',
					as: 'userDetails',
				},
			},
			{
				$unwind: {
					path: '$userDetails',
					preserveNullAndEmptyArrays: false,
				},
			},
			{
				$match: {
					'userDetails.member': true,
					'userDetails.vis': false,
				},
			},
			{
				$group: {
					_id: '$cid',
					fname: { $first: '$userDetails.fname' },
					lname: { $first: '$userDetails.lname' },
					rating: { $first: '$userDetails.rating' },
					totalSeconds: {
						$sum: {
							$dateDiff: {
								startDate: '$timeStart',
								endDate: '$timeEnd',
								unit: 'second',
							},
						},
					},
				},
			},
			{
				$project: {
					_id: 0,
					controller: '$_id',
					totalSeconds: 1,
					fname: 1,
					lname: 1,
					rating: 1,
				},
			},
		])
			.cache('5 minutes')
			.exec();

		const center = [];
		const approach = [];
		const tower = [];
		const ground = [];

		for (const result of results) {
			if (result.rating >= 5) {
				center.push(result);
			} else if (result.rating === 4) {
				approach.push(result);
			} else if (result.rating === 3) {
				tower.push(result);
			} else if (result.rating === 2) {
				ground.push(result);
			}
		}

		center.sort((a, b) => b.totalSeconds - a.totalSeconds);
		approach.sort((a, b) => b.totalSeconds - a.totalSeconds);
		tower.sort((a, b) => b.totalSeconds - a.totalSeconds);
		ground.sort((a, b) => b.totalSeconds - a.totalSeconds);
		return res
			.status(status.OK)
			.json({
				results: {
					center: center.slice(0, 3),
					approach: approach.slice(0, 3),
					tower: tower.slice(0, 3),
					ground: ground.slice(0, 3),
				},
				period: zau.activity.period,
			});
	} catch (e) {
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
