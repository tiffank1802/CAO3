/**
 * Stockage local (IndexedDB) : c'est lui qui évite de perdre une pièce quand le navigateur
 * recharge ou plante. Les tests utilisent une implémentation IndexedDB en mémoire
 * (`fake-indexeddb`) : le code testé est exactement celui qui tourne dans le navigateur.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteDocumentRecord,
  isStorageAvailable,
  latestDocument,
  listDocuments,
  loadDocumentRecord,
  resetStorageForTests,
  saveDocumentRecord,
} from "@/cad/io/storage";

beforeEach(() => {
  // Base neuve pour chaque test.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetStorageForTests();
});

describe("Stockage local des documents", () => {
  it("enregistre, relit et liste les documents sans passer par le réseau", async () => {
    expect(await isStorageAvailable()).toBe(true);

    const saved = await saveDocumentRecord({
      id: "doc_1",
      name: "Support moteur",
      json: JSON.stringify({ schema: "cao3/document@1", name: "Support moteur", features: [] }),
      features: 3,
      volume: 42100.5,
    });
    expect(saved).toBe(true);

    await saveDocumentRecord({
      id: "doc_2",
      name: "Bride",
      json: JSON.stringify({ schema: "cao3/document@1", name: "Bride", features: [] }),
      features: 1,
      volume: null,
    });

    const record = await loadDocumentRecord("doc_1");
    expect(record?.name).toBe("Support moteur");
    expect(JSON.parse(record!.json).schema).toBe("cao3/document@1");
    expect(record!.volume).toBeCloseTo(42100.5, 3);

    const documents = await listDocuments();
    expect(documents.map((d) => d.name).sort()).toEqual(["Bride", "Support moteur"]);
    // Les métadonnées suffisent à l'affichage : le JSON complet n'est pas remonté.
    expect((documents[0] as unknown as { json?: string }).json).toBeUndefined();
    expect(documents.every((d) => d.bytes > 0)).toBe(true);

    // Le plus récent est proposé à la reprise de session.
    const latest = await latestDocument();
    expect(latest?.id).toBe("doc_2");
  });

  it("supprime un document et met à jour la reprise de session", async () => {
    await saveDocumentRecord({ id: "a", name: "A", json: "{}", features: 0, volume: null });
    await saveDocumentRecord({ id: "b", name: "B", json: "{}", features: 0, volume: null });
    expect(await deleteDocumentRecord("b")).toBe(true);
    expect((await listDocuments()).map((d) => d.id)).toEqual(["a"]);
    expect((await latestDocument())?.id).toBe("a");
    expect(await loadDocumentRecord("b")).toBeNull();
  });

  it("dégrade proprement quand IndexedDB est refusé (navigation privée, quota)", async () => {
    // Un navigateur peut refuser l'ouverture : on ne doit jamais lever d'exception.
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = {
      open() {
        throw new Error("SecurityError : stockage refusé");
      },
    } as unknown as IDBFactory;
    resetStorageForTests();

    expect(await isStorageAvailable()).toBe(false);
    expect(await saveDocumentRecord({ id: "x", name: "X", json: "{}", features: 0, volume: null })).toBe(false);
    expect(await listDocuments()).toEqual([]);
    expect(await loadDocumentRecord("x")).toBeNull();
    expect(await latestDocument()).toBeNull();
  });
});
