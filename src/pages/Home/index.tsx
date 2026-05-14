import { HomeAgentHubSurface } from './HomeAgentHubSurface';

/**
 * 首页：智能助手工作台概览（sto-design 色板）。
 */
export function Home() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] min-h-[calc(100svh-5rem)] flex-col px-1 pb-4 pt-2 sm:px-2">
      <HomeAgentHubSurface />
    </div>
  );
}
