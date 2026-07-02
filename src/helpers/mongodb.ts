import { UserModel, type IUser } from '../models/user.js';
import zau from './zau.js';

export function userSelector(isStaff: boolean): string {
	let select = '-idsToken -discordInfo -discord -broadcast';
	if (!isStaff) {
		select += ' -email -history -joinDate -removalDate -trainingMilestones';
	}

	return select;
}

export async function getUsersWithPrivacy(user: IUser, findOptions = {}) {
	const isStaff = user.isStaff || user.isTrainingStaff || user.rating >= 11;
	const projectLName = isStaff
		? '$lname'
		: {
				$cond: {
					if: { $eq: ['$prefName', true] },
					then: { $toString: '$cid' },
					else: '$lname',
				},
			};

	const cacheKey =
		Object.keys(findOptions).length === 0 ? 'users' : `user-${JSON.stringify(findOptions)}`;

	let results = await UserModel.aggregate([
		{ $match: findOptions },
		{
			$unset: userSelector(isStaff).replaceAll('-', '').split(' '),
		},
		{
			$addFields: {
				lname: projectLName,
				name: { $concat: ['$fname', ' ', projectLName] },
				ratingsArrayS: [...zau.ratingsShort],
				ratingsArrayL: [...zau.ratingsLong],
			},
		},
		{
			$addFields: {
				ratingShort: {
					$arrayElemAt: ['$ratingsArrayS', '$rating'],
				},
				ratingLong: {
					$arrayElemAt: ['$ratingsArrayL', '$rating'],
				},
			},
		},
		{
			// 1. REPLACED POPULATE FOR ROLES
			$lookup: {
				from: 'roles', // <-- The actual MongoDB collection name for Roles
				localField: 'roleCodes', // <-- The field on your User document
				foreignField: 'code', // <-- The field on the Role document (change to '_id' if referencing by ObjectId)
				as: 'roles',
			},
		},
		{
			// 2. REPLACED POPULATE FOR CERTIFICATIONS
			$lookup: {
				from: 'certifications', // <-- The actual MongoDB collection name for Certifications
				localField: 'certCodes', // <-- The field on your User document
				foreignField: 'code', // <-- The field on the Cert document (change to '_id' if referencing by ObjectId)
				as: 'certifications',
			},
		},
		{
			$lookup: {
				from: 'absence',
				localField: 'cid',
				foreignField: 'controller',
				as: 'absence',
				pipeline: [
					{ $match: { expirationDate: { $gt: new Date() }, deleted: { $ne: true } } },
					{ $project: { controller: 1, expirationDate: 1 } },
				],
			},
		},
		{
			$project: {
				prefName: 0,
				deleted: 0,
				deletedAt: 0,
				createdAt: 0,
				updatedAt: 0,
				ratingsArrayS: 0,
				ratingsArrayL: 0,
			},
		},
		{
			$sort: {
				lname: 1,
				fname: 1,
				oi: 1,
			},
		},
	])
		.cache('1 minute', cacheKey)
		.exec();

	// Convert extended JSON date back to a normal date.
	return results.map((user) => {
		if (user.history && Array.isArray(user.history)) {
			user.history = user.history.map((h: any) => {
				const startDate = h.start && h.start.$date ? h.start.$date : h.start;
				const endDate = h.end && h.end.$date ? h.end.$date : h.end;

				return {
					...h,
					start: startDate ? new Date(startDate).toISOString() : null,
					end: endDate ? new Date(endDate).toISOString() : null,
				};
			});
		}

		return user;
	});
}
