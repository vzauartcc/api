import axios from 'axios';
import { DateTime } from 'luxon';
import { SoloEndorsementModel } from '../models/soloEndorsement.js';
import zau from '../zau.js';

export async function soloExpiringNotifications() {
	if (!process.env['DISCORD_TOKEN'] || process.env['DISCORD_TOKEN'] === '') {
		console.log('Skipping Solo Endorsement Expiration Check due to no bot configuration.');
	}

	const now = new Date();
	const twoFromNow = new Date(new Date().setDate(now.getDate() + 2));

	const solos = await SoloEndorsementModel.find({
		deleted: false,
		expires: {
			$gt: new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
			$lte: new Date(
				twoFromNow.getUTCFullYear(),
				twoFromNow.getUTCMonth(),
				twoFromNow.getUTCDate(),
			),
		},
		notified: { $ne: true },
	})
		.populate('student', 'fname lname')
		.exec();

	for (const solo of solos) {
		try {
			await axios.post(
				`https://discord.com/api/channels/1341139323604439090/messages`,
				{
					content: `:timer: **SOLO ENDORSEMENT EXPIRING SOON** :timer:\n<@&1215950778120933467>\n\nStudent Name: ${solo.student!.fname} ${solo.student!.lname}\nExpiration Date: ${DateTime.fromJSDate(solo.expires).toUTC().toFormat(zau.DATE_FORMAT)} (<t:${Math.floor(solo.expires.getTime() / 1000)}:R>)\nPosition: ${solo.position}\n\n[Manage Solo Endorsements](https://${process.env['DOMAIN']}/ins/solo)`,
				},
				{
					headers: {
						Authorization: `Bot ${process.env['DISCORD_TOKEN']}`,
						'Content-Type': 'application/json',
						'User-Agent': 'vZAU ARTCC API Integration',
					},
				},
			);
			solo.notified = true;
			solo.save();
		} catch (err) {
			console.log('Error posting solo endorsement expiration to discord', err);
		}
	}
}
