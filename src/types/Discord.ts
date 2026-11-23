export interface TextChannelInfo {
	id: string;
	name: string;
	topic: string | null;
	parent: string | null;
	parentName: string;
	lastMessage: string | null;
}
