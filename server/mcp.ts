import type { VercelRequest, VercelResponse } from '@vercel/node'
import { McpServer, type CallToolResult, type ServerContext } from '@modelcontextprotocol/server'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import { WEEK_UI_HTML } from './ui.generated'
import { deleteWeek as deleteWeekRow, ensureSchema, getSql, loadTemplate, loadWeek, loadWeeks, saveTemplate, saveWeek, type Sql } from './shared'
import { buildWeekReport, weekLabelOf, weekReportToMarkdown, type WeekReport } from '../src/domain/report'
import { compile, toSchedule } from '../src/domain/model'
import { solve } from '../src/domain/solver'
import { ADULT_ANIMALS, BABY_ANIMALS, pickAnimal } from '../src/domain/animals'
import { EMPLOYEE_COLORS, buildExampleTemplate, makeChild, makeEmployee, migrateTemplate, migrateWeekConfig, newId, weekConfigFromTemplate } from '../src/domain/defaults'
import { normalizeRequirements } from '../src/domain/requirements'
import { fmtDuration, fromHHMM, parseDuration, roundToSlot, toHHMM } from '../src/domain/time'
import { mondayISO, weekIdOf } from '../src/store/weekKey'
import { DAY_LABELS, ROLE_LABELS, type Child, type DayIndex, type Employee, type Rules, type StaffRole, type Week } from '../src/domain/types'

/**
 * Serveur MCP (Streamable HTTP, sans état) : permet d'utiliser le planning depuis Claude, ChatGPT, etc.
 * URL : https://<domaine>/api/mcp/<MCP_TOKEN>   (ou en-tête `x-app-key` / `Authorization: Bearer`).
 *
 * Toute modification demande confirmation : sans `confirm: true`, l'outil renvoie un aperçu des
 * changements (ou pose la question directement à l'utilisatrice si le client gère l'« elicitation »).
 */

const UI_URI = 'ui://planning-creche/week.html'

// ---------------------------------------------------------------------------
// Analyse des entrées (noms, jours, heures, durées)
// ---------------------------------------------------------------------------

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function parseDay(input: string | number): DayIndex {
  if (typeof input === 'number') {
    if (input >= 0 && input <= 6) return input as DayIndex
    throw new Error(`Jour invalide : ${input}`)
  }
  const n = norm(input)
  const idx = DAY_LABELS.findIndex((l) => norm(l) === n || norm(l).startsWith(n.slice(0, 3)))
  if (idx < 0) throw new Error(`Jour inconnu : « ${input} » (attendu : lundi … dimanche).`)
  return idx as DayIndex
}

function parseTime(input: string, label: string): number {
  const m = fromHHMM(input.replace('h', ':').replace(/:$/, ':00'))
  if (m == null) throw new Error(`${label} : heure invalide « ${input} » (format attendu 08:30 ou 8h30).`)
  return roundToSlot(m)
}

function parseHours(input: string, label: string): number {
  const m = parseDuration(input)
  if (m == null) throw new Error(`${label} : durée invalide « ${input} » (format attendu 33h30, 7h ou 7.5).`)
  return roundToSlot(m)
}

function findEmployee(week: Week, name: string, includeInactive = false): Employee {
  const n = norm(name)
  const list = week.config.employees.filter((e) => includeInactive || e.active)
  const e = list.find((x) => norm(x.name) === n || x.id === name) ?? list.find((x) => norm(x.name).startsWith(n))
  if (!e) throw new Error(`Personne inconnue : « ${name} ». Équipe : ${list.map((x) => x.name).join(', ')}.`)
  return e
}

function findChild(week: Week, name: string): Child {
  const n = norm(name)
  const c = week.config.children.find((x) => norm(x.name) === n || x.id === name) ?? week.config.children.find((x) => norm(x.name).startsWith(n))
  if (!c) throw new Error(`Enfant inconnu : « ${name} ». Enfants : ${week.config.children.map((x) => x.name).join(', ') || 'aucun'}.`)
  return c
}

const ROLE_INPUT: Record<string, StaffRole> = { pro: 'pro', professionnelle: 'pro', apprentie: 'apprenti', apprenti: 'apprenti', stagiaire: 'stagiaire' }

async function resolveWeek(sql: Sql, input: string | undefined): Promise<Week> {
  let id: string
  if (!input || /^(cette semaine|semaine en cours|now|current)$/i.test(input.trim())) id = weekIdOf(new Date())
  else if (/^\d{4}-W\d{2}$/i.test(input.trim())) id = input.trim().toUpperCase()
  else if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) id = weekIdOf(new Date(`${input.trim()}T12:00:00`))
  else if (/^(semaine prochaine|next)$/i.test(input.trim())) id = weekIdOf(new Date(Date.now() + 7 * 86400000))
  else throw new Error(`Semaine invalide : « ${input} ». Utilisez un identifiant (2026-W44), une date (2026-10-26) ou « cette semaine ».`)
  const w = await loadWeek(sql, id)
  if (!w) {
    const all = await loadWeeks(sql)
    throw new Error(`La semaine ${id} n'existe pas. Semaines disponibles : ${all.map((x) => x.id).join(', ') || 'aucune'}. Utilisez create_week pour la créer.`)
  }
  return { ...w, config: migrateWeekConfig(w.config) }
}

// ---------------------------------------------------------------------------
// Résultats
// ---------------------------------------------------------------------------

const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] })

function reportResult(report: WeekReport, prefix?: string): CallToolResult {
  const md = weekReportToMarkdown(report)
  return { content: [{ type: 'text', text: prefix ? `${prefix}\n\n${md}` : md }], structuredContent: report as unknown as Record<string, unknown> }
}

const errorResult = (e: unknown): CallToolResult => ({ content: [{ type: 'text', text: `Erreur : ${e instanceof Error ? e.message : String(e)}` }], isError: true })

async function persist(sql: Sql, week: Week): Promise<Week> {
  const w = { ...week, updatedAt: new Date().toISOString() }
  await saveWeek(sql, w)
  return w
}

function runSolver(week: Week, fresh: boolean): Week {
  const { model, shifts } = compile(week.config, week.schedule)
  const base = fresh ? shifts.map((row, i) => row.map((x, d) => (model.employees[i].frozen[d] ? x : null))) : shifts
  const res = solve(model, base, { iterations: 200_000, restarts: 4, seed: Math.floor(Math.random() * 1e9) })
  return { ...week, schedule: toSchedule(model, res.shifts, week.schedule) }
}

function teamText(w: Week): string {
  const { rules } = w.config
  const lines = [`## Équipe — ${weekLabelOf(w.monday)}`, '', '| Personne | Animal | Statut | Contrat | Jours | Journée | Pause | Particularités | Active |', '|---|---|---|---|---|---|---|---|---|']
  for (const e of w.config.employees) {
    const day = e.fixedDailyMinutes != null ? `${fmtDuration(e.fixedDailyMinutes)} fixe` : `${fmtDuration(e.minDailyMinutes)} à ${fmtDuration(e.maxDailyMinutes)}`
    const notes = [!e.canBeAlone && 'jamais seule', e.role !== 'pro' && 'hors taux d’encadrement'].filter(Boolean).join(', ')
    lines.push(`| ${e.name} | ${ADULT_ANIMALS.find((a) => a.key === e.avatar)?.label ?? '—'} | ${ROLE_LABELS[e.role]} | ${fmtDuration(e.weeklyMinutes)} | ${e.workDays.map((d) => DAY_LABELS[d].slice(0, 3)).join(' ')} | ${day} (amplitude ≤ ${fmtDuration(e.maxAmplitudeMinutes)}) | ${e.breakMinutes ? fmtDuration(e.breakMinutes) : 'aucune'} | ${notes || '—'} | ${e.active ? 'oui' : 'non'} |`)
  }
  lines.push('', rulesText(rules))
  if (w.config.notes) lines.push('', `Notes : ${w.config.notes}`)
  return lines.join('\n')
}

