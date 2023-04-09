import User from '../models/User.js';
import jwt from 'jsonwebtoken';

export default async function(req, res, next) {
	const token = req.cookies.token || req.headers.authorization?.split(' ')[1] || '';
	
	if (token) {
	  try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		const user = await User.findOne({ cid: decoded.cid }).populate('roles');
		res.user = user;
	  } catch (err) {
		console.error(err);
		res.user = null;
	  }
	} else {
	  res.user = null;
	}
  
	next();
  }