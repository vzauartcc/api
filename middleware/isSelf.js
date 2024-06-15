import User from '../models/User.js';
import jwt from 'jsonwebtoken';

export function isSelf(req, res, next) {
	if (!req.cookies.token) {
		return res.sendStatus(401);
	} else {
		const userToken = req.cookies.token;
		const userId = req.params.id;
		jwt.verify(userToken, process.env.JWT_SECRET, { algorithms: ['HS256'] }, async (err, decoded) => {
			if (err) {
				console.log(`Unable to verify token: ${err}`);
				return res.sendStatus(401);
			} else {
				try {
					const user = await User.findOne({
						cid: decoded.cid
					}).lean();
					if (user && user._id.toString() === userId) {
						next();
					} else {
						return res.sendStatus(403);
					}
				} catch (e) {
					console.error(e);
					return res.sendStatus(500); // Internal server error if DB lookup fails
				}
			}
		});
	}
}