function rulesText(r: Rules): string {
  return [
    '### Règles',
    `- Ouverture : ${r.openDays.map((d) => DAY_LABELS[d]).join(', ')}, de ${toHHMM(r.dayStart)} à ${toHHMM(r.dayEnd)} au plus.`,
    `- Au moins ${r.minProsWhenTwoOrMore} professionnelle(s) dès que 2 personnes sont requises.`,
    `- Taux d’encadrement : ${r.ratio.map((s) => `${s.minChildren}+ enfants → ${s.staff}`).join(' ; ')}.`,
    `- Pauses de préférence entre ${toHHMM(r.breakWindowStart)} et ${toHHMM(r.breakWindowEnd)}${r.breakMinShiftMinutes ? `, dues au-delà de ${fmtDuration(r.breakMinShiftMinutes)}` : ''}.`,
    `- Heures supplémentaires : ${['tolérées', 'limitées', 'fortement évitées'][r.overtimeStrictness - 1]} ; référentes : ${['ignorées', 'souhaitées', 'importantes'][r.referentImportance]}.`,
    `- Valeurs par défaut : journée ${fmtDuration(r.defaultMinDailyMinutes)} à ${fmtDuration(r.defaultMaxDailyMinutes)}, amplitude ≤ ${fmtDuration(r.defaultMaxAmplitudeMinutes)}, pause ${fmtDuration(r.defaultBreakMinutes)}, ménage ${fmtDuration(r.defaultCleaningMinutes)}.`,
  ].join('\n')
}

