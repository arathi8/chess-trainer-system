interface EngineChecksProps {
  checks?: string[]
}

// The engine checks the coach ran before writing its text (backend coach_tools), folded under it.
export default function EngineChecks({ checks }: EngineChecksProps) {
  if (!checks?.length) return null
  return (
    <details className="engine-checks">
      <summary>
        Conferido com o Stockfish: {checks.length} {checks.length === 1 ? 'verificação' : 'verificações'}
      </summary>
      <ul>
        {checks.map((check, index) => (
          <li key={index}>{check}</li>
        ))}
      </ul>
    </details>
  )
}
