import e from 'express';
import transporter from '../config/mailer.js';
import { fileTypeFromFile } from 'file-type';
import fs from 'fs/promises';
const router = e.Router();
import Event from '../models/Event.js';
import User from '../models/User.js';
import getUser from '../middleware/getUser.js';
import auth from '../middleware/auth.js';
import StaffingRequest from '../models/StaffingRequest.js'
import fetch from "node-fetch";
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import formidable from 'formidable';
import path from 'path';

router.get('/', async ({res}) => {
	try {
		const events = await Event.find({
			eventEnd: {
				$gt: new Date(new Date().toUTCString()) // event starts in the future
			},
			deleted: false
		}).sort({eventStart: "asc"}).lean();

		res.stdRes.data = events;
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/archive', async(req, res) => {
	try {
		const page = +req.query.page || 1;
		const limit = +req.query.limit || 10;

		const count = await Event.countDocuments({
			eventEnd: {
				$lt: new Date(new Date().toUTCString())
			},
			deleted: false
		});
		const events = await Event.find({
			eventEnd: {
				$lt: new Date(new Date().toUTCString())
			},
			deleted: false
		}).skip(limit * (page - 1)).limit(limit).sort({eventStart: "desc"}).lean();

		res.stdRes.data = {
			amount: count,
			events: events
		};
	} catch(e) {
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
		  requests: requests
		}
	  });
	} catch (e) {
	  console.error(e);
	  return res.status(500).json({ ret_det: { code: 500, message: 'An error occurred while retrieving staffing requests' }});
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
	  return res.status(500).json({ error: 'An error occurred while retrieving the staffing request' });
	}
});

