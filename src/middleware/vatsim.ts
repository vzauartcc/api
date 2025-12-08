import axios from 'axios';
import type { NextFunction, Request, Response } from 'express';
import { logException } from '../app.js';
import status from '../types/status.js';

export default async function (req: Request, res: Response, next: NextFunction) {
	const code = req.body.code;
	if (!code) {
		return res.status(status.BAD_REQUEST).send('No authorization code provided.');
	}

	if (
		!process.env['VATSIM_AUTH_ENDPOINT'] ||
		!process.env['VATSIM_AUTH_CLIENT_ID'] ||
		!process.env['VATSIM_AUTH_CLIENT_SECRET']
	) {
		return res.status(status.INTERNAL_SERVER_ERROR).json();
	}

	let redirectUrl = 'http://localhost:8080/login/verify';

	const vatsimOauthEndpoint = process.env['VATSIM_AUTH_ENDPOINT'] + '/oauth/token';

	const allowedOrigins = new Map<string, string>([
		['https://ids.zauartcc.org', 'https://ids.zauartcc.org/login/verify'],
		['https://staging.zauartcc.org', 'https://staging.zauartcc.org/login/verify'],
		['https://zauartcc.org', 'https://zauartcc.org/login/verify'],
	]);

	const origin = req.headers.origin;
	if (origin && allowedOrigins.has(origin)) {
		redirectUrl = allowedOrigins.get(origin)!;
	}

	const params = new URLSearchParams();
	params.append('grant_type', 'authorization_code');
	params.append('code', code);
	params.append('redirect_uri', redirectUrl);

	let clientId = process.env['VATSIM_AUTH_CLIENT_ID'];
	let clientSecret = process.env['VATSIM_AUTH_CLIENT_SECRET']!;

	if (req.headers.origin === 'https://ids.zauartcc.org') {
		if (
			!process.env['VATSIM_AUTH_CLIENT_ID_IDS'] ||
			!process.env['VATSIM_AUTH_CLIENT_SECRET_IDS']
		) {
			return res.status(status.INTERNAL_SERVER_ERROR).json();
		}

		clientId = process.env['VATSIM_AUTH_CLIENT_ID_IDS'];
		clientSecret = process.env['VATSIM_AUTH_CLIENT_SECRET_IDS'];
	}

	params.append('client_id', clientId);
	params.append('client_secret', clientSecret);

	try {
		const response = await axios.post(vatsimOauthEndpoint, params);
		req.oauth = response.data;
		return next();
	} catch (e) {
		logException(e);

		return next(e);
	}
}
