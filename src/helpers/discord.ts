import { DiscordAPIError, REST } from '@discordjs/rest';
import {
	ChannelType,
	GuildScheduledEventEntityType,
	GuildScheduledEventPrivacyLevel,
	Routes,
	type APIChannel,
	type APIGuild,
	type APIGuildCategoryChannel,
	type APIGuildScheduledEvent,
	type APIMessage,
	type APINewsChannel,
	type APIRole,
	type APITextChannel,
	type APIUser,
	type RESTPostAPIChannelMessageJSONBody,
} from 'discord-api-types/v10';
import type { EditDiscordEventPayload } from '../types/Discord.js';

const discord = new REST({
	version: '10',
	userAgentAppendix: 'vZAU ARTCC API Integration',
}).setToken(process.env['DISCORD_TOKEN']!);

async function sendMessage(
	channelId: string,
	message: RESTPostAPIChannelMessageJSONBody,
): Promise<APIMessage> {
	// Ensure there is some content, as Discord requires either 'content', 'embeds', or 'files'.
	// You can add more robust validation here.
	if (!message.content && (!message.embeds || message.embeds.length === 0)) {
		throw new Error("Message must contain 'content' or at least one 'embed'.");
	}

	try {
		const response = (await discord.post(Routes.channelMessages(channelId), {
			body: message,
		})) as APIMessage;

		console.log(`Message successfully sent to channel ${channelId}`);
		return response;
	} catch (err) {
		// Detailed error logging for debugging API issues
		if (err instanceof DiscordAPIError) {
			console.error(
				`Failed to send message to channel ${channelId}. Discord API Error:`,
				err.message,
			);
			throw new Error(`Discord API responded with status ${err.status}`);
		}

		console.error(`An unknown error occurred while sending message:`, err);
		throw err;
	}
}

async function getCurrentUser(accessToken: string): Promise<APIUser> {
	try {
		const oauth = new REST({ version: '10', authPrefix: 'Bearer' }).setToken(accessToken);
		return (await oauth.get(Routes.user('@me'))) as APIUser;
	} catch (err) {
		if (err instanceof DiscordAPIError) {
			console.error(`Failed to get current discord user. Discord API Error:`, err.message);
			throw new Error(`Discord API responded with status ${err.status}`);
		}

		console.error(`An unknown error occurred while getting current discord user:`, err);
		throw err;
	}
}

async function getAllTextChannels(guildId: string) {
	try {
		const channels = (await discord.get(Routes.guildChannels(guildId))) as APIChannel[];

		const categories = channels.filter(
			(c): c is APIGuildCategoryChannel => c.type === ChannelType.GuildCategory,
		);

		const textChannels = channels.filter(
			(c): c is APITextChannel | APINewsChannel =>
				c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement,
		);

		const categoryMap = new Map(categories.map((cat) => [cat.id, cat.name]));

		return textChannels.map((channel) => ({
			id: channel.id,
			name: channel.name,
			topic: channel.topic ?? null,
			parent: channel.parent_id ?? null,
			parentName: categoryMap.get(channel.parent_id ?? '') ?? 'No Category',
			lastMessage: channel.last_message_id ?? null,
		}));
	} catch (err) {
		if (err instanceof DiscordAPIError) {
			console.error(`Failed to get all text channels. Discord API Error:`, err.message);
			throw new Error(`Discord API responded with status ${err.status}`);
		}

		console.error(`An unknown error occurred while getting all text channels:`, err);
		throw err;
	}
}

async function getAllRoles(guildId: string): Promise<APIRole[]> {
	try {
		return (await discord.get(Routes.guildRoles(guildId))) as APIRole[];
	} catch (err) {
		if (err instanceof DiscordAPIError) {
			console.error(`Failed to get all guild roles. Discord API Error:`, err.message);
			throw new Error(`Discord API responded with status ${err.status}`);
		}

		console.error(`An unknown error occurred while getting all text channels:`, err);
		throw err;
	}
}

async function getMessageContent(channelId: string, messageId: string): Promise<APIMessage> {
	try {
		return (await discord.get(Routes.channelMessage(channelId, messageId))) as APIMessage;
	} catch (err) {
		if (err instanceof DiscordAPIError) {
			console.error(`Failed to get all text channels. Discord API Error:`, err.message);
			throw new Error(`Discord API responded with status ${err.status}`);
		}

		console.error(`An unknown error occurred while getting all text channels:`, err);
		throw err;
	}
}

async function getAllMessages(channelId: string): Promise<APIMessage[]> {
	try {
		return (await discord.get(Routes.channelMessages(channelId), {
			query: new URLSearchParams({ limit: '100' }),
		})) as APIMessage[];
	} catch (err) {
		if (err instanceof DiscordAPIError) {
			console.error(`Failed to get all text channels. Discord API Error:`, err.message);
			throw new Error(`Discord API responded with status ${err.status}`);
		}

		console.error(`An unknown error occurred while getting all text channels:`, err);
		throw err;
	}
}

async function getAllGuilds(): Promise<APIGuild[]> {
	try {
		return (await discord.get(Routes.userGuilds())) as APIGuild[];
	} catch (err) {
		if (err instanceof DiscordAPIError) {
			console.error(`Failed to get all text channels. Discord API Error:`, err.message);
			throw new Error(`Discord API responded with status ${err.status}`);
		}
		console.error(`An unknown error occurred while getting all text channels:`, err);
		throw err;
	}
}

