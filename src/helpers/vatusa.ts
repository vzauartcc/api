import axios from 'axios';

export const vatusaApi = axios.create({
	baseURL: 'https://api.vatusa.net/v2',
	params: {
		apikey: process.env['VATUSA_API_KEY'],
	},
});

export interface IVisitingStatus {
	visiting: boolean;
	recentlyRostered: boolean;
	hasRating: boolean;
	ratingConsolidation: boolean;
	needsBasic: boolean;
	promo: boolean;
	visitingDays: number;
	hasHome: boolean;
	ratingHours: number;
	promoDays: number;
}
