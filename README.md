# Planning crèche

Application web (React + TypeScript + Tailwind + shadcn/ui) pour construire les plannings hebdomadaires d'une crèche en respectant les contraintes de l'équipe et les besoins d'encadrement.

Tout fonctionne dans le navigateur, sans serveur : les données sont enregistrées localement (localStorage) et peuvent être exportées / importées en JSON.

## Fonctionnalités

- **Équipe** : heures hebdomadaires, jours travaillés, journée fixe (ex. 3h30/jour) ou bornée (min/max), amplitude maximale, pause quotidienne, statut (professionnel·le, apprenti·e, stagiaire), « peut ouvrir / fermer seul·e ».
- **Enfants** : présences par jour, référent·e et relais. Les besoins en personnel peuvent être calculés automatiquement depuis les présences et le taux d'encadrement (ex. 2 pros dès 4 enfants). Le planning favorise la présence du référent·e (ou du relais) quand l'enfant est là.
- **Semaine** : besoins en personnel par plage horaire et par jour, congés / absences (avec heures comptées dans le contrat), contraintes fixes (« Fanny ouvre à 6h45 mardi », « Isabelle finit à 18h30 jeudi », jour imposé ou interdit), notes.
- **Règles** : horaires de la structure, nombre minimum de professionnel·les, fenêtre de pause, priorité donnée à la limitation des heures supplémentaires, valeurs par défaut.
- **Génération** : un solveur (recuit simulé + réparation locale) exécuté dans un web worker produit un planning qui couvre les besoins, respecte les contraintes dures et minimise les heures supplémentaires. Chaque créneau est modifiable à la main et peut être **verrouillé** avant une nouvelle génération.
- **Diagnostic** : couverture créneau par créneau, récapitulatif des heures (travaillé, congés, contrat, écart), liste des points de vigilance.
- **Historique** : chaque semaine est sauvegardée (brouillon / validé), peut être rouverte, copiée vers une nouvelle semaine, supprimée, imprimée.
- **Réglages persistants mais modifiables par semaine** : les nouvelles semaines partent des réglages par défaut ; chaque semaine garde sa propre copie, que l'on peut ré-enregistrer comme réglages par défaut.

## Contraintes prises en compte

| Contrainte | Niveau |
| --- | --- |
| Nombre de personnes présentes ≥ besoin, à chaque créneau de 15 min | bloquante |
| Au moins N professionnel·les (hors apprenti·es / stagiaires) dès que ≥ 2 personnes sont requises ; une personne seule doit être une pro autorisée à être seule | bloquante |
| Jours travaillés, congés, contraintes fixes (heures imposées, jour imposé / interdit) | bloquante |
| Journée fixe, durée maximale par jour, amplitude maximale, pause obligatoire | bloquante |
| Heures hebdomadaires du contrat (heures sup. pénalisées et réparties, heures manquantes pénalisées) | forte |
| Présence en dehors des horaires de besoin, journées trop courtes | moyenne |
| Pause dans la fenêtre souhaitée et pas en tout début / fin de journée, sur-effectif, référent·e / relais présent·e | faible |

Quand les contrats ne suffisent pas à couvrir les besoins, l'application l'indique avant la génération (besoins vs heures disponibles) et le planning répartit les heures supplémentaires nécessaires.

## Développement

```bash
pnpm install
pnpm dev        # serveur de développement
pnpm build      # build de production dans dist/
pnpm preview    # prévisualisation du build
pnpm lint
```

Le dossier `dist/` est un site statique : il peut être déployé tel quel (Vercel, Netlify, GitHub Pages, serveur web…).

Scripts utiles pour le solveur : `pnpm dlx tsx scripts/try-example.ts` (planning de l'exemple) et `pnpm dlx tsx scripts/bench.ts` (robustesse sur plusieurs graines).

## Structure

```
src/domain/       types, règles métier, modèle, évaluation des contraintes, solveur (+ web worker)
src/store/        état persistant (zustand), navigation par semaine, hook du solveur
src/features/     écrans : planning, semaine, équipe, enfants, règles, historique
src/components/   composants shadcn/ui et composants communs (saisie d'heures, de durées…)
scripts/          scripts de test du solveur
```