async function createEvent(
	name: string,
	description: string,
	startTime: Date,
	imageUrl?: string,
	endTime?: Date,
): Promise<APIGuildScheduledEvent> {
	try {
		if (!name || name.length > 1000) {
			throw new RangeError('Event name must be contain 1 to 1000 characters');
		}
		if (description && description.length > 1000) {
			throw new RangeError('Event description must not exceed 1000 characters');
		}

		if (Number.isNaN(startTime.getTime())) {
			throw new TypeError('Invalid start time');
		}
		if (startTime.getTime() <= Date.now()) {
			throw new RangeError('Event start time must be in the future');
		}

		if (endTime) {
			if (Number.isNaN(endTime.getTime())) {
				throw new TypeError('Invalid end time');
			}

			if (endTime.getTime() <= startTime.getTime()) {
				throw new RangeError('Event end time must be after event start time');
			}
		}

		return (await discord.post(Routes.guildScheduledEvents('485491681903247361'), {
			body: {
				name: name.trim(),
				description: description.trim() || '',
				channel_id: '523250298681294868',
				scheduled_start_time: startTime.toISOString(),
				scheduled_end_time: endTime?.toISOString(),
				privacy_level: GuildScheduledEventPrivacyLevel.GuildOnly,
				entity_type: GuildScheduledEventEntityType.Voice,
				image: await imageUrlToDataUri(imageUrl),
			},
		})) as APIGuildScheduledEvent;
	} catch (err) {
		if (err instanceof DiscordAPIError) {
			console.error(`Failed to create discord event. Discord API Error:`, err.message);
			throw new Error(`Discord API responded with status ${err.status}`);
		}
		console.error(`An unknown error occurred while creating discord event:`, err);
		throw err;
	}
}

async function editEvent(
	eventId: string,
	options: EditDiscordEventPayload,
): Promise<APIGuildScheduledEvent> {
	try {
		if (options.name !== undefined && (!options.name.trim() || options.name.length > 1000)) {
			throw new RangeError('Event name must be contain 1 to 1000 characters');
		}

		if (
			options.description !== undefined &&
			options.description !== null &&
			options.description.length > 1000
		) {
			throw new RangeError('Event description must not exceed 1000 characters');
		}

		if (options.startTime !== undefined) {
			if (!(options.startTime instanceof Date) || Number.isNaN(options.startTime.getTime())) {
				throw new TypeError('Invalid start time');
			}
			if (options.startTime.getTime() <= Date.now()) {
				throw new RangeError('Event start time must be in the future');
			}
		}

		if (options.endTime !== undefined) {
			if (!(options.endTime instanceof Date) || Number.isNaN(options.endTime.getTime())) {
				throw new TypeError('Invalid end time');
			}

			if (
				options.startTime !== undefined &&
				options.startTime instanceof Date &&
				options.endTime.getTime() <= options.startTime.getTime()
			) {
				throw new RangeError('Event end time must be after event start time');
			}
		}

		const payload = {
			...(options.name !== undefined && { name: options.name.trim() }),
			...(options.description !== undefined && { description: options.description }),
			...(options.startTime !== undefined && {
				scheduled_start_time: options.startTime.toISOString(),
			}),
			...(options.endTime !== undefined && { scheduled_end_time: options.endTime.toISOString() }),
			...(options.image !== undefined && { image: await imageUrlToDataUri(options.image) }),
		};

		return (await discord.patch(Routes.guildScheduledEvent('485491681903247361', eventId), {
			body: payload,
		})) as APIGuildScheduledEvent;
	} catch (err) {
		if (err instanceof DiscordAPIError) {
			console.error(`Failed to edit discord event. Discord API Error:`, err.message);
			throw new Error(`Discord API responded with status ${err.status}`);
		}
		console.error(`An unknown error occurred while editing discord event:`, err);
		throw err;
	}
}

async function deleteEvent(eventId: string) {
	try {
		return await discord.delete(Routes.guildScheduledEvent('485491681903247361', eventId));
	} catch (err) {
		if (err instanceof DiscordAPIError) {
			console.error(`Failed to delete discord event. Discord API Error:`, err.message);
			throw new Error(`Discord API responded with status ${err.status}`);
		}
		console.error(`An unknown error occurred while deleting discord event:`, err);
		throw err;
	}
}

async function imageUrlToDataUri(url?: string): Promise<string> {
	if (!url) {
		return '';
	}

	const response = await fetch(url);

	if (!response.ok) {
		throw new Error('Failed to fetch image');
	}

	const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() as
		string | undefined;

	const supportedTypes = ['image/png', 'image/jpeg', 'image/gif'];

	if (!contentType || !supportedTypes.includes(contentType)) {
		throw new Error('Unsupported media type');
	}

	const buffer = Buffer.from(await response.arrayBuffer());

	return `data:${contentType};base64,${buffer.toString('base64')}`;
}

export default {
	sendMessage,
	getCurrentUser,
	getAllTextChannels,
	getAllRoles,
	getMessageContent,
	getAllMessages,
	getAllGuilds,
	createEvent,
	editEvent,
	deleteEvent,
};
