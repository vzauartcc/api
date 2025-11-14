import type { Progress } from '@aws-sdk/lib-storage';
import { captureException } from '@sentry/node';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { fileTypeFromFile } from 'file-type';
import * as fs from 'fs';
import multer from 'multer';
import { getCacheInstance } from '../../app.js';
import { sendMail } from '../../helpers/mailer.js';
import { deleteFromS3, setUploadStatus, uploadToS3 } from '../../helpers/s3.js';
import { isEventsTeam } from '../../middleware/auth.js';
import getUser from '../../middleware/user.js';
import { DossierModel } from '../../models/dossier.js';
import EventModel from '../../models/event.js';
import type { IEventPosition, IEventPositionData } from '../../models/eventPosition.js';
import type { IEventSignup } from '../../models/eventSignup.js';
import { UserModel, type IUser } from '../../models/user.js';
import status from '../../types/status.js';
import staffingRequestRouter from './staffingrequest.js';

const router = Router();

const upload = multer({
	storage: multer.diskStorage({
		destination: (_req, _file, cb) => {
			cb(null, '/tmp');
		},
		filename: (_req, file, cb) => {
			cb(null, `${Date.now()}-${file.originalname}`);
		},
	}),
	limits: {
		fileSize: 30 * 1024 * 1024, // 30MiB
	},
});

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
		if (!(e as any).code) {
			captureException(e);
		}
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
			.cache('10 minutes', 'event-archive')
			.exec();

		return res.status(status.OK).json({ amount: count, events });
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
	try {
		const event = await EventModel.findOne({
			url: req.params['slug'],
			deleted: false,
		})
			.lean()
			.cache('10 minute', `event-${req.params['slug']}`)
			.exec();

		return res.status(status.OK).json(event);
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});
//#region Position Signups
router.get('/:slug/positions', async (req: Request, res: Response, next: NextFunction) => {
	try {
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
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.patch('/:slug/signup', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
		if (req.body.requests.length > 3) {
			throw {
				code: status.BAD_REQUEST,
				message: 'You may only give 3 preferred positions',
			};
		}

		if (req.user.member === false) {
			throw {
				code: status.FORBIDDEN,
				message: 'You must be a member of ZAU',
			};
		}

		for (const r of req.body.requests) {
			if (
				(/^([A-Z]{2,3})(_([A-Z,0-9]{1,3}))?_(DEL|GND|TWR|APP|DEP|CTR)$/.test(r) ||
					r.toLowerCase() === 'any') === false
			) {
				throw {
					code: status.BAD_REQUEST,
					message: "Request must be a valid callsign or 'Any'",
				};
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
			throw {
				code: status.NOT_FOUND,
				message: 'Event not found',
			};
		}

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b signed up for the event *${event.name}*.`,
		});

		return res.status(status.OK).json();
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.delete('/:slug/signup', getUser, async (req: Request, res: Response, next: NextFunction) => {
	try {
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
			throw {
				code: status.NOT_FOUND,
				message: 'Event not found',
			};
		}

		await DossierModel.create({
			by: req.user.cid,
			affected: -1,
			action: `%b deleted their signup for the event *${event.name}*.`,
		});

		return res.status(status.NO_CONTENT).json();
	} catch (e) {
		if (!(e as any).code) {
			captureException(e);
		}
		return next(e);
	}
});

router.delete(
	'/:slug/mandelete/:cid',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
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
				throw {
					code: status.NOT_FOUND,
					message: 'Signup not found',
				};
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
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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
			const user = await UserModel.findOne({ cid: req.params['cid'] })
				.cache('1 minute', `user-${req.params['cid']}`)
				.exec();
			if (!user) {
				throw {
					code: status.NOT_FOUND,
					message: 'Controller not found',
				};
			}

			const event = await EventModel.findOne({ url: req.params['slug'] })
				.cache('1 minute', `event-${req.params['slug']}`)
				.exec();

			if (!event) {
				throw {
					code: status.NOT_FOUND,
					message: 'Event not found',
				};
			}

			const isAlreadySignedUp = event.signups.some(
				(signup: IEventSignup) => signup.cid.toString() === req.params['cid'],
			);

			if (isAlreadySignedUp) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Controller is already signed up for this event',
				};
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
			});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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
				throw {
					code: status.NOT_FOUND,
					message: 'Event Not Found.',
				};
			}

			const assignedPosition = eventData.positions.find(
				(pos: IEventPosition) => pos.id === position,
			);

			if (!assignedPosition) {
				throw {
					code: status.INTERNAL_SERVER_ERROR,
					message: 'Internal Server Error',
				};
			}

			if (cid) {
				await DossierModel.create({
					by: req.user.cid,
					affected: cid,
					action: `%b assigned %a to *${assignedPosition.pos}* for *${eventData.name}*.`,
				});
			} else {
				await DossierModel.create({
					by: req.user.cid,
					affected: -1,
					action: `%b unassigned *${assignedPosition.pos}* for *${eventData.name}*.`,
				});
			}

			return res.status(status.OK).json(assignedPosition);
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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
				throw {
					code: status.NOT_FOUND,
					message: 'Event not found',
				};
			}

			const positions = eventData.positions;
			const positionFields = await Promise.all(
				positions.map(async (position: IEventPosition) => {
					if (typeof position.takenBy === 'undefined' || position.takenBy === null) {
						return {
							name: position.pos,
							value: 'Open',
							inline: true,
						};
					} else {
						try {
							const res1 = await UserModel.findOne({ cid: position.takenBy })
								.lean()
								.cache('10 minutes', `user-${position.takenBy}`)
								.exec();
							if (!res1) {
								throw {
									code: status.INTERNAL_SERVER_ERROR,
									message: 'Internal Server Error',
								};
							}

							const name = res1.fname + ' ' + res1.lname;
							return {
								name: position.pos,
								value: name,
								inline: true,
							};
						} catch (err) {
							console.log(err);
							return {
								name: position.pos,
								value: 'Unknown (Server Error)',
								inline: true,
							};
						}
					}
				}),
			);

			const fieldsChunked = chunkArray(positionFields, 25); // Chunk into arrays of 25 fields

			const params = {
				username: 'WATSN',
				avatar_url:
					'https://cdn.discordapp.com/avatars/1011884072479502406/feac626c2bdf43bfa8337cd3165e5a92.png?size=1024',
				content: '',
				embeds: [
					{
						title: eventData.name,
						description: eventData.description,
						color: 2003199,
						footer:
							fieldsChunked.length > 1
								? undefined
								: { text: 'Position information provided by WATSN' },
						fields: fieldsChunked[0],
						url: 'https://www.zauartcc.org/events/' + eventData.url,
						image:
							fieldsChunked.length > 1
								? undefined
								: {
										url:
											`https://zauartcc.sfo3.digitaloceanspaces.com/${process.env['S3_FOLDER_PREFIX']}/events/` +
											eventData.bannerUrl,
									},
					},
				],
			};

			if (fieldsChunked.length > 1) {
				// Second Embed if there are more than 25 fields
				const secondEmbed = {
					title: eventData.name,
					description: '',
					color: 2003199,
					url: `https://www.zauartcc.org/events/${eventData.url}`,
					fields: fieldsChunked[1],
					image: {
						url:
							`https://zauartcc.sfo3.digitaloceanspaces.com/${process.env['S3_FOLDER_PREFIX']}/events/` +
							eventData.bannerUrl,
					},
					footer: { text: 'Position information provided by WATSN' },
				};
				if (secondEmbed) {
					params.embeds.push(secondEmbed);
				}
			}

			const webhookUrl =
				eventData.discordId === undefined
					? process.env['DISCORD_WEBHOOK']
					: process.env['DISCORD_WEBHOOK'] + `/messages/${eventData.discordId}`;

			if (!webhookUrl) {
				throw {
					code: status.INTERNAL_SERVER_ERROR,
					message: 'Internal Server Error',
				};
			}

			fetch(webhookUrl, {
				method: 'POST',
				headers: {
					'Content-type': 'application/json',
				},
				body: JSON.stringify(params),
			})
				.then((res2) => res2.json())
				.then(async (data) => {
					let url = eventData.url;
					let messageId = (data as { id: string }).id;
					if (messageId !== undefined) {
						await EventModel.findOneAndUpdate(
							{ url: url },
							{ $set: { discordId: String(messageId) } },
							{ returnOriginal: false },
						).exec();
					} else {
						return res
							.status(status.NOT_FOUND)
							.json({ message: 'Event could not be sent', status: status.NOT_FOUND });
					}
					return res
						.status(status.OK)
						.json({ message: 'Event sent successfully', status: status.OK });
				})
				.catch((error) => {
					console.log(error);
				});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.post(
	'/',
	getUser,
	isEventsTeam,
	upload.single('banner'),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (!req.file?.path) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Path missing',
				};
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
			const fileType = await fileTypeFromFile(req.file.path);

			if (fileType === undefined || !allowedTypes.includes(fileType.mime)) {
				throw {
					code: status.BAD_REQUEST,
					message: 'Banner type not supported',
				};
			}

			setUploadStatus(req.body.uploadId, 0);

			res.status(status.ACCEPTED).json();

			const filePath = req.file.path;
			let fileStream: fs.ReadStream | undefined;

			try {
				fileStream = fs.createReadStream(filePath);

				await uploadToS3(
					`events/${req.file.filename}`,
					fileStream,
					req.file.mimetype,
					{
						ContentDisposition: 'inline',
					},
					(progress: Progress) => {
						const total = progress.total || 0;
						const percent = total > 0 ? Math.round(((progress.loaded || 0) / total) * 100) : 0;
						setUploadStatus(req.body.uploadId, percent);
					},
				);
			} catch (e) {
				captureException(e);

				setUploadStatus(req.body.uploadId, -1);

				throw {
					code: status.INTERNAL_SERVER_ERROR,
					message: 'Error streaming file to storage',
				};
			} finally {
				try {
					fileStream?.close();
					fs.unlinkSync(filePath);
				} catch (_err) {
					// Do nothing, we don't care about this error
				}
			}

			await EventModel.create({
				name: req.body.name,
				description: req.body.description,
				url: url,
				bannerUrl: req.file.filename,
				eventStart: req.body.startTime,
				eventEnd: req.body.endTime,
				createdBy: req.user.cid,
				open: true,
				submitted: false,
			});

			getCacheInstance().clear('events');

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b created the event *${req.body.name}*.`,
			});

			return res.status(status.CREATED).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

router.put(
	'/:slug',
	getUser,
	isEventsTeam,
	upload.single('banner'),
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const eventData = await EventModel.findOne({ url: req.params['slug'] })
				.cache('1 minute', `event-${req.params['slug']}`)
				.exec();
			if (!eventData) {
				throw {
					code: status.NOT_FOUND,
					message: 'Event not found',
				};
			}

			const { name, description, startTime, endTime, positions } = req.body;
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

			const computedPositions: IEventPositionData[] = [];

			for (const pos of JSON.parse(positions)) {
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

			if (req.file) {
				const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png', 'image/gif'];
				const fileType = await fileTypeFromFile(req.file.path);
				if (fileType === undefined || !allowedTypes.includes(fileType.mime)) {
					throw {
						code: status.BAD_REQUEST,
						message: 'File type not supported',
					};
				}

				if (eventData.bannerUrl) {
					deleteFromS3(`events/${eventData.bannerUrl}`);
				}

				setUploadStatus(req.body.uploadId, 0);

				res.status(status.ACCEPTED).json();

				const filePath = req.file.path;
				let fileStream: fs.ReadStream | undefined;

				try {
					fileStream = fs.createReadStream(filePath);

					await uploadToS3(
						`events/${req.file.filename}`,
						fileStream,
						req.file.mimetype,
						{
							ContentDisposition: 'inline',
						},
						(progress: Progress) => {
							const total = progress.total || 0;
							const percent = total > 0 ? Math.round(((progress.loaded || 0) / total) * 100) : 0;
							setUploadStatus(req.body.uploadId, percent);
						},
					);
				} catch (e) {
					captureException(e);

					setUploadStatus(req.body.uploadId, -1);

					throw {
						code: status.INTERNAL_SERVER_ERROR,
						message: 'Error streaming file to storage',
					};
				} finally {
					try {
						fileStream?.close();
						fs.unlinkSync(filePath);
					} catch (_err) {
						// Do nothing, we don't care about this error
					}
				}

				eventData.bannerUrl = req.file.filename;
			}

			await eventData.save();
			await getCacheInstance().clear(`event-${req.params['slug']}`);
			await getCacheInstance().clear(`event-positions-${req.params['slug']}`);

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b updated the event *${eventData.name}*.`,
			});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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
			const deleteEvent = await EventModel.findOne({ url: req.params['slug'] })
				.cache('1 minute', `event-${req.params['slug']}`)
				.exec();

			if (!deleteEvent) {
				throw {
					code: status.NOT_FOUND,
					message: 'Event not found',
				};
			}

			// 🚨 **Delete Banner from S3 If It Exists**
			if (deleteEvent.bannerUrl) {
				deleteFromS3(`events/${deleteEvent.bannerUrl}`);
			}

			await deleteEvent.delete();
			await getCacheInstance().clear(`event-${req.params['slug']}`);
			await getCacheInstance().clear(`event-positions-${req.params['slug']}`);
			await getCacheInstance().clear(`events`);

			await DossierModel.create({
				by: req.user.cid,
				affected: -1,
				action: `%b deleted the event *${deleteEvent.name}*.`,
			});

			return res.status(status.NO_CONTENT).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

