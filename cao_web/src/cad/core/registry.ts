/**
 * Registre des types de fonctions : paramètres par défaut + validation + indices d'UI.
 * Ajouter un type de fonction = ajouter une entrée ici + un builder dans kernel/builders.
 */
import { newId } from "./ids";
import type { CadDocument, ExtrudeEnd, ExtrudeFeature, Feature, SketchData, SketchFeature } from "./types";

export interface ExtrudeDefaults {
  operation: ExtrudeFeature["operation"];
  end: ExtrudeEnd;
}

export const DEFAULT_EXTRUDE: ExtrudeDefaults = {
  operation: "newBody",
  end: { kind: "blind", depth: 20, reverse: false, draftAngle: 0 },
};

export function createEmptySketchData(plane: SketchData["plane"] = { kind: "base", name: "XY", offset: 0 }): SketchData {
  const originId = newId("p");
  return {
    plane,
    originId,
    points: [{ id: originId, x: 0, y: 0, fixed: true }],
    entities: [],
    constraints: [],
    dimensions: [],
    gridStep: 1,
  };
}

export function createSketchFeature(name: string, data?: SketchData): SketchFeature {
  return {
    id: newId("f"),
    type: "sketch",
    name,
    suppressed: false,
    sketch: data ?? createEmptySketchData(),
  };
}

export function createExtrudeFeature(profileId: string, name: string): ExtrudeFeature {
  return {
    id: newId("f"),
    type: "extrude",
    name,
    suppressed: false,
    profileId,
    end: { ...DEFAULT_EXTRUDE.end },
    operation: DEFAULT_EXTRUDE.operation,
  };
}

export function createDocument(name = "Pièce1"): CadDocument {
  return {
    schema: "cao3/document@1",
    id: newId("doc"),
    name,
    units: { length: "mm", decimals: 2 },
    features: [],
  };
}

/** Contrôles de cohérence minimaux avant envoi au noyau (équivalent validation zod-light). */
export function validateDocument(doc: CadDocument): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const f of doc.features) {
    if (ids.has(f.id)) errors.push(`Identifiant de fonction dupliqué : ${f.id}`);
    ids.add(f.id);
  }
  for (const f of doc.features as Feature[]) {
    if (f.type === "extrude") {
      const profile = doc.features.find((x) => x.id === f.profileId);
      if (!profile) errors.push(`Fonction « ${f.name} » : esquisse source introuvable.`);
      else if (profile.type !== "sketch") errors.push(`Fonction « ${f.name} » : le profil doit être une esquisse.`);
      if (f.end.kind !== "throughAll" && !(f.end.depth > 0)) errors.push(`Fonction « ${f.name} » : profondeur invalide.`);
    }
    if (f.type === "sketch") {
      const pointIds = new Set(f.sketch.points.map((p) => p.id));
      for (const e of f.sketch.entities) {
        if (e.kind === "line") {
          if (!pointIds.has(e.p1) || !pointIds.has(e.p2)) errors.push(`Esquisse « ${f.name} » : ligne ${e.id} référence un point inexistant.`);
        } else if (!pointIds.has(e.center)) errors.push(`Esquisse « ${f.name} » : cercle ${e.id} référence un centre inexistant.`);
      }
    }
  }
  return errors;
}
