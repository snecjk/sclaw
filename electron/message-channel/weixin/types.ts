/** Host types — re-export shared wire contract + binding. */
export type {
  WeixinWireCommand,
  WeixinWireEvent,
  WeixinReasonCode,
} from '../../../shared/weixin-runtime-protocol';

export type { WeixinBinding } from './binding';