// router.put('/:slug/assign', getUser, isEventsTeam, async (req: Request, res: Response) => {
// 	try {
// 		const event = await Event.findOneAndUpdate({url: req.params.slug}, {
// 			$set: {
// 				positions: req.body.assignment
// 			}
// 		});

// 		await DossierModel.create({
// 			by: req.user.cid,
// 			affected: -1,
// 			action: `%b updated the positions assignments for the event *${event.name}*.`
// 		});
// 	} catch (e) {
// 		res.stdRes.ret_det = convertToReturnDetails(e);
// 		captureException(e);
// 	} finally {
// 		return res.json(res.stdRes);
// }
// });

router.patch(
	'/:slug/notify',
	getUser,
	isEventsTeam,
	async (req: Request, res: Response, next: NextFunction) => {
		try {
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
				throw {
					code: status.NOT_FOUND,
					message: 'Event Not Found',
				};
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
			});

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
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
			const event = await EventModel.updateOne(
				{ url: req.params['slug'] },
				{
					$set: {
						open: false,
					},
				},
			).exec();

			await getCacheInstance().clear(`event-${req.params['slug']}`);
			await getCacheInstance().clear(`event-positions-${req.params['slug']}`);

			if (!event) {
				throw {
					code: status.NOT_FOUND,
					message: 'Event not found',
				};
			}

			return res.status(status.OK).json();
		} catch (e) {
			if (!(e as any).code) {
				captureException(e);
			}
			return next(e);
		}
	},
);

export default router;

function chunkArray(arr: string | any[], chunkSize: number) {
	const chunkedArr = [];
	let index = 0;
	while (index < arr.length) {
		chunkedArr.push(arr.slice(index, index + chunkSize));
		index += chunkSize;
	}
	return chunkedArr;
}
