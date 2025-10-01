import m from 'mongoose';
import './User.js';
import softDelete from 'mongoose-delete';

const staffingSchema = new m.Schema(
	{
		vaName: String, //VA requesting staffing
		name: String, //person making the request
		email: String, // requester's email
		date: Date, // Date and Time for the request
		pilots: Number, // expected amount of pilots
		route: String, // expected route
		description: String, // description for the request
		accepted: Boolean, //whether it is accepted or not by the EC
	},
	{
		timestamps: true,
	},
);

staffingSchema.plugin(softDelete, {
	deletedAt: true,
});

export default m.model('StaffingRequest', staffingSchema, 'staffingRequests');
