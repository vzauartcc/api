import { captureMessage } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCacheInstance } from '../../app.js';
import {
	throwBadRequestException,
	throwForbiddenException,
	throwInternalServerErrorException,
	throwNotFoundException,
} from '../../helpers/errors.js';
import { sendMail } from '../../helpers/mailer.js';
import { clearCachePrefix } from '../../helpers/redis.js';
import { deleteFromS3, generateS3SignedUrl } from '../../helpers/s3.js';
import { isEventsTeam } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { ACTION_TYPE, DossierModel } from '../../models/dossier.js';
import EventModel from '../../models/event.js';
import type { IEventPosition, IEventPositionData } from '../../models/eventPosition.js';
import type { IEventSignup } from '../../models/eventSignup.js';
import { UserModel, type IUser } from '../../models/user.js';
import status from '../../types/status.js';
import staffingRequestRouter from './staffingrequest.js';

const router = Router();
const BANNER_SIZE_LIMIT = 5 * 1024 * 1024;

router.use('/staffingrequest', staffingRequestRouter);

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
	try {
		const events = await EventModel.find({
			eventEnd: {
				$gt: new Date(new Date().toUTCString()), // event starts in the future
			},
			deleted: false,
		})
			.sort({ eventStart: 'asc' })
			.lean()
			.cache('10 minutes', `events`)
			.exec();

		return res.status(status.OK).json(events);
	} catch (e) {
		return next(e);
	}
});

router.get('/archive', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const page = +(req.query['page'] as string) || 1;
		const limit = +(req.query['limit'] as string) || 10;

		const count = await EventModel.countDocuments({
			eventEnd: {
				$lt: new Date(new Date().toUTCString()),
			},
			deleted: false,
		})
			.cache('10 minutes', 'event-archive-count')
			.exec();
		const events = await EventModel.find({
			eventEnd: {
				$lt: new Date(new Date().toUTCString()),
			},
			deleted: false,
		})
			.skip(limit * (page - 1))
			.limit(limit)
			.sort({ eventStart: 'desc' })
			.lean()
			.cache('10 minutes')
			.exec();

		return res.status(status.OK).json({ amount: count, events });
	} catch (e) {
		return next(e);
	}
});

router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['slug'] || req.params['slug'] === 'undefined') {
			throwBadRequestException('Invalid event slug');
		}

		const event = await EventModel.findOne({
			url: req.params['slug'],
			deleted: false,
		})
			.lean()
			.cache('10 minute', `event-${req.params['slug']}`)
			.exec();

		return res.status(status.OK).json(event);
	} catch (e) {
		return next(e);
	}
});

//#region Position Signups
router.get('/:slug/positions', async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['slug'] || req.params['slug'] === 'undefined') {
			throwBadRequestException('Invalid event slug');
		}

		const event = await EventModel.findOne({
			url: req.params['slug'],
			deleted: false,
		})
			.sort({
				'positions.order': -1,
			})
			.select('open submitted eventStart positions signups name')
			.populate('positions.user', 'cid fname lname roleCodes')
			.populate('signups.user', 'fname lname cid vis rating certCodes')
			.lean({ virtuals: true })
			.cache('1 minute', `event-positions-${req.params['slug']}`)
			.exec();

		return res.status(status.OK).json(event);
	} catch (e) {
		return next(e);
	}
});

router.patch('/:slug/signup', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['slug'] || req.params['slug'] === 'undefined') {
			throwBadRequestException('Invalid event slug');
		}

		if (req.body.requests.length > 3) {
			throwBadRequestException('You may only request up to 3 positions');
		}

		if (req.user.member === false) {
			throwForbiddenException('You must be a ZAU member to request positions for an event.');
		}

		for (const r of req.body.requests) {
			if (
				(/^([A-Z]{2,3})(_([A-Z,0-9]{1,3}))?_(DEL|GND|TWR|APP|DEP|CTR)$/.test(r) ||
					r.toLowerCase().includes('any')) === false
			) {
				throwBadRequestException('Invalid callsign');
			}
		}

		const event = await EventModel.findOneAndUpdate(
			{ url: req.params['slug'] },
			{
				$push: {
					signups: {
						cid: req.user.cid,
						requests: req.body.requests,
					},
				},
			},
		).exec();

		await getCacheInstance().clear(`event-${req.params['slug']}`);
		await getCacheInstance().clear(`event-positions-${req.params['slug']}`);

		if (!event) {
			throwNotFoundException('Event Not Found');
		}

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b signed up for the event *${event.name}*.`,
			actionType: ACTION_TYPE.CREATE_EVENT_SIGNUP,
		});

		return res.status(status.OK).json();
	} catch (e) {
		return next(e);
	}
});

router.delete('/:slug/signup', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.params['slug'] || req.params['slug'] === 'undefined') {
			throwBadRequestException('Invalid event slug');
		}

		const event = await EventModel.findOneAndUpdate(
			{ url: req.params['slug'] },
			{
				$pull: {
					signups: {
						cid: req.user.cid,
					},
				},
			},
		).exec();

		await getCacheInstance().clear(`event-${req.params['slug']}`);
		await getCacheInstance().clear(`event-positions-${req.params['slug']}`);

		if (!event) {
			throwNotFoundException('Event Not Found');
		}

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b deleted their signup for the event *${event.name}*.`,
			actionType: ACTION_TYPE.DELETE_EVENT_SIGNUP,
		});

		return res.status(status.NO_CONTENT).json();
	} catch (e) {
		return next(e);
	}
});

