import { useRef } from 'react'
import { toast } from 'sonner'
import { Download, FolderOpen, Trash2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SectionCard } from '@/components/common/SectionCard'
import { compile } from '@/domain/model'
import { evaluate } from '@/domain/evaluate'
import { fmtDuration } from '@/domain/time'
import type { Week } from '@/domain/types'
import { useStore, type PersistedData } from '@/store/useStore'
import { weekLabel } from '@/store/weekKey'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'

export function HistoryTab({ onOpen }: { onOpen: () => void }) {
  const weeks = useStore((s) => s.weeks)
  const currentWeekId = useStore((s) => s.currentWeekId)
  const setCurrentWeek = useStore((s) => s.setCurrentWeek)
  const deleteWeek = useStore((s) => s.deleteWeek)
  const exportData = useStore((s) => s.exportData)
  const importData = useStore((s) => s.importData)
  const fileRef = useRef<HTMLInputElement>(null)
  const list = Object.values(weeks).sort((a, b) => b.monday.localeCompare(a.monday))

  const summarize = (w: Week) => {
    const hasSchedule = Object.values(w.schedule).some((row) => Object.values(row).some(Boolean))
    if (!hasSchedule) return { hasSchedule, worked: 0, overtime: 0, errors: 0 }
    const { model, shifts } = compile(w.config, w.schedule)
    const ev = evaluate(model, shifts)
    return {
      hasSchedule,
      worked: ev.stats.reduce((a, s) => a + s.workedMinutes, 0),
      overtime: ev.stats.reduce((a, s) => a + Math.max(0, s.deltaMinutes), 0),
      errors: ev.violations.filter((v) => v.severity === 'error').length,
    }
  }

  const doExport = () => {
    const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `planning-creche-${format(new Date(), 'yyyy-MM-dd')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as PersistedData
      if (!confirm('Remplacer toutes les données actuelles par celles du fichier ?')) return
      importData(data)
      toast.success('Données importées.')
    } catch (e) {
      toast.error(`Import impossible : ${(e as Error).message}`)
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Plannings enregistrés"
        description="Chaque semaine est sauvegardée automatiquement dans ce navigateur. Exportez régulièrement une copie de sauvegarde."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={doExport}><Download /> Exporter tout</Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload /> Importer</Button>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Semaine</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Heures planifiées</TableHead>
              <TableHead className="text-right">Heures sup.</TableHead>
              <TableHead>Contraintes</TableHead>
              <TableHead>Modifié le</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((w) => {
              const s = summarize(w)
              return (
                <TableRow key={w.id} className={w.id === currentWeekId ? 'bg-muted/40' : undefined}>
                  <TableCell className="font-medium">{weekLabel(w.monday)}</TableCell>
                  <TableCell><Badge variant={w.status === 'validated' ? 'default' : 'secondary'}>{w.status === 'validated' ? 'Validé' : 'Brouillon'}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{s.hasSchedule ? fmtDuration(s.worked) : <span className="text-muted-foreground">non généré</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.hasSchedule ? (s.overtime > 0 ? <span className="text-red-700">+{fmtDuration(s.overtime)}</span> : '—') : ''}</TableCell>
                  <TableCell>{s.hasSchedule ? (s.errors > 0 ? <span className="text-red-700">{s.errors} à vérifier</span> : <span className="text-green-700">OK</span>) : ''}</TableCell>
                  <TableCell className="text-muted-foreground">{format(parseISO(w.updatedAt), 'd MMM yyyy HH:mm', { locale: fr })}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => { setCurrentWeek(w.id); onOpen() }}><FolderOpen /> Ouvrir</Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Supprimer"
                      onClick={() => {
                        if (confirm(`Supprimer définitivement la ${weekLabel(w.monday)} ?`)) deleteWeek(w.id)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
            {list.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Aucune semaine enregistrée.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  )
}
