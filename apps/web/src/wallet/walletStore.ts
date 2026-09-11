// IndexedDB persistence for the encrypted wallet blob -- never `localStorage` (IMPLEMENTATION_PLAN.md
// Fase H: "never localStorage for the encrypted seed"). Stores only the ciphertext + salt/iv +
// the wallet's real public extended key (safe to store in the clear -- it's what gets registered
// with Ishtaran anyway) and the derived receiving address. The passphrase and plaintext mnemonic
// never touch this module.
import type { EncryptedBlob } from './cryptoStorage.js';

const DB_NAME = 'ishtaran-wallet';
const DB_VERSION = 1;
const STORE_NAME = 'wallet';
const RECORD_KEY = 'default'; // V1: one wallet per browser profile, matching PRODUCT_SPEC's V1 scope.

export interface StoredWalletRecord {
  encryptedMnemonic: EncryptedBlob;
  accountExtendedPublicKey: string;
  address: string;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWalletRecord(record: StoredWalletRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadWalletRecord(): Promise<StoredWalletRecord | undefined> {
  const db = await openDb();
  const record = await new Promise<StoredWalletRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
    request.onsuccess = () => resolve(request.result as StoredWalletRecord | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return record;
}

export async function clearWalletRecord(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
