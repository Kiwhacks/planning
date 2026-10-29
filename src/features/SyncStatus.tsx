import { useState } from 'react'
import { Cloud, CloudOff, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useStore } from '@/store/useStore'
import { flush, retryWithKey } from '@/store/sync'
import { cn } from '@/lib/utils'

export function SyncStatus() {
  const sync = useStore((s) => s.sync)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)

  const label =
    sync.mode === 'unknown' ? 'Connexion…'
    : sync.mode === 'local' ? 'Mode local'
    : sync.mode === 'auth' ? 'Code d’accès requis'
    : sync.status === 'saving' ? 'Enregistrement…'
    : sync.status === 'error' ? 'Erreur de sauvegarde'
    : 'Base de données'

  const Icon = sync.mode === 'unknown' || sync.status === 'saving' ? Loader2 : sync.mode === 'local' ? CloudOff : sync.mode === 'auth' ? KeyRound : Cloud

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => {
              if (sync.mode === 'auth') setOpen(true)
              else if (sync.status === 'error') flush()
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
              sync.mode === 'remote' && sync.status !== 'error' && 'border-green-200 bg-green-50 text-green-800',
              sync.mode === 'local' && 'border-border bg-muted text-muted-foreground',
              sync.mode === 'auth' && 'border-amber-200 bg-amber-50 text-amber-800',
              sync.status === 'error' && 'border-red-200 bg-red-50 text-red-800',
            )}
          >
            <Icon className={cn('size-3.5', (sync.mode === 'unknown' || sync.status === 'saving') && 'animate-spin')} />
            {label}
            {sync.status === 'error' && <RefreshCw className="size-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {sync.mode === 'remote' && (sync.status === 'error' ? `Dernière erreur : ${sync.error ?? 'inconnue'}. Cliquez pour réessayer.` : 'Les données sont enregistrées dans la base de données.')}
          {sync.mode === 'local' && (sync.error ? `La base de données a répondu une erreur (${sync.error}). Les données restent dans ce navigateur.` : 'Aucune base de données configurée : les données restent dans ce navigateur.')}
          {sync.mode === 'auth' && 'Cliquez pour saisir le code d’accès.'}
          {sync.mode === 'unknown' && 'Connexion à la base de données…'}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open || sync.mode === 'auth'} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Code d’accès</DialogTitle>
            <DialogDescription>Saisissez le code d’accès de l’application pour charger et enregistrer les plannings.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                await retryWithKey(key.trim())
              } finally {
                setBusy(false)
                setOpen(false)
              }
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="access-key">Code</Label>
              <Input id="access-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !key.trim()}>{busy ? <Loader2 className="animate-spin" /> : null} Se connecter</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
