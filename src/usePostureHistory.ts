import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type PostureHistoryEntry = {
  date: string;
  warningCount: number;
  totalBadPostureTime: number;
};

const STORAGE_KEY = 'postureHistory';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getRecentDateKeys(days: number) {
  const today = new Date();

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getTime() - (days - 1 - index) * ONE_DAY_MS);
    return getDateKey(date);
  });
}

function normalizeHistory(rawHistory: unknown): PostureHistoryEntry[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  return rawHistory
    .filter((entry): entry is PostureHistoryEntry => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as PostureHistoryEntry).date === 'string' &&
        typeof (entry as PostureHistoryEntry).warningCount === 'number' &&
        typeof (entry as PostureHistoryEntry).totalBadPostureTime === 'number'
      );
    })
    .map((entry) => ({
      date: entry.date,
      warningCount: Math.max(0, Math.floor(entry.warningCount)),
      totalBadPostureTime: Math.max(0, Math.floor(entry.totalBadPostureTime)),
    }));
}

function ensureDateEntry(history: PostureHistoryEntry[], date: string) {
  if (history.some((entry) => entry.date === date)) {
    return history;
  }

  return [...history, { date, warningCount: 0, totalBadPostureTime: 0 }];
}

function ensureDateEntries(history: PostureHistoryEntry[], dates: string[]) {
  return dates.reduce((currentHistory, date) => ensureDateEntry(currentHistory, date), history);
}

function readStoredHistory() {
  try {
    const rawHistory = localStorage.getItem(STORAGE_KEY);
    const parsedHistory = rawHistory ? JSON.parse(rawHistory) : [];

    return ensureDateEntries(normalizeHistory(parsedHistory), getRecentDateKeys(7));
  } catch {
    return ensureDateEntries([], getRecentDateKeys(7));
  }
}

function updateToday(
  history: PostureHistoryEntry[],
  updater: (entry: PostureHistoryEntry) => PostureHistoryEntry,
) {
  const today = getDateKey();
  const historyWithToday = ensureDateEntry(history, today);

  return historyWithToday.map((entry) => (entry.date === today ? updater(entry) : entry));
}

export function usePostureHistory(isBadPostureActive: boolean) {
  const wasBadPostureActiveRef = useRef(false);
  const [history, setHistory] = useState<PostureHistoryEntry[]>(readStoredHistory);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  const recordWarning = useCallback(() => {
    setHistory((currentHistory) =>
      updateToday(currentHistory, (entry) => ({
        ...entry,
        warningCount: entry.warningCount + 1,
      })),
    );
  }, []);

  const addBadPostureSecond = useCallback(() => {
    setHistory((currentHistory) =>
      updateToday(currentHistory, (entry) => ({
        ...entry,
        totalBadPostureTime: entry.totalBadPostureTime + 1,
      })),
    );
  }, []);

  useEffect(() => {
    if (isBadPostureActive && !wasBadPostureActiveRef.current) {
      recordWarning();
    }

    wasBadPostureActiveRef.current = isBadPostureActive;
  }, [isBadPostureActive, recordWarning]);

  useEffect(() => {
    if (!isBadPostureActive) {
      return;
    }

    const intervalId = window.setInterval(addBadPostureSecond, 1000);

    return () => window.clearInterval(intervalId);
  }, [addBadPostureSecond, isBadPostureActive]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setHistory((currentHistory) => ensureDateEntries(currentHistory, getRecentDateKeys(7)));
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const today = useMemo(() => {
    const todayKey = getDateKey();
    return ensureDateEntry(history, todayKey).find((entry) => entry.date === todayKey)!;
  }, [history]);

  const recentSevenDays = useMemo(() => {
    const historyMap = new Map(history.map((entry) => [entry.date, entry]));

    return getRecentDateKeys(7).map(
      (date) => historyMap.get(date) ?? { date, warningCount: 0, totalBadPostureTime: 0 },
    );
  }, [history]);

  return {
    history,
    today,
    recentSevenDays,
  };
}
