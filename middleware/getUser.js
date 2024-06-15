import User from '../models/User.js';
import jwt from 'jsonwebtoken';

export default function(req, res, next) {
	const userToken = req.cookies.token || '';
	jwt.verify(userToken, process.env.JWT_SECRET, { algorithms: ['HS256'] }, async (err, decoded) => {
		if (err) {
			res.user = null;
		} else {
			try {
				const user = await User.findOne({
					cid: decoded.cid
				}).populate('roles');
				res.user = user;
			} catch (e) {
				console.error(e);
				res.user = null;
			}
		}
		next();
	});
}