router.get('/:slug', async(req, res) => {
	try {
		const event = await Event.findOne({
			url: req.params.slug,
			deleted: false
		}).lean();

		res.stdRes.data = event;
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.get('/:slug/positions', async(req, res) => {
	try {
		const event = await Event.findOne({
			url: req.params.slug,
			deleted: false
		}).sort({
			'positions.order': -1
		}).select(
			'open submitted eventStart positions signups name'
		).populate(
			'positions.user', 'cid fname lname roleCodes'
		).populate(
			'signups.user', 'fname lname cid vis rating certCodes'
		).lean({virtuals: true}).catch(console.error)

		res.stdRes.data = event;
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.put('/:slug/signup', getUser, async (req, res) => {
	try {
		if(req.body.requests.length > 3) {
			throw {
				code: 400,
				message: "You may only give 3 preferred positions"
			}
		}

		if(res.user.member === false) {
			throw {
				code: 403,
				message: "You must be a member of ZAU"
			}
		}

		for(const r of req.body.requests) {
			if((/^([A-Z]{2,3})(_([A-Z,0-9]{1,3}))?_(DEL|GND|TWR|APP|DEP|CTR)$/.test(r) || r.toLowerCase() === "any") === false) {
				throw {
					code: 400,
					message: "Request must be a valid callsign or 'Any'"
				}
			}
		}

		const event = await Event.findOneAndUpdate({url: req.params.slug}, {
			$push: {
				signups: {
					cid: res.user.cid,
					requests: req.body.requests
				}
			}
		});

		await req.app.dossier.create({
			by: res.user.cid,
			affected: -1,
			action: `%b signed up for the event *${event.name}*.`
		});
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.delete('/:slug/signup', getUser, async (req, res) => {
	try {
		const event = await Event.findOneAndUpdate({url: req.params.slug}, {
			$pull: {
				signups: {
					cid: res.user.cid
				}
			}
		});

		await req.app.dossier.create({
			by: res.user.cid,
			affected: -1,
			action: `%b deleted their signup for the event *${event.name}*.`
		});
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.delete('/:slug/mandelete/:cid', getUser, auth(['atm', 'datm', 'ec', 'wm']), async(req, res) => {
	try {
		const signup = await Event.findOneAndUpdate({url: req.params.slug}, {
			$pull: {
				signups: {
					cid: req.params.cid
				}
			}
		});

		for(const position of signup.positions) {
			if(position.takenBy === res.user.cid) {
				await Event.findOneAndUpdate({url: req.params.slug, 'positions.takenBy': res.user.cid}, {
					$set: {
						'positions.$.takenBy': null
					}
				});
			}
		}

		await req.app.dossier.create({
			by: res.user.cid,
			affected: req.params.cid,
			action: `%b manually deleted the event signup for %a for the event *${signup.name}*.`
		});
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.put('/:slug/mansignup/:cid', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
	try {
		const user = await User.findOne({cid: req.params.cid});
		if(user !== null) {
			const event = await Event.findOneAndUpdate({url: req.params.slug}, {
				$push: {
					signups: {
						cid: req.params.cid,
					}
				}
			});

			await req.app.dossier.create({
				by: res.user.cid,
				affected: req.params.cid,
				action: `%b manually signed up %a for the event *${event.name}*.`
			});
		} else {
			throw {
				code: 400,
				message: "Controller not found"
			};
		}
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.post('/sendEvent', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {

	try{
		const url = req.body.url
	const eventData = await Event.findOne({ url: url });
	const positions = eventData.positions;
	const positionFields = await Promise.all(positions.map(async position => {
		if (typeof position.takenBy === 'undefined' || position.takenBy === null) {
			return {
				name: position.pos,
				value: 'Open',
				inline: true
			};
		} else {
			try {
				const res1 = await User.findOne({ cid: position.takenBy });
				const name = res1.fname + ' ' + res1.lname;
				return {
					name: position.pos,
					value: name,
					inline: true
				};
			} catch (err) {
				console.log(err);
			}
		}
	}));

	const params = {
		username: "WATSN",
		avatar_url: "https://cdn.discordapp.com/avatars/1011884072479502406/feac626c2bdf43bfa8337cd3165e5a92.png?size=1024",
		content: "",
		embeds: [
			{
				title: eventData.name,
				description: eventData.description,
				color: 2003199,
				footer: { text: 'Position information provided by WATSN' },
				fields: positionFields,
				url: 'https://www.zauartcc.org/events/' + eventData.url,
				image: {
					url: `https://zauartcc.sfo3.digitaloceanspaces.com/${process.env.S3_FOLDER_PREFIX}/events/` + eventData.bannerUrl
				}
			}
		]
	};
	if(eventData.discordId === undefined) {

		fetch(process.env.DISCORD_WEBHOOK + '?wait=true', {
			method: "POST",
			headers: {
				'Content-type': 'application/json'
			},
			body: JSON.stringify(params)
		})
			.then(res2 => res2.json())
			.then(async data => {
				let url = eventData.url
				let messageId = data.id
				if (messageId !== undefined) {
					await Event.findOneAndUpdate(
						{ url: url },
						{ $set: { discordId: String(messageId) } },
						{ returnOriginal: false }
					)
				} else {
					return res.status(404).json({ message: 'Event could not be sent', status: 404 });
				}
				return res.status(200).json({ message: 'Event sent successfully', status: 200 });


			})
			.catch(error => {
				console.log(error);
			});
	}else{
		fetch(process.env.DISCORD_WEBHOOK + `/messages/${eventData.discordId}`, {
			method: "PATCH",
			headers: {
				'Content-type': 'application/json'
			},
			body: JSON.stringify(params)
		})
			.then(res => res.json())
			.then(data => {
				return res.status(201).json({ message: 'Event updated successfully', status: 201 });
			})
	}
} catch (e) {
	req.app.Sentry.captureException(e);
	res.stdRes.ret_det = e;
}

});

router.post('/', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
  const form = formidable();

  form.parse(req, async (err, fields, files) => {

    if (err) {
      console.error('Error during form parsing:', err);
      req.app.Sentry.captureException(err);
      res.stdRes.ret_det = err;
      return res.json(res.stdRes);
    }

		const name = fields.name[0];
    const description = fields.description[0];
    const startTime = fields.startTime[0];
    const endTime = fields.endTime[0];

    try {

			if (typeof name !== 'string') {
        throw new Error('Name field is not a string');
      }

      const url = name
        .replace(/\s+/g, '-')
        .toLowerCase()
        .replace(/^-+|-+(?=-|$)/g, '')
        .replace(/[^a-zA-Z0-9-_]/g, '') + '-' + Date.now().toString().slice(-5);

      const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png', 'image/gif'];
      const file = files.banner[0];

      // Log file size for debugging
      console.log('File size:', file.size);

      if (file.size > (6 * 1024 * 1024)) { // 6MiB
        throw {
          code: 400,
          message: "Banner too large"
        };
      }

      const fileType = await fileTypeFromFile(file.filepath);

      if (!fileType || !allowedTypes.includes(fileType.mime)) {
        throw {
          code: 400,
          message: "Banner type not supported"
        };
      }

      const newFilename = `${Date.now()}-${file.originalFilename}`;
      const newFilePath = path.join(path.dirname(file.filepath), newFilename);

      // Rename the file
      await fs.rename(file.filepath, newFilePath);

      const tmpFile = await fs.readFile(newFilePath);

      await req.app.s3.send(new PutObjectCommand({
        Bucket: 'zauartcc',
        Key: `${process.env.S3_FOLDER_PREFIX}/events/${newFilename}`,
        Body: tmpFile,
        ContentType: fileType.mime,
        ACL: 'public-read',
        ContentDisposition: 'inline',
      }));

      await Event.create({
        name: name,
        description: description,
        url: url,
        bannerUrl: newFilename,
        eventStart: startTime,
        eventEnd: endTime,
        createdBy: res.user.cid,
        open: true,
        submitted: false
      });

      await req.app.dossier.create({
        by: res.user.cid,
        affected: -1,
        action: `%b created the event *${fields.name}*.`
      });

      res.stdRes.data = { message: "Event created successfully" };
    } catch (e) {
      req.app.Sentry.captureException(e);
      res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
  });
});

router.put('/:slug', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
  const form = formidable();

  form.parse(req, async (err, fields, files) => {

    if (err) {
      console.error('Error during form parsing:', err);
      req.app.Sentry.captureException(err);
      res.stdRes.ret_det = err;
      return res.json(res.stdRes);
    }

    const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png', 'image/gif'];

    try {
      const event = await Event.findOne({ url: req.params.slug });
      if (!event) {
        throw new Error('Event not found');
      }

      const name = fields.name[0];
      const description = fields.description[0];
      const startTime = fields.startTime[0];
      const endTime = fields.endTime[0];
      const positions = JSON.parse(fields.positions[0]);

      if (event.name !== name) {
        event.name = name;
        event.url = name.replace(/\s+/g, '-')
                        .toLowerCase()
                        .replace(/^-+|-+(?=-|$)/g, '')
                        .replace(/[^a-zA-Z0-9-_]/g, '') + '-' + Date.now().toString().slice(-5);
      }

      event.description = description;
      event.eventStart = startTime;
      event.eventEnd = endTime;

      const computedPositions = positions.map(pos => {
        const thePos = pos.match(/^([A-Z]{3})_(?:[A-Z0-9]{1,3}_)?([A-Z]{3})$/);
        const type = thePos[2];
        const code = ['ORD'].includes(thePos[1]) ? 'ord' + type.toLowerCase() : type.toLowerCase();
        return { pos, type, code };
      });

      event.positions = event.positions.length > 0 ? event.positions.map(epos => {
        const newPos = computedPositions.find(npos => npos.pos === epos.pos);
        return newPos ? { ...newPos, takenBy: epos.takenBy } : epos;
      }) : computedPositions;

      if (files.banner) {
        const file = files.banner[0];
        console.log('New banner file:', file);

        if (file.size > (6 * 1024 * 1024)) { // 6MiB
          throw {
            code: 400,
            message: "Banner too large"
          };
        }

        const fileType = await fileTypeFromFile(file.filepath);

        if (!fileType || !allowedTypes.includes(fileType.mime)) {
          throw {
            code: 400,
            message: "File type not supported"
          };
        }

        // Remove the old banner from S3
        if (event.bannerUrl) {
          await req.app.s3.send(new DeleteObjectCommand({
            Bucket: 'zauartcc',
            Key: `${process.env.S3_FOLDER_PREFIX}/events/${event.bannerUrl}`
          }));
        }

        const newFilename = `${Date.now()}-${file.originalFilename}`;
        const newFilePath = path.join(path.dirname(file.filepath), newFilename);

        // Rename the file
        await fs.rename(file.filepath, newFilePath);

        const tmpFile = await fs.readFile(newFilePath);

        await req.app.s3.send(new PutObjectCommand({
          Bucket: 'zauartcc',
          Key: `${process.env.S3_FOLDER_PREFIX}/events/${newFilename}`,
          Body: tmpFile,
          ContentType: fileType.mime,
          ACL: 'public-read',
          ContentDisposition: 'inline',
        }));

        event.bannerUrl = newFilename;
      }

      await event.save();

      await req.app.dossier.create({
        by: res.user.cid,
        affected: -1,
        action: `%b updated the event *${event.name}*.`
      });

      res.stdRes.data = { message: "Event updated successfully" };
    } catch (e) {
      console.error('Error during event update:', e);
      req.app.Sentry.captureException(e);
      res.stdRes.ret_det = e;
    }

    return res.json(res.stdRes);
  });
});

router.delete('/:slug', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
  console.log('Incoming DELETE request to remove event');

  try {
    const deleteEvent = await Event.findOne({ url: req.params.slug });
    if (!deleteEvent) {
      throw new Error('Event not found');
    }

    console.log('Event found:', deleteEvent);

    // Remove the banner from S3
    if (deleteEvent.bannerUrl) {
      console.log('Removing banner from S3:', deleteEvent.bannerUrl);
      await req.app.s3.send(new DeleteObjectCommand({
        Bucket: 'zauartcc',
        Key: `${process.env.S3_FOLDER_PREFIX}/events/${deleteEvent.bannerUrl}`
      }));
    }

    // Delete the event from the database
    await deleteEvent.delete();
    console.log('Event deleted:', deleteEvent);

    await req.app.dossier.create({
      by: res.user.cid,
      affected: -1,
      action: `%b deleted the event *${deleteEvent.name}*.`
    });

    res.stdRes.data = { message: "Event deleted successfully" };
  } catch (e) {
    console.error('Error during event deletion:', e);
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
		const {position, cid} = req.body;

		const event = await Event.findOneAndUpdate({url: req.params.slug, "positions._id": position}, {
			$set: {
				'positions.$.takenBy': cid || null
			}
		});

		const [assignedPosition] = event.positions.filter(pos => pos._id == position);

		if(cid) {
			await req.app.dossier.create({
				by: res.user.cid,
				affected: cid,
				action: `%b assigned %a to *${assignedPosition.pos}* for *${event.name}*.`
			});
		} else {
			await req.app.dossier.create({
				by: res.user.cid,
				affected: -1,
				action: `%b unassigned *${assignedPosition.pos}* for *${event.name}*.`
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
		await Event.updateOne({url: req.params.slug}, {
			$set: {
				positions: req.body.assignment,
				submitted: true
			}
		});

		const getSignups = await Event.findOne({url: req.params.slug }, 'name url signups').populate('signups.user', 'fname lname email cid').lean();
		getSignups.signups.forEach(async (signup) => {
			await transporter.sendMail({
				to: signup.user.email,
				from: {
					name: "Chicago ARTCC",
					address: 'no-reply@zauartcc.org'
				},
				subject: `Position Assignments for ${getSignups.name} | Chicago ARTCC`,
				template: 'event',
				context: {
					eventTitle: getSignups.name,
					name: `${signup.user.fname} ${signup.user.lname}`,
					slug: getSignups.url
				}
			});
		});

		await req.app.dossier.create({
			by: res.user.cid,
			affected: -1,
			action: `%b notified controllers of positions for the event *${getSignups.name}*.`
		});
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.put('/:slug/close', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
	try {
		await Event.updateOne({url: req.params.slug}, {
			$set: {
				open: false
			}
		});
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.post('/staffingRequest', async (req, res) => { // Submit staffing request
	try {
		if(!req.body.vaName || !req.body.name || !req.body.email || !req.body.date || !req.body.pilots || !req.body.route || !req.body.description) { // Validation
			throw {
				code: 400,
				message: "You must fill out all required fields"
			};
		}

		if(isNaN(req.body.pilots)) {
			throw {
				code: 400,
				message: "Pilots must be a number"
			};
		}

		const count = await StaffingRequest.countDocuments({ 
			accepted: false,
			name: req.body.name,
			email: req.body.email
		  });
		  
		console.log(count);
		if (count >= 3) {
			throw {
				code: 400,
				message: "You have reached the maximum limit of staffing requests with a pending status."
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
		  		address: 'no-reply@zauartcc.org'
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
	} catch(e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = e;
	}

	return res.json(res.stdRes);
});

router.put('/staffingRequest/:id/accept', async (req, res) => {
	try {
	  const staffingRequest = await StaffingRequest.findById(req.params.id);
  
	  if (!staffingRequest) {
		return res.status(404).json({ ret_det: { code: 404, message: 'Staffing request not found' }});
	  }
  
	  staffingRequest.accepted = req.body.accepted;
  
	  await staffingRequest.save();
  
	  return res.status(200).json({ ret_det: { code: 200, message: 'Staffing request updated successfully' }});
	} catch (e) {
	  console.error(e);
	  return res.status(500).json({ ret_det: { code: 500, message: 'An error occurred while updating the staffing request' }});
	}
});


router.put('/staffingRequest/:id', async (req, res) => {
	try {
	  const staffingRequest = await StaffingRequest.findById(req.params.id);
  
	  if (!staffingRequest) {
		return res.status(404).json({ ret_det: { code: 404, message: 'Staffing request not found' }});
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
			address: 'no-reply@zauartcc.org'
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
  
	  return res.status(200).json({ ret_det: { code: 200, message: 'Staffing request updated successfully' }});
	} catch (e) {
	  console.error(e);
	  return res.status(500).json({ ret_det: { code: 500, message: 'An error occurred while updating the staffing request' }});
	}
});

router.delete('/staffingRequest/:id', getUser, auth(['atm', 'datm', 'ec', 'wm']), async (req, res) => {
	try {
	  const staffingRequest = await StaffingRequest.findById(req.params.id);
	  
	  if (!staffingRequest) {
		return res.status(404).json({ ret_det: { code: 404, message: 'Staffing request not found' }});
	  }
	  
	  await staffingRequest.delete(); // Soft-delete the staffing request using the mongoose-delete plugin
  
	  return res.status(200).json({ ret_det: { code: 200, message: 'Staffing request deleted successfully' }});
	} catch (e) {
	  console.error(e);
	  return res.status(500).json({ ret_det: { code: 500, message: 'An error occurred while deleting the staffing request' }});
	}
});

export default router;