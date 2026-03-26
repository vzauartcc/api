import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance } from '../../app.js';
import discord from '../../helpers/discord.js';
import { throwBadRequestException, throwForbiddenException } from '../../helpers/errors.js';
import zau from '../../helpers/zau.js';
import { isSeniorStaff, userOrInternalJwt } from '../../middleware/auth.js';
import { jwtInternalAuth } from '../../middleware/internalAuth.js';
import getUser from '../../middleware/user.js';
import { ControllerHoursModel } from '../../models/controllerHours.js';
import { DiscordConfigModel } from '../../models/discordConfig.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';

const router = Router();

router.get('/users', jwtInternalAuth, async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const users = await UserModel.find({ discordInfo: { $ne: null } })
			.select('fname lname cid discordInfo roleCodes oi rating member vis')
			.exec();

		return res.status(status.OK).json(users);
	} catch (e) {
		return next(e);
	}
});

router.get(
	'/user/:id',
	jwtInternalAuth,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { id } = req.params;
			if (!id || id.trim() === '') {
				throwBadRequestException('Invalid request');
			}

			const user = await UserModel.findOne({ discord: id })
				.select('fname lname cid discordInfo roleCodes oi rating member vis')
				.exec();

			if (!user) {
				throwBadRequestException('User not found');
			}

			return res.status(status.OK).json(user);
		} catch (e) {
			return next(e);
		}
	},
);

router.get(
	'/ironmic',
	jwtInternalAuth,
	async (_req: Request, res: Response, next: NextFunction) => {
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
			return res.status(status.OK).json({
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
	},
);

router.get(
	'/configs',
	userOrInternalJwt,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if ((req.user && !req.user.isSeniorStaff) || req.internal === false) {
				throwForbiddenException('Forbidden');
			}

			const configs = await DiscordConfigModel.find({ type: 'discord' })
				.cache('6 hours', 'discord-configs')
				.exec();
			return res.status(status.OK).json(configs);
		} catch (e) {
			return next(e);
		}
	},
);

router.get(
	'/config/:id',
	userOrInternalJwt,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if ((req.user && !req.user.isSeniorStaff) || req.internal === false) {
				throwForbiddenException('Forbidden');
			}

			const { id } = req.params;
			if (!id || id === 'undefined') {
				throwBadRequestException('Invalid request');
			}

			const config = await DiscordConfigModel.findOne({ type: 'discord', id: id })
				.cache('6 hours', `discord-config-${id}`)
				.exec();
			if (!config) {
				return res.status(status.OK).json({
					id,
					type: 'discord',
					repostChannels: {},
					managedRoles: [],
					ironMic: { channelId: '', messageId: '' },
					onlineControllers: { channelId: '', messageId: '' },
					cleanupChannels: {},
				});
			}

			return res.status(status.OK).json(config);
		} catch (e) {
			return next(e);
		}
	},
);

router.put(
	'/config/:id',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { id } = req.params;
			if (!id || id === 'undefined') {
				throwBadRequestException('Invalid request');
			}

			const config = req.body;
			if (!config) {
				throwBadRequestException('Invalid request');
			}

			await DiscordConfigModel.findOneAndUpdate({ type: 'discord', id: id }, config, {
				upsert: true,
			}).exec();

			await getCacheInstance().clear(`discord-config-${id}`);

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.patch(
	'/config/:id',
	jwtInternalAuth,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { id } = req.params;
			if (!id || id === 'undefined') {
				throwBadRequestException('Invalid request');
			}

			const { ironMic, onlineControllers } = req.body;
			if (!ironMic || !onlineControllers) {
				throwBadRequestException('Invalid request');
			}

			const config = await DiscordConfigModel.findOne({ type: 'discord', id: id })
				.cache('6 hours', `discord-config-${id}`)
				.exec();
			if (!config) {
				throwBadRequestException('Invalid request');
			}

			config.ironMic.messageId = ironMic;
			config.onlineControllers.messageId = onlineControllers;
			const updated = await config.save();

			await getCacheInstance().clear(`discord-config-${id}`);

			return res.status(status.OK).json(updated);
		} catch (e) {
			return next(e);
		}
	},
);

router.get(
	'/all-channels',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { guildId } = req.query;
			if (!guildId || guildId === 'undefined') {
				throwBadRequestException('Invalid request');
			}

			const channels = await discord.getAllTextChannels(guildId as string);
			return res.status(status.OK).json(channels);
		} catch (e) {
			return next(e);
		}
	},
);

router.get(
	'/all-roles',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { guildId } = req.query;
			if (!guildId || guildId === 'undefined') {
				throwBadRequestException('Invalid request');
			}

			const roles = await discord.getAllRoles(guildId as string);
			return res.status(status.OK).json(roles);
		} catch (e) {
			return next(e);
		}
	},
);

router.get(
	'/message-content',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { channelId, messageId } = req.query;
			if (!channelId || !messageId) {
				throwBadRequestException('Invalid request');
			}

			const content = await discord.getMessageContent(channelId as string, messageId as string);
			return res.status(status.OK).json(content);
		} catch (e) {
			return next(e);
		}
	},
);

router.get(
	'/all-messages',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { channelId } = req.query;
			if (!channelId) {
				throwBadRequestException('Invalid request');
			}

			const messages = await discord.getAllMessages(channelId as string);
			return res.status(status.OK).json(messages);
		} catch (e) {
			return next(e);
		}
	},
);

router.get(
	'/all-guilds',
	getUser,
	isSeniorStaff,
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			const guilds = await discord.getAllGuilds();
			return res.status(status.OK).json(guilds);
		} catch (e) {
			return next(e);
		}
	},
);

router.post(
	'/send-message',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { channelId, content } = req.body;
			if (!channelId || !content) {
				throwBadRequestException('Invalid request');
			}

			await discord.sendMessage(channelId, content);
			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

export default router;
