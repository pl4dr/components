'use client'

import { cn } from '@/lib/utils'
import Konva from 'konva'
import * as pdfjs from 'pdfjs-dist'
import type {
  DocumentInitParameters,
  TypedArray,
} from 'pdfjs-dist/types/src/display/api'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FastLayer, Group, Image, Rect, Stage, Text } from 'react-konva'

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

const PDF_PAGE_LOAD_SCALE = 2
const GAP_BETWEEN_PAGES_ON_CANVAS = 24

function PDFView<ContainerRef extends HTMLElement>(props: {
  src: string
  containerRef: React.RefObject<ContainerRef | null>
}) {
  const [status, setStatus] = useState(
    'loading' as 'loading' | 'success' | 'error',
  )
  const [viewportState, setViewportState] = useState({
    scale: 1,

    width: 0,
    height: 0,

    x: 0,
    y: 0,

    pagePositions: [] as ReturnType<PDFLoader['calculatePagePositions']>,
  })
  const loaderRef = useRef<PDFLoader>(null)
  const wheelEndTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(
    function loadDocumentAndPages() {
      if (props.containerRef.current === null) return

      const container = props.containerRef.current
      const rect = container.getBoundingClientRect()
      setViewportState((prev) => ({
        ...prev,
        width: rect.width,
        height: rect.height,
      }))

      const loader = new PDFLoader()

      loader
        .load(props.src, PDF_PAGE_LOAD_SCALE)
        .then(({ dominantPageWidth, pageDimensions }) => {
          setStatus('success')

          const pagePositions = loader.calculatePagePositions({
            pageDimensions,
            dominantPageWidth,
            viewportWidth: rect.width,
            pageGap: GAP_BETWEEN_PAGES_ON_CANVAS,
          })

          setViewportState((prev) => ({
            ...prev,
            pagePositions,
          }))
        })
        .catch((e) => {
          setStatus('error')
          console.error('[PDFView] Failed to load document. Cause:', e)
        })
      loaderRef.current = loader

      return () => {
        loaderRef.current?.dispose()
      }
    },
    [props.src],
  )

  const setViewportScale = useCallback((scale: number) => {
    setViewportState((state) => {
      const centerX1 = state.width / 2
      const centerXs = (state.width * scale) / 2
      const diff = Math.abs(centerX1 - centerXs)
      const piv = centerX1 > centerXs ? 1 : -1

      return {
        ...state,
        x: diff * piv,
        scale: scale,
      }
    })
  }, [])

  const goToPage = useCallback((pageNumber: number) => {
    setViewportState((viewportState) => {
      const targetPagePos = viewportState.pagePositions.find(
        (pos) => pos.pageNumber === pageNumber,
      )
      if (targetPagePos === undefined) return viewportState

      const targetY = targetPagePos.position.y * viewportState.scale - GAP_BETWEEN_PAGES_ON_CANVAS

      return {
        ...viewportState,
        y: -targetY,
      }
    })
  }, [])

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()

    const stage = e.currentTarget as Konva.Stage

    const deltaY = e.evt.deltaY
    const deltaX = e.evt.deltaX
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const zoomBy = e.evt.ctrlKey || e.evt.metaKey ? 1.03 : 1
    const pointer = stage.getPointerPosition()!

    setViewportState((state) => {
      if (zoomBy !== 1) {
        const newScale =
          direction > 0
            ? Math.min(state.scale * zoomBy, 3)
            : Math.max(state.scale / zoomBy, 0.25)
        const mousePointToY = (pointer.y - state.y) / state.scale
        const newY = pointer.y - mousePointToY * newScale

        const centerX1 = viewportState.width / 2
        const centerXs = (viewportState.width * newScale) / 2
        const diff = Math.abs(centerX1 - centerXs)
        const piv = centerX1 > centerXs ? 1 : -1

        return {
          ...state,
          y: newY,
          x: diff * piv,
          scale: newScale,
        }
      }

      let newY = state.y - deltaY
      let newX = state.x - deltaX
      const scale = state.scale

      const lastPagePos = state.pagePositions[state.pagePositions.length - 1]
      const lastPageHeight = lastPagePos.dimensions.height * scale
      const lastPageY = lastPagePos.position.y * scale
      const maxY =
        lastPageY +
        (lastPageHeight > state.height ? lastPageHeight - state.height : 0) +
        GAP_BETWEEN_PAGES_ON_CANVAS * 2

      if (newY > GAP_BETWEEN_PAGES_ON_CANVAS * scale) newY = GAP_BETWEEN_PAGES_ON_CANVAS * scale
      if (newY < -maxY) newY = -maxY

      let largestPagePos = state.pagePositions[0]
      for (const pagePos of state.pagePositions) {
        if (pagePos.dimensions.width > largestPagePos.dimensions.width) {
          largestPagePos = pagePos
        }
      }

      const largestPageWidth = largestPagePos.dimensions.width * scale

      if (largestPageWidth < state.width) {
        newX = state.x
      } else {
        const largestPageX = largestPagePos.position.x * scale
        const maxX =
          largestPageX + largestPageWidth - state.width + GAP_BETWEEN_PAGES_ON_CANVAS * 2

        const extraX =
          largestPageWidth > state.width ? largestPageWidth - state.width : 0
        const minX = extraX / 2 + GAP_BETWEEN_PAGES_ON_CANVAS * 2

        if (newX > minX) newX = minX
        if (newX < -maxX) newX = -maxX
      }

      return {
        ...state,
        y: newY,
        x: newX,
      }
    })

    if (wheelEndTimeoutRef.current !== null) {
      clearTimeout(wheelEndTimeoutRef.current)
    }

    wheelEndTimeoutRef.current = setTimeout(() => {
      const evt = new CustomEvent('PDFView/requestPageCandidates')
      window.dispatchEvent(evt)
    }, 150)
  }

  // NOTE: temporary loading state
  if (status === 'loading') {
    return <div>Loading...</div>
  }

  const buffer = 2 * viewportState.height
  const visiblePages = viewportState.pagePositions.filter((pos) => {
    const pageTop = pos.position.y * viewportState.scale
    const pageBottom = pageTop + pos.dimensions.height * viewportState.scale
    const viewportTop = -viewportState.y
    const viewportBottom = viewportTop + viewportState.height

    return (
      pageBottom >= viewportTop - buffer && pageTop <= viewportBottom + buffer
    )
  })

  return (
    <>
      <Stage
        scaleX={viewportState.scale}
        scaleY={viewportState.scale}
        x={viewportState.x}
        y={viewportState.y}
        onWheel={handleWheel}
        width={viewportState.width}
        height={viewportState.height}
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
      <div className="absolute top-0 left-0">
        Y: {viewportState.y}. X: {viewportState.x}. Z: {viewportState.scale}
      </div>
    </>
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
    [props.pageNumber],
  )

  useEffect(function handleCandidateRequest() {
    const controller = new AbortController()

    window.addEventListener(
      'PDFView/handleRequestPositionsEvent',
      () => {
        if (groupRef.current === null) return

        const group = groupRef.current

        console.log('Page', group.id(), 'rendered', group.position())
      },
      {
        signal: controller.signal,
      },
    )

    return () => {
      controller.abort()
    }
  }, [])

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
        />
      )}
      <Text
        text={`Y: ${props.position.y}. X: ${props.position.x}`}
        y={0}
        x={0}
      />
    </Group>
  )
}

export { PDFView }
