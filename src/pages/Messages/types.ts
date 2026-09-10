export type IMConversationType = 'single' | 'group' | 'digital_employee';

export type IMContactKind = 'digital_employee' | 'colleague' | 'group';

export type IMMessageRole = 'self' | 'other' | 'system';

export type IMMessageContentType = 'text' | 'image' | 'file' | 'rich' | 'artifact' | 'thinking' | 'tool';

/** 自己发送消息的回执状态（对应 SDK OnRecvC2CReadReceipt / OnRecvGroupReadReceipt） */
export type IMMessageReadStatus = 'sending' | 'sent' | 'read';

export interface IMMessageGroupReadReceipt {
  readCount: number;
  memberCount: number;
}

export interface IMConversation {
  id: string;
  type: IMConversationType;
  name: string;
  avatarLabel: string;
  lastMessage: string;
  lastTime: string;
  unread: number;
  pinned?: boolean;
  muted?: boolean;
  subtitle?: string;
  status?: 'online' | 'busy' | 'offline';
  /** 个性签名 / 状态文案 */
  statusText?: string;
  /** 组织路径，如「华东销售 | 销售经理」 */
  orgPath?: string;
  /** 群成员数 */
  memberCount?: number;
  /** 群标签，如「内部群」 */
  groupTag?: string;
}

export interface IMContact {
  id: string;
  kind: IMContactKind;
  name: string;
  avatarLabel: string;
  subtitle?: string;
  memberCount?: number;
  status?: 'online' | 'busy' | 'offline';
  skills?: string[];
}

export interface IMMessage {
  id: string;
  role: IMMessageRole;
  senderName?: string;
  /** 发送者头像字，缺省取 senderName 首字 */
  senderAvatarLabel?: string;
  contentType: IMMessageContentType;
  content: string;
  time: string;
  /** 图片消息缩略图 URL（列表气泡） */
  mediaUrl?: string;
  /** 图片预览原图 URL；缺省回退 mediaUrl */
  previewUrl?: string;
  /** 富文本 HTML（contentType=rich） */
  richHtml?: string;
  /** 文件消息文件名 */
  fileName?: string;
  /** 自己发送消息的回执；other 消息不需要 */
  readStatus?: IMMessageReadStatus;
  /** 群聊已读人数（有值时优先展示「N 人已读」） */
  groupReadReceipt?: IMMessageGroupReadReceipt;
  artifact?: {
    title: string;
    fileName: string;
    fileSize: string;
  };
  toolName?: string;
  collapsed?: boolean;
}

export interface IMArtifactOption {
  id: string;
  title: string;
  fileName: string;
  fileSize: string;
}

export type MessagesLeftTab = 'conversations' | 'contacts';

export interface IMOrgMember {
  id: string;
  name: string;
  title: string;
  departmentId: string;
  avatarLabel: string;
}

export interface IMOrgDepartment {
  id: string;
  name: string;
  parentId?: string;
}

export type IMChatFileTab = 'files' | 'media' | 'links';

export type IMChatFileType = 'video' | 'document' | 'spreadsheet' | 'pdf' | 'link';

export interface IMChatFileItem {
  id: string;
  tab: IMChatFileTab;
  name: string;
  metaLine: string;
  fileType: IMChatFileType;
}
