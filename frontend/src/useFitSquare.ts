import { useLayoutEffect, useRef, useState } from 'react'

// Height an element takes in a column, margins included.
function outerHeight(el: Element): number {
  const style = getComputedStyle(el)
  return el.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom)
}

// The side of the largest square that fits in an element, next to the element's other children
// (stacked in a column), kept up to date as it resizes. The square is the child marked `data-fit`:
// the board takes all the room its area has, without making the page scroll.
export function useFitSquare<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const style = getComputedStyle(el)
      const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const height = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const others = [...el.children].filter(child => !child.hasAttribute('data-fit'))
      const reserved = others.reduce((sum, child) => sum + outerHeight(child), 0)
      setSize(Math.max(0, Math.floor(Math.min(width, height - reserved))))
    }
    // Measured before the first paint, so the board never shows at a size that does not fit.
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, size }
}
