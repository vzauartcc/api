import axios from 'axios';
import type { IDiscordMessage } from '../types/Discord.js';

const discord = axios.create({
	baseURL: 'https://discord.com/api',
	headers: {
		Authorization: `Bot ${process.env['DISCORD_TOKEN']}`,
		'Content-Type': 'application/json',
		'User-Agent': 'vZAU ARTCC API Integration',
	},
});

async function sendMessage(channelId: string, message: IDiscordMessage) {
	const url = `/channels/${channelId}/messages`;

	// Ensure there is some content, as Discord requires either 'content', 'embeds', or 'files'.
	// You can add more robust validation here.
	if (!message.content && (!message.embeds || message.embeds.length === 0)) {
		throw new Error("Message must contain 'content' or at least one 'embed'.");
	}

	try {
		const response = await discord.post(url, message);

		console.log(`Message successfully sent to channel ${channelId}`);
		return response;
	} catch (err) {
		// Detailed error logging for debugging API issues
		if (axios.isAxiosError(err) && err.response) {
			console.error(
				`Failed to send message to channel ${channelId}. Discord API Error:`,
				err.response.data,
			);
			throw new Error(`Discord API responded with status ${err.response.status}`);
		}

		console.error(`An unknown error occurred while sending message:`, err);
		throw err;
	}
}

async function getCurrentUser(tokenType: string, accessToken: string) {
	try {
		return await discord.get('/users/@me', {
			headers: {
				Authorization: `${tokenType} ${accessToken}`,
			},
		});
	} catch (err) {
		if (axios.isAxiosError(err) && err.response) {
			console.error(`Failed to get current discord user. Discord API Error:`, err.response.data);
			throw new Error(`Discord API responded with status ${err.response.status}`);
		}

		console.error(`An unknown error occurred while getting current discord user:`, err);
		throw err;
	}
}

export default {
	sendMessage,
	getCurrentUser,
};
