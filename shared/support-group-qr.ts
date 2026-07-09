import siteQrUrl from '../src/assets/support/site_dd.jpg';
import hqQrUrl from '../src/assets/support/hq_dd.jpg';

/** 网点用户钉钉产品咨询群二维码（本地静态资源） */
export const SUPPORT_GROUP_QR_URL_SITE = siteQrUrl;

/** 非网点用户钉钉产品咨询群二维码（本地静态资源） */
export const SUPPORT_GROUP_QR_URL_HQ = hqQrUrl;

export function resolveSupportGroupQrUrl(isSiteUserFlag: boolean): string {
  return isSiteUserFlag ? SUPPORT_GROUP_QR_URL_SITE : SUPPORT_GROUP_QR_URL_HQ;
}
