'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';

type ComparisonType = 'MOM' | 'YOY' | 'YTD';

type ReasonOverride = {
  id: number;
  accountCode: string;
  comparisonType: ComparisonType;
  currentPeriod: string;
  comparisonPeriod: string;
  generatedReason: string;
  userComment: string;
  updatedByName: string;
  updatedAt: string;
};

type ReasonMeta = {
  key: string;
  accountCode: string;
  comparisonType: ComparisonType;
  currentPeriod: string;
  comparisonPeriod: string;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const MONTHS: Record<string, number> = {
  jan: 1,
  januari: 1,
  feb: 2,
  februari: 2,
  mar: 3,
  maret: 3,
  apr: 4,
  april: 4,
  mei: 5,
  may: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  agu: 8,
  agt: 8,
  agustus: 8,
  aug: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  oct: 10,
  nov: 11,
  november: 11,
  des: 12,
  desember: 12,
  dec: 12,
  december: 12,
};

const buildKey = (
  accountCode: string,
  comparisonType: ComparisonType,
  currentPeriod: string,
  comparisonPeriod: string,
): string => `${accountCode}|${comparisonType}|${currentPeriod}|${comparisonPeriod}`;

const parsePeriodLabel = (raw: string): string => {
  const value = String(raw ?? '').replace(/\[up to\]/gi, '').trim();
  const direct = value.match(/(20\d{2})[.\-/](0?[1-9]|1[0-2])(?:\b|$)/);
  if (direct) return `${direct[1]}.${String(Number(direct[2])).padStart(2, '0')}`;

  const lower = value.toLowerCase();
  const year4 = lower.match(/20\d{2}/)?.[0];
  let month = 0;
  for (const [token, monthNo] of Object.entries(MONTHS)) {
    if (new RegExp(`(?:^|[^a-z])${token}(?:[^a-z]|$)`, 'i').test(lower)) {
      month = monthNo;
      break;
    }
  }

  if (year4 && month) return `${year4}.${String(month).padStart(2, '0')}`;

  const monthYear = lower.match(
    /(?:jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|may|jun(?:i)?|jul(?:i)?|agu(?:stus)?|agt|aug|sep(?:t(?:ember)?)?|okt(?:ober)?|oct|nov(?:ember)?|des(?:ember)?|dec(?:ember)?)[-\s/]+(\d{2,4})/i,
  );
  if (monthYear && month) {
    const year = monthYear[1].length === 2 ? 2000 + Number(monthYear[1]) : Number(monthYear[1]);
    return `${year}.${String(month).padStart(2, '0')}`;
  }

  return '';
};

const getSelectedPeriodPair = (comparisonType: ComparisonType): { currentPeriod: string; comparisonPeriod: string } | null => {
  const label = comparisonType === 'MOM' ? 'MoM' : comparisonType === 'YOY' ? 'YoY' : 'YtD';
  const spans = Array.from(document.querySelectorAll('span'));

  for (const span of spans) {
    if (span.textContent?.trim() !== label) continue;
    const parent = span.parentElement;
    if (!parent) continue;
    const selects = parent.querySelectorAll('select');
    if (selects.length < 2) continue;

    const currentText = selects[0].options[selects[0].selectedIndex]?.textContent ?? '';
    const comparisonText = selects[1].options[selects[1].selectedIndex]?.textContent ?? '';
    const currentPeriod = parsePeriodLabel(currentText);
    const comparisonPeriod = parsePeriodLabel(comparisonText);
    if (currentPeriod && comparisonPeriod) return { currentPeriod, comparisonPeriod };
  }

  return null;
};

const resolveReasonMeta = (textarea: HTMLTextAreaElement): ReasonMeta | null => {
  const row = textarea.closest('tr.js-rekap-row');
  if (!row) return null;

  const accountCode = row.querySelector('td')?.textContent?.trim() ?? '';
  if (!/^\d{5,}$/.test(accountCode)) return null;

  const cell = textarea.closest('td');
  const button = cell?.querySelector<HTMLButtonElement>('button[title^="Generate AI Reason"]');
  const title = button?.title?.toUpperCase() ?? '';
  const match = title.match(/\b(MOM|YOY|YTD)\b/);
  if (!match) return null;

  const comparisonType = match[1] as ComparisonType;
  const periods = getSelectedPeriodPair(comparisonType);
  if (!periods) return null;

  return {
    accountCode,
    comparisonType,
    currentPeriod: periods.currentPeriod,
    comparisonPeriod: periods.comparisonPeriod,
    key: buildKey(accountCode, comparisonType, periods.currentPeriod, periods.comparisonPeriod),
  };
};

const setTextareaValue = (textarea: HTMLTextAreaElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
};

export default function ReasonPersistenceBridge() {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const overridesRef = useRef<Map<string, ReasonOverride>>(new Map());
  const dirtyRef = useRef(new WeakSet<HTMLTextAreaElement>());
  const sourceReasonRef = useRef(new WeakMap<HTMLTextAreaElement, string>());
  const appliedRef = useRef(new WeakMap<HTMLTextAreaElement, string>());
  const timersRef = useRef(new Map<HTMLTextAreaElement, ReturnType<typeof setTimeout>>());
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = useCallback((next: SaveStatus) => {
    setStatus(next);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (next === 'saved') {
      statusTimerRef.current = setTimeout(() => setStatus('idle'), 1800);
    }
  }, []);

  const scanOverrides = useCallback(() => {
    const textareas = document.querySelectorAll<HTMLTextAreaElement>('tr.js-rekap-row textarea');

    for (const textarea of textareas) {
      if (document.activeElement === textarea || dirtyRef.current.has(textarea)) continue;
      const meta = resolveReasonMeta(textarea);
      if (!meta) continue;
      const override = overridesRef.current.get(meta.key);
      if (!override) continue;

      const version = `${meta.key}|${override.updatedAt}|${override.userComment}`;
      if (appliedRef.current.get(textarea) === version) continue;

      appliedRef.current.set(textarea, version);
      sourceReasonRef.current.set(textarea, override.generatedReason || textarea.value);
      if (textarea.value !== override.userComment) {
        setTextareaValue(textarea, override.userComment);
      }
    }
  }, []);

  const scheduleScan = useCallback(() => {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = setTimeout(scanOverrides, 80);
  }, [scanOverrides]);

  const loadOverrides = useCallback(async () => {
    try {
      const response = await fetch('/api/fluktuasi/reasons', { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      if (!result?.success || !Array.isArray(result.data)) return;

      const next = new Map<string, ReasonOverride>();
      for (const raw of result.data as ReasonOverride[]) {
        if (!raw?.accountCode || !raw?.comparisonType || !raw?.currentPeriod || !raw?.comparisonPeriod) continue;
        next.set(
          buildKey(raw.accountCode, raw.comparisonType, raw.currentPeriod, raw.comparisonPeriod),
          raw,
        );
      }
      overridesRef.current = next;
      scheduleScan();
    } catch {
      // Main page remains usable if persistence endpoint is temporarily unavailable.
    }
  }, [scheduleScan]);

  const saveOverride = useCallback(async (
    textarea: HTMLTextAreaElement,
    meta: ReasonMeta,
    generatedReason: string,
  ) => {
    showStatus('saving');
    try {
      const response = await fetch('/api/fluktuasi/reasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountCode: meta.accountCode,
          comparisonType: meta.comparisonType,
          currentPeriod: meta.currentPeriod,
          comparisonPeriod: meta.comparisonPeriod,
          generatedReason,
          userComment: textarea.value,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success || !result?.data) {
        throw new Error(result?.error || `HTTP ${response.status}`);
      }

      const saved = result.data as ReasonOverride;
      overridesRef.current.set(meta.key, saved);
      dirtyRef.current.delete(textarea);
      appliedRef.current.set(textarea, `${meta.key}|${saved.updatedAt}|${saved.userComment}`);
      showStatus('saved');
    } catch (error) {
      console.error('Gagal autosave komentar final fluktuasi:', error);
      showStatus('error');
    } finally {
      timersRef.current.delete(textarea);
    }
  }, [showStatus]);

  useRealtimeUpdates(['fluktuasi'], useCallback(() => {
    void loadOverrides();
  }, [loadOverrides]));

  useEffect(() => {
    void loadOverrides();

    const onFocusIn = (event: FocusEvent) => {
      const textarea = event.target instanceof HTMLTextAreaElement ? event.target : null;
      if (!textarea || !textarea.closest('tr.js-rekap-row')) return;
      sourceReasonRef.current.set(textarea, textarea.value);
    };

    const onInput = (event: Event) => {
      if (!event.isTrusted) return;
      const textarea = event.target instanceof HTMLTextAreaElement ? event.target : null;
      if (!textarea || !textarea.closest('tr.js-rekap-row')) return;
      const meta = resolveReasonMeta(textarea);
      if (!meta) return;

      dirtyRef.current.add(textarea);
      const generatedReason = sourceReasonRef.current.get(textarea) ?? '';
      const existingTimer = timersRef.current.get(textarea);
      if (existingTimer) clearTimeout(existingTimer);
      timersRef.current.set(
        textarea,
        setTimeout(() => void saveOverride(textarea, meta, generatedReason), 900),
      );
    };

    const onFocusOut = (event: FocusEvent) => {
      const textarea = event.target instanceof HTMLTextAreaElement ? event.target : null;
      if (!textarea || !dirtyRef.current.has(textarea)) return;
      const meta = resolveReasonMeta(textarea);
      if (!meta) return;

      const existingTimer = timersRef.current.get(textarea);
      if (existingTimer) clearTimeout(existingTimer);
      const generatedReason = sourceReasonRef.current.get(textarea) ?? '';
      void saveOverride(textarea, meta, generatedReason);
    };

    const onChange = (event: Event) => {
      if (event.target instanceof HTMLSelectElement) {
        scheduleScan();
      }
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('input', onInput);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('change', onChange);

    const observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleScan();

    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('input', onInput);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('change', onChange);
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, [loadOverrides, saveOverride, scheduleScan]);

  if (status === 'idle') return null;

  const label = status === 'saving'
    ? 'Menyimpan komentar...'
    : status === 'saved'
      ? 'Komentar tersimpan'
      : 'Komentar belum tersimpan';

  return (
    <div
      className={`fixed bottom-4 right-4 z-[120] rounded-lg border px-3 py-2 text-[11px] font-medium shadow-lg ${
        status === 'error'
          ? 'border-red-200 bg-red-50 text-red-700'
          : status === 'saved'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-blue-200 bg-white text-blue-700'
      }`}
      role="status"
      aria-live="polite"
    >
      {label}
    </div>
  );
}
