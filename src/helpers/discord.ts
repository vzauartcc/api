import { DiscordAPIError, REST } from '@discordjs/rest';
import {
	ChannelType,
	Routes,
	type APIChannel,
	type APIGuild,
	type APIGuildCategoryChannel,
	type APIMessage,
	type APINewsChannel,
	type APIRole,
	type APITextChannel,
	type APIUser,
	type RESTPostAPIChannelMessageJSONBody,
} from 'discord-api-types/v10';

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

export default {
	sendMessage,
	getCurrentUser,
	getAllTextChannels,
	getAllRoles,
	getMessageContent,
	getAllMessages,
	getAllGuilds,
};
