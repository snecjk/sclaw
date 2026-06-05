/**
 * Hook for natural language scheduled task creation
 * 
 * Detects scheduled task creation intent from user input,
 * extracts parameters, shows confirmation modal, and creates the task.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { extractScheduledTaskParams } from '@/lib/scheduled-task-nl-extractor';
import { useScheduledTasksStore } from '@/stores/scheduledTasks';
import type { ScheduledTaskCreateInput } from '@/types/scheduled-task';
import type { ExtractedTaskParams } from '@/lib/scheduled-task-nl-extractor';

interface UseScheduledTaskNlCreationReturn {
  nlModalOpen: boolean;
  extractedParams: ExtractedTaskParams;
  openNlModal: (params: ExtractedTaskParams) => void;
  closeNlModal: () => void;
  handleNlCreation: (input: ScheduledTaskCreateInput) => Promise<void>;
  detectAndCreate: (text: string) => Promise<{ handled: boolean; reason?: string }>;
}

/**
 * 检测文本是否包含定时任务创建意图
 */
function detectScheduledTaskIntent(text: string): boolean {
  const keywords = [
    '每天', '每周', '每月', '定期', '定时',
    '提醒我', '提醒', '通知', '自动',
    '点钟', '点', '上午', '下午', '早上', '晚上',
    '周一', '周二', '周三', '周四', '周五', '周六', '周日',
    '工作日', '周末',
  ];
  
  // 至少包含 2 个关键词才认为是定时任务意图
  let matchCount = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      matchCount++;
    }
  }
  
  return matchCount >= 2;
}

export function useScheduledTaskNlCreation(): UseScheduledTaskNlCreationReturn {
  const navigate = useNavigate();
  const createTask = useScheduledTasksStore((s) => s.createTask);
  const fetchTasks = useScheduledTasksStore((s) => s.fetchTasks);
  
  const [nlModalOpen, setNlModalOpen] = useState(false);
  const [extractedParams, setExtractedParams] = useState<ExtractedTaskParams>({});

  const openNlModal = useCallback((params: ExtractedTaskParams) => {
    setExtractedParams(params);
    setNlModalOpen(true);
  }, []);

  const closeNlModal = useCallback(() => {
    setNlModalOpen(false);
    setExtractedParams({});
  }, []);

  const handleNlCreation = useCallback(async (input: ScheduledTaskCreateInput) => {
    try {
      const task = await createTask(input);
      toast.success(`任务"${task.name}"已创建`);
      
      // 刷新任务列表
      await fetchTasks();
      
      // 跳转到定时任务列表页
      navigate('/scheduled-tasks');
    } catch (err) {
      const message = String(err);
      toast.error(`创建失败：${message}`);
      throw err;
    }
  }, [createTask, fetchTasks, navigate]);

  const detectAndCreate = useCallback(async (text: string): Promise<{ handled: boolean; reason?: string }> => {
    // 1. 检测意图
    if (!detectScheduledTaskIntent(text)) {
      return { handled: false, reason: 'not_scheduled_task_intent' };
    }

    // 2. 提取参数
    const params = extractScheduledTaskParams(text);
    
    // 3. 打开确认弹窗（无论参数是否完整，都让用户确认/补充）
    openNlModal(params);
    
    return { handled: true };
  }, [openNlModal]);

  return {
    nlModalOpen,
    extractedParams,
    openNlModal,
    closeNlModal,
    handleNlCreation,
    detectAndCreate,
  };
}