router.delete(
	'/:slug/mandelete/:cid',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['slug'] || req.params['slug'] === 'undefined') {
				throwBadRequestException('Invalid event slug');
			}

			if (
				!req.params['cid'] ||
				req.params['cid'] === 'undefined' ||
				isNaN(Number(req.params['cid']))
			) {
				throwBadRequestException('Invalid CID');
			}
			const signup = await EventModel.findOneAndUpdate(
				{ url: req.params['slug'] },
				{
					$pull: {
						signups: {
							cid: req.params['cid'],
						},
					},
				},
			).exec();

			await getCacheInstance().clear(`event-${req.params['slug']}`);
			await getCacheInstance().clear(`event-positions-${req.params['slug']}`);

			if (!signup) {
				throwNotFoundException('Signup Not Found');
			}

			for (const position of signup.positions) {
				if (position.takenBy === req.user.cid) {
					await EventModel.findOneAndUpdate(
						{ url: req.params['slug'], 'positions.takenBy': req.user.cid },
						{
							$set: {
								'positions.$.takenBy': null,
							},
						},
					).exec();
				}
			}

			await DossierModel.create({
				by: req.user.cid,
				affected: req.params['cid'],
				action: `%b manually deleted the event signup for %a for the event *${signup.name}*.`,
				actionType: ACTION_TYPE.MANUAL_DELETE_EVENT_SIGNUP,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.patch(
	'/:slug/mansignup/:cid',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['slug'] || req.params['slug'] === 'undefined') {
				throwBadRequestException('Invalid event slug');
			}

			if (
				!req.params['cid'] ||
				req.params['cid'] === 'undefined' ||
				isNaN(Number(req.params['cid']))
			) {
				throwBadRequestException('Invalid CID');
			}
			const user = await UserModel.findOne({ cid: req.params['cid'] })
				.cache('1 minute', `user-${req.params['cid']}`)
				.exec();
			if (!user) {
				throwNotFoundException('Controller Not Found');
			}

			const event = await EventModel.findOne({ url: req.params['slug'] })
				.cache('1 minute', `event-${req.params['slug']}`)
				.exec();

			if (!event) {
				throwNotFoundException('Event Not Found');
			}

			const isAlreadySignedUp = event.signups.some(
				(signup: IEventSignup) => signup.cid.toString() === req.params['cid'],
			);

			if (isAlreadySignedUp) {
				throwBadRequestException('Controller already signed up for this event');
			}

			// If not already signed up, proceed with adding
			await EventModel.findOneAndUpdate(
				{ url: req.params['slug'] },
				{
					$push: {
						signups: {
							cid: req.params['cid'],
						},
					},
				},
			).exec();

			await getCacheInstance().clear(`event-${req.params['slug']}`);
			await getCacheInstance().clear(`event-positions-${req.params['slug']}`);

			await DossierModel.create({
				by: req.user.cid,
				affected: req.params['cid'],
				action: `%b manually signed up %a for the event *${event.name}*.`,
				actionType: ACTION_TYPE.MANUAL_EVENT_SIGNUP,
			});

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.patch(
	'/:slug/assign',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['slug'] || req.params['slug'] === 'undefined') {
				throwBadRequestException('Invalid event slug');
			}

			const { position, cid } = req.body;

			const eventData = await EventModel.findOneAndUpdate(
				{ url: req.params['slug'], 'positions._id': position },
				{
					$set: {
						'positions.$.takenBy': cid || null,
					},
				},
				{
					new: true,
				},
			).exec();

			await getCacheInstance().clear(`event-${req.params['slug']}`);
			await getCacheInstance().clear(`event-positions-${req.params['slug']}`);

			if (!eventData) {
				throwNotFoundException('Event Not Found');
			}

			const assignedPosition = eventData.positions.find(
				(pos: IEventPosition) => pos.id === position,
			);

			if (!assignedPosition) {
				throwInternalServerErrorException('Position does not exist');
			}

			if (cid) {
				await DossierModel.create({
					by: req.user.cid,
					affected: cid,
					action: `%b assigned %a to *${assignedPosition.pos}* for *${eventData.name}*.`,
					actionType: ACTION_TYPE.ASSIGN_EVENT_POSITION,
				});
			} else {
				await DossierModel.create({
					by: req.user.cid,
					affected: -1,
					action: `%b unassigned *${assignedPosition.pos}* for *${eventData.name}*.`,
					actionType: ACTION_TYPE.UNASSIGN_EVENT_POSITION,
				});
			}

			return res.status(status.OK).json(assignedPosition);
		} catch (e) {
			return next(e);
		}
	},
);
//#endregion

