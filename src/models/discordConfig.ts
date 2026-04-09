import { Document, model, Schema } from 'mongoose';

interface IUpdatableMessage {
	channelId: string;
	messageId: string;
}

interface IManagedRole {
	key: string;
	roleId: string;
}

interface IDiscordConfig extends Document {
	id: string;
	type: string;
	repostChannels: object;
	managedRoles: IManagedRole[];
	ironMic: IUpdatableMessage;
	onlineControllers: IUpdatableMessage;
	cleanupChannels: object;
	reminderChannels: object;
}

const IronMicSchema = new Schema<IUpdatableMessage>(
	{
		channelId: { type: String, required: true },
		messageId: { type: String, required: true },
	},
	{ _id: false },
);

const OnlineControllersSchema = new Schema<IUpdatableMessage>(
	{
		channelId: { type: String, required: true },
		messageId: { type: String, required: true },
	},
	{ _id: false },
);

const ManagedRoleSchema = new Schema<IManagedRole>(
	{
		key: { type: String, required: true },
		roleId: { type: String, required: true },
	},
	{ _id: false },
);

const DiscordConfigSchema = new Schema<IDiscordConfig>(
	{
		id: { type: String, required: true },
		type: { type: String, required: true, default: 'discord' },
		repostChannels: { type: Object },
		managedRoles: [ManagedRoleSchema],
		ironMic: IronMicSchema,
		onlineControllers: OnlineControllersSchema,
		cleanupChannels: { type: Object },
		reminderChannels: { type: Object },
	},
	{ collection: 'config' },
);

export const DiscordConfigModel = model<IDiscordConfig>('DiscordConfig', DiscordConfigSchema);
