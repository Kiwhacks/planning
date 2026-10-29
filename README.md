# Planning crèche

Application web (React + TypeScript + Tailwind + shadcn/ui) pour construire les plannings hebdomadaires d'une crèche en respectant les contraintes de l'équipe et les besoins d'encadrement.

Les données sont enregistrées dans une base PostgreSQL (Neon) via une petite API déployée sur Vercel. Sans base configurée, l'application fonctionne en mode local (données dans le navigateur). Dans les deux cas, export / import JSON possibles.

## Fonctionnalités

- **Équipe** : heures hebdomadaires, jours travaillés, journée fixe (ex. 3h30/jour) ou bornée (min/max), amplitude maximale, pause quotidienne, statut (professionnelle, apprentie, stagiaire), « peut ouvrir / fermer seule ».
- **Enfants** : présences par jour, référente et relais. Les besoins en personnel peuvent être calculés automatiquement depuis les présences et le taux d'encadrement (ex. 2 pros dès 4 enfants). Le planning favorise la présence du référente (ou de la relais) quand l'enfant est là.
- **Semaine** : besoins en personnel par plage horaire et par jour, **ménage** (durée après le départ du dernier enfant et personnes affectées, par jour), congés / absences (avec heures comptées dans le contrat), contraintes fixes (« Fanny ouvre à 6h45 mardi », « Isabelle finit à 18h30 jeudi », jour imposé ou interdit), notes.
- **Règles** : horaires de la structure, nombre minimum de professionnelles, fenêtre de pause, priorité donnée à la limitation des heures supplémentaires, valeurs par défaut.
- **Génération** : un solveur (recuit simulé + réparation locale) exécuté dans un web worker produit un planning qui couvre les besoins, respecte les contraintes dures et minimise les heures supplémentaires. Chaque créneau est modifiable à la main et peut être **verrouillé** avant une nouvelle génération.
- **Diagnostic** : couverture créneau par créneau, récapitulatif des heures (travaillé, congés, contrat, écart), liste des points de vigilance.
- **Suggestions** : quand quelque chose coince, l'application propose des solutions applicables en un clic (prolonger ou avancer une personne, déplacer une pause, ajouter une journée, affecter quelqu'un au ménage, réduire un besoin quand les contrats ne suffisent pas).
- **Historique** : chaque semaine est sauvegardée (brouillon / validé), peut être rouverte, copiée vers une nouvelle semaine, supprimée, imprimée.
- **Réglages persistants mais modifiables par semaine** : les nouvelles semaines partent des réglages par défaut ; chaque semaine garde sa propre copie, que l'on peut ré-enregistrer comme réglages par défaut.

## Contraintes prises en compte

| Contrainte | Niveau |
| --- | --- |
| Nombre de personnes présentes ≥ besoin, à chaque créneau de 15 min | bloquante |
| Au moins N professionnelles (hors apprenties / stagiaires) dès que ≥ 2 personnes sont requises ; une personne seule doit être une pro autorisée à être seule | bloquante |
| Jours travaillés, congés, contraintes fixes (heures imposées, jour imposé / interdit) | bloquante |
| Ménage : les personnes affectées restent jusqu'à la fin du ménage après le départ du dernier enfant | bloquante |
| Journée fixe, durée maximale par jour, amplitude maximale, pause obligatoire | bloquante |
| Pause repas : tout créneau couvrant la fenêtre (12h45–15h par défaut, réglable) a une pause placée dans cette fenêtre, même si la journée est courte | bloquante |
| Heures hebdomadaires du contrat (heures sup. pénalisées et réparties, heures manquantes pénalisées) | forte |
| Présence en dehors des horaires de besoin, journées trop courtes | moyenne |
| Pause dans la fenêtre souhaitée et pas en tout début / fin de journée, sur-effectif, référente / relais présente | faible |

Quand les contrats ne suffisent pas à couvrir les besoins, l'application l'indique avant la génération (besoins vs heures disponibles) et le planning répartit les heures supplémentaires nécessaires.

## Développement

```bash
pnpm install
pnpm dev        # serveur de développement (mode local, sans base)
pnpm build      # build de production dans dist/
pnpm preview    # prévisualisation du build
pnpm typecheck
pnpm lint
```

Pour développer avec la base de données : copier `.env.example` en `.env`, renseigner `DATABASE_URL` (et `APP_PASSWORD`), puis lancer dans deux terminaux :

```bash
pnpm dev:api
```

```bash
API_PORT=3001 pnpm dev
```

