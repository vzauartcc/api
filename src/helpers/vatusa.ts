import axios from 'axios';

export const vatusaApi = axios.create({
	baseURL: 'https://api.vatusa.net/v2',
	params: {
		apikey: process.env['VATUSA_API_KEY'],
	},
});
