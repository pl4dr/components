'use client'

import { cn } from '@/lib/utils'
import type Konva from 'konva'
import * as pdfjs from 'pdfjs-dist'
import type {
  DocumentInitParameters,
  TypedArray,
} from 'pdfjs-dist/types/src/display/api'
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { FastLayer, Group, Image, Rect, Stage } from 'react-konva'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

class PDFLoader {
  public pdf!: pdfjs.PDFDocumentProxy
  public pdfLoaded = false

  public async load(
    src: string | URL | TypedArray | ArrayBuffer | DocumentInitParameters,
    pageScale: number = 1,
  ) {
    const pdf = await pdfjs.getDocument(src).promise
    this.pdf = pdf
    this.pdfLoaded = true

    const pages = await Promise.all(
      Array.from({ length: pdf.numPages }).map((_, i) => pdf.getPage(i + 1)),
    )
    const pageDimensions = new Map<
      number,
      {
        width: number
        height: number
      }
    >()
    const pageWidths = new Map<number, number>()
    pages.forEach((page) => {
      const viewport = page.getViewport({ scale: pageScale })
      const v = pageWidths.get(viewport.width) ?? 1
      pageWidths.set(viewport.width, v + 1)
      pageDimensions.set(page.pageNumber, {
        width: viewport.width,
        height: viewport.height,
      })
    })
    const reversedMap = new Map(
      pageWidths.entries().map(([k, v]) => [v, k] as [number, number]),
    )

    const max = Math.max(...reversedMap.keys())
    const dominantPageWidth = reversedMap.get(max)

    if (!dominantPageWidth) {
      throw new Error('Failed to get major page width')
    }

    return {
      pdf,
      dominantPageWidth,
      pageDimensions,
    }
  }

  public calculatePagePositions(opts: {
    pageDimensions: Map<number, { width: number; height: number }>
    dominantPageWidth: number
    viewportWidth: number
    pageGap: number
  }) {
    const { pageDimensions, dominantPageWidth, viewportWidth, pageGap } = opts
    let prevPageHeight = pageGap

    return pageDimensions
      .entries()
      .map(([pageNumber, pageDimensions], index) => {
        const allowedPageWidth = viewportWidth * 0.8
        const allowedScale =
          dominantPageWidth > allowedPageWidth
            ? allowedPageWidth / dominantPageWidth
            : 1

        const scaledPageWidth = pageDimensions.width * allowedScale
        const scaledPageHeight = pageDimensions.height * allowedScale

        const yPosition = prevPageHeight + index * pageGap
        prevPageHeight += scaledPageHeight

        return {
          pageNumber,
          dimensions: {
            width: scaledPageWidth,
            height: scaledPageHeight,
          },
          position: {
            x: viewportWidth / 2 - scaledPageWidth / 2,
            y: yPosition,
          },
        }
      })
      .toArray()
  }

  public async loadPage(pageNumber: number, scale: number = 1) {
    if (this.pdf === null) throw new Error('PDF not loaded yet.')

    const page = await this.pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const outputScale = window.devicePixelRatio || 1

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    canvas.width = Math.floor(viewport.width * outputScale)
    canvas.height = Math.floor(viewport.height * outputScale)
    canvas.style.width = Math.floor(viewport.width) + 'px'
    canvas.style.height = Math.floor(viewport.height) + 'px'

    const transform =
      outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
    const renderContext = {
      canvas,
      canvasContext: context,
      transform,
      viewport,
    }

    await page.render(renderContext).promise

    return {
      page,
      canvas,
    }
  }

  public dispose() {
    this.pdfLoaded = false
    void this.pdf?.destroy()
  }
}

function calculateYClamping(
  inputY: number,
  state: {
    scale: number
    pagePositions: ReturnType<PDFLoader['calculatePagePositions']>
    height: number
  },
) {
  let newY = inputY
  const scale = state.scale
  if (newY > GAP_BETWEEN_PAGES_ON_CANVAS * scale)
    newY = GAP_BETWEEN_PAGES_ON_CANVAS * scale

  // bottom bounds
  const lastPagePos = state.pagePositions[state.pagePositions.length - 1]
  const lastPageHeight = lastPagePos.dimensions.height * scale
  const lastPageY = lastPagePos.position.y * scale
  const totalDocHeight = lastPageY + lastPageHeight
  const maxY =
    totalDocHeight - state.height + GAP_BETWEEN_PAGES_ON_CANVAS * scale * 2
  if (newY < -maxY) newY = -maxY

  return newY
}