## Déploiement (Vercel + Neon)

1. **Neon** : créer un projet Postgres et récupérer la chaîne de connexion (`DATABASE_URL`). Les tables sont créées automatiquement au premier appel de l'API (voir `db/schema.sql`).
2. **Vercel** : importer le dépôt GitHub (préréglage Vite détecté automatiquement, `vercel.json` fournit les réécritures). Définir les variables d'environnement :
   - `DATABASE_URL` : chaîne de connexion Neon ;
   - `APP_PASSWORD` : code d'accès demandé à l'ouverture de l'application (recommandé, les prénoms des enfants sont des données personnelles).
3. Déployer. Les fonctions `api/index.js` (routes `/api/data`, `/api/template`, `/api/weeks/:id`) et `api/mcp.js` sont générées depuis `server/` par `pnpm build:api` ; lancez-le (ou `pnpm build`) avant de pousser une modification du serveur.

Le code d'accès est mémorisé dans le navigateur après la première saisie. Pour le changer, modifier `APP_PASSWORD` dans Vercel et redéployer.

## Utilisation depuis une IA (connexion MCP)

L'application expose un serveur MCP (Streamable HTTP) à l'adresse :

```
https://<votre-domaine>/api/mcp/<MCP_TOKEN>
```

`MCP_TOKEN` est une variable d'environnement Vercel (à défaut, `APP_PASSWORD` est utilisé). Le jeton peut aussi être passé par l'en-tête `x-app-key` ou `Authorization: Bearer`.

- **Claude** (claude.ai) : Paramètres → Connecteurs → Ajouter un connecteur personnalisé → coller l'URL ci-dessus (sans authentification OAuth : le jeton est dans l'URL).
- **ChatGPT** : Paramètres → Connecteurs (mode développeur) → Créer → coller l'URL.
- **Claude Code / autres clients** : transport `http` avec la même URL.

Outils de lecture : `list_weeks`, `get_week`, `get_team`, `get_children`.

Outils de modification (tous les champs) : `generate_week`, `create_week`, `delete_week`, `set_week_status`, `set_notes`, `set_shift`, `remove_shift`, `set_leave`, `set_constraint`, `set_cleaning`, `set_requirements`, `upsert_employee` (contrat, jours, statut, pauses, journée fixe, amplitude, « jamais seule », active, animal, couleur, création), `delete_employee`, `upsert_child` (référente, relais, présences, animal, création), `delete_child`, `update_rules`, `save_week_as_defaults`, `reset_week_from_defaults`.

**Confirmation** : chaque modification est d'abord renvoyée sous forme d'aperçu (« avant → après ») sans rien enregistrer ; l'assistant demande l'accord de l'utilisatrice puis rappelle l'outil avec `confirm: true`. Si le client MCP gère l'« elicitation », la question est posée directement dans l'interface. Les réponses contiennent un rendu Markdown (tableaux) et, dans les clients compatibles **MCP Apps** (Claude, ChatGPT…), une vue graphique interactive du planning (`ui://planning-creche/week.html`, construite depuis `src/mcp-ui/` par `pnpm build:api`).

Exemples de demandes : « Affiche le planning de cette semaine », « Lucie est en congé lundi, régénère le planning », « Fanny ouvre à 6h45 mardi », « Affecte Isabelle au ménage du jeudi ».

Tests locaux : `pnpm dev:api` puis `pnpm mcp:test` (lecture) ou `pnpm mcp:test:confirm` (flux de confirmation sur une semaine jetable) ; nécessite `.env`.

Scripts utiles pour le solveur : `pnpm dlx tsx scripts/try-example.ts` (planning de l'exemple) et `pnpm dlx tsx scripts/bench.ts` (robustesse sur plusieurs graines).

## Structure

```
server/           sources des fonctions Vercel : data.ts (API de persistance), mcp.ts (serveur MCP), shared.ts (base Neon)
api/              fonctions déployées (index.js, mcp.js), regroupées par esbuild depuis server/ (`pnpm build:api`, versionnées)
db/schema.sql     schéma de la base
src/domain/       types, règles métier, modèle, évaluation des contraintes, suggestions, solveur (+ web worker)
src/store/        état (zustand), synchronisation avec l'API, navigation par semaine, hook du solveur
src/features/     écrans : planning, semaine, équipe, enfants, règles, historique
src/components/   composants shadcn/ui et composants communs (saisie d'heures, de durées…)
scripts/          serveur API local et scripts de test du solveur
```
