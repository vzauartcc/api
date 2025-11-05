import { model, Schema } from 'mongoose';
import type { SoftDeleteDocument, SoftDeleteModel } from 'mongoose-delete';
import MongooseDelete from 'mongoose-delete';
import mongooseLeanVirtuals from 'mongoose-lean-virtuals';
import zau from '../helpers/zau.js';
import type { IAbsence } from './absence.js';
import * as Certification from './certification.js';
import type { IRole } from './role.js';
import type { ITimestamps } from './timestamps.js';

export interface ICertificationDate {
	code: string;
	gainedDate: Date;
}

export interface IUserHistory {
	start: Date;
	end: Date;
	reason: string;
}

export interface IUser extends SoftDeleteDocument, ITimestamps {
	cid: number;
	fname: string;
	lname: string;
	email: string;
	rating: number;
	oi?: string | null;
	broadcast: boolean;
	member: boolean;
	vis: boolean;
	homeFacility?: string;
	bio: string;
	avatar?: string;
	joinDate?: Date | null;
	removalDate?: Date | null;
	prefName: boolean;
	discordInfo?: {
		clientId: string;
		accessToken: string;
		refreshToken: string;
		tokenType: string;
		expires: Date;
	};
	discord?: string;
	idsToken?: string;
	certCodes: string[];
	certificationDate: ICertificationDate[];
	roleCodes: string[];
	trainingMilestones: [];
	history: IUserHistory[];

	// Virtual Properties
	name: string;
	isMem: boolean;
	isManagement: boolean;
	isSeniorStaff: boolean;
	isStaff: boolean;
	isIns: boolean;
	ratingShort: string;
	ratingLong: string;
	certCodeList: string[];

	roles: IRole;
	certifications: Certification.ICertification[];
	absence: IAbsence[];
}

const CertificationDateSchema = new Schema<ICertificationDate>(
	{
		code: { type: String, required: true },
		gainedDate: { type: Date, required: true },
	},
	{ _id: false },
);

const UserHistorySchema = new Schema<IUserHistory>(
	{
		start: { type: Date, required: true },
		end: { type: Date, required: true },
		reason: { type: String, required: true },
	},
	{
		_id: false,
	},
);

const UserSchema = new Schema<IUser>(
	{
		cid: { type: Number, required: true, unique: true },
		fname: { type: String, required: true },
		lname: { type: String, required: true },
		email: { type: String, required: true },
		rating: { type: Number, required: true },
		oi: { type: String },
		broadcast: { type: Boolean, required: true },
		member: { type: Boolean, required: true },
		vis: { type: Boolean, required: true },
		homeFacility: { type: String },
		avatar: { type: String },
		joinDate: { type: Date },
		removalDate: { type: Date },
		prefName: { type: Boolean, default: false, required: true },
		discordInfo: {
			clientId: { type: String },
			accessToken: { type: String },
			refreshToken: { type: String },
			tokenType: { type: String },
			expires: { type: Date },
			_id: false,
		},
		discord: { type: String },
		idsToken: { type: String },
		certCodes: [{ type: String, required: true }],
		certificationDate: { type: [CertificationDateSchema], required: true, default: [] },
		roleCodes: [{ type: String, required: true }],
		trainingMilestones: {
			type: [
				{
					type: Schema.Types.ObjectId,
					ref: 'TrainingMilestone',
				},
			],
			required: true,
			default: [],
		},
		history: { type: [UserHistorySchema], default: [] },
	},
	{
		timestamps: true,
	},
);

UserSchema.plugin(MongooseDelete, {
	deletedAt: true,
});

UserSchema.plugin(mongooseLeanVirtuals);

UserSchema.virtual('name').get(function (this: IUser) {
	return `${this.fname} ${this.lname}`;
});

UserSchema.virtual('isMem').get(function (this: IUser) {
	return this.member;
});

UserSchema.virtual('isManagement').get(function (this: IUser) {
	if (!this.roleCodes) return false;

	const search = ['atm', 'datm', 'wm'];
	return this.roleCodes.some((r) => search.includes(r));
});

UserSchema.virtual('isSeniorStaff').get(function (this: IUser) {
	if (!this.roleCodes) return false;

	const search = ['atm', 'datm', 'ta', 'wm'];
	return this.roleCodes.some((r) => search.includes(r));
});

UserSchema.virtual('isStaff').get(function (this: IUser) {
	if (!this.roleCodes) return false;

	const search = ['atm', 'datm', 'ec', 'fe', 'wm'];
	return this.roleCodes.some((r) => search.includes(r));
});

UserSchema.virtual('isIns').get(function (this: IUser) {
	if (!this.roleCodes) return false;

	const search = ['atm', 'datm', 'ins', 'mtr', 'ia'];
	return this.roleCodes.some((r) => search.includes(r));
});

UserSchema.virtual('ratingShort').get(function (this: IUser) {
	return zau.ratingsShort[this.rating];
});

UserSchema.virtual('ratingLong').get(function (this: IUser) {
	return zau.ratingsLong[this.rating];
});

UserSchema.virtual('certCodesList').get(function (this: IUser) {
	return (this.certificationDate || []).map((cert) => cert.code);
});

UserSchema.virtual('roles', {
	ref: 'Role',
	localField: 'roleCodes',
	foreignField: 'code',
});

UserSchema.virtual('certifications', {
	ref: 'Certification',
	localField: 'certCodes',
	foreignField: 'code',
});

UserSchema.virtual('absence', {
	ref: 'Absence',
	localField: 'cid',
	foreignField: 'controller',
});

export const UserModel = model<IUser, SoftDeleteModel<IUser>>('User', UserSchema);
