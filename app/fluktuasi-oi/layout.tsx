'use client';

import { useEffect, useState, type ReactNode } from 'react';
import ReasonPersistenceBridge from './ReasonPersistenceBridge';

const IDB_NAME = 'fluktuasi-oi-v1';
const IDB_STORE = 'sheets';
const IDB_KEY = 'current';

/**
 * `fluktuasi-oi` historically treated IndexedDB as source of truth. Because
 * IndexedDB is isolated per browser, two browsers could keep different full
 * workbook snapshots forever even after refresh. The server/database is now
 * authoritative, so remove only this module's legacy snapshot before the page
 * mounts. Auth/session/localStorage and other application caches are untouched.
 */
const clearLegacyFluktuasiSnapshot = async (): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  await new Promise<void>((resolve) => {
    const request = indexedDB.open(IDB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };

    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.close();
        resolve();
        return;
      }

      try {
        const transaction = db.transaction(IDB_STORE, 'readwrite');
        transaction.objectStore(IDB_STORE).delete(IDB_KEY);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          resolve();
        };
        transaction.onabort = () => {
          db.close();
          resolve();
        };
      } catch {
        db.close();
        resolve();
      }
    };
  });
};

export default function FluktuasiOILayout({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    void clearLegacyFluktuasiSnapshot().finally(() => {
      if (active) setReady(true);
    });

    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return <div className="min-h-screen bg-gray-50" aria-busy="true" />;
  }

  return (
    <>
      <ReasonPersistenceBridge />
      {children}
    </>
  );
}
