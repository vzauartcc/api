import { Redis } from 'ioredis';

let redis: Redis | null = null;

export function setRedis(client: Redis) {
	redis = client;
}

interface RedisConnectionDetails {
	username: string;
	password: string;
	host: string;
	port: number;
}

export function parseRedisConnectionString(connectionString: string): RedisConnectionDetails {
	try {
		// 1. Create a URL object. The Node.js URL class handles standard URI parsing.
		const url = new URL(connectionString);

		// 2. Extract components from the URL object
		const username = url.username || '';
		const password = url.password || '';
		const host = url.hostname || '';

		// The default Redis port is 6379, but we rely on the URL object to parse
		// the specified port, or return null if not explicitly set and not the default.
		// url.port returns a string, so convert it to a number.
		let port: number | null = 6379;
		if (url.port) {
			port = parseInt(url.port, 10);
		} else if (url.protocol === 'redis:' || url.protocol === 'rediss:') {
			// Set the default port if it's a redis/redisS protocol and no port is specified.
			// Although not strictly necessary as clients often default it, this provides clarity.
			port = url.protocol === 'rediss:' ? 6380 : 6379; // RedisS often defaults to 6380 for SSL
		}

		return {
			username,
			password,
			host,
			port,
		};
	} catch (error) {
		console.error('Error parsing Redis connection string:', error);
		return {
			username: '',
			password: '',
			host: '',
			port: 6379,
		};
	}
}

export async function clearCacheKeys() {
	if (!redis) return;

	const keys = await redis.keys('cache-mongoose:*');

	if (keys.length > 0) {
		const count = await redis.del(keys);
		console.log('Deleted', count, 'old cache entries.');
	}
}

export async function clearCachePrefix(prefix: string) {
	if (!redis) return;

	const keys = await redis.keys(`cache-mongoose:${prefix}*`);

	if (keys.length > 0) {
		const count = await redis.del(keys);
		console.log(`Cleared ${count} cache entires for "${prefix}"`);
	}
}
