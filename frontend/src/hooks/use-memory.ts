import { useCallback, useMemo } from 'react';

import { MEMORY_CATEGORY_ORDER } from '@/data/mock-memory';
import { SEED_MEMORIES } from '@/data/mock-memory';
import { usePersistentState } from '@/hooks/use-persistent-state';
import type { MemoryCategory, MemoryItem } from '@/types';

/**
 * Memory items PADI may keep — only ever with the user's permission.
 * Nothing is collected automatically; every entry can be corrected, paused or deleted.
 */
export function useMemory() {
  const [items, setItems, status] = usePersistentState<MemoryItem[]>('memory-items', SEED_MEMORIES);

  const correct = useCallback(
    (id: string, value: string) => {
      setItems((prev) => prev.map((m) => (m.id === id ? { ...m, value } : m)));
    },
    [setItems],
  );

  const togglePaused = useCallback(
    (id: string) => {
      setItems((prev) => prev.map((m) => (m.id === id ? { ...m, paused: !m.paused } : m)));
    },
    [setItems],
  );

  const remove = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((m) => m.id !== id));
    },
    [setItems],
  );

  const grouped = useMemo(() => {
    return MEMORY_CATEGORY_ORDER.map((category) => ({
      category,
      items: items.filter((m) => m.category === category),
    })).filter((group) => group.items.length > 0);
  }, [items]);

  const counts = useMemo(() => {
    const byCategory: Record<MemoryCategory, number> = {
      name: 0,
      interests: 0,
      relationships: 0,
      preferences: 0,
      plans: 0,
    };
    items.forEach((m) => {
      byCategory[m.category] += 1;
    });
    return {
      total: items.length,
      active: items.filter((m) => !m.paused).length,
      paused: items.filter((m) => m.paused).length,
      byCategory,
    };
  }, [items]);

  return { items, grouped, counts, status, correct, togglePaused, remove };
}
