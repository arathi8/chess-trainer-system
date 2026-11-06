import ReactMarkdown from 'react-markdown'

export interface PhaseStats {
  moves: number
  accuracy: number
  inaccuracies: number
  mistakes: number
  blunders: number
}

export interface KeyMoment {
  ply: number
  move_number: string
  san: string
  fen: string
  classification: string
  win_percent_loss: number
  phase: string
  best_move: string
  eval_before: string
  eval_after: string
  tags: string[]
}

export interface GameStats {
  analysed_moves: number
  total_user_moves: number
  accuracy: number | null
  classification_counts: Record<string, number>
  phases: Record<string, PhaseStats>
  key_moments: KeyMoment[]
  error_tags: Record<string, number>
}

export interface GameReportData {
  stats: GameStats
  report: string | null
  report_error: string | null
}

const PHASE_LABELS: Record<string, string> = {
  opening: 'Abertura',
  middlegame: 'Meio-jogo',
  endgame: 'Final'
}

const COUNT_ROWS: { key: string; label: string; className: string }[] = [
  { key: 'Best Move', label: 'Melhor lance', className: 'great' },
  { key: 'Good Move', label: 'Bom lance', className: 'best' },
  { key: 'Inaccuracy', label: 'Imprecisão', className: 'inaccuracy' },
  { key: 'Mistake', label: 'Erro', className: 'mistake' },
  { key: 'Blunder', label: 'Erro grave', className: 'blunder' }
]

const TAG_LABELS: Record<string, string> = {
  hung_piece: 'peça desprotegida',
  missed_capture: 'captura perdida',
  missed_check: 'xeque perdido',
  missed_mate: 'mate perdido',
  allowed_mate: 'permitiu mate',
  walked_into_tactic: 'caiu em tática'
}

interface GameReportProps {
  result: string
  data: GameReportData | null
  loading: boolean
  message: string | null
  onSelectMoment: (fen: string) => void
  onRetry: () => void
  onConfigureLLM: () => void
}

export default function GameReport({
  result,
  data,
  loading,
  message,
  onSelectMoment,
  onRetry,
  onConfigureLLM
}: GameReportProps) {
  return (
    <div className="game-report">
      <span className="eyebrow small">RELATÓRIO DA PARTIDA</span>
      <h2 className="report-result">{result}</h2>

      {message && <p className="message system">{message}</p>}

      {loading && !data && (
        <p className="message system" style={{ color: '#d0af68' }}>
          🤔 Gerando seu relatório...
        </p>
      )}

      {data && (
        <>
          <div className="report-accuracy">
            <span>Precisão</span>
            <b>{data.stats.accuracy !== null ? `${data.stats.accuracy}%` : '—'}</b>
            {data.stats.analysed_moves < data.stats.total_user_moves && (
              <small>
                {data.stats.analysed_moves} de {data.stats.total_user_moves} lances analisados
              </small>
            )}
          </div>

          <div className="report-counts">
            {COUNT_ROWS.map(row => (
              <div key={row.key}>
                <span className={`tag ${row.className}`}>{data.stats.classification_counts[row.key] ?? 0}</span>
                <span>{row.label}</span>
              </div>
            ))}
          </div>

          {Object.keys(data.stats.phases).length > 0 && (
            <table className="report-phases">
              <thead>
                <tr><th>Fase</th><th>Lances</th><th>Precisão</th><th>?! / ? / ??</th></tr>
              </thead>
              <tbody>
                {Object.entries(data.stats.phases).map(([phase, p]) => (
                  <tr key={phase}>
                    <td>{PHASE_LABELS[phase] ?? phase}</td>
                    <td>{p.moves}</td>
                    <td>{p.accuracy}%</td>
                    <td>{p.inaccuracies} / {p.mistakes} / {p.blunders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {data.stats.key_moments.length > 0 && (
            <div className="report-moments">
              <span className="eyebrow small">MOMENTOS-CHAVE</span>
              {data.stats.key_moments.map(km => (
                <button key={km.ply} onClick={() => onSelectMoment(km.fen)} title="Ver a posição antes do lance">
                  <b>{km.move_number} {km.san}</b>
                  <span>−{km.win_percent_loss}% · melhor: {km.best_move}</span>
                  {km.tags.length > 0 && (
                    <small>{km.tags.map(t => TAG_LABELS[t] ?? t).join(' · ')}</small>
                  )}
                </button>
              ))}
            </div>
          )}

          {loading && (
            <p className="message system" style={{ color: '#d0af68' }}>🤔 Gerando relatório do treinador...</p>
          )}

          {data.report && !loading && (
            <div className="message markdown-body">
              <ReactMarkdown>{data.report}</ReactMarkdown>
            </div>
          )}

          {data.report_error && !loading && (
            <div className="report-error">
              <p>⚠️ {data.report_error}</p>
              <div>
                <button className="outline-btn" onClick={onConfigureLLM}>Configurar LLM</button>
                <button className="outline-btn" onClick={onRetry}>Gerar novamente</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
