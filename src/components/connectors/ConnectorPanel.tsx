import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

import { ConnectorCard } from '@/components/connectors/ConnectorCard';
import { useConnectorsStore } from '@/stores/connectors';

export function ConnectorPanel() {
  const { items, loading, error, connectingId, fetchList, connect, disconnect, tokenConnect } =
    useConnectorsStore();

  useEffect(() => {
    void fetchList(true);
  }, [fetchList]);

  return (
    <div className="connector-panel flex flex-col gap-4 p-1">

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 py-10 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载连接器…
        </div>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <div className="py-10 text-center text-[13px] text-muted-foreground">
          暂无可用连接器
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((item) => (
          <ConnectorCard
            key={item.id}
            item={item}
            busy={connectingId === item.id}
            onConnect={connect}
            onDisconnect={disconnect}
            onTokenConnect={tokenConnect}
          />
        ))}
      </div>
    </div>
  );
}