router.post(
	'/sendEvent',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const url = req.body.url;
			const eventData = await EventModel.findOne({ url: url }).exec();
			if (!eventData) {
				throwNotFoundException('Event Not Found');
			}

			const positions = eventData.positions;

			if (positions.length >= 25 * 10) {
				throwBadRequestException(`A maximum of ${25 * 10} positions are permitted per event.`);
			}

			const userCids = [...new Set(positions.map((p) => p.takenBy).filter((cid) => !!cid))];
			const users = await UserModel.find({ cid: { $in: userCids } })
				.lean()
				.exec();
			const userMap = new Map(users.map((u) => [u.cid, u]));

			const positionFields = positions.map((position: IEventPosition) => {
				if (!position.takenBy) {
					return {
						name: position.pos,
						value: 'Open',
						inline: true,
					};
				}

				const user = userMap.get(position.takenBy);

				return {
					name: trimText(position.pos, 256),
					value: trimText(user ? `${user.fname} ${user.lname}` : 'Unknown User', 1024),
					inline: true,
				};
			});

			const embeds = [];

			for (let i = 0; i < positionFields.length; i += 25) {
				const chunk = positionFields.slice(i, i + 25);

				const isFirstChunk = i === 0;
				const isLastChunk = i + 25 >= positionFields.length;

				embeds.push({
					title: isFirstChunk ? trimText(eventData.name, 256) : undefined,
					description: isFirstChunk ? trimText(eventData.description, 4096) : undefined,
					color: 2003199,
					footer: !isLastChunk ? undefined : { text: 'Position information provided by WATSN' },
					fields: chunk,
					url: `https://www.zauartcc.org/events/${eventData.url}#${i}`,
					image: !isLastChunk
						? undefined
						: {
								url: `${process.env['S3_ORIGIN_ENDPOINT']}/events/` + eventData.bannerUrl,
							},
				});
			}

			const params = {
				username: 'WATSN',
				avatar_url:
					'https://cdn.discordapp.com/avatars/1011884072479502406/feac626c2bdf43bfa8337cd3165e5a92.png?size=1024',
				content: '',
				embeds: embeds,
			};

			const isEdit = !!eventData.discordId;

			const webhookUrl = !isEdit
				? process.env['DISCORD_WEBHOOK']
				: `${process.env['DISCORD_WEBHOOK']}/messages/${eventData.discordId}`;

			if (!webhookUrl) {
				throwInternalServerErrorException('Webook URL not found');
			}

			try {
				const response = await fetch(`${webhookUrl}?wait=true`, {
					method: isEdit ? 'PATCH' : 'POST',
					headers: {
						'Content-type': 'application/json',
					},
					body: JSON.stringify(params),
				});

				const data = (await response.json()) as any;
				if (data) {
					if (response.status === status.NOT_FOUND && data.code === 10008) {
						const res2 = await fetch(`${process.env['DISCORD_WEBHOOK']}?wait=true`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(params),
						});

						const data2 = (await res2.json()) as any;
						if (data2 && data2.id) {
							await EventModel.findOneAndUpdate(
								{ url: url },
								{ $set: { discordId: String(data2.id) } },
								{ returnOriginal: false },
							).exec();

							return res.status(status.OK).json();
						}
						return;
					}
					let messageId = (data as { id: string }).id;
					if (!messageId) {
						captureMessage('Discord Webhook failed', data);
						throwInternalServerErrorException('Discord failed to process our message.');
					}

					await EventModel.findOneAndUpdate(
						{ url: url },
						{ $set: { discordId: String(messageId) } },
						{ returnOriginal: false },
					).exec();

					return res.status(status.OK).json();
				} else {
					throwInternalServerErrorException('Discord did not return any data');
				}
			} catch (e: any) {
				console.error('error posting message to discord', e);
				throwInternalServerErrorException(e.message);
			}
		} catch (e) {
			return next(e);
		}
	},
);

