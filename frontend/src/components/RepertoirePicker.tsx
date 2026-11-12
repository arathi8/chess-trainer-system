import { useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { fetchRepertoireCatalog } from '../repertoire/api'
import type { Color, RepertoireFamily, RepertoireOpening } from '../repertoire/api'

const X = ({ size = 19 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const ArrowRight = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
)

export interface RepertoireSelection {
  opening: RepertoireOpening
  color: Color
}

interface RepertoirePickerProps {
  onStart: (selection: RepertoireSelection) => void
  onBack: () => void
}

// Accent-insensitive, so typing "Grunfeld" finds "Grünfeld".
const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const matches = (opening: RepertoireOpening, query: string) =>
  normalize(opening.name).includes(query) || opening.eco.toLowerCase().startsWith(query)

// Position after the reference line, for the preview board.
function finalFen(pgn: string): string {
  const game = new Chess()
  try {
    game.loadPgn(pgn)
  } catch {
    // Dataset lines are validated by the backend; keep the starting position if one is not.
  }
  return game.fen()
}

export default function RepertoirePicker({ onStart, onBack }: RepertoirePickerProps) {
  const [catalog, setCatalog] = useState<RepertoireFamily[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selected, setSelected] = useState<RepertoireOpening | null>(null)
  const [color, setColor] = useState<Color>('white')

  useEffect(() => {
    fetchRepertoireCatalog()
      .then(setCatalog)
      .catch(err => {
        console.error('Repertoire catalog error:', err)
        setLoadError('Não foi possível carregar o catálogo de aberturas. Verifique se o servidor está rodando.')
      })
  }, [])

  // A family is shown when it or one of its variations matches; matching variations are listed under it.
  const visible = useMemo(() => {
    if (!catalog) return []
    const q = normalize(query.trim())
    if (!q) return catalog.map(family => ({ family, variations: family.variations }))
    return catalog
      .map(family => ({
        family,
        variations: family.variations.filter(v => matches(v, q)),
        familyMatches: matches(family, q)
      }))
      .filter(({ familyMatches, variations }) => familyMatches || variations.length > 0)
      .map(({ family, variations, familyMatches }) => ({
        family,
        variations: familyMatches && variations.length === 0 ? family.variations : variations
      }))
  }, [catalog, query])

  const searching = query.trim().length > 0

  const select = (opening: RepertoireOpening) => {
    setSelected(opening)
    setColor(opening.default_color)
  }

  const previewFen = useMemo(() => (selected ? finalFen(selected.reference_line) : new Chess().fen()), [selected])

  return (
    <main className="loader-page repertoire-page">
      <header className="topbar">
        <button className="brand compact" onClick={onBack}>
          <span className="brand-mark">♞</span>
          <span>chess<span className="gold">trainer</span></span>
        </button>
        <button className="icon-btn" onClick={onBack} aria-label="Fechar">
          <X />
        </button>
      </header>

      <section className="repertoire-layout">
        <div className="repertoire-catalog">
          <span className="eyebrow small">APRENDER REPERTÓRIO</span>
          <h1>Escolha uma abertura ou defesa</h1>
          <p>Treine as linhas teóricas do catálogo Lichess. Escolha a família inteira ou uma variante específica.</p>

          <input
            className="repertoire-search"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nome ou ECO (ex.: Sicilian, Najdorf, C60)"
            aria-label="Buscar abertura"
          />

          {loadError && <div className="report-error"><p>⚠️ {loadError}</p></div>}
          {!catalog && !loadError && <p className="message system">Carregando aberturas...</p>}
          {catalog && visible.length === 0 && <p className="message system">Nenhuma abertura encontrada.</p>}

          <ul className="repertoire-list">
            {visible.map(({ family, variations }) => {
              const open = searching || expanded === family.name
              return (
                <li key={family.name}>
                  <div className="repertoire-family">
                    <button
                      className={`repertoire-item${selected?.name === family.name ? ' selected' : ''}`}
                      onClick={() => select(family)}
                    >
                      <span className="repertoire-eco">{family.eco}</span>
                      <b>{family.name}</b>
                      <small>{family.lines} {family.lines === 1 ? 'linha' : 'linhas'}</small>
                    </button>
                    {family.variations.length > 0 && !searching && (
                      <button
                        className="repertoire-toggle"
                        onClick={() => setExpanded(open ? null : family.name)}
                        aria-expanded={open}
                        aria-label={`${open ? 'Ocultar' : 'Mostrar'} variantes de ${family.name}`}
                      >
                        {open ? '−' : `+${family.variations.length}`}
                      </button>
                    )}
                  </div>
                  {open && variations.length > 0 && (
                    <ul className="repertoire-variations">
                      {variations.map(variation => (
                        <li key={variation.name}>
                          <button
                            className={`repertoire-item${selected?.name === variation.name ? ' selected' : ''}`}
                            onClick={() => select(variation)}
                          >
                            <span className="repertoire-eco">{variation.eco}</span>
                            <b>{variation.name.slice(family.name.length + 2)}</b>
                            <small>{variation.lines} {variation.lines === 1 ? 'linha' : 'linhas'}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <aside className="repertoire-detail">
          <div className="repertoire-preview">
            <Chessboard
              options={{
                position: previewFen,
                boardOrientation: color,
                allowDragging: false
              }}
            />
          </div>

          {selected ? (
            <>
              <span className="eyebrow small">{selected.eco}</span>
              <h2>{selected.name}</h2>
              <p className="repertoire-line">{selected.reference_line}</p>
              <p className="repertoire-meta">
                {selected.lines} {selected.lines === 1 ? 'linha teórica' : 'linhas teóricas'} para treinar
              </p>

              <span className="eyebrow small">VOCÊ VAI JOGAR COM</span>
              <div className="repertoire-colors" role="radiogroup" aria-label="Cor">
                {(['white', 'black'] as const).map(c => (
                  <button
                    key={c}
                    role="radio"
                    aria-checked={color === c}
                    className={color === c ? 'active' : undefined}
                    onClick={() => setColor(c)}
                  >
                    {c === 'white' ? '♙ Brancas' : '♟ Pretas'}
                    {selected.default_color === c && <small>sugerido</small>}
                  </button>
                ))}
              </div>

              <button className="primary-action full" onClick={() => onStart({ opening: selected, color })}>
                Começar treino <ArrowRight />
              </button>
            </>
          ) : (
            <p className="message system">Selecione uma abertura para ver a linha de referência e começar.</p>
          )}
        </aside>
      </section>
    </main>
  )
}
