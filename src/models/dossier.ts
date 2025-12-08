import { Document, model, Schema, type PopulatedDoc } from 'mongoose';
import type { ITimestamps } from './timestamps.js';
import type { IUser } from './user.js';

export const ACTION_TYPE = {
	UNKNOWN: 0,
	CREATE_USER: 1,
	UPDATE_USER: 2,
	DELETE_USER: 3,
	UPDATE_SELF: 4,
	SET_MEMBERSHIP: 5,
	SET_VISIT_STATUS: 6,
	CREATE_LOA: 7,
	DELETE_LOA: 8,
	SET_RATING: 9,
	APPROVE_VISIT: 10,
	REJECT_VISIT: 11,
	CREATE_EVENT_SIGNUP: 12,
	DELETE_EVENT_SIGNUP: 13,
	MANUAL_EVENT_SIGNUP: 14,
	MANUAL_DELETE_EVENT_SIGNUP: 15,
	ASSIGN_EVENT_POSITION: 16,
	UNASSIGN_EVENT_POSITION: 17,
	CREATE_EVENT: 18,
	UPDATE_EVENT: 19,
	DELETE_EVENT: 20,
	NOTIFY_EVENT: 21,
	APPROVE_STAFFING_REQUEST: 22,
	REJECT_STAFFING_REQUEST: 23,
	SUBMIT_FEEDBACK: 24,
	APPROVE_FEEDBACK: 25,
	REJECT_FEEDBACK: 26,
	CREATE_DOCUMENT: 27,
	UPDATE_DOCUMENT: 28,
	DELETE_DOCUMENT: 29,
	CREATE_FILE: 30,
	UPDATE_FILE: 31,
	DELETE_FILE: 32,
	CREATE_NEWS: 33,
	UPDATE_NEWS: 34,
	DELETE_NEWS: 35,
	CREATE_SOLO_ENDORSEMENT: 36,
	EXTEND_SOLO_ENDORSEMENT: 37,
	DELETE_SOLO_ENDORSEMENT: 38,
	GENERATE_IDS_TOKEN: 39,
	CONNECT_DISCORD: 40,
	DISCONNECT_DISCORD: 41,
	REQUEST_GDRP_DATA: 42,
	ERASE_USER_DATA: 43,
	CREATE_WAITLIST_SIGNUP: 44,
	MANUAL_WAITLIST_SIGNUP: 45,
	EDIT_WAITLIST_SIGNUP: 46,
	DELETE_WAITLIST_SIGNUP: 47,
} as const;

interface IDossier extends Document, ITimestamps {
	by: number;
	affected: number;
	action: string;
	actionType: number;

	// Virtuals
	userBy?: PopulatedDoc<IUser & ITimestamps & Document>;
	userAffected?: PopulatedDoc<IUser & ITimestamps & Document>;
}

const DossierSchema = new Schema<IDossier>(
	{
		by: { type: Number, ref: 'User' },
		affected: { type: Number, ref: 'User' },
		action: { type: String },
		actionType: { type: Number, required: true },
	},
	{
		collection: 'dossier',
		timestamps: true,
	},
);

DossierSchema.virtual('userBy', {
	ref: 'User',
	localField: 'by',
	foreignField: 'cid',
	justOne: true,
});

DossierSchema.virtual('userAffected', {
	ref: 'User',
	localField: 'affected',
	foreignField: 'cid',
	justOne: true,
});
export const DossierModel = model<IDossier>('dossier', DossierSchema);
