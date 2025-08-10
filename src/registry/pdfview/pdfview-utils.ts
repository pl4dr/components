import { GAP_BETWEEN_PAGES_ON_CANVAS } from '@/registry/pdfview/pdfview-constants'
import type { PDFLoader } from '@/registry/pdfview/pdfview-loader'

export function calculateYClamping(
  inputY: number,
  state: {
    scale: number
    pagePositions: ReturnType<PDFLoader['calculatePagePositions']>
    height: number
  },
) {
  let newY = inputY
  const scale = state.scale
  if (newY > 0) newY = 0

  // bottom bounds
  const lastPagePos = state.pagePositions[state.pagePositions.length - 1]
  const lastPageHeight = lastPagePos.dimensions.height * scale
  const lastPageY = lastPagePos.position.y * scale
  const totalDocHeight = lastPageY + lastPageHeight
  const maxY =
    totalDocHeight - state.height + GAP_BETWEEN_PAGES_ON_CANVAS * scale
  if (newY < -maxY) newY = -maxY

  return newY
}

export function calculateMinMaxX(state: {
  scale: number
  pagePositions: ReturnType<PDFLoader['calculatePagePositions']>
  width: number
  height: number
  x: number
}) {
  const scale = state.scale
  let largestPagePos = state.pagePositions[0]
  for (const pagePos of state.pagePositions) {
    if (pagePos.dimensions.width > largestPagePos.dimensions.width) {
      largestPagePos = pagePos
    }
  }

  const largestPageWidth = largestPagePos.dimensions.width * scale
  const largestPageX = largestPagePos.position.x * scale

  const docLeft = largestPageX
  const docRight = largestPageX + largestPageWidth

  const padding = GAP_BETWEEN_PAGES_ON_CANVAS * scale

  const maxX = padding - docLeft
  const minX = state.width - docRight - padding

  return { minX, maxX, largestPageWidth }
}

export function calculateXClamping(
  inputX: number,
  state: {
    scale: number
    pagePositions: ReturnType<PDFLoader['calculatePagePositions']>
    width: number
    height: number
    x: number
  },
) {
  const { minX, maxX, largestPageWidth } = calculateMinMaxX(state)
  let newX = inputX
  if (largestPageWidth <= state.width) {
    newX = state.x
  } else {
    if (newX > maxX) newX = maxX
    if (newX < minX) newX = minX
  }

  return newX
}

export function findClosestPage(state: {
  currentPage: number
  pagePositions: ReturnType<PDFLoader['calculatePagePositions']>
  y: number
  height: number
  scale: number
}) {
  let closestPage = state.currentPage
  let closestDistance = Infinity

  const viewportTop = -state.y
  const viewportCenter = viewportTop + state.height / 2

  state.pagePositions.forEach((pos) => {
    const pageTop = pos.position.y * state.scale
    const pageBottom = pageTop + pos.dimensions.height * state.scale
    const pageCenter = (pageTop + pageBottom) / 2

    const distance = Math.abs(pageCenter - viewportCenter)
    if (distance < closestDistance) {
      closestDistance = distance
      closestPage = pos.pageNumber
    }
  })

  return closestPage
}

export function calculateXForScale(width: number, scale: number) {
  const centerXOriginal = width / 2
  const centerXScaled = (width * scale) / 2
  const diff = Math.abs(centerXOriginal - centerXScaled)
  const newX = diff * (centerXOriginal > centerXScaled ? 1 : -1)

  return newX
}

export function remapRange(
  x: number,
  minO: number,
  maxO: number,
  dMin: number,
  dMax: number,
): number {
  return dMin + ((x - minO) / (maxO - minO)) * (dMax - dMin)
}

export function invertRemapRange(
  xNew: number,
  minO: number,
  maxO: number,
  dMin: number,
  dMax: number,
): number {
  return minO + ((xNew - dMin) / (dMax - dMin)) * (maxO - minO)
}
