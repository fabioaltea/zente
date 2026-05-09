import type { BoardFile } from "../hooks/useWebRTC";

const DB_NAME = "zente";
const STORE = "files";
const DB_VERSION = 1;

interface StoredFile extends BoardFile {
   username: string;
   blob: Blob;
}

function openDB(): Promise<IDBDatabase> {
   return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
         const db = req.result;
         if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: "id" });
            store.createIndex("by_username", "username");
         }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
   });
}

export async function saveFile(username: string, file: BoardFile, blob: Blob): Promise<void> {
   const db = await openDB();
   return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ ...file, username, blob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
   });
}

export async function loadFiles(username: string): Promise<Array<{ file: BoardFile; blob: Blob }>> {
   const db = await openDB();
   return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).index("by_username").getAll(username);
      req.onsuccess = () => {
         const rows = req.result as StoredFile[];
         resolve(
            rows.map(({ blob, username: _u, ...file }) => ({ file, blob }))
         );
      };
      req.onerror = () => reject(req.error);
   });
}

export async function removeFile(fileId: string): Promise<void> {
   const db = await openDB();
   return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(fileId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
   });
}

export async function clearUserFiles(username: string): Promise<void> {
   const db = await openDB();
   return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.index("by_username").getAllKeys(username);
      req.onsuccess = () => {
         (req.result as IDBValidKey[]).forEach((key) => store.delete(key));
         tx.oncomplete = () => resolve();
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
   });
}
