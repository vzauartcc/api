import axios from 'axios';
import { getCacheInstance } from '../../app.js';
import { findInS3, uploadToS3 } from '../../helpers/s3.js';
import { UserModel, type ICertificationDate, type IUser } from '../../models/user.js';
import status from '../../types/status.js';

export async function checkOI(user: IUser) {
	try {
		if (!user) return '';

		const oi = await UserModel.find({ deletedAt: null, member: true })
			.select('oi cid')
			.lean()
			.cache('5 minutes', 'operating-initials')
			.exec();

		if (user.oi) {
			// OIs are only in the database once
			if (oi.filter((o) => o.oi === user.oi).length === 0) {
				uploadAvatar(user, user.oi);
				return user.oi;
			} else {
				// OIs are matched to the user
				if (oi.some((u) => u.oi === user.oi && u.cid === user.cid)) {
					uploadAvatar(user, user.oi);
					return user.oi;
				}
			}
		}

		const assignedOi = generateOperatingInitials(
			user.fname,
			user.lname,
			oi.map((oi) => oi.oi || '').filter((oi) => oi !== ''),
		);

		const { data } = await axios.get(
			`https://ui-avatars.com/api/?name=${oi}&size=256&background=122049&color=ffffff`,
			{ responseType: 'arraybuffer' },
		);

		await uploadToS3(`avatars/${user.cid}-default.png`, data, 'image/png', {
			ContentDisposition: 'inline',
		});

		await getCacheInstance().clear('operating-initials');
		return assignedOi;
	} catch (e) {
		throw { code: status.INTERNAL_SERVER_ERROR, message: e };
	}
}

export async function uploadAvatar(user: IUser, oi: string) {
	const exists = await findInS3(`avatars/${user.cid}-default.png`);
	if (!exists || oi !== user.oi) {
		const { data } = await axios.get(
			`https://ui-avatars.com/api/?name=${oi}&size=256&background=122049&color=ffffff`,
			{ responseType: 'arraybuffer' },
		);

		await uploadToS3(`avatars/${user.cid}-default.png`, data, 'image/png', {
			ContentDisposition: 'inline',
		});
	}
}

export function generateOperatingInitials(fname: string, lname: string, usedOi: string[]): string {
	let operatingInitials = '';
	const MAX_TRIES = 10;

	// First initial Last initial
	operatingInitials = `${fname.charAt(0).toUpperCase()}${lname.charAt(0).toUpperCase()}`;

	if (!usedOi.includes(operatingInitials)) {
		return operatingInitials;
	}

	// Last initial First initial
	operatingInitials = `${lname.charAt(0).toUpperCase()}${fname.charAt(0).toUpperCase()}`;

	if (!usedOi.includes(operatingInitials)) {
		return operatingInitials;
	}

	// Combine first name and last name, start looking for any available OIs.
	const chars = `${lname.toUpperCase()}${fname.toUpperCase()}`;

	let tries = 0;

	do {
		operatingInitials = random(chars, 2);
		tries++;
	} while (usedOi.includes(operatingInitials) || tries > MAX_TRIES);

	if (!usedOi.includes(operatingInitials)) {
		return operatingInitials;
	}

	// Pick any available two letters in the alphabet to find available OIs.
	tries = 0;

	do {
		operatingInitials = random('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 2);
		tries++;
	} while (usedOi.includes(operatingInitials) || tries > MAX_TRIES);

	if (!usedOi.includes(operatingInitials)) {
		return operatingInitials;
	}

	return operatingInitials;
}

const random = (str: string, len: number) => {
	let ret = '';
	for (let i = 0; i < len; i++) {
		ret = `${ret}${str.charAt(Math.floor(Math.random() * str.length))}`;
	}
	return ret;
};

export function grantCerts(
	rating: number,
	certificationDate: ICertificationDate[],
): ICertificationDate[] {
	let certCodes = [...certificationDate.map((cert) => cert.code)];
	if (rating >= 2) {
		certCodes.push('gnd');
	}
	if (rating >= 3) {
		certCodes.push('twr');
	}
	if (rating >= 4) {
		certCodes.push('app');
	}

	// Remove duplicates
	certCodes = certCodes.filter((value, index, self) => {
		return self.indexOf(value) === index;
	});

	// Handle certifications (certCodes and certificationDate)
	const existingCertMap = new Map(certificationDate.map((cert) => [cert.code, cert]));
	const updatedCertificationDate = [];

	for (const code of certCodes) {
		if (existingCertMap.has(code)) {
			// Keep the existing gainedDate if certification already exists
			updatedCertificationDate.push({
				code,
				gainedDate: existingCertMap.get(code)!.gainedDate,
			});
		} else {
			// If it's a new certification, add with today's date
			updatedCertificationDate.push({
				code,
				gainedDate: new Date(), // Assign current date as gainedDate
			});
		}
	}

	return updatedCertificationDate;
}

export async function clearUserCache(id: number) {
	await getCacheInstance().clear('user-{"member":true}');
	await getCacheInstance().clear('users');
	await getCacheInstance().clear('discord-users');
	await getCacheInstance().clear('user-users-user');
	await getCacheInstance().clear('user-users-internal');
	await getCacheInstance().clear(`user-${id}`);
	await getCacheInstance().clear(`auth-${id}`);
	await getCacheInstance().clear(`users-user-${id}`);
}