function childrenText(w: Week): string {
  const days = w.config.rules.openDays
  const name = (id: string | null) => (id ? w.config.employees.find((e) => e.id === id)?.name ?? '?' : '—')
  const lines = [`## Enfants — ${weekLabelOf(w.monday)}`, '', `| Enfant | Animal | Référente | Relais | ${days.map((d) => DAY_LABELS[d].slice(0, 3)).join(' | ')} |`, `|---|---|---|---|${days.map(() => '---').join('|')}|`]
  for (const c of w.config.children) {
    const att = days.map((d) => {
      const a = c.attendance[d]
      return a ? `${toHHMM(a.start)}–${toHHMM(a.end)}` : '—'
    })
    lines.push(`| ${c.name} | ${BABY_ANIMALS.find((a) => a.key === c.avatar)?.label ?? '—'} | ${name(c.referentId)} | ${name(c.relaisId)} | ${att.join(' | ')} |`)
  }
  if (w.config.children.length === 0) lines.push('', '_Aucun enfant renseigné._')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Confirmation des modifications
// ---------------------------------------------------------------------------

interface Plan {
  /** Description des changements (Markdown). */
  summary: string
  /** Applique les changements et renvoie le résultat. */
  apply: () => Promise<CallToolResult>
}

const confirmArg = z.boolean().optional().describe('Mettre à true UNIQUEMENT après que l’utilisatrice a explicitement approuvé l’aperçu renvoyé par un premier appel sans confirm. Sans confirm, rien n’est modifié : l’outil renvoie l’aperçu des changements.')

type Ctx = ServerContext

/** Demande la confirmation : via le client (elicitation) si possible, sinon aperçu + second appel avec confirm=true. */
async function confirmAndApply(plan: Plan, confirm: boolean | undefined, ctx: Ctx): Promise<CallToolResult> {
  if (confirm === true) return plan.apply()
  const elicit = ctx?.mcpReq?.elicitInput
  if (typeof elicit === 'function') {
    try {
      const res = await elicit(
        {
          message: `${plan.summary}\n\nAppliquer cette modification ?`,
          requestedSchema: { type: 'object', properties: { appliquer: { type: 'boolean', title: 'Appliquer la modification', description: 'Oui pour enregistrer, non pour annuler.' } }, required: ['appliquer'] },
        },
        { timeout: 90_000 },
      )
      if (res.action === 'accept' && (res.content as { appliquer?: boolean } | undefined)?.appliquer === true) return plan.apply()
      if (res.action === 'accept' || res.action === 'decline' || res.action === 'cancel') return text(`Modification annulée par l’utilisatrice. Rien n’a été enregistré.\n\n${plan.summary}`)
    } catch {
      // le client ne gère pas l'elicitation : aperçu
    }
  }
  return text(`⚠️ **Aperçu — rien n’a été modifié.**\n\n${plan.summary}\n\nDemandez à l’utilisatrice si elle confirme, puis rappelez le même outil avec les mêmes paramètres et \`confirm: true\`.`)
}

const diffLine = (label: string, before: string, after: string) => (before === after ? null : `- ${label} : ${before || '—'} → **${after || '—'}**`)

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

function createServer(sql: Sql, appUrl: string): McpServer {
  const server = new McpServer({ name: 'planning-creche', version: '1.1.0' })
  const uiMeta = { ui: { resourceUri: UI_URI } }
  const weekArg = z.string().optional().describe('Semaine : identifiant ISO (ex. 2026-W44), date (2026-10-26), « cette semaine » (défaut) ou « semaine prochaine ».')
  const dayArg = z.union([z.string(), z.number()]).describe('Jour : lundi, mardi… ou index 0 (lundi) à 6.')
  const employeeArg = z.string().describe('Prénom de la personne (tel qu’il apparaît dans l’équipe).')
  const daysArg = z.array(z.union([z.string(), z.number()])).describe('Liste de jours (lundi, mardi… ou 0 à 6).')
  const hoursArg = (d: string) => z.string().describe(`${d} (format 33h30, 7h ou 7.5).`)
  const timeArg = (d: string) => z.string().describe(`${d} (format 08:30 ou 8h30).`)
  const mutating = { readOnlyHint: false, idempotentHint: false }

  registerAppResource(server, 'Planning de la semaine', UI_URI, { description: 'Vue graphique du planning hebdomadaire', mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: WEEK_UI_HTML }],
  }))

  // ----- lecture -----------------------------------------------------------

  server.registerTool('list_weeks', { title: 'Lister les semaines', description: 'Liste les semaines de planning enregistrées (identifiant, dates, statut, heures planifiées).', inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => {
    const weeks = await loadWeeks(sql)
    if (weeks.length === 0) return text('Aucune semaine enregistrée. Utilisez create_week.')
    const lines = ['| Semaine | Statut | Planning | Heures sup. |', '|---|---|---|---|']
    const items = weeks.map((w) => {
      const r = buildWeekReport({ ...w, config: migrateWeekConfig(w.config) }, appUrl)
      const ot = r.totals.reduce((a, t) => a + Math.max(0, t.delta), 0)
      lines.push(`| ${w.id} — ${r.week.label} | ${w.status === 'validated' ? 'validée' : 'brouillon'} | ${r.hasSchedule ? (r.violations.some((v) => v.severity === 'error') ? 'généré, points à vérifier' : 'généré') : 'non généré'} | ${ot ? `+${fmtDuration(ot)}` : '—'} |`)
      return { id: w.id, monday: w.monday, label: r.week.label, status: w.status, hasSchedule: r.hasSchedule, overtimeMinutes: ot }
    })
    return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { weeks: items } }
  })

  registerAppTool(server, 'get_week', { title: 'Afficher une semaine', description: 'Affiche le planning d’une semaine : horaires de chaque personne par jour, récapitulatif des heures, points de vigilance et suggestions.', inputSchema: z.object({ week: weekArg }), annotations: { readOnlyHint: true }, _meta: uiMeta }, async ({ week }) => {
    try {
      return reportResult(buildWeekReport(await resolveWeek(sql, week), appUrl))
    } catch (e) {
      return errorResult(e)
    }
  })

  server.registerTool('get_team', { title: 'Équipe et règles', description: 'Décrit l’équipe (contrats, jours, pauses, particularités, animal), les règles d’encadrement et les notes d’une semaine.', inputSchema: z.object({ week: weekArg }), annotations: { readOnlyHint: true } }, async ({ week }) => {
    try {
      return text(teamText(await resolveWeek(sql, week)))
    } catch (e) {
      return errorResult(e)
    }
  })

  server.registerTool('get_children', { title: 'Enfants', description: 'Liste les enfants d’une semaine : animal, référente, relais et présences par jour.', inputSchema: z.object({ week: weekArg }), annotations: { readOnlyHint: true } }, async ({ week }) => {
    try {
      return text(childrenText(await resolveWeek(sql, week)))
    } catch (e) {
      return errorResult(e)
    }
  })

  // ----- semaine -----------------------------------------------------------

  registerAppTool(
    server,
    'generate_week',
    {
      title: 'Générer le planning',
      description: 'Génère (ou régénère) le planning d’une semaine avec le solveur, en respectant les contraintes, puis l’enregistre. Les créneaux verrouillés sont conservés. Demande confirmation.',
      inputSchema: z.object({ week: weekArg, improve_existing: z.boolean().optional().describe('true = partir du planning existant pour l’améliorer ; false (défaut) = repartir de zéro (hors créneaux verrouillés).'), confirm: confirmArg }),
      annotations: mutating,
      _meta: uiMeta,
    },
    async ({ week, improve_existing, confirm }, ctx) => {
      try {
        const w = await resolveWeek(sql, week)
        if (!w.config.employees.some((e) => e.active)) throw new Error('Aucune personne active dans l’équipe de cette semaine.')
        const has = Object.values(w.schedule).some((row) => Object.values(row).some(Boolean))
        const summary = `**${improve_existing ? 'Améliorer' : 'Générer'} le planning de la ${weekLabelOf(w.monday)}**${has && !improve_existing ? ' — le planning actuel sera remplacé (sauf créneaux verrouillés).' : ''}`
        return confirmAndApply({ summary, apply: async () => reportResult(buildWeekReport(await persist(sql, runSolver(w, !improve_existing)), appUrl), '✅ Planning généré et enregistré.') }, confirm, ctx)
      } catch (e) {
        return errorResult(e)
      }
    },
  )

  registerAppTool(
    server,
    'create_week',
    {
      title: 'Créer une semaine',
      description: 'Crée une nouvelle semaine de planning à partir des réglages par défaut (ou en copiant la semaine précédente). Demande confirmation.',
      inputSchema: z.object({ date: z.string().describe('Une date de la semaine à créer (YYYY-MM-DD).'), copy_previous: z.boolean().optional().describe('true = copier la semaine précédente (besoins, congés, contraintes, planning).'), confirm: confirmArg }),
      annotations: mutating,
      _meta: uiMeta,
    },
    async ({ date, copy_previous, confirm }, ctx) => {
      try {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date attendue au format YYYY-MM-DD.')
        const d = new Date(`${date}T12:00:00`)
        const id = weekIdOf(d)
        if (await loadWeek(sql, id)) throw new Error(`La semaine ${id} existe déjà.`)
        const prev = copy_previous ? await loadWeek(sql, weekIdOf(new Date(d.getTime() - 7 * 86400000))) : null
        const summary = `**Créer la semaine ${id}** (${weekLabelOf(mondayISO(d))}) ${prev ? `en copiant la semaine ${prev.id}` : 'à partir des réglages par défaut'}.`
        return confirmAndApply(
          {
            summary,
            apply: async () => {
              let template = await loadTemplate(sql)
              if (!template) {
                template = buildExampleTemplate()
                await saveTemplate(sql, template)
              }
              let week: Week = { id, monday: mondayISO(d), config: weekConfigFromTemplate(migrateTemplate(template)), schedule: {}, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
              if (prev) week = { ...week, config: migrateWeekConfig(prev.config), schedule: prev.schedule }
              await saveWeek(sql, week)
              return reportResult(buildWeekReport(week, appUrl), `✅ Semaine ${id} créée.`)
            },
          },
          confirm,
          ctx,
        )
      } catch (e) {
        return errorResult(e)
      }
    },
  )

  server.registerTool('delete_week', { title: 'Supprimer une semaine', description: 'Supprime définitivement une semaine (configuration et planning). Demande confirmation.', inputSchema: z.object({ week: z.string().describe('Identifiant ou date de la semaine.'), confirm: confirmArg }), annotations: { ...mutating, destructiveHint: true } }, async ({ week, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      return confirmAndApply(
        {
          summary: `**Supprimer définitivement la semaine ${w.id}** (${weekLabelOf(w.monday)}, ${w.status === 'validated' ? 'validée' : 'brouillon'}).`,
          apply: async () => {
            await deleteWeekRow(sql, w.id)
            return text(`✅ Semaine ${w.id} supprimée.`)
          },
        },
        confirm,
        ctx,
      )
    } catch (e) {
      return errorResult(e)
    }
  })

  registerAppTool(server, 'set_week_status', { title: 'Statut de la semaine', description: 'Marque la semaine comme validée ou la repasse en brouillon. Demande confirmation.', inputSchema: z.object({ week: weekArg, status: z.enum(['draft', 'validated']), confirm: confirmArg }), annotations: mutating, _meta: uiMeta }, async ({ week, status, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      return confirmAndApply({ summary: `**${status === 'validated' ? 'Valider' : 'Repasser en brouillon'} la ${weekLabelOf(w.monday)}**.`, apply: async () => reportResult(buildWeekReport(await persist(sql, { ...w, status }), appUrl), `✅ Semaine ${status === 'validated' ? 'validée' : 'repassée en brouillon'}.`) }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  server.registerTool('set_notes', { title: 'Notes de la semaine', description: 'Remplace les notes libres de la semaine. Demande confirmation.', inputSchema: z.object({ week: weekArg, notes: z.string(), confirm: confirmArg }), annotations: mutating }, async ({ week, notes, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      return confirmAndApply({ summary: `**Notes de la ${weekLabelOf(w.monday)}**\n${diffLine('Notes', w.config.notes, notes) ?? '- inchangées'}`, apply: async () => {
        await persist(sql, { ...w, config: { ...w.config, notes } })
        return text('✅ Notes enregistrées.')
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  server.registerTool('save_week_as_defaults', { title: 'Enregistrer comme réglages par défaut', description: 'Enregistre l’équipe, les enfants, les règles, les besoins types et le ménage de cette semaine comme réglages par défaut pour les prochaines semaines. Demande confirmation.', inputSchema: z.object({ week: weekArg, confirm: confirmArg }), annotations: mutating }, async ({ week, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      return confirmAndApply({ summary: `**Enregistrer les réglages de la ${weekLabelOf(w.monday)} comme réglages par défaut** (équipe de ${w.config.employees.length} personnes, ${w.config.children.length} enfants, règles, besoins types, ménage).`, apply: async () => {
        const { employees, children, rules, requirements, cleaning } = w.config
        await saveTemplate(sql, { employees, children, rules, requirements, cleaning })
        return text('✅ Réglages par défaut enregistrés : les prochaines semaines les reprendront.')
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  server.registerTool('reset_week_from_defaults', { title: 'Recharger les réglages par défaut', description: 'Remplace l’équipe, les enfants, les règles, les besoins types et le ménage de cette semaine par les réglages par défaut (congés, contraintes et planning conservés). Demande confirmation.', inputSchema: z.object({ week: weekArg, confirm: confirmArg }), annotations: { ...mutating, destructiveHint: true } }, async ({ week, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      const t = await loadTemplate(sql)
      if (!t) throw new Error('Aucun réglage par défaut enregistré.')
      return confirmAndApply({ summary: `**Recharger les réglages par défaut dans la ${weekLabelOf(w.monday)}** : l’équipe, les enfants, les règles, les besoins et le ménage de cette semaine seront remplacés.`, apply: async () => {
        await persist(sql, { ...w, config: { ...w.config, ...migrateTemplate(t) } })
        return text('✅ Réglages par défaut rechargés pour cette semaine.')
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  // ----- créneaux, congés, contraintes, ménage, besoins ----------------------

  registerAppTool(
    server,
    'set_shift',
    {
      title: 'Modifier un créneau',
      description: 'Fixe manuellement les horaires d’une personne un jour donné (créneau verrouillé par défaut, conservé lors des régénérations). Demande confirmation.',
      inputSchema: z.object({ week: weekArg, employee: employeeArg, day: dayArg, start: timeArg('Heure d’arrivée'), end: timeArg('Heure de départ'), break_start: z.string().nullable().optional().describe('Début de la pause (12:30), null = pas de pause. Par défaut : pause placée au milieu si la personne en a une.'), locked: z.boolean().optional().describe('Verrouiller le créneau (défaut true).'), confirm: confirmArg }),
      annotations: mutating,
      _meta: uiMeta,
    },
    async ({ week, employee, day, start, end, break_start, locked, confirm }, ctx) => {
      try {
        const w = await resolveWeek(sql, week)
        const e = findEmployee(w, employee)
        const d = parseDay(day)
        const s = parseTime(start, 'Arrivée')
        const en = parseTime(end, 'Départ')
        if (en <= s) throw new Error('Le départ doit être après l’arrivée.')
        let b: number | null = null
        if (break_start === undefined) b = e.breakMinutes > 0 ? roundToSlot((s + en) / 2 - e.breakMinutes / 2) : null
        else if (break_start !== null) b = parseTime(break_start, 'Pause')
        if (b != null && (b <= s || b + e.breakMinutes >= en)) throw new Error('La pause doit être à l’intérieur du créneau.')
        const cur = w.schedule[e.id]?.[d]
        const summary = `**${e.name} — ${DAY_LABELS[d]}** : ${cur ? `${toHHMM(cur.start)}–${toHHMM(cur.end)}` : 'aucun créneau'} → **${toHHMM(s)}–${toHHMM(en)}**${b != null ? ` (pause ${toHHMM(b)}–${toHHMM(b + e.breakMinutes)})` : ''}, ${locked ?? true ? 'verrouillé' : 'non verrouillé'}.`
        return confirmAndApply({ summary, apply: async () => {
          const schedule = { ...w.schedule, [e.id]: { ...(w.schedule[e.id] ?? {}), [d]: { start: s, end: en, breakStart: b, locked: locked ?? true } } }
          return reportResult(buildWeekReport(await persist(sql, { ...w, schedule }), appUrl), `✅ ${e.name} : ${DAY_LABELS[d]} ${toHHMM(s)}–${toHHMM(en)} enregistré.`)
        } }, confirm, ctx)
      } catch (e) {
        return errorResult(e)
      }
    },
  )

  registerAppTool(server, 'remove_shift', { title: 'Supprimer un créneau', description: 'Retire le créneau d’une personne un jour donné. Demande confirmation.', inputSchema: z.object({ week: weekArg, employee: employeeArg, day: dayArg, confirm: confirmArg }), annotations: { ...mutating, destructiveHint: true }, _meta: uiMeta }, async ({ week, employee, day, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      const e = findEmployee(w, employee)
      const d = parseDay(day)
      const cur = w.schedule[e.id]?.[d]
      if (!cur) throw new Error(`${e.name} n'a pas de créneau le ${DAY_LABELS[d].toLowerCase()}.`)
      return confirmAndApply({ summary: `**Supprimer le créneau de ${e.name} le ${DAY_LABELS[d].toLowerCase()}** (${toHHMM(cur.start)}–${toHHMM(cur.end)}).`, apply: async () => {
        const schedule = { ...w.schedule, [e.id]: { ...(w.schedule[e.id] ?? {}), [d]: null } }
        return reportResult(buildWeekReport(await persist(sql, { ...w, schedule }), appUrl), `✅ Créneau de ${e.name} le ${DAY_LABELS[d].toLowerCase()} supprimé.`)
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  registerAppTool(
    server,
    'set_leave',
    {
      title: 'Congé / absence',
      description: 'Déclare (ou retire) un congé ou une absence pour une personne un jour donné. Les heures indiquées comptent dans le contrat hebdomadaire. Demande confirmation.',
      inputSchema: z.object({ week: weekArg, employee: employeeArg, day: dayArg, hours: z.string().optional().describe('Heures comptées (ex. « 7h »). Défaut : la journée type de la personne.'), label: z.string().optional().describe('Motif (Congé, Maladie, Formation…).'), remove: z.boolean().optional().describe('true = retirer le congé.'), confirm: confirmArg }),
      annotations: mutating,
      _meta: uiMeta,
    },
    async ({ week, employee, day, hours, label, remove, confirm }, ctx) => {
      try {
        const w = await resolveWeek(sql, week)
        const e = findEmployee(w, employee)
        const d = parseDay(day)
        const existing = w.config.leaves.find((l) => l.employeeId === e.id && l.day === d)
        if (remove) {
          if (!existing) throw new Error(`${e.name} n'a pas de congé le ${DAY_LABELS[d].toLowerCase()}.`)
          return confirmAndApply({ summary: `**Retirer le congé de ${e.name} le ${DAY_LABELS[d].toLowerCase()}** (${existing.label}, ${fmtDuration(existing.minutes)}).`, apply: async () => {
            const config = structuredClone(w.config)
            config.leaves = config.leaves.filter((l) => l.id !== existing.id)
            return reportResult(buildWeekReport(await persist(sql, { ...w, config }), appUrl), `✅ Congé de ${e.name} le ${DAY_LABELS[d].toLowerCase()} retiré.`)
          } }, confirm, ctx)
        }
        const minutes = hours ? parseHours(hours, 'Heures') : e.fixedDailyMinutes ?? roundToSlot(e.weeklyMinutes / Math.max(1, e.workDays.length))
        const motif = label ?? existing?.label ?? 'Congé'
        return confirmAndApply({ summary: `**${motif} pour ${e.name} le ${DAY_LABELS[d].toLowerCase()}** (${fmtDuration(minutes)} comptées)${existing ? ` — remplace ${existing.label} (${fmtDuration(existing.minutes)})` : ''}. Son créneau de ce jour sera retiré ; le planning devra être régénéré.`, apply: async () => {
          const config = structuredClone(w.config)
          config.leaves = config.leaves.filter((l) => !(l.employeeId === e.id && l.day === d))
          config.leaves.push({ id: newId('lv'), employeeId: e.id, day: d, minutes, label: motif })
          const schedule = { ...w.schedule, [e.id]: { ...(w.schedule[e.id] ?? {}), [d]: null } }
          return reportResult(buildWeekReport(await persist(sql, { ...w, config, schedule }), appUrl), `✅ ${motif} de ${e.name} le ${DAY_LABELS[d].toLowerCase()} enregistré. Pensez à régénérer le planning.`)
        } }, confirm, ctx)
      } catch (e) {
        return errorResult(e)
      }
    },
  )

  registerAppTool(
    server,
    'set_constraint',
    {
      title: 'Contrainte fixe',
      description: 'Impose une heure d’arrivée ou de départ, ou oblige / interdit une journée, pour une personne un jour donné (ex. « Fanny ouvre à 6h45 mardi »). Demande confirmation.',
      inputSchema: z.object({ week: weekArg, employee: employeeArg, day: dayArg, start: timeArg('Heure d’arrivée imposée').optional(), end: timeArg('Heure de départ imposée').optional(), must_work: z.enum(['oui', 'non', 'libre']).optional().describe('oui = doit travailler ce jour, non = ne travaille pas (sans heures comptées), libre = au choix.'), note: z.string().optional(), remove: z.boolean().optional().describe('true = retirer toutes les contraintes de cette personne ce jour.'), confirm: confirmArg }),
      annotations: mutating,
      _meta: uiMeta,
    },
    async ({ week, employee, day, start, end, must_work, note, remove, confirm }, ctx) => {
      try {
        const w = await resolveWeek(sql, week)
        const e = findEmployee(w, employee)
        const d = parseDay(day)
        const s = start ? parseTime(start, 'Arrivée') : null
        const en = end ? parseTime(end, 'Départ') : null
        const mustWork = must_work === 'oui' ? true : must_work === 'non' ? false : s != null || en != null ? true : null
        const desc = remove ? 'retirer toutes les contraintes' : [s != null && `arrive à ${toHHMM(s)}`, en != null && `part à ${toHHMM(en)}`, mustWork === true && 'travaille ce jour', mustWork === false && 'ne travaille pas ce jour', note && `note « ${note} »`].filter(Boolean).join(', ') || 'au choix'
        return confirmAndApply({ summary: `**Contrainte pour ${e.name} le ${DAY_LABELS[d].toLowerCase()}** : ${desc}.`, apply: async () => {
          const config = structuredClone(w.config)
          config.pins = config.pins.filter((p) => !(p.employeeId === e.id && p.day === d))
          if (!remove) config.pins.push({ id: newId('pin'), employeeId: e.id, day: d, start: s, end: en, mustWork, note: note ?? '' })
          return reportResult(buildWeekReport(await persist(sql, { ...w, config }), appUrl), `✅ Contrainte enregistrée. Pensez à régénérer le planning.`)
        } }, confirm, ctx)
      } catch (e) {
        return errorResult(e)
      }
    },
  )

  registerAppTool(server, 'set_cleaning', { title: 'Ménage', description: 'Définit le ménage d’un jour : durée après le départ du dernier enfant et personnes affectées. Demande confirmation.', inputSchema: z.object({ week: weekArg, day: dayArg, minutes: z.number().optional().describe('Durée du ménage en minutes (ex. 30).'), employees: z.array(z.string()).optional().describe('Prénoms des personnes affectées (remplace la liste).'), confirm: confirmArg }), annotations: mutating, _meta: uiMeta }, async ({ week, day, minutes, employees, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      const d = parseDay(day)
      const cur = w.config.cleaning?.[d] ?? { minutes: w.config.rules.defaultCleaningMinutes, employeeIds: [] }
      const next = { minutes: minutes != null ? roundToSlot(minutes) : cur.minutes, employeeIds: employees ? employees.map((n) => findEmployee(w, n).id) : cur.employeeIds }
      const names = (ids: string[]) => ids.map((id) => w.config.employees.find((e) => e.id === id)?.name ?? '?').join(', ') || 'personne'
      return confirmAndApply({ summary: `**Ménage du ${DAY_LABELS[d].toLowerCase()}** : ${fmtDuration(cur.minutes)}, ${names(cur.employeeIds)} → **${fmtDuration(next.minutes)}, ${names(next.employeeIds)}**.`, apply: async () => {
        const config = structuredClone(w.config)
        config.cleaning ??= {}
        config.cleaning[d] = next
        return reportResult(buildWeekReport(await persist(sql, { ...w, config }), appUrl), `✅ Ménage du ${DAY_LABELS[d].toLowerCase()} mis à jour. Pensez à régénérer le planning.`)
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  registerAppTool(server, 'set_requirements', { title: 'Besoins en personnel', description: 'Remplace les besoins en personnel d’un jour : liste de plages horaires avec le nombre de personnes requises. Demande confirmation.', inputSchema: z.object({ week: weekArg, day: dayArg, segments: z.array(z.object({ start: z.string(), end: z.string(), staff: z.number().int().min(1) })).describe('Ex. [{start:"08:00",end:"09:00",staff:2},{start:"09:00",end:"17:00",staff:3}]'), confirm: confirmArg }), annotations: mutating, _meta: uiMeta }, async ({ week, day, segments, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      const d = parseDay(day)
      const next = normalizeRequirements(segments.map((s) => ({ start: parseTime(s.start, 'Début'), end: parseTime(s.end, 'Fin'), staff: s.staff })))
      const fmt = (list: { start: number; end: number; staff: number }[]) => list.map((r) => `${toHHMM(r.start)}–${toHHMM(r.end)} : ${r.staff}`).join(' · ') || 'fermé'
      return confirmAndApply({ summary: `**Besoins du ${DAY_LABELS[d].toLowerCase()}**\n- avant : ${fmt(normalizeRequirements(w.config.requirements[d] ?? []))}\n- après : **${fmt(next)}**`, apply: async () => {
        const config = structuredClone(w.config)
        config.requirements[d] = next
        return reportResult(buildWeekReport(await persist(sql, { ...w, config }), appUrl), `✅ Besoins du ${DAY_LABELS[d].toLowerCase()} mis à jour. Pensez à régénérer le planning.`)
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  // ----- équipe --------------------------------------------------------------

  const employeeFields = z.object({
    name: z.string().optional().describe('Prénom / nom.'),
    role: z.enum(['pro', 'professionnelle', 'apprentie', 'stagiaire']).optional().describe('Statut : seules les professionnelles comptent dans le taux d’encadrement.'),
    weekly_hours: hoursArg('Heures hebdomadaires du contrat').optional(),
    work_days: daysArg.optional().describe('Jours où la personne peut travailler.'),
    fixed_daily_hours: z.string().nullable().optional().describe('Durée de journée fixe (ex. 3h30) ; null = journée variable entre min et max.'),
    min_daily_hours: hoursArg('Journée minimale').optional(),
    max_daily_hours: hoursArg('Journée maximale').optional(),
    max_amplitude_hours: hoursArg('Amplitude maximale (arrivée → départ, pause incluse)').optional(),
    break: hoursArg('Pause quotidienne non travaillée, 0h = aucune').optional(),
    can_be_alone: z.boolean().optional().describe('Peut ouvrir / fermer seule.'),
    active: z.boolean().optional().describe('Active cette semaine (une personne inactive est ignorée par le planning).'),
    avatar: z.string().optional().describe(`Animal (adulte) : ${ADULT_ANIMALS.map((a) => a.key).join(', ')}.`),
    color: z.string().optional().describe('Couleur hexadécimale (ex. #2563eb).'),
  })

  function applyEmployeeFields(w: Week, e: Employee, f: z.infer<typeof employeeFields>): { next: Employee; lines: string[] } {
    const next: Employee = { ...e }
    const lines: string[] = []
    const push = (l: string | null) => l && lines.push(l)
    if (f.name != null) { push(diffLine('Nom', e.name, f.name)); next.name = f.name }
    if (f.role != null) { const r = ROLE_INPUT[f.role]; push(diffLine('Statut', ROLE_LABELS[e.role], ROLE_LABELS[r])); next.role = r }
    if (f.weekly_hours != null) { const m = parseHours(f.weekly_hours, 'Heures hebdomadaires'); push(diffLine('Contrat', fmtDuration(e.weeklyMinutes), fmtDuration(m))); next.weeklyMinutes = m }
    if (f.work_days != null) { const days = [...new Set(f.work_days.map(parseDay))].sort() as DayIndex[]; push(diffLine('Jours', e.workDays.map((d) => DAY_LABELS[d]).join(', '), days.map((d) => DAY_LABELS[d]).join(', '))); next.workDays = days }
    if (f.fixed_daily_hours !== undefined) { const m = f.fixed_daily_hours == null ? null : parseHours(f.fixed_daily_hours, 'Journée fixe'); push(diffLine('Journée fixe', e.fixedDailyMinutes != null ? fmtDuration(e.fixedDailyMinutes) : 'non', m != null ? fmtDuration(m) : 'non')); next.fixedDailyMinutes = m }
    if (f.min_daily_hours != null) { const m = parseHours(f.min_daily_hours, 'Journée minimale'); push(diffLine('Journée minimale', fmtDuration(e.minDailyMinutes), fmtDuration(m))); next.minDailyMinutes = m }
    if (f.max_daily_hours != null) { const m = parseHours(f.max_daily_hours, 'Journée maximale'); push(diffLine('Journée maximale', fmtDuration(e.maxDailyMinutes), fmtDuration(m))); next.maxDailyMinutes = m }
    if (f.max_amplitude_hours != null) { const m = parseHours(f.max_amplitude_hours, 'Amplitude'); push(diffLine('Amplitude maximale', fmtDuration(e.maxAmplitudeMinutes), fmtDuration(m))); next.maxAmplitudeMinutes = m }
    if (f.break != null) { const m = parseHours(f.break, 'Pause'); push(diffLine('Pause', fmtDuration(e.breakMinutes), fmtDuration(m))); next.breakMinutes = m }
    if (f.can_be_alone != null) { push(diffLine('Peut être seule', e.canBeAlone ? 'oui' : 'non', f.can_be_alone ? 'oui' : 'non')); next.canBeAlone = f.can_be_alone }
    if (f.active != null) { push(diffLine('Active', e.active ? 'oui' : 'non', f.active ? 'oui' : 'non')); next.active = f.active }
    if (f.avatar != null) {
      const a = ADULT_ANIMALS.find((x) => x.key === norm(f.avatar!) || norm(x.label) === norm(f.avatar!))
      if (!a) throw new Error(`Animal inconnu : « ${f.avatar} ». Choix : ${ADULT_ANIMALS.map((x) => `${x.key} (${x.label})`).join(', ')}.`)
      push(diffLine('Animal', ADULT_ANIMALS.find((x) => x.key === e.avatar)?.label ?? '—', a.label))
      next.avatar = a.key
    }
    if (f.color != null) { if (!/^#[0-9a-f]{6}$/i.test(f.color)) throw new Error('Couleur attendue au format #rrggbb.'); push(diffLine('Couleur', e.color, f.color)); next.color = f.color }
    if (next.workDays.length === 0) throw new Error('Il faut au moins un jour travaillé.')
    void w
    return { next, lines }
  }

  server.registerTool('upsert_employee', { title: 'Ajouter ou modifier une personne', description: 'Modifie n’importe quel champ d’une personne de l’équipe (contrat, jours, statut, pauses, journée fixe, amplitude, « jamais seule », active, animal, couleur) ou crée une nouvelle personne si elle n’existe pas (create: true). Demande confirmation.', inputSchema: z.object({ week: weekArg, employee: employeeArg, create: z.boolean().optional().describe('true = créer la personne si elle n’existe pas.'), fields: employeeFields.describe('Champs à modifier.'), confirm: confirmArg }), annotations: mutating }, async ({ week, employee, create, fields, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      let existing: Employee | null = null
      try { existing = findEmployee(w, employee, true) } catch { existing = null }
      if (!existing && !create) throw new Error(`Personne inconnue : « ${employee} ». Pour la créer, rappelez l’outil avec create: true. Équipe : ${w.config.employees.map((x) => x.name).join(', ')}.`)
      const base = existing ?? makeEmployee({ name: fields.name ?? employee }, w.config.rules, w.config.employees.length, w.config.employees)
      const { next, lines } = applyEmployeeFields(w, base, fields)
      const recap = `${ROLE_LABELS[next.role]}, ${fmtDuration(next.weeklyMinutes)}/semaine, ${next.workDays.map((d) => DAY_LABELS[d].slice(0, 3)).join(' ')}, ${next.fixedDailyMinutes != null ? `${fmtDuration(next.fixedDailyMinutes)} fixe` : `${fmtDuration(next.minDailyMinutes)} à ${fmtDuration(next.maxDailyMinutes)}`}, amplitude ≤ ${fmtDuration(next.maxAmplitudeMinutes)}, pause ${fmtDuration(next.breakMinutes)}, ${next.canBeAlone ? 'peut être seule' : 'jamais seule'}, animal ${ADULT_ANIMALS.find((a) => a.key === next.avatar)?.label ?? '—'}`
      const summary = existing ? (lines.length ? `**Modifier ${existing.name}** (${weekLabelOf(w.monday)})\n${lines.join('\n')}` : `**${existing.name}** : aucun changement.`) : `**Ajouter ${next.name} à l’équipe** (${weekLabelOf(w.monday)}) : ${recap}.`
      if (existing && lines.length === 0) return text(summary)
      return confirmAndApply({ summary, apply: async () => {
        const config = structuredClone(w.config)
        const i = config.employees.findIndex((x) => x.id === next.id)
        if (i >= 0) config.employees[i] = next
        else config.employees.push(next)
        const saved = await persist(sql, { ...w, config })
        return text(`✅ ${existing ? 'Modifications enregistrées' : `${next.name} ajoutée`}. Pensez à régénérer le planning.\n\n${teamText(saved)}`)
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  server.registerTool('delete_employee', { title: 'Retirer une personne', description: 'Retire une personne de l’équipe de la semaine (ses créneaux, congés et contraintes de la semaine sont supprimés). Pour une absence temporaire, préférez active: false via upsert_employee. Demande confirmation.', inputSchema: z.object({ week: weekArg, employee: employeeArg, confirm: confirmArg }), annotations: { ...mutating, destructiveHint: true } }, async ({ week, employee, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      const e = findEmployee(w, employee, true)
      return confirmAndApply({ summary: `**Retirer ${e.name} de l’équipe de la ${weekLabelOf(w.monday)}** (créneaux, congés et contraintes de la semaine supprimés).`, apply: async () => {
        const config = structuredClone(w.config)
        config.employees = config.employees.filter((x) => x.id !== e.id)
        config.leaves = config.leaves.filter((l) => l.employeeId !== e.id)
        config.pins = config.pins.filter((p) => p.employeeId !== e.id)
        for (const cl of Object.values(config.cleaning ?? {})) if (cl) cl.employeeIds = cl.employeeIds.filter((id) => id !== e.id)
        for (const c of config.children) { if (c.referentId === e.id) c.referentId = null; if (c.relaisId === e.id) c.relaisId = null }
        const schedule = { ...w.schedule }
        delete schedule[e.id]
        const saved = await persist(sql, { ...w, config, schedule })
        return text(`✅ ${e.name} retirée.\n\n${teamText(saved)}`)
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  // ----- enfants -------------------------------------------------------------

  const childFields = z.object({
    name: z.string().optional().describe('Prénom.'),
    referent: z.string().nullable().optional().describe('Prénom de la référente (null = aucune).'),
    relais: z.string().nullable().optional().describe('Prénom de la relais (null = aucune).'),
    attendance: z.record(z.string(), z.string().nullable()).optional().describe('Présences par jour : { "lundi": "08:30-17:30", "mardi": null } (null = absent). Les jours non cités sont inchangés.'),
    avatar: z.string().optional().describe(`Bébé animal : ${BABY_ANIMALS.map((a) => a.key).join(', ')}.`),
  })

  server.registerTool('upsert_child', { title: 'Ajouter ou modifier un enfant', description: 'Modifie un enfant (prénom, référente, relais, présences par jour, animal) ou le crée s’il n’existe pas (create: true). Demande confirmation.', inputSchema: z.object({ week: weekArg, child: z.string().describe('Prénom de l’enfant.'), create: z.boolean().optional(), fields: childFields, confirm: confirmArg }), annotations: mutating }, async ({ week, child, create, fields, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      let existing: Child | null = null
      try { existing = findChild(w, child) } catch { existing = null }
      if (!existing && !create) throw new Error(`Enfant inconnu : « ${child} ». Pour le créer, rappelez l’outil avec create: true.`)
      const next: Child = structuredClone(existing ?? makeChild({ name: fields.name ?? child }, w.config.children))
      const lines: string[] = []
      const push = (l: string | null) => l && lines.push(l)
      const nameOf = (id: string | null) => (id ? w.config.employees.find((e) => e.id === id)?.name ?? '?' : '—')
      if (fields.name != null) { push(diffLine('Prénom', next.name, fields.name)); next.name = fields.name }
      if (fields.referent !== undefined) { const id = fields.referent ? findEmployee(w, fields.referent).id : null; push(diffLine('Référente', nameOf(next.referentId), nameOf(id))); next.referentId = id }
      if (fields.relais !== undefined) { const id = fields.relais ? findEmployee(w, fields.relais).id : null; push(diffLine('Relais', nameOf(next.relaisId), nameOf(id))); next.relaisId = id }
      if (fields.attendance) {
        for (const [dayName, value] of Object.entries(fields.attendance)) {
          const d = parseDay(dayName)
          const before = next.attendance[d]
          if (value == null) { push(diffLine(DAY_LABELS[d], before ? `${toHHMM(before.start)}–${toHHMM(before.end)}` : 'absent', 'absent')); next.attendance[d] = null; continue }
          const m = /^\s*([0-9h:]+)\s*[-–à]\s*([0-9h:]+)\s*$/.exec(value)
          if (!m) throw new Error(`${DAY_LABELS[d]} : présence invalide « ${value} » (format attendu 08:30-17:30).`)
          const a = { start: parseTime(m[1], DAY_LABELS[d]), end: parseTime(m[2], DAY_LABELS[d]) }
          if (a.end <= a.start) throw new Error(`${DAY_LABELS[d]} : le départ doit être après l’arrivée.`)
          push(diffLine(DAY_LABELS[d], before ? `${toHHMM(before.start)}–${toHHMM(before.end)}` : 'absent', `${toHHMM(a.start)}–${toHHMM(a.end)}`))
          next.attendance[d] = a
        }
      }
      if (fields.avatar != null) {
        const a = BABY_ANIMALS.find((x) => x.key === norm(fields.avatar!) || norm(x.label) === norm(fields.avatar!))
        if (!a) throw new Error(`Animal inconnu : « ${fields.avatar} ». Choix : ${BABY_ANIMALS.map((x) => `${x.key} (${x.label})`).join(', ')}.`)
        push(diffLine('Animal', BABY_ANIMALS.find((x) => x.key === next.avatar)?.label ?? '—', a.label))
        next.avatar = a.key
      }
      if (!existing && !next.avatar) next.avatar = pickAnimal(BABY_ANIMALS, w.config.children.map((c) => c.avatar), w.config.children.length)
      const summary = existing ? (lines.length ? `**Modifier ${existing.name}**\n${lines.join('\n')}` : `**${existing.name}** : aucun changement.`) : `**Ajouter l’enfant ${next.name}** (référente ${nameOf(next.referentId)}, relais ${nameOf(next.relaisId)}, animal ${BABY_ANIMALS.find((x) => x.key === next.avatar)?.label ?? '—'})${lines.length ? `\n${lines.join('\n')}` : ''}`
      if (existing && lines.length === 0) return text(summary)
      return confirmAndApply({ summary, apply: async () => {
        const config = structuredClone(w.config)
        const i = config.children.findIndex((x) => x.id === next.id)
        if (i >= 0) config.children[i] = next
        else config.children.push(next)
        const saved = await persist(sql, { ...w, config })
        return text(`✅ ${existing ? 'Modifications enregistrées' : `${next.name} ajouté`}.\n\n${childrenText(saved)}`)
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  server.registerTool('delete_child', { title: 'Retirer un enfant', description: 'Retire un enfant de la liste de la semaine. Demande confirmation.', inputSchema: z.object({ week: weekArg, child: z.string(), confirm: confirmArg }), annotations: { ...mutating, destructiveHint: true } }, async ({ week, child, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      const c = findChild(w, child)
      return confirmAndApply({ summary: `**Retirer l’enfant ${c.name}** de la ${weekLabelOf(w.monday)}.`, apply: async () => {
        const config = structuredClone(w.config)
        config.children = config.children.filter((x) => x.id !== c.id)
        const saved = await persist(sql, { ...w, config })
        return text(`✅ ${c.name} retiré.\n\n${childrenText(saved)}`)
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  // ----- règles --------------------------------------------------------------

  const rulesFields = z.object({
    day_start: timeArg('Début de journée au plus tôt').optional(),
    day_end: timeArg('Fin de journée au plus tard').optional(),
    open_days: daysArg.optional().describe('Jours d’ouverture.'),
    min_pros: z.number().int().min(1).optional().describe('Professionnelles minimum dès que 2 personnes sont requises.'),
    ratio: z.array(z.object({ min_children: z.number().int().min(1), staff: z.number().int().min(1) })).optional().describe('Taux d’encadrement : à partir de N enfants → M personnes.'),
    break_window_start: timeArg('Pauses de préférence à partir de').optional(),
    break_window_end: timeArg('Pauses de préférence jusqu’à').optional(),
    break_min_shift_hours: hoursArg('Pause due seulement si la journée dépasse (0h = toujours)').optional(),
    overtime_strictness: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('Heures supplémentaires : 1 tolérées, 2 limitées, 3 fortement évitées.'),
    referent_importance: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe('Présence des référentes : 0 ignorée, 1 souhaitée, 2 importante.'),
    default_min_daily_hours: hoursArg('Journée minimale par défaut').optional(),
    default_max_daily_hours: hoursArg('Journée maximale par défaut').optional(),
    default_max_amplitude_hours: hoursArg('Amplitude maximale par défaut').optional(),
    default_break: hoursArg('Pause par défaut').optional(),
    default_cleaning: hoursArg('Ménage quotidien par défaut').optional(),
  })

  server.registerTool('update_rules', { title: 'Modifier les règles', description: 'Modifie les règles d’une semaine : horaires et jours d’ouverture, encadrement, taux, pauses, priorités du générateur, valeurs par défaut. Demande confirmation.', inputSchema: z.object({ week: weekArg, fields: rulesFields, confirm: confirmArg }), annotations: mutating }, async ({ week, fields: f, confirm }, ctx) => {
    try {
      const w = await resolveWeek(sql, week)
      const r = w.config.rules
      const next: Rules = { ...r, ratio: r.ratio.map((s) => ({ ...s })) }
      const lines: string[] = []
      const push = (l: string | null) => l && lines.push(l)
      const setTime = (key: keyof Rules, label: string, v?: string) => { if (v != null) { const m = parseTime(v, label); push(diffLine(label, toHHMM(r[key] as number), toHHMM(m))); (next as unknown as Record<string, unknown>)[key] = m } }
      const setDur = (key: keyof Rules, label: string, v?: string) => { if (v != null) { const m = parseHours(v, label); push(diffLine(label, fmtDuration(r[key] as number), fmtDuration(m))); (next as unknown as Record<string, unknown>)[key] = m } }
      setTime('dayStart', 'Début de journée', f.day_start)
      setTime('dayEnd', 'Fin de journée', f.day_end)
      setTime('breakWindowStart', 'Pauses à partir de', f.break_window_start)
      setTime('breakWindowEnd', 'Pauses jusqu’à', f.break_window_end)
      setDur('breakMinShiftMinutes', 'Pause due au-delà de', f.break_min_shift_hours)
      setDur('defaultMinDailyMinutes', 'Journée minimale par défaut', f.default_min_daily_hours)
      setDur('defaultMaxDailyMinutes', 'Journée maximale par défaut', f.default_max_daily_hours)
      setDur('defaultMaxAmplitudeMinutes', 'Amplitude par défaut', f.default_max_amplitude_hours)
      setDur('defaultBreakMinutes', 'Pause par défaut', f.default_break)
      setDur('defaultCleaningMinutes', 'Ménage par défaut', f.default_cleaning)
      if (f.open_days) { const days = [...new Set(f.open_days.map(parseDay))].sort() as DayIndex[]; push(diffLine('Jours d’ouverture', r.openDays.map((d) => DAY_LABELS[d]).join(', '), days.map((d) => DAY_LABELS[d]).join(', '))); next.openDays = days }
      if (f.min_pros != null) { push(diffLine('Professionnelles minimum', String(r.minProsWhenTwoOrMore), String(f.min_pros))); next.minProsWhenTwoOrMore = f.min_pros }
      if (f.ratio) { const ratio = f.ratio.map((s) => ({ minChildren: s.min_children, staff: s.staff })).sort((a, b) => a.minChildren - b.minChildren); push(diffLine('Taux d’encadrement', r.ratio.map((s) => `${s.minChildren}+→${s.staff}`).join(', '), ratio.map((s) => `${s.minChildren}+→${s.staff}`).join(', '))); next.ratio = ratio }
      if (f.overtime_strictness != null) { push(diffLine('Heures supplémentaires', String(r.overtimeStrictness), String(f.overtime_strictness))); next.overtimeStrictness = f.overtime_strictness }
      if (f.referent_importance != null) { push(diffLine('Importance des référentes', String(r.referentImportance), String(f.referent_importance))); next.referentImportance = f.referent_importance }
      if (next.dayEnd <= next.dayStart) throw new Error('La fin de journée doit être après le début.')
      if (lines.length === 0) return text('Aucun changement demandé.\n\n' + rulesText(r))
      return confirmAndApply({ summary: `**Règles de la ${weekLabelOf(w.monday)}**\n${lines.join('\n')}`, apply: async () => {
        const saved = await persist(sql, { ...w, config: { ...w.config, rules: next } })
        return text(`✅ Règles enregistrées. Pensez à régénérer le planning.\n\n${rulesText(saved.config.rules)}`)
      } }, confirm, ctx)
    } catch (e) {
      return errorResult(e)
    }
  })

  void EMPLOYEE_COLORS
  return server
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const expected = process.env.MCP_TOKEN || process.env.APP_PASSWORD
  if (expected) {
    const auth = req.headers.authorization
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined
    const token = (typeof req.query.token === 'string' ? req.query.token : undefined) ?? (req.headers['x-app-key'] as string | undefined) ?? bearer
    if (token !== expected) {
      res.status(401).json({ error: 'unauthorized', message: 'Jeton MCP invalide.' })
      return
    }
  }
  const sql = getSql()
  if (!sql) {
    res.status(503).json({ error: 'no_database' })
    return
  }
  await ensureSchema(sql)
  const appUrl = process.env.APP_URL ?? `https://${req.headers.host ?? 'localhost'}`
  const server = createServer(sql, appUrl)
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
}
