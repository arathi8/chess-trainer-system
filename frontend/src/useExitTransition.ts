import { useEffect, useState } from 'react'

// Keeps showing the last value for `duration` ms after `value` goes away, flagged as leaving, so
// the element rendered from it can fade out before it is removed.
export function useExitTransition<T>(value: T | undefined, duration: number) {
  const [last, setLast] = useState(value)
  if (value !== undefined && value !== last) setLast(value)

  const leaving = value === undefined && last !== undefined
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setLast(undefined), duration)
    return () => clearTimeout(timer)
  }, [leaving, duration])

  return { value: value ?? last, leaving }
}
