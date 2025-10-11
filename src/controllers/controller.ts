import { Router, type Request, type Response } from 'express';
import { UserModel, type IUser } from '../models/user.js';
import { convertToReturnDetails } from '../app.js';

const router = Router();

const baseUserQuery = () => {
	return UserModel.find({})
		.select('-email -idsToken -discordInfo -discord -certificationDate -broadcast')
		.sort({
			lname: 'asc',
			fname: 'asc',
		})
		.populate([
			{
				path: 'certifications',
				options: {
					sort: { order: 'desc' },
				},
			},
			{
				path: 'roles',
				options: {
					sort: { order: 'asc' },
				},
			},
			{
				path: 'absence',
				match: {
					expirationDate: {
						$gte: new Date(),
					},
					deleted: false,
				},
				select: '-reason',
			},
		]);
};

router.get('/', async (req: Request, res: Response) => {
	try {
		const allUsers: IUser[] = await baseUserQuery().exec();

		const home = allUsers.filter((user) => user.vis === false && user.member === true);
		const visiting = allUsers.filter((user) => user.vis === true && user.member === true);
		const removed = allUsers.filter((user) => user.member === false);

		if (!home || !visiting || !removed) {
			throw {
				code: 503,
				message: 'Unable to retrieve controllers',
			};
		}

		res.stdRes.data = { home, visiting, removed };
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = convertToReturnDetails(e);
	} finally {
		return res.json(res.stdRes);
	}
});

interface IUserLean {
	fname: string;
	lname: string;
	cid: number;
	roleCodes: string[];
}

interface IRoleGroup {
	title: string;
	code: string;
	users: IUserLean[];
}

interface IStaffDirectory {
	[key: string]: IRoleGroup;
}

router.get('/staff', async (req: Request, res: Response) => {
	try {
		const users = await UserModel.find()
			.select('fname lname cid roleCodes')
			.sort({ lname: 'asc', fname: 'asc' })
			.lean<IUserLean[]>();

		if (!users) {
			throw {
				code: 503,
				message: 'Unable to retrieve staff members',
			};
		}

		const staff: IStaffDirectory = {
			atm: {
				title: 'Air Traffic Manager',
				code: 'atm',
				users: [],
			},
			datm: {
				title: 'Deputy Air Traffic Manager',
				code: 'datm',
				users: [],
			},
			ta: {
				title: 'Training Administrator',
				code: 'ta',
				users: [],
			},
			ec: {
				title: 'Events Team',
				code: 'ec',
				users: [],
			},
			wm: {
				title: 'Web Team',
				code: 'wm',
				users: [],
			},
			fe: {
				title: 'Facility Engineering Team',
				code: 'fe',
				users: [],
			},
			ins: {
				title: 'Instructors',
				code: 'instructors',
				users: [],
			},
			ia: {
				title: 'Instructor Assistants',
				code: 'ia',
				users: [],
			},
			mtr: {
				title: 'Mentors',
				code: 'instructors',
				users: [],
			},
		};
		(users as IUserLean[]).forEach((user) => {
			user.roleCodes.forEach((roleCode) => {
				if (staff[roleCode as keyof IStaffDirectory]) {
					staff[roleCode as keyof IStaffDirectory]!.users.push(user);
				}
			});
		});

		res.stdRes.data = staff;
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = convertToReturnDetails(e);
	} finally {
		return res.json(res.stdRes);
	}
});

// Default router
router.get('/', async (req: Request, res: Response) => {
	try {
	} catch (e) {
		req.app.Sentry.captureException(e);
		res.stdRes.ret_det = convertToReturnDetails(e);
	} finally {
		return res.json(res.stdRes);
	}
});

export default router;
