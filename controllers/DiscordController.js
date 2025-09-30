import express from 'express';
import microAuth from '../middleware/microAuth.js';
const router = express.Router();
import dotenv from 'dotenv';
import getUser from '../middleware/getUser.js';
import Discord from 'discord-oauth2';
import oAuth from '../middleware/vatsimOAuth.js';
import axios from 'axios';
import User from '../models/User.js';
import Config from '../models/Config.js';

dotenv.config();

router.get('/users', microAuth, async (req, res) => {
	try {
		const users = await User.find({ discordInfo: { $ne: null } }).select(
			'fname lname cid discordInfo roleCodes oi rating member vis',
		);

		res.stdRes.data = users;
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/withyou', microAuth, async (req, res) => {
	try {
		const withYou = await Config.findOne({}).select('withYou').lean();

		res.stdRes.data = withYou;
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.post('/withyou', microAuth, async (req, res) => {
	try {
		const withYou = await Config.findOne({}).select('withYou');
		withYou.withYou++;
		await withYou.save();
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.delete('/withyou', microAuth, async (req, res) => {
	try {
		const withYou = await Config.findOne({}).select('withYou');
		withYou.withYou--;
		await withYou.save();
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});
router.get('/user', getUser, async (req, res) => {
	try {
		res.stdRes.data = !!res.user.discordInfo.clientId;
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.post('/info', async (req, res) => {
	try {
		if (!req.body.code || !req.body.cid) {
			throw {
				code: 400,
				message: 'Incomplete request',
			};
		}

		const { cid, code } = req.body;
		const user = await User.findOne({ cid });

		if (!user) {
			throw {
				code: 401,
				message: 'User not found',
			};
		}

		const oauth = new Discord();
		const token = await oauth
			.tokenRequest({
				clientId: process.env.DISCORD_CLIENT_ID,
				clientSecret: process.env.DISCORD_CLIENT_SECRET,
				redirectUri: process.env.DISCORD_REDIRECT_URI,
				grantType: 'authorization_code',
				code,
				scope: 'identify',
			})
			.catch((err) => {
				console.log(err);
				return false;
			});

		if (!token) {
			throw {
				code: 403,
				message: 'Unable to authenticate with Discord',
			};
		}

		const { data: discordUser } = await axios
			.get('https://discord.com/api/users/@me', {
				headers: {
					Authorization: `${token.token_type} ${token.access_token}`,
					'User-Agent': 'Chicago ARTCC API',
				},
			})
			.catch((err) => {
				console.log(err);
				return false;
			});

		if (!discordUser) {
			throw {
				code: 403,
				message: 'Unable to retrieve Discord info',
			};
		}

		user.discordInfo.clientId = discordUser.id;
		user.discordInfo.accessToken = token.access_token;
		user.discordInfo.refreshToken = token.refresh_token;
		user.discordInfo.tokenType = token.token_type;
		user.discord = discordUser.id;

		let currentTime = new Date();
		currentTime = new Date(currentTime.getTime() + token.expires_in * 1000);
		user.discordInfo.expires = currentTime;
		let nickname = `${user.fname} ${user.lname} | ${user.ratingShort}`;
		try {
			await req.app.redis.lpush(
				'newUser4512',
				JSON.stringify([discordUser.id, token.access_token, nickname]),
			);
			console.log('Task sent to the queue:', discordUser.id);
		} catch (error) {
			console.error('Error sending task:', error);
		} finally {
			// Close the Redis connection (if needed)
		}
		await user.save();

		await req.app.dossier.create({
			by: user.cid,
			affected: -1,
			action: `%b connected their Discord.`,
		});
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.delete('/user', getUser, async (req, res) => {
	try {
		res.user.discordInfo = undefined;
		res.user.discord = undefined;
		await res.user.save();
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});
export default router;
