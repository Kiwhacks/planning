import type { VercelRequest, VercelResponse } from '@vercel/node'
import { McpServer } from '@modelcontextprotocol/server'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { z } from 'zod'
import { WEEK_UI_HTML } from './ui.generated'
import { ensureSchema, getSql, loadTemplate, loadWeek, loadWeeks, saveTemplate, saveWeek, type Sql } from './shared'
import { buildWeekReport, weekLabelOf, weekReportToMarkdown, type WeekReport } from '../src/domain/report'
import { compile, toSchedule } from '../src/domain/model'
import { solve } from '../src/domain/solver'
import { buildExampleTemplate, migrateTemplate, migrateWeekConfig, newId, weekConfigFromTemplate } from '../src/domain/defaults'
import { normalizeRequirements } from '../src/domain/requirements'
import { fmtDuration, fromHHMM, parseDuration, roundToSlot, toHHMM } from '../src/domain/time'
import { mondayISO, weekIdOf } from '../src/store/weekKey'
import { DAY_LABELS, ROLE_LABELS, type DayIndex, type Employee, type Week } from '../src/domain/types'

/**
 * Serveur MCP (Streamable HTTP, sans état) : permet d'utiliser le planning depuis Claude, ChatGPT, etc.
 * URL : https://<domaine>/api/mcp/<MCP_TOKEN>   (ou en-tête `x-app-key` / `Authorization: Bearer`).
 * Les outils renvoient du Markdown + des données structurées affichées par la vue MCP App (ui://planning-creche/week.html).
 */

const UI_URI = 'ui://planning-creche/week.html'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function parseDay(input: string | number, openDays: DayIndex[]): DayIndex {
  if (typeof input === 'number') {
    if (input >= 0 && input <= 6) return input as DayIndex
    throw new Error(`Jour invalide : ${input}`)
  }
  const n = norm(input)
  const idx = DAY_LABELS.findIndex((l) => norm(l) === n || norm(l).startsWith(n.slice(0, 3)))
  if (idx < 0) throw new Error(`Jour inconnu : « ${input} ». Jours ouverts : ${openDays.map((d) => DAY_LABELS[d]).join(', ')}.`)
  return idx as DayIndex
}

function parseTime(input: string, label: string): number {
  const m = fromHHMM(input.replace('h', ':').replace(/:$/, ':00'))
  if (m == null) throw new Error(`${label} : heure invalide « ${input} » (format attendu 08:30 ou 8h30).`)
  return roundToSlot(m)
}

function findEmployee(week: Week, name: string): Employee {
  const n = norm(name)
  const list = week.config.employees.filter((e) => e.active)
  const e = list.find((x) => norm(x.name) === n || x.id === name) ?? list.find((x) => norm(x.name).startsWith(n))
  if (!e) throw new Error(`Personne inconnue : « ${name} ». Équipe : ${list.map((x) => x.name).join(', ')}.`)
  return e
}

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

function result(report: WeekReport, prefix?: string) {
  const md = weekReportToMarkdown(report)
  return { content: [{ type: 'text' as const, text: prefix ? `${prefix}\n\n${md}` : md }], structuredContent: report as unknown as Record<string, unknown> }
}

function errorResult(e: unknown) {
  return { content: [{ type: 'text' as const, text: `Erreur : ${e instanceof Error ? e.message : String(e)}` }], isError: true }
}

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

