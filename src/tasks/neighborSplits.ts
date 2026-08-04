import axios from 'axios';
import { ZMP_High, ZMP_Low } from '../controllers/split/geojson.js';

interface ZMPSplit {
	type: string;
	name: string;
	start?: string; // ISO Date
	end?: string; // ISO Date
	live?: boolean;
	split: Record<string, string>;
}

interface ZOBSplit {
	data: {
		callsign: string;
		frequency: string;
		splits: string[];
		is_active: boolean;
	}[];
}

export async function getNeighborSplits(redis: any) {
	await clearSplits(redis);

	try {
		const { data: zmpSplit } = await axios.get<ZMPSplit[]>(
			'https://minniecenter.org/api/eventsplits',
		);

		const zmp = zmpSplit.find((s) => s.type === 'current');
		if (zmp && Object.keys(zmp.split).length > 0) {
			for (const [key, value] of Object.entries(zmp.split)) {
				const sectors = value.split('|');
				sectors.forEach((s) => {
					redis.set(`split:p:${s}`, key.replaceAll('MSP_', '').replaceAll('_CTR', ''));
				});
			}
		} else {
			// No split, make P11 own all.
			ZMP_High.features.forEach((f) => {
				redis.set(`split:p:${f.properties.id}`, '11');
			});
			ZMP_Low.features.forEach((f) => {
				redis.set(`split:p:${f.properties.id}`, '11');
			});
		}
	} catch (e) {
		console.error('error fetching zmp split', e);
	}

	try {
		const { data: zobSplit } = await axios.get<ZOBSplit>(
			'https://clevelandcenter.org/api/public/splits',
		);
		if (Array.isArray(zobSplit.data) && zobSplit.data.length > 1) {
			zobSplit.data.forEach((position) => {
				position.splits.forEach((sector) => {
					redis.set(
						`split:c:${sector.replaceAll('ZOB', '')}`,
						position.callsign.replaceAll('CLE_', '').replaceAll('_CTR', ''),
					);
				});
			});
		}
	} catch (e) {
		console.error('error fetching zob split', e);
	}
}

async function clearSplits(redis: any) {
	try {
		const keys = await redis.keys(`split:c:*`);

		if (keys.length > 0) {
			await redis.del(keys);
		}
	} catch (e) {
		console.error('error clearing zob split', e);
	}

	try {
		const keys = await redis.keys(`split:p:*`);

		if (keys.length > 0) {
			await redis.del(keys);
		}
	} catch (e) {
		console.error('error clearing zmp split', e);
	}
}
