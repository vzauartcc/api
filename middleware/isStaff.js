import User from '../models/User.js';
import jwt from 'jsonwebtoken';

export function isIns(req, res, next) {
	if (!req.cookies.token) {
		return res.sendStatus(401);
	} else {
		const userToken = req.cookies.token;
		jwt.verify(userToken, process.env.JWT_SECRET, { algorithms: ['HS256'] }, async (err, decoded) => {
			if (err) {
				console.log(`Unable to verify token: ${err}`);
				return res.sendStatus(401);
			} else {
				try {
					const user = await User.findOne({
						cid: decoded.cid
					}).populate('roles').lean({ virtuals: true });
					if (user && user.isIns) {
						next();
					} else {
						return res.sendStatus(403);
					}
				} catch (e) {
					console.error(e);
					return res.sendStatus(500);
				}
			}
		});
	}
}

export function isStaff(req, res, next) {
	if (!req.cookies.token) {
		return res.sendStatus(401);
	} else {
		const userToken = req.cookies.token;
		jwt.verify(userToken, process.env.JWT_SECRET, { algorithms: ['HS256'] }, async (err, decoded) => {
			if (err) {
				console.log(`Unable to verify token: ${err}`);
				return res.sendStatus(401);
			} else {
				try {
					const user = await User.findOne({
						cid: decoded.cid
					}).populate('roles').lean({ virtuals: true });
					if (user && user.isStaff) {
						next();
					} else {
						return res.sendStatus(403);
					}
				} catch (e) {
					console.error(e);
					return res.sendStatus(500);
				}
			}
		});
	}
}

export function isSenior(req, res, next) {
	if (!req.cookies.token) {
		return res.sendStatus(401);
	} else {
		const userToken = req.cookies.token;
		jwt.verify(userToken, process.env.JWT_SECRET, { algorithms: ['HS256'] }, async (err, decoded) => {
			if (err) {
				console.log(`Unable to verify token: ${err}`);
				return res.sendStatus(401);
			} else {
				try {
					const user = await User.findOne({
						cid: decoded.cid
					}).populate('roles').lean({ virtuals: true });
					if (user && user.isSenior) {
						next();
					} else {
						return res.sendStatus(403);
					}
				} catch (e) {
					console.error(e);
					return res.sendStatus(500);
				}
			}
		});
	}
}

export function isMgt(req, res, next) {
	if (!req.cookies.token) {
		return res.sendStatus(401);
	} else {
		const userToken = req.cookies.token;
		jwt.verify(userToken, process.env.JWT_SECRET, { algorithms: ['HS256'] }, async (err, decoded) => {
			if (err) {
				console.log(`Unable to verify token: ${err}`);
				return res.sendStatus(401);
			} else {
				try {
					const user = await User.findOne({
						cid: decoded.cid
					}).populate('roles').lean({ virtuals: true });
					if (user && user.isMgt) {
						next();
					} else {
						return res.sendStatus(403);
					}
				} catch (e) {
					console.error(e);
					return res.sendStatus(500);
				}
			}
		});
	}
}