function createServer(sql: Sql, appUrl: string): McpServer {
  const server = new McpServer({ name: 'planning-creche', version: '1.0.0' })
  const uiMeta = { ui: { resourceUri: UI_URI } }
  const weekArg = z.string().optional().describe('Semaine : identifiant ISO (ex. 2026-W44), date (2026-10-26), « cette semaine » (défaut) ou « semaine prochaine ».')
  const dayArg = z.union([z.string(), z.number()]).describe('Jour : lundi, mardi… ou index 0 (lundi) à 6.')
  const employeeArg = z.string().describe('Prénom de la personne (tel qu’il apparaît dans l’équipe).')

  registerAppResource(server, 'Planning de la semaine', UI_URI, { description: 'Vue graphique du planning hebdomadaire', mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: WEEK_UI_HTML }],
  }))

  server.registerTool(
    'list_weeks',
    { title: 'Lister les semaines', description: 'Liste les semaines de planning enregistrées (identifiant, dates, statut, heures planifiées).', inputSchema: z.object({}) },
    async () => {
      const weeks = await loadWeeks(sql)
      if (weeks.length === 0) return { content: [{ type: 'text', text: 'Aucune semaine enregistrée. Utilisez create_week.' }] }
      const lines = ['| Semaine | Statut | Planning | Heures sup. |', '|---|---|---|---|']
      const items = weeks.map((w) => {
        const r = buildWeekReport({ ...w, config: migrateWeekConfig(w.config) }, appUrl)
        const ot = r.totals.reduce((a, t) => a + Math.max(0, t.delta), 0)
        lines.push(`| ${w.id} — ${r.week.label} | ${w.status === 'validated' ? 'validée' : 'brouillon'} | ${r.hasSchedule ? (r.violations.some((v) => v.severity === 'error') ? 'généré, points à vérifier' : 'généré') : 'non généré'} | ${ot ? `+${fmtDuration(ot)}` : '—'} |`)
        return { id: w.id, monday: w.monday, label: r.week.label, status: w.status, hasSchedule: r.hasSchedule, overtimeMinutes: ot }
      })
      return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { weeks: items } }
    },
  )

  registerAppTool(server, 'get_week', { title: 'Afficher une semaine', description: 'Affiche le planning d’une semaine : horaires de chaque personne par jour, récapitulatif des heures, points de vigilance et suggestions.', inputSchema: z.object({ week: weekArg }), _meta: uiMeta }, async ({ week }) => {
    try {
      const w = await resolveWeek(sql, week)
      return result(buildWeekReport(w, appUrl))
    } catch (e) {
      return errorResult(e)
    }
  })

  registerAppTool(
    server,
    'generate_week',
    {
      title: 'Générer le planning',
      description: 'Génère (ou régénère) le planning d’une semaine avec le solveur, en respectant les contraintes, puis l’enregistre. Les créneaux verrouillés sont conservés.',
      inputSchema: z.object({ week: weekArg, improve_existing: z.boolean().optional().describe('true = partir du planning existant pour l’améliorer ; false (défaut) = repartir de zéro (hors créneaux verrouillés).') }),
      _meta: uiMeta,
    },
    async ({ week, improve_existing }) => {
      try {
        const w = await resolveWeek(sql, week)
        if (!w.config.employees.some((e) => e.active)) throw new Error('Aucune personne active dans l’équipe de cette semaine.')
        const solved = await persist(sql, runSolver(w, !improve_existing))
        return result(buildWeekReport(solved, appUrl), '✅ Planning généré et enregistré.')
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
      description: 'Crée une nouvelle semaine de planning à partir des réglages par défaut (ou en copiant la semaine précédente).',
      inputSchema: z.object({ date: z.string().describe('Une date de la semaine à créer (YYYY-MM-DD).'), copy_previous: z.boolean().optional().describe('true = copier la semaine précédente (besoins, congés, contraintes, planning).') }),
      _meta: uiMeta,
    },
    async ({ date, copy_previous }) => {
      try {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date attendue au format YYYY-MM-DD.')
        const d = new Date(`${date}T12:00:00`)
        const id = weekIdOf(d)
        if (await loadWeek(sql, id)) throw new Error(`La semaine ${id} existe déjà.`)
        let template = await loadTemplate(sql)
        if (!template) {
          template = buildExampleTemplate()
          await saveTemplate(sql, template)
        }
        template = migrateTemplate(template)
        let week: Week = { id, monday: mondayISO(d), config: weekConfigFromTemplate(template), schedule: {}, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        if (copy_previous) {
          const prev = await loadWeek(sql, weekIdOf(new Date(d.getTime() - 7 * 86400000)))
          if (prev) week = { ...week, config: migrateWeekConfig(prev.config), schedule: prev.schedule }
        }
        await saveWeek(sql, week)
        return result(buildWeekReport(week, appUrl), `✅ Semaine ${id} créée (${weekLabelOf(week.monday)}).`)
      } catch (e) {
        return errorResult(e)
      }
    },
  )

  registerAppTool(
    server,
    'set_shift',
    {
      title: 'Modifier un créneau',
      description: 'Fixe manuellement les horaires d’une personne un jour donné (créneau verrouillé par défaut, conservé lors des régénérations).',
      inputSchema: z.object({
        week: weekArg,
        employee: employeeArg,
        day: dayArg,
        start: z.string().describe('Heure d’arrivée (08:30).'),
        end: z.string().describe('Heure de départ (17:00).'),
        break_start: z.string().nullable().optional().describe('Début de la pause (12:30), null = pas de pause. Par défaut : pause placée au milieu si la personne en a une.'),
        locked: z.boolean().optional().describe('Verrouiller le créneau (défaut true).'),
      }),
      _meta: uiMeta,
    },
    async ({ week, employee, day, start, end, break_start, locked }) => {
      try {
        const w = await resolveWeek(sql, week)
        const e = findEmployee(w, employee)
        const d = parseDay(day, w.config.rules.openDays)
        const s = parseTime(start, 'Arrivée')
        const en = parseTime(end, 'Départ')
        if (en <= s) throw new Error('Le départ doit être après l’arrivée.')
        let b: number | null = null
        if (break_start === undefined) b = e.breakMinutes > 0 ? roundToSlot((s + en) / 2 - e.breakMinutes / 2) : null
        else if (break_start !== null) b = parseTime(break_start, 'Pause')
        if (b != null && (b <= s || b + e.breakMinutes >= en)) throw new Error('La pause doit être à l’intérieur du créneau.')
        const schedule = { ...w.schedule, [e.id]: { ...(w.schedule[e.id] ?? {}), [d]: { start: s, end: en, breakStart: b, locked: locked ?? true } } }
        const saved = await persist(sql, { ...w, schedule })
        return result(buildWeekReport(saved, appUrl), `✅ ${e.name} : ${DAY_LABELS[d]} ${toHHMM(s)}–${toHHMM(en)} enregistré.`)
      } catch (e) {
        return errorResult(e)
      }
    },
  )

  registerAppTool(server, 'remove_shift', { title: 'Supprimer un créneau', description: 'Retire le créneau d’une personne un jour donné.', inputSchema: z.object({ week: weekArg, employee: employeeArg, day: dayArg }), _meta: uiMeta }, async ({ week, employee, day }) => {
    try {
      const w = await resolveWeek(sql, week)
      const e = findEmployee(w, employee)
      const d = parseDay(day, w.config.rules.openDays)
      const schedule = { ...w.schedule, [e.id]: { ...(w.schedule[e.id] ?? {}), [d]: null } }
      const saved = await persist(sql, { ...w, schedule })
      return result(buildWeekReport(saved, appUrl), `✅ Créneau de ${e.name} le ${DAY_LABELS[d].toLowerCase()} supprimé.`)
    } catch (e) {
      return errorResult(e)
    }
  })

  registerAppTool(
    server,
    'set_leave',
    {
      title: 'Congé / absence',
      description: 'Déclare (ou retire) un congé ou une absence pour une personne un jour donné. Les heures indiquées comptent dans le contrat hebdomadaire.',
      inputSchema: z.object({
        week: weekArg,
        employee: employeeArg,
        day: dayArg,
        hours: z.string().optional().describe('Heures comptées (ex. « 7h »). Défaut : la journée type de la personne.'),
        label: z.string().optional().describe('Motif (Congé, Maladie, Formation…).'),
        remove: z.boolean().optional().describe('true = retirer le congé.'),
      }),
      _meta: uiMeta,
    },
    async ({ week, employee, day, hours, label, remove }) => {
      try {
        const w = await resolveWeek(sql, week)
        const e = findEmployee(w, employee)
        const d = parseDay(day, w.config.rules.openDays)
        const config = structuredClone(w.config)
        config.leaves = config.leaves.filter((l) => !(l.employeeId === e.id && l.day === d))
        let msg = `✅ Congé de ${e.name} le ${DAY_LABELS[d].toLowerCase()} retiré.`
        if (!remove) {
          const minutes = hours ? parseDuration(hours) : e.fixedDailyMinutes ?? roundToSlot(e.weeklyMinutes / Math.max(1, e.workDays.length))
          if (minutes == null) throw new Error(`Durée invalide : « ${hours} ».`)
          config.leaves.push({ id: newId('lv'), employeeId: e.id, day: d, minutes, label: label ?? 'Congé' })
          const schedule = { ...w.schedule, [e.id]: { ...(w.schedule[e.id] ?? {}), [d]: null } }
          const saved = await persist(sql, { ...w, config, schedule })
          return result(buildWeekReport(saved, appUrl), `✅ ${label ?? 'Congé'} de ${e.name} le ${DAY_LABELS[d].toLowerCase()} (${fmtDuration(minutes)} comptées). Pensez à régénérer le planning.`)
        }
        const saved = await persist(sql, { ...w, config })
        return result(buildWeekReport(saved, appUrl), msg)
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
      description: 'Impose une heure d’arrivée ou de départ, ou oblige / interdit une journée, pour une personne un jour donné (ex. « Fanny ouvre à 6h45 mardi »).',
      inputSchema: z.object({
        week: weekArg,
        employee: employeeArg,
        day: dayArg,
        start: z.string().optional().describe('Heure d’arrivée imposée.'),
        end: z.string().optional().describe('Heure de départ imposée.'),
        must_work: z.enum(['oui', 'non', 'libre']).optional().describe('oui = doit travailler ce jour, non = ne travaille pas (sans heures comptées), libre = au choix.'),
        note: z.string().optional(),
        remove: z.boolean().optional().describe('true = retirer toutes les contraintes de cette personne ce jour.'),
      }),
      _meta: uiMeta,
    },
    async ({ week, employee, day, start, end, must_work, note, remove }) => {
      try {
        const w = await resolveWeek(sql, week)
        const e = findEmployee(w, employee)
        const d = parseDay(day, w.config.rules.openDays)
        const config = structuredClone(w.config)
        config.pins = config.pins.filter((p) => !(p.employeeId === e.id && p.day === d))
        if (!remove) {
          const s = start ? parseTime(start, 'Arrivée') : null
          const en = end ? parseTime(end, 'Départ') : null
          const mustWork = must_work === 'oui' ? true : must_work === 'non' ? false : s != null || en != null ? true : null
          config.pins.push({ id: newId('pin'), employeeId: e.id, day: d, start: s, end: en, mustWork, note: note ?? '' })
        }
        const saved = await persist(sql, { ...w, config })
        return result(buildWeekReport(saved, appUrl), remove ? `✅ Contraintes de ${e.name} le ${DAY_LABELS[d].toLowerCase()} retirées.` : `✅ Contrainte enregistrée pour ${e.name} le ${DAY_LABELS[d].toLowerCase()}. Pensez à régénérer le planning.`)
      } catch (e) {
        return errorResult(e)
      }
    },
  )

  registerAppTool(
    server,
    'set_cleaning',
    {
      title: 'Ménage',
      description: 'Définit le ménage d’un jour : durée après le départ du dernier enfant et personnes affectées.',
      inputSchema: z.object({ week: weekArg, day: dayArg, minutes: z.number().optional().describe('Durée du ménage en minutes (ex. 30).'), employees: z.array(z.string()).optional().describe('Prénoms des personnes affectées (remplace la liste).') }),
      _meta: uiMeta,
    },
    async ({ week, day, minutes, employees }) => {
      try {
        const w = await resolveWeek(sql, week)
        const d = parseDay(day, w.config.rules.openDays)
        const config = structuredClone(w.config)
        config.cleaning ??= {}
        const cur = (config.cleaning[d] ??= { minutes: config.rules.defaultCleaningMinutes, employeeIds: [] })
        if (minutes != null) cur.minutes = roundToSlot(minutes)
        if (employees) cur.employeeIds = employees.map((n) => findEmployee(w, n).id)
        const saved = await persist(sql, { ...w, config })
        const names = cur.employeeIds.map((id) => w.config.employees.find((e) => e.id === id)?.name ?? '?')
        return result(buildWeekReport(saved, appUrl), `✅ Ménage du ${DAY_LABELS[d].toLowerCase()} : ${fmtDuration(cur.minutes)}, ${names.length ? names.join(', ') : 'personne affectée'}. Pensez à régénérer le planning.`)
      } catch (e) {
        return errorResult(e)
      }
    },
  )

  registerAppTool(
    server,
    'set_requirements',
    {
      title: 'Besoins en personnel',
      description: 'Remplace les besoins en personnel d’un jour : liste de plages horaires avec le nombre de personnes requises.',
      inputSchema: z.object({ week: weekArg, day: dayArg, segments: z.array(z.object({ start: z.string(), end: z.string(), staff: z.number().int().min(1) })).describe('Ex. [{start:"08:00",end:"09:00",staff:2},{start:"09:00",end:"17:00",staff:3}]') }),
      _meta: uiMeta,
    },
    async ({ week, day, segments }) => {
      try {
        const w = await resolveWeek(sql, week)
        const d = parseDay(day, w.config.rules.openDays)
        const config = structuredClone(w.config)
        config.requirements[d] = normalizeRequirements(segments.map((s) => ({ start: parseTime(s.start, 'Début'), end: parseTime(s.end, 'Fin'), staff: s.staff })))
        const saved = await persist(sql, { ...w, config })
        return result(buildWeekReport(saved, appUrl), `✅ Besoins du ${DAY_LABELS[d].toLowerCase()} mis à jour. Pensez à régénérer le planning.`)
      } catch (e) {
        return errorResult(e)
      }
    },
  )

  registerAppTool(server, 'set_week_status', { title: 'Statut de la semaine', description: 'Marque la semaine comme validée ou la repasse en brouillon.', inputSchema: z.object({ week: weekArg, status: z.enum(['draft', 'validated']) }), _meta: uiMeta }, async ({ week, status }) => {
    try {
      const w = await resolveWeek(sql, week)
      const saved = await persist(sql, { ...w, status })
      return result(buildWeekReport(saved, appUrl), `✅ Semaine ${status === 'validated' ? 'validée' : 'repassée en brouillon'}.`)
    } catch (e) {
      return errorResult(e)
    }
  })

  server.registerTool('get_team', { title: 'Équipe et règles', description: 'Décrit l’équipe (contrats, jours, pauses, particularités) et les règles d’encadrement d’une semaine.', inputSchema: z.object({ week: weekArg }) }, async ({ week }) => {
    try {
      const w = await resolveWeek(sql, week)
      const { rules } = w.config
      const lines = [`## Équipe — ${weekLabelOf(w.monday)}`, '', '| Personne | Statut | Contrat | Jours | Journée | Pause | Particularités |', '|---|---|---|---|---|---|---|']
      for (const e of w.config.employees.filter((x) => x.active)) {
        const day = e.fixedDailyMinutes != null ? `${fmtDuration(e.fixedDailyMinutes)} fixe` : `${fmtDuration(e.minDailyMinutes)} à ${fmtDuration(e.maxDailyMinutes)}`
        const notes = [!e.canBeAlone && 'jamais seule', e.role !== 'pro' && 'hors taux d’encadrement'].filter(Boolean).join(', ')
        lines.push(`| ${e.name} | ${ROLE_LABELS[e.role]} | ${fmtDuration(e.weeklyMinutes)} | ${e.workDays.map((d) => DAY_LABELS[d].slice(0, 3)).join(' ')} | ${day} (amplitude ≤ ${fmtDuration(e.maxAmplitudeMinutes)}) | ${e.breakMinutes ? fmtDuration(e.breakMinutes) : 'aucune'} | ${notes || '—'} |`)
      }
      lines.push('', `Structure ouverte ${rules.openDays.map((d) => DAY_LABELS[d]).join(', ')}, de ${toHHMM(rules.dayStart)} à ${toHHMM(rules.dayEnd)} au plus. Au moins ${rules.minProsWhenTwoOrMore} professionnelles dès que 2 personnes sont requises. Pauses de préférence entre ${toHHMM(rules.breakWindowStart)} et ${toHHMM(rules.breakWindowEnd)}. Ménage par défaut : ${fmtDuration(rules.defaultCleaningMinutes)}.`)
      if (w.config.notes) lines.push('', `Notes : ${w.config.notes}`)
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    } catch (e) {
      return errorResult(e)
    }
  })

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
