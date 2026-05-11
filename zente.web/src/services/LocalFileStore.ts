import type { BoardFile } from "../hooks/useWebRTC";

const DB_NAME = "zente";
const STORE = "files";
const DB_VERSION = 1;

interface StoredFile extends BoardFile {
   username: string;
   blob: Blob;
}

export interface LoadedFile {
   file: BoardFile;
   blob: Blob;
}

export class LocalFileStore {
   private dbPromise: Promise<IDBDatabase> | null = null;

   private openDB(): Promise<IDBDatabase> {
      if (this.dbPromise) return this.dbPromise;
      this.dbPromise = new Promise((resolve, reject) => {
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
      return this.dbPromise;
   }

   async loadAll(username: string): Promise<LoadedFile[]> {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
         const tx = db.transaction(STORE, "readonly");
         const req = tx.objectStore(STORE).index("by_username").getAll(username);
         req.onsuccess = () => {
            const rows = req.result as StoredFile[];
            resolve(rows.map(({ blob, username: _u, ...file }) => ({ file, blob })));
         };
         req.onerror = () => reject(req.error);
      });
   }

   async save(username: string, file: BoardFile, blob: Blob): Promise<void> {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
         const tx = db.transaction(STORE, "readwrite");
         tx.objectStore(STORE).put({ ...file, username, blob });
         tx.oncomplete = () => resolve();
         tx.onerror = () => reject(tx.error);
      });
   }

   async remove(fileId: string): Promise<void> {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
         const tx = db.transaction(STORE, "readwrite");
         tx.objectStore(STORE).delete(fileId);
         tx.oncomplete = () => resolve();
         tx.onerror = () => reject(tx.error);
      });
   }

   async clearUser(username: string): Promise<void> {
      const db = await this.openDB();
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
}
