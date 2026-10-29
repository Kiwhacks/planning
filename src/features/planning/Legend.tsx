/** Légende des textures et couleurs du planning. */
export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-6 rounded-sm bg-primary" /> travail</span>
      <span className="inline-flex items-center gap-1.5">
        <i className="inline-block h-3 w-6 rounded-sm bg-primary" style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,.75) 0 3px, transparent 3px 7px)' }} /> pause
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className="inline-block h-3 w-6 rounded-sm bg-primary" style={{ backgroundColor: 'rgba(0,0,0,.6)', backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.95) 1.2px, transparent 1.7px)', backgroundSize: '6px 6px' }} /> ménage
      </span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm bg-green-200" /> besoin couvert</span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm bg-red-300" /> manque</span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm bg-sky-200" /> surplus</span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm bg-violet-200" /> ménage (couverture)</span>
    </div>
  )
}
