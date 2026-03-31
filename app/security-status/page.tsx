'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Activity, RefreshCw, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const Sidebar = dynamic(() => import('@/app/components/Sidebar'), { ssr: false });
const Header = dynamic(() => import('@/app/components/Header'), { ssr: false });

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

type StatusResponse = {
  success: boolean;
  score: { passed: number; failed: number; total: number };
  checks: Check[];
  timestamp: string;
};

type SelfTest = {
  name: string;
  ok: boolean;
  expected: string;
  actual: string;
};

type SelfTestResponse = {
  success: boolean;
  score: { passed: number; failed: number; total: number };
  tests: SelfTest[];
  timestamp: string;
};

export default function SecurityStatusPage() {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingSelfTest, setLoadingSelfTest] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoRefreshSelfTest, setAutoRefreshSelfTest] = useState(false);
  const [criticalAlarm, setCriticalAlarm] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [lastSelfTestUpdated, setLastSelfTestUpdated] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const prevHealthRef = useRef<string>('UNKNOWN');
  const [prefsHydrated, setPrefsHydrated] = useState(false);

  const playCriticalAlarm = () => {
    if (typeof window === 'undefined') return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(660, now + 0.12);
      osc.frequency.setValueAtTime(880, now + 0.24);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    } catch {
      // ignore audio failures
    }
  };

  const loadStatus = async () => {
    setLoadingStatus(true);
    setError('');
    try {
      const res = await fetch('/api/security/status', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Gagal memuat status keamanan');
      setStatus(data);
      setLastUpdated(new Date().toISOString());
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Terjadi kesalahan';
      setError(msg);
    } finally {
      setLoadingStatus(false);
    }
  };

  const runSelfTest = async () => {
    setLoadingSelfTest(true);
    setError('');
    try {
      const res = await fetch('/api/security/status/self-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Gagal menjalankan self-test');
      setSelfTest(data);
      setLastSelfTestUpdated(new Date().toISOString());
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Terjadi kesalahan';
      setError(msg);
    } finally {
      setLoadingSelfTest(false);
    }
  };

  const exportAsJson = (name: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    try {
      const ar = localStorage.getItem('securityStatus:autoRefresh');
      const ast = localStorage.getItem('securityStatus:autoRefreshSelfTest');
      const ca = localStorage.getItem('securityStatus:criticalAlarm');
      if (ar !== null) setAutoRefresh(ar === 'true');
      if (ast !== null) setAutoRefreshSelfTest(ast === 'true');
      if (ca !== null) setCriticalAlarm(ca === 'true');
    } finally {
      setPrefsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!prefsHydrated) return;
    localStorage.setItem('securityStatus:autoRefresh', String(autoRefresh));
  }, [autoRefresh, prefsHydrated]);

  useEffect(() => {
    if (!prefsHydrated) return;
    localStorage.setItem('securityStatus:autoRefreshSelfTest', String(autoRefreshSelfTest));
  }, [autoRefreshSelfTest, prefsHydrated]);

  useEffect(() => {
    if (!prefsHydrated) return;
    localStorage.setItem('securityStatus:criticalAlarm', String(criticalAlarm));
  }, [criticalAlarm, prefsHydrated]);

  const resetPreferences = () => {
    setAutoRefresh(true);
    setAutoRefreshSelfTest(false);
    setCriticalAlarm(true);
    localStorage.removeItem('securityStatus:autoRefresh');
    localStorage.removeItem('securityStatus:autoRefreshSelfTest');
    localStorage.removeItem('securityStatus:criticalAlarm');
    toast.success('Preferensi security status berhasil direset ke default.');
  };

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      loadStatus();
    }, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  useEffect(() => {
    if (!autoRefreshSelfTest) return;
    const id = setInterval(() => {
      runSelfTest();
    }, 180_000);
    return () => clearInterval(id);
  }, [autoRefreshSelfTest]);

  const healthState = (() => {
    const scoreTotal = (status?.score.total ?? 0) + (selfTest?.score.total ?? 0);
    const scoreFailed = (status?.score.failed ?? 0) + (selfTest?.score.failed ?? 0);
    if (scoreTotal === 0) return { label: 'UNKNOWN', className: 'bg-slate-600 text-white' };
    if (scoreFailed === 0) return { label: 'HEALTHY', className: 'bg-green-600 text-white' };
    if (scoreFailed <= 2) return { label: 'WARNING', className: 'bg-yellow-500 text-black' };
    return { label: 'CRITICAL', className: 'bg-red-600 text-white' };
  })();

  useEffect(() => {
    const prev = prevHealthRef.current;
    const next = healthState.label;
    if (prev === next) return;

    // Skip first render transition from initial UNKNOWN.
    if (prev !== 'UNKNOWN') {
      if (next === 'HEALTHY') {
        toast.success('Security health kembali normal (HEALTHY).');
      } else if (next === 'WARNING') {
        toast.warning('Security health turun ke WARNING. Mohon periksa hasil check.');
      } else if (next === 'CRITICAL') {
        toast.error('Security health CRITICAL. Tindakan segera diperlukan.');
        if (criticalAlarm) playCriticalAlarm();
      }
    }

    prevHealthRef.current = next;
  }, [healthState.label]);

  return (
    <div className="flex min-h-screen bg-background overflow-x-hidden">
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ${
        isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        <Sidebar onClose={() => setIsMobileSidebarOpen(false)} />
      </div>

      <div className="flex-1 bg-background lg:ml-64 min-w-0 overflow-x-hidden">
        <Header
          title="Security Status"
          subtitle="Audit runtime keamanan aplikasi"
          onMenuClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        />

        <div className="p-4 sm:p-6 md:p-8 space-y-4">
          <Card>
            <CardContent className="pt-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Global Security Health</p>
                <p className="text-xs text-muted-foreground">Gabungan hasil status check + self-test</p>
              </div>
              <Badge className={cn(healthState.className)}>
                {healthState.label}
              </Badge>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button onClick={loadStatus} disabled={loadingStatus}>
              {loadingStatus ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              Cek Security Status
            </Button>
            <Button onClick={runSelfTest} variant="outline" disabled={loadingSelfTest}>
              {loadingSelfTest ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Activity className="w-4 h-4 mr-2" />}
              Jalankan Self-Test
            </Button>
            <Button
              onClick={() => exportAsJson('security-status', status)}
              variant="outline"
              disabled={!status}
            >
              <Download className="w-4 h-4 mr-2" />
              Export Status JSON
            </Button>
            <Button
              onClick={() => exportAsJson('security-self-test', selfTest)}
              variant="outline"
              disabled={!selfTest}
            >
              <Download className="w-4 h-4 mr-2" />
              Export Self-Test JSON
            </Button>
            <Button
              onClick={() => setAutoRefresh((v) => !v)}
              variant={autoRefresh ? 'default' : 'outline'}
            >
              {autoRefresh ? 'Auto Refresh: ON (30s)' : 'Auto Refresh: OFF'}
            </Button>
            <Button
              onClick={() => setAutoRefreshSelfTest((v) => !v)}
              variant={autoRefreshSelfTest ? 'default' : 'outline'}
            >
              {autoRefreshSelfTest ? 'Auto Self-Test: ON (3m)' : 'Auto Self-Test: OFF'}
            </Button>
            <Button
              onClick={() => setCriticalAlarm((v) => !v)}
              variant={criticalAlarm ? 'default' : 'outline'}
            >
              {criticalAlarm ? 'Critical Alarm: ON' : 'Critical Alarm: OFF'}
            </Button>
            <Button onClick={() => setShowResetConfirm(true)} variant="outline">
              Reset Preferences
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleString('id-ID') : '-'}
          </p>
          <p className="text-xs text-muted-foreground">
            Last self-test: {lastSelfTestUpdated ? new Date(lastSelfTestUpdated).toLocaleString('id-ID') : '-'}
          </p>

          {error && (
            <Card className="border-destructive/30">
              <CardContent className="pt-4 text-sm text-destructive">{error}</CardContent>
            </Card>
          )}

          {status && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Security Status</span>
                  <Badge variant={status.score.failed === 0 ? 'success' : 'destructive'}>
                    {status.score.passed}/{status.score.total} passed
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {status.checks.map((c) => (
                  <div key={c.name} className="flex items-center justify-between rounded border p-2">
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.detail}</p>
                    </div>
                    <Badge className={cn(c.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white')}>
                      {c.ok ? 'OK' : 'FAIL'}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {selfTest && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Security Self-Test</span>
                  <Badge variant={selfTest.score.failed === 0 ? 'success' : 'destructive'}>
                    {selfTest.score.passed}/{selfTest.score.total} passed
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {selfTest.tests.map((t) => (
                  <div key={t.name} className="flex items-center justify-between rounded border p-2">
                    <div>
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">Expected: {t.expected} | Actual: {t.actual}</p>
                    </div>
                    <Badge className={cn(t.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white')}>
                      {t.ok ? 'OK' : 'FAIL'}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowResetConfirm(false)} />
          <Card className="relative w-full max-w-md">
            <CardHeader>
              <CardTitle>Reset Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Yakin ingin mereset semua preferensi security status ke default?
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowResetConfirm(false)}>
                  Batal
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    resetPreferences();
                    setShowResetConfirm(false);
                  }}
                >
                  Ya, Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