router.post('/', getUser, isEventsTeam, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (!req.body.fileType) {
			throwBadRequestException('File path missing');
		}

		const url =
			req.body.name
				.replace(/\s+/g, '-')
				.toLowerCase()
				.replace(/^-+|-+(?=-|$)/g, '')
				.replace(/[^a-zA-Z0-9-_]/g, '') +
			'-' +
			Date.now().toString().slice(-5);
		const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png', 'image/gif'];

		if (!req.body.fileType || !allowedTypes.includes(req.body.fileType)) {
			throwBadRequestException('Banner file type is not supported');
		}

		if (!req.body.fileName) {
			throwBadRequestException('File name is required');
		}

		if (!req.body.fileSize) {
			throwBadRequestException('File size is required');
		}
		if (!/^\d+$/.test(String(req.body.fileSize))) {
			throwBadRequestException('Invalid file size');
		}

		const fileSize = Number(String(req.body.fileSize));
		if (fileSize < 1 || fileSize >= BANNER_SIZE_LIMIT) {
			throwBadRequestException(`File must be less than ${BANNER_SIZE_LIMIT / 1024 / 1024} MB`);
		}

		const fileName = `${Date.now()}-${req.body.fileName}`;
		const s3Url = await generateS3SignedUrl(`events/${fileName}`, req.body.fileType, fileSize);

		await EventModel.create({
			name: req.body.name,
			description: req.body.description,
			url: url,
			bannerUrl: fileName,
			eventStart: req.body.startTime,
			eventEnd: req.body.endTime,
			createdBy: req.user.cid,
			open: true,
			submitted: false,
			requiresEventEndorsement: req.body.requiresEventEndorsement,
		});

		await clearCachePrefix('event');

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b created the event *${req.body.name}*.`,
			actionType: ACTION_TYPE.CREATE_EVENT,
		});

		return res.status(status.CREATED).json({ url: s3Url });
	} catch (e) {
		return next(e);
	}
});

router.put(
	'/:slug',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['slug'] || req.params['slug'] === 'undefined') {
				throwBadRequestException('Invalid event slug');
			}

			const eventData = await EventModel.findOne({ url: req.params['slug'] })
				.cache('1 minute', `event-${req.params['slug']}`)
				.exec();
			if (!eventData) {
				throwNotFoundException('Event Not Found');
			}

			const {
				name,
				description,
				startTime,
				endTime,
				positions,
				requiresEventEndorsement,
				fileType,
			} = req.body;
			if (eventData.name !== name) {
				eventData.name = name;
				eventData.url =
					name
						.replace(/\s+/g, '-')
						.toLowerCase()
						.replace(/^-+|-+(?=-|$)/g, '')
						.replace(/[^a-zA-Z0-9-_]/g, '') +
					'-' +
					Date.now().toString().slice(-5);
			}
			eventData.description = description;
			eventData.eventStart = startTime;
			eventData.eventEnd = endTime;
			eventData.requiresEventEndorsement = requiresEventEndorsement;

			const computedPositions: IEventPositionData[] = [];

			for (const pos of positions) {
				const thePos = pos.match(/^([A-Z]{3})_(?:[A-Z0-9]{1,3}_)?([A-Z]{3})$/); // 🤮 so basically this extracts the first part and last part of a callsign.
				if (['CTR'].includes(thePos[2])) {
					computedPositions.push({
						pos,
						type: thePos[2],
						code: 'zau',
					});
				}
				if (['APP', 'DEP'].includes(thePos[2])) {
					computedPositions.push({
						pos,
						type: thePos[2],
						code: thePos[1] === 'ORD' ? 'ordapp' : 'app',
					});
				}
				if (['TWR'].includes(thePos[2])) {
					computedPositions.push({
						pos,
						type: thePos[2],
						code: thePos[1] === 'ORD' ? 'ordtwr' : 'twr',
					});
				}
				if (['GND', 'DEL'].includes(thePos[2])) {
					computedPositions.push({
						pos,
						type: thePos[2],
						code: thePos[1] === 'ORD' ? 'ordgnd' : 'gnd',
					});
				}
			}

			if (eventData.positions.length > 0) {
				const newPositions = [];

				for (let position of computedPositions) {
					newPositions.push(position);
					for (let i = 0; i < eventData.positions.length; i++) {
						if (!eventData.positions[i]) continue;

						if (eventData.positions[i]!.pos === position.pos) {
							if (eventData.positions[i]!.takenBy) {
								const j = newPositions.indexOf(position);
								if (j) {
									newPositions[j]!.takenBy = eventData.positions[i]!.takenBy!;
								}
							}
						}
					}
				}

				eventData.positions = newPositions as IEventPosition[];
			} else {
				eventData.positions = computedPositions as IEventPosition[];
			}

			let s3Url = '';
			if (fileType) {
				const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png', 'image/gif'];
				if (!fileType || !allowedTypes.includes(fileType)) {
					throwBadRequestException('File type not supported');
				}

				if (!req.body.fileName) {
					throwBadRequestException('File name is required');
				}

				if (!req.body.fileSize) {
					throwBadRequestException('File size is required');
				}
				if (!/^\d+$/.test(String(req.body.fileSize))) {
					throwBadRequestException('Invalid file size');
				}

				const fileSize = Number(String(req.body.fileSize));
				if (fileSize < 1 || fileSize >= BANNER_SIZE_LIMIT) {
					throwBadRequestException(`File must be less than ${BANNER_SIZE_LIMIT / 1024 / 1024} MB`);
				}

				if (eventData.bannerUrl) {
					deleteFromS3(`events/${eventData.bannerUrl}`);
				}

				const fileName = `${Date.now()}-${req.body.fileName}`;
				s3Url = await generateS3SignedUrl(`events/${fileName}`, fileType, fileSize);

				eventData.bannerUrl = fileName;
			}

			await eventData.save();

			await clearCachePrefix('event');

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b updated the event *${eventData.name}*.`,
				actionType: ACTION_TYPE.UPDATE_EVENT,
			});

			return res.status(status.OK).json({ url: s3Url });
		} catch (e) {
			return next(e);
		}
	},
);

