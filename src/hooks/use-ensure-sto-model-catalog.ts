import { useEffect, useRef, useState } from 'react';
import { hasReadyStoModelCatalog } from '@/lib/provider-accounts';
import { hostApiFetch } from '@/lib/host-api';
import { useAuthStore } from '@/stores/auth';
import { useProviderStore } from '@/stores/providers';

const MAX_AUTO_SYNC_ATTEMPTS = 3;

/**
 * When logged in but STO customModels are missing from the provider snapshot,
 * trigger a background sto-model-sync (deduped on main process) and refresh.
 * Shared by Settings and Chat model selectors.
 */
export function useEnsureStoModelCatalog(): { hasCatalog: boolean; syncing: boolean } {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const accounts = useProviderStore((state) => state.accounts);
  const loading = useProviderStore((state) => state.loading);
  const refreshProviderSnapshot = useProviderStore((state) => state.refreshProviderSnapshot);

  const hasCatalog = hasReadyStoModelCatalog(accounts);
  const [syncing, setSyncing] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    if (!isAuthenticated || hasCatalog || loading || syncing) {
      return;
    }
    if (attempts.current >= MAX_AUTO_SYNC_ATTEMPTS) {
      return;
    }
    attempts.current += 1;

    let cancelled = false;
    setSyncing(true);
    void (async () => {
      try {
        await hostApiFetch('/api/sto-model-sync', { method: 'POST' });
        if (!cancelled) {
          await refreshProviderSnapshot();
        }
      } catch (error) {
        console.warn('[sto-catalog] Auto sync failed:', error);
      } finally {
        if (!cancelled) {
          setSyncing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, hasCatalog, loading, syncing, refreshProviderSnapshot]);

  return { hasCatalog, syncing };
}
