import EventModel from '../models/event.js';

export async function closeEventSignups() {
	await EventModel.updateMany({ eventEnd: { $lt: new Date() } }, { $set: { open: false } }).exec();
}
