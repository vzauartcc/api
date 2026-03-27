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

async function getAllTextChannels(guildId: string) {
	try {
		const channels = await discord.get(`/guilds/${guildId}/channels`);

		const textChannels = channels.data.filter(
			(channel: any) => channel.type === 0 || channel.type === 5,
		);

		const categoryMap = new Map(
			channels.data.filter((c: any) => c.type === 4).map((cat: any) => [cat.id, cat.name]),
		);

		return textChannels.map((c: any) => ({
			id: c.id,
			name: c.name,
			topic: c.topic,
			parent: c.parent_id,
			parentName: categoryMap.get(c.parent_id) || 'No Category',
			lastMessage: c.last_message_id,
		}));
	} catch (e) {
		if (axios.isAxiosError(e) && e.response) {
			console.error(`Failed to get all text channels. Discord API Error:`, e.response.data);
			throw new Error(`Discord API responded with status ${e.response.status}`);
		}

		console.error(`An unknown error occurred while getting all text channels:`, e);
		throw e;
	}
}

async function getAllRoles(guildId: string) {
	try {
		const roles = await discord.get(`/guilds/${guildId}/roles`);

		return roles.data.map((r: any) => ({ id: r.id, name: r.name }));
	} catch (e) {
		if (axios.isAxiosError(e) && e.response) {
			console.error(`Failed to get all text channels. Discord API Error:`, e.response.data);
			throw new Error(`Discord API responded with status ${e.response.status}`);
		}

		console.error(`An unknown error occurred while getting all text channels:`, e);
		throw e;
	}
}

async function getMessageContent(channelId: string, messageId: string) {
	try {
		const message = await discord.get(`/channels/${channelId}/messages/${messageId}`);

		return {
			author: message.data.author,
			content: message.data.content,
		};
	} catch (e) {
		if (axios.isAxiosError(e) && e.response) {
			console.error(`Failed to get all text channels. Discord API Error:`, e.response.data);
			throw new Error(`Discord API responded with status ${e.response.status}`);
		}

		console.error(`An unknown error occurred while getting all text channels:`, e);
		throw e;
	}
}

async function getAllMessages(channelId: string) {
	try {
		const messages = await discord.get(`/channels/${channelId}/messages?limit=100`);

		return messages.data.map((message: any) => ({
			id: message.id,
			author: message.author,
			content: message.content,
		}));
	} catch (e) {
		if (axios.isAxiosError(e) && e.response) {
			console.error(`Failed to get all text channels. Discord API Error:`, e.response.data);
			throw new Error(`Discord API responded with status ${e.response.status}`);
		}

		console.error(`An unknown error occurred while getting all text channels:`, e);
		throw e;
	}
}

async function getAllGuilds() {
	try {
		const guilds = await discord.get('/users/@me/guilds');

		return guilds.data.map((g: any) => ({ id: g.id, name: g.name }));
	} catch (e) {
		if (axios.isAxiosError(e) && e.response) {
			console.error(`Failed to get all text channels. Discord API Error:`, e.response.data);
			throw new Error(`Discord API responded with status ${e.response.status}`);
		}
		console.error(`An unknown error occurred while getting all text channels:`, e);
		throw e;
	}
}

export default {
	sendMessage,
	getCurrentUser,
	getAllTextChannels,
	getAllRoles,
	getMessageContent,
	getAllMessages,
	getAllGuilds,
};
