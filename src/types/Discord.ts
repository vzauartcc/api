export interface IDiscordMessage {
	content?: string;
	embeds?: IDiscordEmbed[];
}

export interface IDiscordEmbed {
	/** The title of the embed (max 256 characters) */
	title?: string;

	/** The type of embed (always "rich" for webhook/bot embeds) */
	type?: 'rich' | 'image' | 'video' | 'gifv' | 'article' | 'link';

	/** The description of the embed (max 4096 characters) */
	description?: string;

	/** The URL of the embed (will be treated as the title's hyperlink) */
	url?: string;

	/** The timestamp of the embed content */
	timestamp?: string; // ISO8601 timestamp (e.g., "2024-10-25T16:46:50.000Z")

	/** The color code of the embed (as an integer) */
	color?: number;

	/** Footer information */
	footer?: {
		text: string; // Footer text (max 2048 characters)
		icon_url?: string; // URL of the footer icon
		proxy_icon_url?: string; // A proxied URL for the footer icon
	};

	/** Image information */
	image?: {
		url: string; // Source URL of the image
		proxy_url?: string; // A proxied URL for the image
		height?: number;
		width?: number;
	};

	/** Thumbnail information */
	thumbnail?: {
		url: string; // Source URL of the thumbnail
		proxy_url?: string; // A proxied URL for the thumbnail
		height?: number;
		width?: number;
	};

	/** Video information (rarely set by bots, used for link previews) */
	video?: {
		url?: string;
		proxy_url?: string;
		height?: number;
		width?: number;
	};

	/** Provider information (rarely set by bots, used for link previews) */
	provider?: {
		name?: string;
		url?: string;
	};

	/** Author information */
	author?: {
		name: string; // Name of the author (max 256 characters)
		url?: string; // URL of the author
		icon_url?: string; // URL of the author icon
		proxy_icon_url?: string; // A proxied URL for the author icon
	};

	/** Fields array */
	fields?: {
		name: string; // Name of the field (max 256 characters)
		value: string; // Value of the field (max 1024 characters)
		inline?: boolean; // Whether or not this field should display inline
	}[];
}
