import { DateTime } from 'luxon';
import discord from '../helpers/discord.js';
import { vatusaApi } from '../helpers/vatusa.js';
import zau from '../helpers/zau.js';
import { DossierModel } from '../models/dossier.js';
import { SoloEndorsementModel } from '../models/soloEndorsement.js';

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
			await discord.sendMessage('1341139323604439090', {
				content: `:timer: **SOLO ENDORSEMENT EXPIRING SOON** :timer:\n<@&1215950778120933467>\n\nStudent Name: ${solo.student!.name}\nExpiration Date: ${DateTime.fromJSDate(solo.expires).toUTC().toFormat(zau.DATE_FORMAT)} (<t:${Math.floor(solo.expires.getTime() / 1000)}:R>)\nPosition: ${solo.position}\n\n[Manage Solo Endorsements](https://${process.env['DOMAIN']}/ins/solo)`,
			});

			solo.notified = true;
			solo.save();
		} catch (err) {
			console.log('Error posting solo endorsement expiration to discord', err);
		}
	}
}

const ZAU_FACILITIES = ['CHI', 'ORD', 'MKE', 'SBN', 'LAF', 'MDW'];
export async function syncVatusaSoloEndorsements() {
	try {
		const { data } = await vatusaApi.get('/solo');

		if (!data || !data.data) return;

		for (const solo of data.data) {
			if (solo.position.length < 3) continue;

			const facility = solo.position.slice(0, 3);
			if (!ZAU_FACILITIES.includes(facility)) continue;

			const ours = await SoloEndorsementModel.findOne({ vatusaId: solo.id }).exec();
			if (ours) {
				if (ours.expires.getTime() === new Date(solo.expires).getTime()) continue;

				ours.expires = new Date(solo.expires);
				await ours.save();

				continue;
			}

			console.log(
				'VATUSA has an extra solo endorsement, creating',
				solo.cid,
				solo.position,
				solo.expires,
			);

			await SoloEndorsementModel.create({
				studentCid: solo.cid,
				instructorCid: -1,
				expires: new Date(solo.expires),
				position: solo.position,
				vatusaId: solo.id,
				createdAt: solo.created_at,
			});

			await DossierModel.create({
				by: -1,
				affected: solo.cid,
				action: `An external service issued a solo endorsement for %a to work ${solo.position} until ${DateTime.fromJSDate(new Date(solo.expires)).toUTC().toFormat(zau.DATE_FORMAT)}`,
			});
		}
	} catch (err) {
		console.error(`Error syncing VATUSA solo endorsements:`, err);
	}
}
