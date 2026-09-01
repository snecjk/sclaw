import { useParams } from 'react-router-dom';
import AppDevWorkbench from './AppDevWorkbench';

export default function AppDevIdePage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const decoded = decodeURIComponent(workspaceId);

  if (!decoded.trim()) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        缺少工作区
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 w-screen flex-col overflow-hidden bg-background">
      <AppDevWorkbench layout="ide" />
    </div>
  );
}
