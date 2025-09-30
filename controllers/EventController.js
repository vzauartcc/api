import e from 'express';
import transporter from '../config/mailer.js';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import fs from 'fs/promises';
const router = e.Router();
import Event from '../models/Event.js';
import User from '../models/User.js';
import getUser from '../middleware/getUser.js';
import auth from '../middleware/auth.js';
import StaffingRequest from '../models/StaffingRequest.js';
import fetch from 'node-fetch';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const upload = multer({
	storage: multer.diskStorage({
		destination: (req, file, cb) => {
			cb(null, '/tmp');
		},
		filename: (req, file, cb) => {
			cb(null, `${Date.now()}-${file.originalname}`);
		},
	}),
});

router.get('/', async ({ res }) => {
	try {
		const events = await Event.find({
			eventEnd: {
				$gt: new Date(new Date().toUTCString()), // event starts in the future
			},
			deleted: false,
		})
			.sort({ eventStart: 'asc' })
			.lean();

		res.stdRes.data = events;
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/archive', async (req, res) => {
	try {
		const page = +req.query.page || 1;
		const limit = +req.query.limit || 10;

		const count = await Event.countDocuments({
			eventEnd: {
				$lt: new Date(new Date().toUTCString()),
			},
			deleted: false,
		});
		const events = await Event.find({
			eventEnd: {
				$lt: new Date(new Date().toUTCString()),
			},
			deleted: false,
		})
			.skip(limit * (page - 1))
			.limit(limit)
			.sort({ eventStart: 'desc' })
			.lean();

		res.stdRes.data = {
			amount: count,
			events: events,
		};
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/staffingRequest', async (req, res) => {
	try {
		const page = +req.query.page || 1;
		const limit = +req.query.limit || 10;

		const count = await StaffingRequest.countDocuments({ deleted: false });
		let requests = [];

		if (count > 0) {
			requests = await StaffingRequest.find({ deleted: false })
				.skip(limit * (page - 1))
				.limit(limit)
				.sort({ date: 'desc' })
				.lean();
		}
		return res.status(200).json({
			ret_det: { code: 200, message: '' },
			data: {
				amount: count,
				requests: requests,
			},
		});
	} catch (e) {
		console.error(e);
		return res
			.status(500)
			.json({
				ret_det: { code: 500, message: 'An error occurred while retrieving staffing requests' },
			});
	}
});

router.get('/staffingRequest/:id', async (req, res) => {
	try {
		const staffingRequest = await StaffingRequest.findById(req.params.id);

		if (!staffingRequest) {
			return res.status(404).json({ error: 'Staffing request not found' });
		}

		return res.status(200).json({ staffingRequest });
	} catch (e) {
		console.error(e);
		return res
			.status(500)
			.json({ error: 'An error occurred while retrieving the staffing request' });
	}
});

router.get('/:slug', async (req, res) => {
	try {
		const event = await Event.findOne({
			url: req.params.slug,
			deleted: false,
		}).lean();

		res.stdRes.data = event;
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/:slug/positions', async (req, res) => {
	try {
		const event = await Event.findOne({
			url: req.params.slug,
			deleted: false,
		})
			.sort({
				'positions.order': -1,
			})
			.select('open submitted eventStart positions signups name')
			.populate('positions.user', 'cid fname lname roleCodes')
			.populate('signups.user', 'fname lname cid vis rating certCodes')
			.lean({ virtuals: true })
			.catch(console.error);

		res.stdRes.data = event;
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.put('/:slug/signup', getUser, async (req, res) => {
	try {
		if (req.body.requests.length > 3) {
			throw {
				code: 400,
				message: 'You may only give 3 preferred positions',
			};
		}

		if (res.user.member === false) {
			throw {
				code: 403,
				message: 'You must be a member of ZAU',
			};
		}

		for (const r of req.body.requests) {
			if (
				(/^([A-Z]{2,3})(_([A-Z,0-9]{1,3}))?_(DEL|GND|TWR|APP|DEP|CTR)$/.test(r) ||
					r.toLowerCase() === 'any') === false
			) {
				throw {
					code: 400,
					message: "Request must be a valid callsign or 'Any'",
				};
			}
		}

		const event = await Event.findOneAndUpdate(
			{ url: req.params.slug },
			{
				$push: {
					signups: {
						cid: res.user.cid,
						requests: req.body.requests,
					},
				},
			},
		);

		await req.app.dossier.create({
			by: res.user.cid,
			affected: -1,
			action: `%b signed up for the event *${event.name}*.`,
		});
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.delete('/:slug/signup', getUser, async (req, res) => {
	try {
		const event = await Event.findOneAndUpdate(
			{ url: req.params.slug },
			{
				$pull: {
					signups: {
						cid: res.user.cid,
					},
				},
			},
		);

		await req.app.dossier.create({
			by: res.user.cid,
			affected: -1,
			action: `%b deleted their signup for the event *${event.name}*.`,
		});
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.delete(
	'/:slug/mandelete/:cid',
	getUser,
	auth(['atm', 'datm', 'ec', 'wm']),
	async (req, res) => {
		try {
			const signup = await Event.findOneAndUpdate(
				{ url: req.params.slug },
				{
					$pull: {
						signups: {
							cid: req.params.cid,
						},
					},
				},
			);

			for (const position of signup.positions) {
				if (position.takenBy === res.user.cid) {
					await Event.findOneAndUpdate(
						{ url: req.params.slug, 'positions.takenBy': res.user.cid },
						{
							$set: {
								'positions.$.takenBy': null,
							},
						},
					);
				}
			}

			await req.app.dossier.create({
				by: res.user.cid,
				affected: req.params.cid,
				action: `%b manually deleted the event signup for %a for the event *${signup.name}*.`,
			});
		} catch (e) {
			req.app.Sentry.captureException(e);
			res.stdRes.ret_det = e;
		}

		return res.json(res.stdRes);
	},
);

router.put(
	'/:slug/mansignup/:cid',
	getUser,
	auth(['atm', 'datm', 'ec', 'wm']),
	async (req, res) => {
		try {
			const user = await User.findOne({ cid: req.params.cid });
			if (!user) {
				throw {
					code: 400,
					message: 'Controller not found',
				};
			}

			const event = await Event.findOne({ url: req.params.slug });

			if (!event) {
				console.log('❌ Event not found in the database');
				throw {
					code: 404,
					message: 'Event not found',
				};
			}

			const isAlreadySignedUp = event.signups.some(
				(signup) => signup.cid.toString() === req.params.cid,
			);

			if (isAlreadySignedUp) {
				throw {
					code: 400,
					message: 'Controller is already signed up for this event',
				};
			}

			// If not already signed up, proceed with adding
			await Event.findOneAndUpdate(
				{ url: req.params.slug },
				{
					$push: {
						signups: {
							cid: req.params.cid,
						},
					},
				},
			);

			await req.app.dossier.create({
				by: res.user.cid,
				affected: req.params.cid,
				action: `%b manually signed up %a for the event *${event.name}*.`,
			});

			res.stdRes.ret_det = {
				code: 200,
				message: 'Controller successfully signed up',
			};
		} catch (e) {
			req.app.Sentry.captureException(e);
			res.stdRes.ret_det = e;
		}

		return res.json(res.stdRes);
	},
);

router.post('/sendEvent', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
	try {
		const url = req.body.url;
		const eventData = await Event.findOne({ url: url });
		const positions = eventData.positions;
		const positionFields = await Promise.all(
			positions.map(async (position) => {
				if (typeof position.takenBy === 'undefined' || position.takenBy === null) {
					return {
						name: position.pos,
						value: 'Open',
						inline: true,
					};
				} else {
					try {
						const res1 = await User.findOne({ cid: position.takenBy });
						const name = res1.fname + ' ' + res1.lname;
						return {
							name: position.pos,
							value: name,
							inline: true,
						};
					} catch (err) {
						console.log(err);
					}
				}
			}),
		);

		const fieldsChunked = chunkArray(positionFields, 25); // Chunk into arrays of 25 fields
		function chunkArray(arr, chunkSize) {
			const chunkedArr = [];
			let index = 0;
			while (index < arr.length) {
				chunkedArr.push(arr.slice(index, index + chunkSize));
				index += chunkSize;
			}
			return chunkedArr;
		}
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
										`https://zauartcc.sfo3.digitaloceanspaces.com/${process.env.S3_FOLDER_PREFIX}/events/` +
										eventData.bannerUrl,
								},
				},
			],
		};

		if (fieldsChunked.length > 1) {
			// Second Embed if there are more than 25 fields
			const secondEmbed = {
				color: 2003199,
				fields: fieldsChunked[1],
				image: {
					url:
						`https://zauartcc.sfo3.digitaloceanspaces.com/${process.env.S3_FOLDER_PREFIX}/events/` +
						eventData.bannerUrl,
				},
				footer: { text: 'Position information provided by WATSN' },
			};
			params.embeds.push(secondEmbed);
		}

		const webhookUrl =
			eventData.discordId === undefined
				? process.env.DISCORD_WEBHOOK
				: process.env.DISCORD_WEBHOOK + `/messages/${eventData.discordId}`;

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
				let messageId = data.id;
				if (messageId !== undefined) {
					await Event.findOneAndUpdate(
						{ url: url },
						{ $set: { discordId: String(messageId) } },
						{ returnOriginal: false },
					);
				} else {
					return res.status(404).json({ message: 'Event could not be sent', status: 404 });
				}
				return res.status(200).json({ message: 'Event sent successfully', status: 200 });
			})
			.catch((error) => {
				console.log(error);
			});
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}
});

router.post(
	'/',
	getUser,
	auth(['atm', 'datm', 'ec', 'wm']),
	upload.single('banner'),
	async (req, res) => {
		try {
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
					code: 400,
					message: 'Banner type not supported',
				};
			}
			if (req.file.size > 10 * 10240 * 10240) {
				// 10MiB
				throw {
					code: 400,
					message: 'Banner too large',
				};
			}

			const tmpFile = await fs.readFile(req.file.path);

			await req.app.s3.send(
				new PutObjectCommand({
					Bucket: req.app.s3.defaultBucket,
					Key: `${req.app.s3.folderPrefix}/events/${req.file.filename}`,
					Body: tmpFile,
					ContentType: req.file.mimetype,
					ACL: 'public-read',
					ContentDisposition: 'inline',
				}),
			);

			await Event.create({
				name: req.body.name,
				description: req.body.description,
				url: url,
				bannerUrl: req.file.filename,
				eventStart: req.body.startTime,
				eventEnd: req.body.endTime,
				createdBy: res.user.cid,
				open: true,
				submitted: false,
			});

			await req.app.dossier.create({
				by: res.user.cid,
				affected: -1,
				action: `%b created the event *${req.body.name}*.`,
			});
		} catch (e) {
			req.app.Sentry.captureException(e);
			res.stdRes.ret_det = e;
		}
		return res.json(res.stdRes);
	},
);

router.put(
	'/:slug',
	getUser,
	auth(['atm', 'datm', 'ec', 'wm']),
	upload.single('banner'),
	async (req, res) => {
		try {
			const event = await Event.findOne({ url: req.params.slug });
			const { name, description, startTime, endTime, positions } = req.body;
			if (event.name !== name) {
				event.name = name;
				event.url =
					name
						.replace(/\s+/g, '-')
						.toLowerCase()
						.replace(/^-+|-+(?=-|$)/g, '')
						.replace(/[^a-zA-Z0-9-_]/g, '') +
					'-' +
					Date.now().toString().slice(-5);
			}
			event.description = description;
			event.eventStart = startTime;
			event.eventEnd = endTime;

			const computedPositions = [];

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

			if (event.positions.length > 0) {
				const newPositions = [];

				for (let position of computedPositions) {
					newPositions.push(position);
					for (let i = 0; i < event.positions.length; i++) {
						if (event.positions[i].pos === position.pos) {
							if (event.positions[i].takenBy) {
								console.log(event.positions[i].takenBy);
								const j = newPositions.indexOf(position);
								newPositions[j].takenBy = event.positions[i].takenBy;
							}
						}
					}
				}

				event.positions = newPositions;
			} else {
				event.positions = computedPositions;
			}

			if (req.file) {
				const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png', 'image/gif'];
				const fileType = await fileTypeFromFile(req.file.path);
				if (fileType === undefined || !allowedTypes.includes(fileType.mime)) {
					throw {
						code: 400,
						message: 'File type not supported',
					};
				}
				if (req.file.size > 30 * 10240 * 10240) {
					// 30MiB
					throw {
						code: 400,
						message: 'File too large',
					};
				}

				// 🚨 **Delete Old Banner from S3**
				if (event.bannerUrl) {
					console.log(`🗑️ Deleting old banner: ${event.bannerUrl}`);
					await req.app.s3.send(
						new DeleteObjectCommand({
							Bucket: req.app.s3.defaultBucket,
							Key: `${req.app.s3.folderPrefix}/events/${event.bannerUrl}`,
						}),
					);
				}

				const tmpFile = await fs.readFile(req.file.path);
				await req.app.s3.send(
					new PutObjectCommand({
						Bucket: req.app.s3.defaultBucket,
						Key: `${req.app.s3.folderPrefix}/events/${req.file.filename}`,
						Body: tmpFile,
						ContentType: req.file.mimetype,
						ACL: 'public-read',
						ContentDisposition: 'inline',
					}),
				);

				event.bannerUrl = req.file.filename;
			}

			await event.save();

			await req.app.dossier.create({
				by: res.user.cid,
				affected: -1,
				action: `%b updated the event *${event.name}*.`,
			});
		} catch (e) {
			req.app.Sentry.captureException(e);
			res.stdRes.ret_det = e;
		}

		return res.json(res.stdRes);
	},
);

router.delete('/:slug', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
	try {
		const deleteEvent = await Event.findOne({ url: req.params.slug });

		if (!deleteEvent) {
			return res.status(404).json({ error: 'Event not found' });
		}

		// 🚨 **Delete Banner from S3 If It Exists**
		if (deleteEvent.bannerUrl) {
			console.log(`🗑️ Deleting banner from S3: ${deleteEvent.bannerUrl}`);
			await req.app.s3.send(
				new DeleteObjectCommand({
					Bucket: req.app.s3.defaultBucket,
					Key: `${req.app.s3.folderPrefix}/events/${deleteEvent.bannerUrl}`,
				}),
			);
		}

		// Delete the event from the database
		await deleteEvent.delete();

		await req.app.dossier.create({
			by: res.user.cid,
			affected: -1,
			action: `%b deleted the event *${deleteEvent.name}*.`,
		});
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

// router.put('/:slug/assign', getUser, auth(['atm', 'datm', 'ec']), async (req, res) => {
// 	try {
// 		const event = await Event.findOneAndUpdate({url: req.params.slug}, {
// 			$set: {
// 				positions: req.body.assignment
// 			}
// 		});

// 		await req.app.dossier.create({
// 			by: res.user.cid,
// 			affected: -1,
// 			action: `%b updated the positions assignments for the event *${event.name}*.`
// 		});
// 	} catch (e) {
// 		req.app.Sentry.captureException(e);
// 		res.stdRes.ret_det = e;
// 	}

// 	return res.json(res.stdRes);
// });

router.put('/:slug/assign', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
	try {
		const { position, cid } = req.body;

		const event = await Event.findOneAndUpdate(
			{ url: req.params.slug, 'positions._id': position },
			{
				$set: {
					'positions.$.takenBy': cid || null,
				},
			},
		);

		const [assignedPosition] = event.positions.filter((pos) => pos._id == position);

		if (cid) {
			await req.app.dossier.create({
				by: res.user.cid,
				affected: cid,
				action: `%b assigned %a to *${assignedPosition.pos}* for *${event.name}*.`,
			});
		} else {
			await req.app.dossier.create({
				by: res.user.cid,
				affected: -1,
				action: `%b unassigned *${assignedPosition.pos}* for *${event.name}*.`,
			});
		}

		res.stdRes.data = assignedPosition;
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.put('/:slug/notify', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
	try {
		await Event.updateOne(
			{ url: req.params.slug },
			{
				$set: {
					positions: req.body.assignment,
					submitted: true,
				},
			},
		);

		const getSignups = await Event.findOne({ url: req.params.slug }, 'name url signups')
			.populate('signups.user', 'fname lname email cid')
			.lean();
		getSignups.signups.forEach(async (signup) => {
			await transporter.sendMail({
				to: signup.user.email,
				from: {
					name: 'Chicago ARTCC',
					address: 'no-reply@zauartcc.org',
				},
				subject: `Position Assignments for ${getSignups.name} | Chicago ARTCC`,
				template: 'event',
				context: {
					eventTitle: getSignups.name,
					name: `${signup.user.fname} ${signup.user.lname}`,
					slug: getSignups.url,
				},
			});
		});

		await req.app.dossier.create({
			by: res.user.cid,
			affected: -1,
			action: `%b notified controllers of positions for the event *${getSignups.name}*.`,
		});
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.put('/:slug/close', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
	try {
		await Event.updateOne(
			{ url: req.params.slug },
			{
				$set: {
					open: false,
				},
			},
		);
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.post('/staffingRequest', async (req, res) => {
	// Submit staffing request
	try {
		if (
			!req.body.vaName ||
			!req.body.name ||
			!req.body.email ||
			!req.body.date ||
			!req.body.pilots ||
			!req.body.route ||
			!req.body.description
		) {
			// Validation
			throw {
				code: 400,
				message: 'You must fill out all required fields',
			};
		}

		if (isNaN(req.body.pilots)) {
			throw {
				code: 400,
				message: 'Pilots must be a number',
			};
		}

		const count = await StaffingRequest.countDocuments({
			accepted: false,
			name: req.body.name,
			email: req.body.email,
		});

		console.log(count);
		if (count >= 3) {
			throw {
				code: 400,
				message: 'You have reached the maximum limit of staffing requests with a pending status.',
			};
		}

		const newRequest = await StaffingRequest.create({
			vaName: req.body.vaName,
			name: req.body.name,
			email: req.body.email,
			date: req.body.date,
			pilots: req.body.pilots,
			route: req.body.route,
			description: req.body.description,
			accepted: false,
		});

		const newRequestID = newRequest._id; // Access the new object's ID

		// Send an email notification to the specified email address
		await transporter.sendMail({
			to: 'ec@zauartcc.org, aec@zauartcc.org',
			from: {
				name: 'Chicago ARTCC',
				address: 'no-reply@zauartcc.org',
			},
			subject: `New Staffing Request from ${req.body.vaName} | Chicago ARTCC`,
			template: `staffingRequest`,
			context: {
				vaName: req.body.vaName,
				name: req.body.name,
				email: req.body.email,
				date: req.body.date,
				pilots: req.body.pilots,
				route: req.body.route,
				description: req.body.description,
				slug: newRequestID,
			},
		});

		// Send a response to the client
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.put('/staffingRequest/:id/accept', async (req, res) => {
	try {
		const staffingRequest = await StaffingRequest.findById(req.params.id);

		if (!staffingRequest) {
			return res
				.status(404)
				.json({ ret_det: { code: 404, message: 'Staffing request not found' } });
		}

		staffingRequest.accepted = req.body.accepted;

		await staffingRequest.save();

		return res
			.status(200)
			.json({ ret_det: { code: 200, message: 'Staffing request updated successfully' } });
	} catch (e) {
		console.error(e);
		return res
			.status(500)
			.json({
				ret_det: { code: 500, message: 'An error occurred while updating the staffing request' },
			});
	}
});

router.put('/staffingRequest/:id', async (req, res) => {
	try {
		const staffingRequest = await StaffingRequest.findById(req.params.id);

		if (!staffingRequest) {
			return res
				.status(404)
				.json({ ret_det: { code: 404, message: 'Staffing request not found' } });
		}

		staffingRequest.vaName = req.body.vaName;
		staffingRequest.name = req.body.name;
		staffingRequest.email = req.body.email;
		staffingRequest.date = req.body.date;
		staffingRequest.pilots = req.body.pilots;
		staffingRequest.route = req.body.route;
		staffingRequest.description = req.body.description;
		staffingRequest.accepted = req.body.accepted;

		await staffingRequest.save();

		if (req.body.accepted) {
			// Send an email notification to the specified email address
			await transporter.sendMail({
				to: req.body.email,
				from: {
					name: 'Chicago ARTCC',
					address: 'no-reply@zauartcc.org',
				},
				subject: `Staffing Request for ${req.body.vaName} accepted | Chicago ARTCC`,
				template: `staffingRequestAccepted`,
				context: {
					vaName: req.body.vaName,
					name: req.body.name,
					email: req.body.email,
					date: req.body.date,
					pilots: req.body.pilots,
					route: req.body.route,
					description: req.body.description,
				},
			});

			await req.app.dossier.create({
				by: res.user.cid,
				affected: -1,
				action: `%b approved a staffing request for ${req.body.vaName}.`,
			});
		}

		return res
			.status(200)
			.json({ ret_det: { code: 200, message: 'Staffing request updated successfully' } });
	} catch (e) {
		console.error(e);
		return res
			.status(500)
			.json({
				ret_det: { code: 500, message: 'An error occurred while updating the staffing request' },
			});
	}
});

router.delete(
	'/staffingRequest/:id',
	getUser,
	auth(['atm', 'datm', 'ec', 'wm']),
	async (req, res) => {
		try {
			const staffingRequest = await StaffingRequest.findById(req.params.id);

			if (!staffingRequest) {
				return res
					.status(404)
					.json({ ret_det: { code: 404, message: 'Staffing request not found' } });
			}

			await staffingRequest.delete(); // Soft-delete the staffing request using the mongoose-delete plugin

			return res
				.status(200)
				.json({ ret_det: { code: 200, message: 'Staffing request deleted successfully' } });
		} catch (e) {
			console.error(e);
			return res
				.status(500)
				.json({
					ret_det: { code: 500, message: 'An error occurred while deleting the staffing request' },
				});
		}
	},
);

export default router;