router.delete(
	'/:slug',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['slug'] || req.params['slug'] === 'undefined') {
				throwBadRequestException('Invalid event slug');
			}

			const deleteEvent = await EventModel.findOne({ url: req.params['slug'] })
				.cache('1 minute', `event-${req.params['slug']}`)
				.exec();

			if (!deleteEvent) {
				throwNotFoundException('Event Not Found');
			}

			// 🚨 **Delete Banner from S3 If It Exists**
			if (deleteEvent.bannerUrl) {
				deleteFromS3(`events/${deleteEvent.bannerUrl}`);
			}

			await deleteEvent.delete();

			await clearCachePrefix('event');

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b deleted the event *${deleteEvent.name}*.`,
				actionType: ACTION_TYPE.DELETE_EVENT,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.patch(
	'/:slug/notify',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['slug'] || req.params['slug'] === 'undefined') {
				throwBadRequestException('Invalid event slug');
			}

			await EventModel.updateOne(
				{ url: req.params['slug'] },
				{
					$set: {
						positions: req.body.assignment,
						submitted: true,
					},
				},
			).exec();

			const eventData = await EventModel.findOne({ url: req.params['slug'] }, 'name url signups')
				.populate('signups.user', 'fname lname email cid')
				.exec();
			if (!eventData) {
				throwNotFoundException('Event Not Found');
			}

			eventData.signups.forEach(async (signup: IEventSignup) => {
				const user = signup.user as IUser;
				if (user.email) {
					sendMail({
						to: user.email,
						subject: `Position Assignments for ${eventData.name} | Chicago ARTCC`,
						template: 'event',
						context: {
							eventTitle: eventData.name,
							name: `${user.name}`,
							slug: eventData.url,
						},
					});
				}
			});

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b notified controllers of positions for the event *${eventData.name}*.`,
				actionType: ACTION_TYPE.NOTIFY_EVENT,
			});

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

router.put(
	'/:slug/close',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.params['slug'] || req.params['slug'] === 'undefined') {
				throwBadRequestException('Invalid event slug');
			}

			if (!req.body || req.body.open === undefined) {
				throwBadRequestException('Body required');
			}

			const event = await EventModel.updateOne(
				{ url: req.params['slug'] },
				{
					$set: {
						open: !!req.body.open,
					},
				},
			).exec();

			await clearCachePrefix('event');

			if (!event) {
				throwNotFoundException('Event Not Found');
			}

			return res.status(status.OK).json();
		} catch (e) {
			return next(e);
		}
	},
);

export default router;

function trimText(text: string, length: number) {
	if (text.length < length) return text;

	return `${text.slice(0, length - 4)} ...`;
}