function calculateXClamping(
  inputX: number,
  state: {
    scale: number
    pagePositions: ReturnType<PDFLoader['calculatePagePositions']>
    width: number
    height: number
    x: number
  },
) {
  const scale = state.scale

  let newX = inputX
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

  if (largestPageWidth <= state.width) {
    newX = state.x
  } else {
    const padding = GAP_BETWEEN_PAGES_ON_CANVAS * scale

    const maxX = padding - docLeft
    const minX = state.width - docRight - padding

    if (newX > maxX) newX = maxX
    if (newX < minX) newX = minX
  }

  return newX
}

function findClosestPage(state: {
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

function calculateXForScale(width: number, scale: number) {
  const centerXOriginal = width / 2
  const centerXScaled = (width * scale) / 2
  const diff = Math.abs(centerXOriginal - centerXScaled)
  const newX = diff * (centerXOriginal > centerXScaled ? 1 : -1)

  return newX
}

const PDF_PAGE_LOAD_SCALE = 2
const GAP_BETWEEN_PAGES_ON_CANVAS = 24
const ZOOM_BY_FACTOR = 1.05

type PDFViewState = {
  status: 'loading' | 'success' | 'error'
  scale: number
  width: number
  height: number
  x: number
  y: number
  dominantPageWidth: number
  pageDimensions: Map<
    number,
    {
      width: number
      height: number
    }
  >
  pagePositions: ReturnType<PDFLoader['calculatePagePositions']>
  currentPage: number
  totalPages: number
}
const PDFViewContext = React.createContext<
  [PDFViewState, React.Dispatch<React.SetStateAction<PDFViewState>>]
>(
  null as unknown as [
    PDFViewState,
    React.Dispatch<React.SetStateAction<PDFViewState>>,
  ],
)

const PDFViewActionsContext = React.createContext<{
  setViewportScale: (scale: number) => void
  goToPage: (pageNumber: number) => void
}>(
  null as unknown as {
    setViewportScale: (scale: number) => void
    goToPage: (pageNumber: number) => void
  },
)

function PDFViewProvider(props: { children: React.ReactNode }) {
  const [state, setState] = useState<PDFViewState>({
    status: 'loading',

    scale: 1,

    width: 0,
    height: 0,

    x: 0,
    y: 0,

    dominantPageWidth: 0,
    pageDimensions: new Map(),
    pagePositions: [],

    currentPage: 1,
    totalPages: 1,
  })

  const setViewportScale = useCallback((scale: number) => {
    setState((state) => {
      const newX = calculateXForScale(state.width, scale)

      return {
        ...state,
        x: newX,
        scale: scale,
      }
    })
  }, [])

  const goToPage = useCallback((pageNumber: number) => {
    setState((viewportState) => {
      const targetPagePos = viewportState.pagePositions.find(
        (pos) => pos.pageNumber === pageNumber,
      )
      if (targetPagePos === undefined) return viewportState

      const targetY =
        targetPagePos.position.y * viewportState.scale -
        GAP_BETWEEN_PAGES_ON_CANVAS

      return {
        ...viewportState,
        currentPage: pageNumber,
        y: -targetY,
      }
    })
  }, [])

  return (
    <PDFViewActionsContext.Provider value={{ setViewportScale, goToPage }}>
      <PDFViewContext.Provider value={[state, setState]}>
        {props.children}
      </PDFViewContext.Provider>
    </PDFViewActionsContext.Provider>
  )
}

function PDFView<ContainerRef extends HTMLElement>(props: {
  src: string
  containerRef: React.RefObject<ContainerRef | null>
}) {
  const context = useContext(PDFViewContext)
  if (!context) throw new Error('PDFView must be child of PDFViewProvider.')

  const [state, setState] = context
  const loaderRef = useRef<PDFLoader>(null)

  useEffect(
    function loadDocumentAndPages() {
      if (props.containerRef.current === null) return

      const container = props.containerRef.current
      const rect = container.getBoundingClientRect()
      setState((prev) => ({
        ...prev,
        width: rect.width,
        height: rect.height,
      }))

      const loader = new PDFLoader()

      loader
        .load(props.src, PDF_PAGE_LOAD_SCALE)
        .then(({ pdf, dominantPageWidth, pageDimensions }) => {
          const pagePositions = loader.calculatePagePositions({
            pageDimensions,
            dominantPageWidth,
            viewportWidth: rect.width,
            pageGap: GAP_BETWEEN_PAGES_ON_CANVAS,
          })

          setState((prev) => ({
            ...prev,
            status: 'success',
            dominantPageWidth,
            pageDimensions,
            pagePositions,
            totalPages: pdf.numPages,
          }))
        })
        .catch((e) => {
          setState((prev) => ({
            ...prev,
            status: 'error',
          }))
          console.error('[PDFView] Failed to load document. Cause:', e)
        })
      loaderRef.current = loader

      let updatViewportDimensionsTimer: NodeJS.Timeout | null = null

      const resizeObserver = new ResizeObserver((entries) => {
        const rect = entries[0].contentRect

        if (updatViewportDimensionsTimer !== null) {
          clearTimeout(updatViewportDimensionsTimer)
        }
        updatViewportDimensionsTimer = setTimeout(() => {
          setState((prev) => {
            if (prev.dominantPageWidth === 0) return prev

            const pagePositions = loader.calculatePagePositions({
              pageDimensions: prev.pageDimensions,
              dominantPageWidth: prev.dominantPageWidth,
              viewportWidth: rect.width,
              pageGap: GAP_BETWEEN_PAGES_ON_CANVAS,
            })

            return {
              ...prev,
              pagePositions,
              width: rect.width,
              height: rect.height,
            }
          })
        }, 150)
      })

      resizeObserver.observe(container)

      return () => {
        resizeObserver.disconnect()
        loaderRef.current?.dispose()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.src],
  )

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()

    const stage = e.currentTarget as Konva.Stage

    const deltaY = e.evt.deltaY
    const deltaX = e.evt.deltaX
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const zoomBy = e.evt.ctrlKey || e.evt.metaKey ? ZOOM_BY_FACTOR : 1
    const pointer = stage.getPointerPosition()!

    setState((state) => {
      if (zoomBy !== 1) {
        const newScale =
          direction > 0
            ? Math.min(state.scale * zoomBy, 3)
            : Math.max(state.scale / zoomBy, 0.25)
        const mousePointToY = (pointer.y - state.y) / state.scale

        const newX = calculateXForScale(state.width, newScale)
        const newY = calculateYClamping(pointer.y - mousePointToY * newScale, {
          ...state,
          scale: newScale,
        })

        return {
          ...state,
          y: newY,
          x: newX,
          scale: newScale,
        }
      }

      const closestPage = findClosestPage(state)
      const newY = calculateYClamping(state.y - deltaY, state)
      const newX = calculateXClamping(state.x - deltaX, state)

      return {
        ...state,
        currentPage: closestPage,
        y: newY,
        x: newX,
      }
    })
  }

  if (state.status === 'loading') {
    return null
  }

  const buffer = 2 * state.height
  const visiblePages = state.pagePositions.filter((pos) => {
    const pageTop = pos.position.y * state.scale
    const pageBottom = pageTop + pos.dimensions.height * state.scale
    const viewportTop = -state.y
    const viewportBottom = viewportTop + state.height

    return (
      pageBottom >= viewportTop - buffer && pageTop <= viewportBottom + buffer
    )
  })

  return (
    <Stage
      scaleX={state.scale}
      scaleY={state.scale}
      x={state.x}
      y={state.y}
      onWheel={handleWheel}
      width={state.width}
      height={state.height}
      className={cn('overflow-hidden')}>
      <FastLayer>
        {visiblePages.map(({ pageNumber, dimensions, position }) => {
          return (
            <PDFPage
              key={pageNumber}
              loaderRef={loaderRef}
              pageNumber={pageNumber}
              dimensions={dimensions}
              position={position}
            />
          )
        })}
      </FastLayer>
    </Stage>
  )
}

function PDFPage(props: {
  loaderRef: React.RefObject<PDFLoader | null>
  pageNumber: number
  dimensions: { width: number; height: number }
  position: {
    x: number
    y: number
  }
}) {
  const groupRef = useRef<Konva.Group>(null)
  const [image, setImage] = useState<HTMLCanvasElement | undefined>(undefined)

  useEffect(
    function loadPage() {
      const loader = props.loaderRef.current
      if (loader === null) return

      setTimeout(() => {
        loader
          .loadPage(props.pageNumber, PDF_PAGE_LOAD_SCALE)
          .then(({ canvas }) => {
            setImage(canvas)
          })
          .catch((e) => {
            console.error('[PDFPage] Failed to load page. Cause:', e)
          })
      }, 300)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.pageNumber],
  )

  return (
    <Group {...props.position} ref={groupRef}>
      {!image && (
        <Rect
          {...props.dimensions}
          stroke={'#e5e5e5'}
          fill={'#efefef'}
          strokeWidth={0.5}
        />
      )}
      {image && (
        <Image
          {...props.dimensions}
          image={image}
          stroke={'#e5e5e5'}
          strokeWidth={1}
          alt={`Page ${props.pageNumber}`}
        />
      )}
    </Group>
  )
}

function usePDFViewState() {
  const context = useContext(PDFViewContext)
  if (!context) throw new Error('PDFView must be child of PDFViewProvider.')

  const [state] = context

  return {
    status: state.status,
    scale: state.scale,
    currentPage: state.currentPage,
    totalPages: state.totalPages,
  }
}

function usePDFViewActions() {
  const context = useContext(PDFViewActionsContext)
  if (!context) throw new Error('PDFView must be child of PDFViewProvider.')

  return context
}

export { PDFView, PDFViewProvider, usePDFViewActions, usePDFViewState }
