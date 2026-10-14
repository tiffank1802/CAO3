/**
 * Définition des rubans (structure SolidWorks : onglets → groupes → commandes).
 *
 * Convention (SPEC_RUBANS_FONCTIONS.md §14) : une commande non encore livrée reste
 * VISIBLE mais désactivée, avec une infobulle indiquant le lot prévu. Cela donne la
 * mesure du périmètre sans mentir à l'utilisateur.
 */
export interface RibbonCommand {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  big?: boolean;
}

export interface RibbonGroup {
  title: string;
  commands: RibbonCommand[];
}

export interface RibbonTab {
  id: string;
  title: string;
  groups: RibbonGroup[];
}

export const RIBBON_TABS: RibbonTab[] = [
  {
    id: "fichier",
    title: "Fichier",
    groups: [
      {
        title: "Document",
        commands: [
          { id: "file.new", label: "Nouveau", icon: "new", big: true, shortcut: "Ctrl+N" },
          { id: "file.open", label: "Ouvrir", icon: "open", big: true, shortcut: "Ctrl+O" },
          { id: "file.save", label: "Enregistrer", icon: "save", big: true, shortcut: "Ctrl+S" },
        ],
      },
      {
        title: "Importer",
        commands: [
          {
            id: "file.import-step",
            label: "Importer STEP",
            icon: "import",
            disabled: true,
            disabledReason: "Import STEP : lot 3 (le noyau le supporte déjà, l'assistant d'import arrive au lot 3).",
          },
        ],
      },
      {
        title: "Exporter",
        commands: [
          { id: "file.export-step", label: "Exporter STEP", icon: "export", big: true },
          { id: "file.export-stl", label: "Exporter STL", icon: "export", big: true },
          { id: "file.export-json", label: "Document (.cao3.json)", icon: "save" },
          { id: "file.capture", label: "Capture PNG", icon: "view", disabled: true, disabledReason: "Capture : lot 3" },
        ],
      },
      {
        title: "Historique",
        commands: [
          { id: "tools.undo", label: "Annuler", icon: "undo", shortcut: "Ctrl+Z" },
          { id: "tools.redo", label: "Rétablir", icon: "redo", shortcut: "Ctrl+Y" },
        ],
      },
    ],
  },
  {
    id: "esquisse",
    title: "Esquisse",
    groups: [
      {
        title: "Esquisse",
        commands: [
          { id: "sketch.new", label: "Nouvelle esquisse", icon: "sketch", big: true },
          { id: "sketch.edit", label: "Modifier l'esquisse", icon: "open" },
          { id: "sketch.leave", label: "Quitter l'esquisse", icon: "undo" },
        ],
      },
      {
        title: "Entités",
        commands: [
          { id: "sketch.rectangle-center", label: "Rectangle par centre", icon: "rectangle-center", big: true, shortcut: "R" },
          { id: "sketch.rectangle-corners", label: "Rectangle par 2 coins", icon: "rectangle", big: true },
          { id: "sketch.circle", label: "Cercle (centre-rayon)", icon: "circle", big: true, shortcut: "C" },
          { id: "sketch.line", label: "Ligne", icon: "line", big: true, shortcut: "L" },
          {
            id: "sketch.arc",
            label: "Arc de cercle",
            icon: "circle",
            disabled: true,
            disabledReason: "Arcs : tranche suivante du lot 1 (solveur prêt, outils canvas à ajouter).",
          },
          {
            id: "sketch.ellipse",
            label: "Ellipse",
            icon: "circle",
            disabled: true,
            disabledReason: "Ellipses : tranche suivante du lot 1.",
          },
        ],
      },
      {
        title: "Contraintes",
        commands: [
          { id: "sketch.dimension", label: "Cotation intelligente", icon: "dimension", big: true, shortcut: "D" },
          {
            id: "sketch.constraint",
            label: "Ajouter une relation",
            icon: "constraint",
            disabled: true,
            disabledReason: "Boîte de relations : tranche suivante du lot 1 (solveur planegcs déjà intégré).",
          },
        ],
      },
      {
        title: "Sélection",
        commands: [{ id: "sketch.select", label: "Sélectionner", icon: "view", shortcut: "Échap" }],
      },
    ],
  },
  {
    id: "fonctions",
    title: "Fonctions",
    groups: [
      {
        title: "Bossage / Base",
        commands: [
          { id: "feature.extrude", label: "Bossage extrudé", icon: "extrude", big: true },
          { id: "feature.cut", label: "Enlèvement de matière", icon: "cut", big: true },
          { id: "feature.revolve", label: "Révolution", icon: "iso", disabled: true, disabledReason: "Révolution : lot 2" },
          { id: "feature.loft", label: "Lissage", icon: "iso", disabled: true, disabledReason: "Lissage : lot 2" },
          { id: "feature.sweep", label: "Balayage", icon: "iso", disabled: true, disabledReason: "Balayage : lot 2" },
        ],
      },
      {
        title: "Modification",
        commands: [
          { id: "feature.fillet", label: "Congé", icon: "fillet", big: true, disabled: true, disabledReason: "Congés : lot 2 (le noyau les supporte)." },
          { id: "feature.chamfer", label: "Chanfrein", icon: "chamfer", disabled: true, disabledReason: "Chanfreins : lot 2" },
          { id: "feature.shell", label: "Coque", icon: "shell", disabled: true, disabledReason: "Coque : lot 2" },
          { id: "feature.pattern", label: "Répétition", icon: "pattern", disabled: true, disabledReason: "Répétitions : lot 2" },
          { id: "feature.mirror", label: "Symétrie", icon: "mirror", disabled: true, disabledReason: "Symétrie : lot 2" },
          { id: "feature.hole", label: "Assistant perçage", icon: "hole", disabled: true, disabledReason: "Perçages : lot 2" },
        ],
      },
    ],
  },
  {
    id: "assemblage",
    title: "Assemblage",
    groups: [
      {
        title: "Composants",
        commands: [
          { id: "assembly.insert", label: "Insérer des pièces", icon: "import", big: true, disabled: true, disabledReason: "Assemblages : lot 5" },
          { id: "assembly.mate", label: "Contrainte", icon: "constraint", disabled: true, disabledReason: "Solveur d'assemblage : lot 5" },
          { id: "assembly.interference", label: "Détecter les interférences", icon: "measure", disabled: true, disabledReason: "Lot 5" },
          { id: "assembly.bom", label: "Nomenclature", icon: "grid", disabled: true, disabledReason: "Lot 5" },
        ],
      },
    ],
  },
  {
    id: "mise-en-plan",
    title: "Mise en plan",
    groups: [
      {
        title: "Vues",
        commands: [
          { id: "drawing.view", label: "Vue projetée", icon: "iso", big: true, disabled: true, disabledReason: "Mise en plan : lot 4 (projection déjà validée par le spike)." },
          { id: "drawing.section", label: "Vue en coupe", icon: "cut", disabled: true, disabledReason: "Lot 4" },
          { id: "drawing.dimension", label: "Cotation", icon: "dimension", disabled: true, disabledReason: "Lot 4" },
          { id: "drawing.export-pdf", label: "Export PDF", icon: "export", disabled: true, disabledReason: "Lot 4" },
        ],
      },
    ],
  },
  {
    id: "evaluation",
    title: "Évaluation",
    groups: [
      {
        title: "Analyse",
        commands: [
          { id: "evaluate.mass", label: "Propriétés de masse", icon: "measure", big: true, disabled: true, disabledReason: "Lot 3 (le noyau expose déjà volume/centre de masse)." },
          { id: "evaluate.measure", label: "Mesurer", icon: "measure", disabled: true, disabledReason: "Lot 3" },
          { id: "evaluate.section", label: "Section dynamique", icon: "cut", disabled: true, disabledReason: "Lot 3" },
        ],
      },
    ],
  },
  {
    id: "affichage",
    title: "Affichage",
    groups: [
      {
        title: "Vues standard",
        commands: [
          { id: "view.iso", label: "Isométrique", icon: "iso", big: true, shortcut: "Espace" },
          { id: "view.front", label: "Face", icon: "view", big: true },
          { id: "view.top", label: "Dessus", icon: "view", big: true },
          { id: "view.right", label: "Droite", icon: "view", big: true },
          { id: "view.frame", label: "Zoom étendu", icon: "view", shortcut: "F" },
        ],
      },
      {
        title: "Styles d'affichage",
        commands: [
          { id: "view.style-shaded-edges", label: "Ombré + arêtes", icon: "view", big: true },
          { id: "view.style-shaded", label: "Ombré", icon: "view" },
          { id: "view.style-wireframe", label: "Filaire", icon: "grid" },
          { id: "view.style-transparent", label: "Transparence", icon: "view" },
        ],
      },
      {
        title: "Repères",
        commands: [{ id: "view.grid", label: "Grille / axes", icon: "grid" }],
      },
    ],
  },
  {
    id: "outils",
    title: "Outils",
    groups: [
      {
        title: "Diagnostic",
        commands: [
          { id: "tools.diagnostics", label: "Diagnostic du noyau", icon: "info", big: true },
          { id: "tools.rebuild", label: "Reconstruire", icon: "redo", shortcut: "Ctrl+B" },
        ],
      },
      {
        title: "Document",
        commands: [
          { id: "tools.units", label: "Unités", icon: "settings", disabled: true, disabledReason: "Préférences : lot 3" },
          { id: "tools.equations", label: "Équations", icon: "constraint", disabled: true, disabledReason: "Équations globales : lot 3" },
          { id: "tools.configurations", label: "Configurations", icon: "grid", disabled: true, disabledReason: "Configurations : lot 3" },
          { id: "tools.about", label: "À propos", icon: "info" },
        ],
      },
    ],
  },
];
