/**
 * Vue MCP App : affiche une semaine de planning dans Claude / ChatGPT.
 * Reçoit le résultat structuré de l'outil (WeekReport) via le protocole MCP Apps.
 */
import type { WeekReport } from '../domain/report'
import { MiniApp } from './mini-app'

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const dur = (m: number) => {
  const sign = m < 0 ? '-' : ''
  const a = Math.abs(Math.round(m))
  const h = Math.floor(a / 60)
  const mm = a % 60
  return mm ? `${sign}${h}h${String(mm).padStart(2, '0')}` : `${sign}${h}h`
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

const root = document.getElementById('root') as HTMLElement
const ANIMALS = ((window as unknown as { __ANIMALS?: Record<string, string> }).__ANIMALS ?? {}) as Record<string, string>
const avatar = (key: string | undefined, color: string) => {
  const svg = key ? ANIMALS[key] : undefined
  return svg ? `<span class="av" style="background:${color}22;box-shadow:inset 0 0 0 2px ${color}">${svg}</span>` : `<i style="background:${color}"></i>`
}

function render(r: WeekReport) {
  const span = r.dayEnd - r.dayStart
  const pct = (t: number) => ((t - r.dayStart) / span) * 100
  const hours: number[] = []
  for (let t = Math.ceil(r.dayStart / 60) * 60; t <= r.dayEnd; t += 60) hours.push(t)
  const errors = r.violations.filter((v) => v.severity === 'error')
  const warnings = r.violations.filter((v) => v.severity === 'warning')

  const dayHtml = r.days
    .map((d) => {
      const rows = r.employees
        .map((e) => {
          const sh = d.shifts.find((s) => s.employeeId === e.id)
          const ab = d.absences.find((a) => a.employeeId === e.id)
          let bar = ''
          if (sh) {
            const w = sh.end - sh.start
            const brk = sh.breakStart != null && sh.breakEnd != null ? `<div class="brk" style="left:${((sh.breakStart - sh.start) / w) * 100}%;width:${((sh.breakEnd - sh.breakStart) / w) * 100}%"></div>` : ''
            const cl = sh.cleaning && d.close != null ? `<div class="cln" style="left:${((d.close - sh.start) / w) * 100}%;width:${((sh.end - d.close) / w) * 100}%"></div>` : ''
            bar = `<div class="bar" style="left:${pct(sh.start)}%;width:${pct(sh.end) - pct(sh.start)}%;background:${e.color}" title="${esc(sh.text)}">${brk}${cl}<span>${hhmm(sh.start)}–${hhmm(sh.end)} <em>(${dur(sh.worked)})</em>${sh.locked ? ' 🔒' : ''}</span></div>`
          } else if (ab) bar = `<div class="note">${esc(ab.label)} (${dur(ab.minutes)})</div>`
          const text = sh ? `${sh.text} · ${dur(sh.worked)}` : ab ? `${esc(ab.label)} (${dur(ab.minutes)})` : '—'
          return `<div class="name">${avatar(e.avatar, e.color)}${esc(e.name)}</div><div class="track">${hours.map((t) => `<b style="left:${pct(t)}%"></b>`).join('')}${bar}</div><div class="txt">${text}</div>`
        })
        .join('')
      const req = d.requirements.map((q) => `<div class="req" style="left:${pct(q.start)}%;width:${pct(q.end) - pct(q.start)}%">${q.staff}</div>`).join('') + (d.cleaningEnd && d.close != null ? `<div class="req clean" style="left:${pct(d.close)}%;width:${pct(d.cleaningEnd) - pct(d.close)}%">ménage</div>` : '')
      const cov = d.coverage
        .map((s) => {
          const cls = s.cleaning ? 'c' : s.required === 0 ? (s.present > 0 ? 'o' : 'z') : s.problem ? 'u' : s.present > s.required ? 'p' : 'k'
          return `<div class="cv ${cls}" title="${hhmm(s.time)} : ${s.present} / ${s.required}"></div>`
        })
        .join('')
      return `<section class="day"><header><h3>${d.label} <small>${esc(d.date)}</small></h3><small>Besoin ${dur(d.requiredMinutes)} · Présence ${dur(d.presentMinutes)}${d.missingMinutes ? ` · <span class="err">manque ${dur(d.missingMinutes)}</span>` : ''}</small></header>
        <div class="grid">
          <div class="hd"></div><div class="axis">${hours.map((t) => `<span style="left:${pct(t)}%">${hhmm(t)}</span>`).join('')}</div>
          <div class="name muted">Besoin</div><div class="track reqs">${req}</div>
          ${rows}
          <div class="name muted">Présentes</div><div class="covs">${cov}</div>
        </div></section>`
    })
    .join('')

  const anyCleaning = r.totals.some((t) => (t.cleaning ?? 0) > 0)
  const totals = r.totals
    .map((t) => `<tr><td>${avatar(r.employees.find((e) => e.id === t.employeeId)?.avatar, t.color)}${esc(t.employee)}</td><td>${dur(t.worked)}</td>${anyCleaning ? `<td class="clean">${t.cleaning ? dur(t.cleaning) : '—'}</td>` : ''}<td>${t.leave ? dur(t.leave) : '—'}</td><td>${dur(t.contract)}</td><td class="${t.delta > 0 ? 'err' : t.delta < 0 ? 'warn' : 'ok'}">${t.delta > 0 ? '+' : ''}${dur(t.delta)}</td></tr>`)
    .join('')
  const ot = r.totals.reduce((a, t) => a + Math.max(0, t.delta), 0)

  root.innerHTML = `
    <header class="top">
      <div><h2>${esc(r.week.label)}</h2><span class="badge ${r.week.status}">${r.week.status === 'validated' ? 'Validée' : 'Brouillon'}</span></div>
      <div class="pills">${errors.length ? `<span class="pill err">${errors.length} bloquant${errors.length > 1 ? 's' : ''}</span>` : '<span class="pill ok">Contraintes respectées</span>'}${warnings.length ? `<span class="pill warn">${warnings.length} avertissement${warnings.length > 1 ? 's' : ''}</span>` : ''}${ot ? `<span class="pill warn">+${dur(ot)} sup.</span>` : ''}${r.appUrl ? `<a class="pill link" href="${esc(r.appUrl)}" id="open-app">Ouvrir l’application ↗</a>` : ''}</div>
    </header>
    ${r.hasSchedule ? '<div class="legend"><span><i></i>travail</span><span><i class="p"></i>pause</span><span><i class="m"></i>ménage</span></div>' : '<p class="muted">Aucun planning généré pour cette semaine. Demandez « génère le planning ».</p>'}
    ${dayHtml}
    <section class="day"><header><h3>Récapitulatif</h3></header>
      <table><thead><tr><th>Personne</th><th>Travaillé</th>${anyCleaning ? '<th>dont ménage</th>' : ''}<th>Congés</th><th>Contrat</th><th>Écart</th></tr></thead><tbody>${totals}</tbody></table>
    </section>
    ${errors.length || warnings.length ? `<section class="day"><header><h3>Points de vigilance</h3></header><ul>${errors.map((v) => `<li class="err">${esc(v.message)}</li>`).join('')}${warnings.map((v) => `<li class="warn">${esc(v.message)}</li>`).join('')}</ul></section>` : ''}
    ${r.suggestions.length ? `<section class="day"><header><h3>Suggestions</h3></header><ul>${r.suggestions.map((s) => `<li>💡 ${esc(s.message)}${s.detail ? ` <small class="muted">${esc(s.detail)}</small>` : ''}</li>`).join('')}</ul></section>` : ''}
  `
  const link = document.getElementById('open-app')
  if (link && r.appUrl) {
    link.addEventListener('click', (ev) => {
      ev.preventDefault()
      void app.openLink({ url: r.appUrl! })
    })
  }
}

function applyTheme(theme: string | undefined) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
}

const app = new MiniApp({ name: 'planning-creche-view', version: '1.0.0' })
app.ontoolresult = (result) => {
  const data = result.structuredContent as WeekReport | undefined
  if (data && Array.isArray(data.days)) render(data)
  else {
    const text = (result.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n')
    root.innerHTML = `<p class="muted">${esc(text)}</p>`
  }
}
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyTheme(ctx.theme)
}
app
  .connect()
  .then((init) => applyTheme(init.hostContext?.theme))
  .catch((e: unknown) => {
    root.innerHTML = `<p class="muted">Connexion à l’hôte impossible : ${esc(String(e))}</p>`
  })
export {}
