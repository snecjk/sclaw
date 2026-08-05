/**
 * 持续语音对话循环状态。
 * - 全局存 active，避免 Hub→会话页 remount 丢状态
 * - 绑定 sessionKey；用户切换到其他会话时清掉
 * - 仅在「语音发送触发的 DEFAULT 物化」时允许 rebind，避免误把确认文案带到别的会话
 * - awaitingAgentReply：已发送、等回复期间禁止重新开麦（防止 remount 时 sending 抖动误开听）
 */
import { create } from 'zustand';

interface VoiceLoopState {
  active: boolean;
  boundSessionKey: string | null;
  /** 语音链路刚触发发送，等待 DEFAULT→真实会话 key */
  expectMaterialization: boolean;
  /** 已发出去，等当前轮 agent 结束再续听 */
  awaitingAgentReply: boolean;
  setActive: (active: boolean, sessionKey?: string | null) => void;
  rebindSessionKey: (nextSessionKey: string) => void;
  markExpectMaterialization: () => void;
  markAwaitingAgentReply: () => void;
  clearAwaitingAgentReply: () => void;
  clear: () => void;
}

export const useVoiceLoopStore = create<VoiceLoopState>((set, get) => ({
  active: false,
  boundSessionKey: null,
  expectMaterialization: false,
  awaitingAgentReply: false,
  setActive: (active, sessionKey = null) => {
    if (!active) {
      set({
        active: false,
        boundSessionKey: null,
        expectMaterialization: false,
        awaitingAgentReply: false,
      });
      return;
    }
    set({
      active: true,
      boundSessionKey: sessionKey ?? get().boundSessionKey,
      expectMaterialization: false,
      awaitingAgentReply: false,
    });
  },
  rebindSessionKey: (nextSessionKey) => {
    if (!get().active) return;
    set({
      boundSessionKey: nextSessionKey,
      expectMaterialization: false,
    });
  },
  markExpectMaterialization: () => {
    if (!get().active) return;
    set({ expectMaterialization: true });
  },
  markAwaitingAgentReply: () => {
    if (!get().active) return;
    set({ awaitingAgentReply: true });
  },
  clearAwaitingAgentReply: () => set({ awaitingAgentReply: false }),
  clear: () => set({
    active: false,
    boundSessionKey: null,
    expectMaterialization: false,
    awaitingAgentReply: false,
  }),
}));
