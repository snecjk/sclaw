import type { IMSDKInterface } from '@openim/electron-client-sdk/lib/render';
import type { ConversationItem, MessageItem } from '@openim/wasm-client-sdk';
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

function getExtension(filePath: string): string {
  const match = filePath.match(/\.([^.]+)$/i);
  return match?.[1]?.toLowerCase() ?? '';
}

export function isImageFilePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath));
}

export async function createMessageFromFilePath(
  im: IMSDKInterface,
  filePath: string,
): Promise<MessageItem | null> {
  if (isImageFilePath(filePath)) {
    const created = await im.createImageMessageFromFullPath(filePath);
    return created.data ?? null;
  }

  const created = await im.createFileMessageFromFullPath({
    filePath,
    fileName: basename(filePath),
  });
  return created.data ?? null;
}

export async function sendMessageToConversation(
  im: IMSDKInterface,
  conversation: ConversationItem,
  message: MessageItem,
): Promise<MessageItem | null> {
  const response = await im.sendMessage({
    recvID: conversation.userID ?? '',
    groupID: conversation.groupID ?? '',
    message,
  });
  return response.data ?? message;
}
