import { useLayoutEffect, useRef } from 'react'

const SLIDE = { duration: 500, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' }

// Slides an element to its new place when something above it appears, grows or goes away, instead
// of letting it jump there: after each render, it starts from where it was and eases to where it is.
export function useSlideOnShift<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const lastTop = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const top = el?.offsetTop ?? null
    const from = lastTop.current
    lastTop.current = top
    if (!el || top === null || from === null || from === top) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    el.animate([{ transform: `translateY(${from - top}px)` }, { transform: 'none' }], SLIDE)
  })

  return ref
}
