import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearBackup,
  IdbDraftStore,
  MemoryDraftStore,
  readBackup,
  writeBackup,
  type DraftStore,
  type StoredDraft,
} from '../core/plan-store';
import type { DayPlan } from '../core/model';

// Автосохранение черновика: IndexedDB с ревизиями, оповещение других вкладок, резервная копия на pagehide.
// Пока черновик читается, loading = true и интерфейс должен быть недоступен для правок.

export type SaveState = 'loading' | 'saved' | 'saving' | 'error' | 'memory';

export function safeLocalStorage(): Storage | null {
  try {
    const s = window.localStorage;
    s.getItem('fdb.v1.probe');
    return s;
  } catch {
    return null;
  }
}

export function usePersistentDraft(initial: () => DayPlan, channelName: string) {
  const [local] = useState(safeLocalStorage);
  const [draft, setDraftState] = useState<DayPlan>(initial);
  const [save, setSave] = useState<SaveState>('loading');
  const [conflict, setConflict] = useState<StoredDraft | null>(null);
  const [recover, setRecover] = useState<DayPlan | null>(null);
  const [external, setExternal] = useState(0);

  const storeRef = useRef<DraftStore | null>(null);
  const revRef = useRef(0);
  const dirtyRef = useRef(false);
  const latestRef = useRef(draft);
  const timerRef = useRef<number | undefined>(undefined);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const channelRef = useRef<BroadcastChannel | null>(null);

  const persist = useCallback(() => {
    chainRef.current = chainRef.current.then(async () => {
      const store = storeRef.current;
      if (!store || !dirtyRef.current) return;
      const snapshot = latestRef.current;
      setSave((s) => (s === 'memory' ? s : 'saving'));
      try {
        const r = await store.putIfRev(snapshot, revRef.current);
        if (!r.ok) {
          setConflict(r.current);
          setSave((s) => (s === 'memory' ? s : 'error'));
          return;
        }
        revRef.current = r.rev;
        if (latestRef.current === snapshot) {
          dirtyRef.current = false;
          clearBackup(local);
        }
        setSave((s) => (s === 'memory' ? s : 'saved'));
        channelRef.current?.postMessage({ type: 'saved', rev: r.rev });
      } catch {
        setSave('error');
      }
    });
    return chainRef.current;
  }, [local]);

  const update = useCallback(
    (fn: (d: DayPlan) => DayPlan) => {
      setDraftState((d) => {
        const next = { ...fn(d), updatedAt: Date.now() };
        latestRef.current = next;
        return next;
      });
      dirtyRef.current = true;
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void persist(), 300);
    },
    [persist],
  );

  const applyStored = useCallback((rec: StoredDraft) => {
    revRef.current = rec.rev;
    dirtyRef.current = false;
    latestRef.current = rec.draft;
    setDraftState(rec.draft);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let store: DraftStore = new IdbDraftStore();
      let rec: StoredDraft | null = null;
      let memory = false;
      try {
        rec = await store.load();
      } catch {
        store = new MemoryDraftStore();
        memory = true;
      }
      if (cancelled) return;
      storeRef.current = store;
      revRef.current = rec?.rev ?? 0;
      const backup = readBackup(local);
      if (backup && backup.baseRev === revRef.current) {
        latestRef.current = backup.draft;
        setDraftState(backup.draft);
        dirtyRef.current = true;
        void persist();
      } else {
        if (rec) applyStored(rec);
        if (backup) setRecover(backup.draft);
      }
      setSave(memory ? 'memory' : 'saved');
    })();

    if ('BroadcastChannel' in window) {
      const ch = new BroadcastChannel(channelName);
      ch.onmessage = async (ev: MessageEvent<{ type: string; rev: number }>) => {
        if (ev.data?.type !== 'saved' || ev.data.rev <= revRef.current || dirtyRef.current) return;
        const rec = await storeRef.current?.load();
        if (!rec || dirtyRef.current) return;
        applyStored(rec);
        setExternal((n) => n + 1);
      };
      channelRef.current = ch;
    }
    const onHide = () => {
      if (dirtyRef.current) writeBackup(local, latestRef.current, revRef.current);
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      cancelled = true;
      channelRef.current?.close();
      window.removeEventListener('pagehide', onHide);
    };
  }, [local, persist, applyStored, channelName]);

  const keepMine = () => {
    revRef.current = conflict?.rev ?? 0;
    setConflict(null);
    dirtyRef.current = true;
    void persist();
  };
  const takeTheirs = () => {
    if (conflict) applyStored(conflict);
    setConflict(null);
    clearBackup(local);
    setSave('saved');
  };
  const dismissRecover = () => {
    setRecover(null);
    clearBackup(local);
  };

  return { draft, latestRef, update, save, conflict, keepMine, takeTheirs, recover, setRecover, dismissRecover, external };
}
