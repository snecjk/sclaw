/** 网点用户钉钉产品咨询群二维码（OSS 静态资源） */
export const SUPPORT_GROUP_QR_URL_SITE =
  'https://ali-sto-shenji.oss-cn-shanghai.aliyuncs.com/2026/07/a9181ea412804270a3ebc00e51a9caa3.png';

/** 非网点用户钉钉产品咨询群二维码（OSS 静态资源） */
export const SUPPORT_GROUP_QR_URL_HQ =
  'https://ali-sto-shenji.oss-cn-shanghai.aliyuncs.com/2026/07/3d1e2fe18e8444d7bbff67404578bf84.png';

export function resolveSupportGroupQrUrl(isSiteUserFlag: boolean): string {
  return isSiteUserFlag ? SUPPORT_GROUP_QR_URL_SITE : SUPPORT_GROUP_QR_URL_HQ;
}
