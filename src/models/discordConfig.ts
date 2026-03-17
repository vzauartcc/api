import { Document, model, Schema } from 'mongoose';

interface IUpdateableMessage {
	channelId: string;
	messageId: string;
}

interface IManagedrole {
	key: string;
	roleId: string;
}

interface IRepostChannel {
	id: string;
	topic: string;
}

interface IDiscordConfig extends Document {
	id: string;
	type: string;
	repostChannels: IRepostChannel[];
	managedRoles: IManagedrole[];
	ironMic: IUpdateableMessage;
	onlineControllers: IUpdateableMessage;
	cleanupChannels: IUpdateableMessage[];
}

const CleanupChannelsSchema = new Schema<IUpdateableMessage>(
	{
		channelId: { type: String, required: true },
		messageId: { type: String, required: true },
	},
	{ _id: false },
);

const IronMicSchema = new Schema<IUpdateableMessage>(
	{
		channelId: { type: String, required: true },
		messageId: { type: String, required: true },
	},
	{ _id: false },
);

const OnlineControllersSchema = new Schema<IUpdateableMessage>(
	{
		channelId: { type: String, required: true },
		messageId: { type: String, required: true },
	},
	{ _id: false },
);

const ManagedRoleSchema = new Schema<IManagedrole>(
	{
		key: { type: String, required: true },
		roleId: { type: String, required: true },
	},
	{ _id: false },
);

const RepostChannelSchema = new Schema<IRepostChannel>(
	{
		id: { type: String, required: true },
		topic: { type: String, required: true },
	},
	{ _id: false },
);

const DiscordConfigSchema = new Schema<IDiscordConfig>(
	{
		id: { type: String, required: true, default: '485491681903247361' },
		type: { type: String, required: true, default: 'discord' },
		repostChannels: [RepostChannelSchema],
		managedRoles: [ManagedRoleSchema],
		ironMic: IronMicSchema,
		onlineControllers: OnlineControllersSchema,
		cleanupChannels: [CleanupChannelsSchema],
	},
	{ collection: 'config' },
);

export const DiscordConfigModel = model<IDiscordConfig>('DiscordConfig', DiscordConfigSchema);
