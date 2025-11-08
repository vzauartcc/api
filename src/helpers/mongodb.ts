import { UserModel, type IUser } from '../models/user.js';
import zau from './zau.js';

export function userSelector(isStaff: boolean): string {
	let select = '-idsToken -discordInfo -discord -certificationDate -broadcast';
	if (!isStaff) {
		select += ' -email -history -joinDate -removalDate -trainingMilestones';
	}

	return select;
}

export async function getUsersWithPrivacy(user: IUser, findOptions = {}) {
	const isStaff = user.isStaff || user.isInstructor || user.rating >= 11;
	const projectLName = isStaff
		? '$lname'
		: {
				$cond: {
					if: { $eq: ['$prefName', true] },
					then: { $toString: '$cid' },
					else: '$lname',
				},
			};

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
			$unwind: {
				path: '$absence',
				preserveNullAndEmptyArrays: true,
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
	]).exec();
	return await UserModel.populate(results, 'roles certifications');
}
