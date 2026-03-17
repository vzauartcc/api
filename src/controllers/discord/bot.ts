import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance } from '../../app.js';
import discord from '../../helpers/discord.js';
import { throwBadRequestException } from '../../helpers/errors.js';
import zau from '../../helpers/zau.js';
import { isSeniorStaff } from '../../middleware/auth.js';
import internalAuth from '../../middleware/internalAuth.js';
import getUser from '../../middleware/user.js';
import { ControllerHoursModel } from '../../models/controllerHours.js';
import { DiscordConfigModel } from '../../models/discordConfig.js';
import { UserModel } from '../../models/user.js';
import status from '../../types/status.js';

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
});

router.get(
	'/config',
	getUser,
	isSeniorStaff,
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			const config = await DiscordConfigModel.findOne({ type: 'discord' })
				.cache('1 hour', 'discord-config')
				.exec();
			if (!config) {
				const doc = await DiscordConfigModel.create({
					id: '485491681903247361',
					type: 'discord',
					repostChannels: [
						{
							id: '486966861632897034',
							topic: 'ZAU Announcement',
						},
						{
							id: '544080116762935296',
							topic: 'ZAU Promotion!',
						},
						{
							id: '878613881046593586',
							topic: 'ZAU Training Announcement',
						},
					],
					managedRoles: [
						{
							key: 'OBS',
							roleId: '826533958245285909',
						},
						{
							key: 'S1',
							roleId: '907949973721743421',
						},
						{
							key: 'S2',
							roleId: '907950813337501697',
						},
						{
							key: 'S3',
							roleId: '925768951491883018',
						},
						{
							key: 'C1',
							roleId: '1012096233738879087',
						},
						{
							key: 'C3',
							roleId: '1012096533027631124',
						},
						{
							key: 'I1',
							roleId: '1012096533392535664',
						},
						{
							key: 'I3',
							roleId: '1012096687071821856',
						},
						{
							key: 'SUP',
							roleId: '1012096738804387920',
						},
						{
							key: 'ADM',
							roleId: '1015818173628547182',
						},
						{
							key: 'HOME',
							roleId: '485492230774325260',
						},
						{
							key: 'VIS',
							roleId: '485500102056607745',
						},
						{
							key: 'ins',
							roleId: '1025487324915699752',
						},
						{
							key: 'mtr',
							roleId: '1025487633754882098',
						},
						{
							key: 'fe',
							roleId: '1146456088129061006',
						},
						{
							key: 'ec',
							roleId: '1044866729764986920',
						},
						{
							key: 'wm',
							roleId: '1036086110931132436',
						},
						{
							key: 'GUEST',
							roleId: '1013191411413287023',
						},
					],
					ironMic: { channelId: '1206360145383395368', messageId: '1206361986032472114' },
					onlineControllers: { channelId: '1095122861028548710', messageId: '1184635443761905825' },
					cleanupChannels: [
						{
							channelId: '1059158001484841010',
							messageId: '1438596525805801492',
						},
					],
				});

				return res.status(status.OK).json(doc);
			}

			return res.status(status.OK).json(config);
		} catch (e) {
			return next(e);
		}
	},
);

router.put(
	'/config',
	getUser,
	isSeniorStaff,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { config } = req.body;
			if (!config) {
				throwBadRequestException('Invalid request');
			}

			for (const repostChannel of config.repostChannels) {
				if (config.repostChannels.filter((r: any) => r.id === repostChannel.id).length > 1) {
					throwBadRequestException('Duplicate repost channel id');
				}
			}

			for (const cleanupChannels of config.cleanupChannels) {
				if (
					config.cleanupChannels.filter((c: any) => c.channelId === cleanupChannels.channelId)
						.length > 1
				) {
					throwBadRequestException('Duplicate cleanup channel id');
				}
			}

			await DiscordConfigModel.findOneAndUpdate({ type: 'discord' }, config, { upsert: true });

			await getCacheInstance().clear('discord-config');

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);
router.get(
	'/all-channels',
	getUser,
	isSeniorStaff,
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			const channels = await discord.getAllTextChannels();
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
	async (_req: Request, res: Response, next: NextFunction) => {
		try {
			const roles = await discord.getAllRoles();
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

export default router;
