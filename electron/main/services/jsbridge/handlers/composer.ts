import { createHostActionEnvelope } from '../../../../../shared/jsbridge/host-actions';
import type { BridgeHandlerFn } from './types';

export const handleComposerOpenFilePicker: BridgeHandlerFn = async ({ request }) => {
  const params = request.params as {
    accept?: string;
    multiple?: boolean;
  } | undefined;

  return createHostActionEnvelope({
    type: 'composer.openFilePicker',
    accept: typeof params?.accept === 'string' ? params.accept : undefined,
    multiple: params?.multiple !== false,
  });
};

export const handleNavOpenPreviewTab: BridgeHandlerFn = async ({ request }) => {
  const params = request.params as {
    url?: string;
    title?: string;
  } | undefined;
  const url = typeof params?.url === 'string' ? params.url.trim() : '';
  if (!url) {
    throw Object.assign(new Error('url is required'), { code: 'INVALID_PARAMS' });
  }
  return createHostActionEnvelope({
    type: 'nav.openPreviewTab',
    url,
    title: typeof params?.title === 'string' ? params.title : undefined,
  });
};
