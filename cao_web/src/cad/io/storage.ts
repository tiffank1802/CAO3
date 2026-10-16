/**
 * Stockage local des documents (IndexedDB) — « technique des jeux en ligne » appliquée à la CAO :
 * le document est petit (JSON de quelques kilo-octets), il n'a rien à faire dans la mémoire vive
 * longue durée ni dans le cache HTTP. On le range dans la base du navigateur, qui est faite
 * pour ça (budget de stockage de l'ordre du gigaoctet, contrairement aux 5 Mo du localStorage).
 *
 * Deux bénéfices concrets :
 *  1. `document` reste la source de vérité et survit à un rechargement, un onglet fermé ou un
 *     plantage du navigateur (aucun travail perdu) ;
 *  2. rien n'est envoyé sur le réseau : aucune donnée ne quitte la machine.
 *
 * Le module **dégrade proprement** : sans IndexedDB (navigation privée, quota refusé, test en
 * environnement nu), toutes les fonctions répondent « indisponible » au lieu de lever.
 */
export interface StoredDocumentMeta {
  id: string;
  name: string;
  updatedAt: number;
  features: number;
  bytes: number;
  volume: number | null;
}

interface StoredDocument extends StoredDocumentMeta {
  json: string;
}

const DB_NAME = "cao3";
const DB_VERSION = 1;
const STORE = "documents";

let database: IDBDatabase | null = null;
let unavailable = false;
/** Horodatage du dernier enregistrement : garantit un ordre strict même en deçà de la milliseconde. */
let lastTimestamp = 0;

function supported(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

/** Ouvre (ou récupère) la base. Renvoie null si le stockage est indisponible. */
export function openDatabase(): Promise<IDBDatabase | null> {
  if (unavailable || !supported()) return Promise.resolve(null);
  if (database) return Promise.resolve(database);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      unavailable = true;
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      database = request.result;
      resolve(database);
    };
    request.onerror = () => {
      unavailable = true;
      resolve(null);
    };
    request.onblocked = () => resolve(null);
  });
}

export function isStorageAvailable(): Promise<boolean> {
  return openDatabase().then((db) => db !== null);
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDatabase().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
        transaction.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** Variante pour les opérations sans résultat (suppression) : le succès suffit. */
function runVoid(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<boolean> {
  return openDatabase().then((db) => {
    if (!db) return false;
    return new Promise<boolean>((resolve) => {
      try {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  });
}

export interface SavePayload {
  id: string;
  name: string;
  json: string;
  features: number;
  volume: number | null;
}

/** Enregistre le document ; renvoie false si le stockage est refusé (quota, mode privé…). */
export async function saveDocumentRecord(payload: SavePayload): Promise<boolean> {
  lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
  const record: StoredDocument = {
    id: payload.id,
    name: payload.name,
    json: payload.json,
    features: payload.features,
    volume: payload.volume,
    bytes: payload.json.length,
    updatedAt: lastTimestamp,
  };
  return runVoid("readwrite", (store) => store.put(record));
}

export function loadDocumentRecord(id: string): Promise<StoredDocument | null> {
  return run<StoredDocument>("readonly", (store) => store.get(id) as IDBRequest<StoredDocument>);
}

/** Liste les documents locaux, du plus récent au plus ancien (métadonnées seulement). */
export async function listDocuments(): Promise<StoredDocumentMeta[]> {
  const records = await run<StoredDocument[]>("readonly", (store) => store.getAll() as IDBRequest<StoredDocument[]>);
  if (!records) return [];
  return records
    .map(({ id, name, updatedAt, features, bytes, volume }) => ({ id, name, updatedAt, features, bytes, volume }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteDocumentRecord(id: string): Promise<boolean> {
  return runVoid("readwrite", (store) => store.delete(id));
}

/** Dernier document enregistré (celui à reprendre au démarrage). */
export async function latestDocument(): Promise<StoredDocumentMeta | null> {
  const documents = await listDocuments();
  return documents[0] ?? null;
}

/** Réservé aux tests : oublie la connexion courante. */
export function resetStorageForTests(): void {
  database = null;
  unavailable = false;
  lastTimestamp = 0;
}
