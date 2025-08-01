'use client'

import { cn } from '@/lib/utils'
import Konva from 'konva'
import * as pdfjs from 'pdfjs-dist'
import type {
  DocumentInitParameters,
  TypedArray,
} from 'pdfjs-dist/types/src/display/api'
import React, { useEffect, useRef, useState } from 'react'
import { Group, Image, Layer, Rect, Stage, Text } from 'react-konva'

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
    scale: number
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
            x: viewportWidth / opts.scale / 2 - scaledPageWidth / 2,
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

const PAGE_SCALE = 4
const PAGE_GAP = 24

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

    pageDimensions: new Map<number, { width: number; height: number }>(),
    dominantPageWidth: 0,
    pagePositions: [] as ReturnType<PDFLoader['calculatePagePositions']>,
  })
  const loaderRef = useRef<PDFLoader>(null)

  useEffect(() => {
    if (viewportState.dominantPageWidth === 0) return
    if (viewportState.width === 0) return

    const pagePositions = loaderRef.current?.calculatePagePositions({
      pageDimensions: viewportState.pageDimensions,
      dominantPageWidth: viewportState.dominantPageWidth,
      viewportWidth: viewportState.width,
      pageGap: PAGE_GAP,
      scale: viewportState.scale,
    })

    setViewportState((prev) => ({
      ...prev,
      pagePositions: pagePositions ?? [],
    }))
  }, [
    viewportState.scale,
    viewportState.dominantPageWidth,
    viewportState.width,
    viewportState.pageDimensions,
  ])

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
        .load(props.src, PAGE_SCALE)
        .then(({ dominantPageWidth, pageDimensions }) => {
          setStatus('success')
          setViewportState((prev) => ({
            ...prev,
            dominantPageWidth,
            pageDimensions,
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

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()

    const deltaY = e.evt.deltaY
    const deltaX = e.evt.deltaX
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const zoomBy = e.evt.ctrlKey || e.evt.metaKey ? 1.03 : 1
    const pointer = (e.currentTarget as Konva.Stage).getPointerPosition()!

    setViewportState((state) => {
      if (zoomBy !== 1) {
        const newScale =
          direction > 0
            ? Math.min(state.scale * zoomBy, 3)
            : Math.max(state.scale / zoomBy, 0.25)
        const mousePointToY = (pointer.y - state.y) / state.scale
        const newY = pointer.y - mousePointToY * newScale

        return {
          ...state,
          y: newY,
          x: direction > 0 ? state.x : 0,
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
        PAGE_GAP * 2

      if (newY > PAGE_GAP * scale) newY = PAGE_GAP * scale
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
          largestPageX + largestPageWidth - state.width + PAGE_GAP * 2

        const extraX =
          largestPageWidth > state.width ? largestPageWidth - state.width : 0
        const minX = extraX / 2 + PAGE_GAP * 2

        if (newX > minX) newX = minX
        if (newX < -maxX) newX = -maxX
      }

      return {
        ...state,
        y: newY,
        x: newX,
      }
    })
  }

  // NOTE: temporary loading state
  if (status === 'loading') {
    return <div>Loading...</div>
  }

  return (
    <>
      <Stage
        scaleX={viewportState.scale}
        scaleY={viewportState.scale}
        onWheel={handleWheel}
        x={viewportState.x}
        y={viewportState.y}
        width={viewportState.width}
        height={viewportState.height}
        className={cn('overflow-hidden')}>
        <Layer>
          {viewportState.pagePositions.map(
            ({ pageNumber, dimensions, position }) => {
              return (
                <PDFPage
                  key={pageNumber}
                  loaderRef={loaderRef}
                  pageNumber={pageNumber}
                  dimensions={dimensions}
                  position={position}
                />
              )
            },
          )}
        </Layer>
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
  const [image, setImage] = useState<HTMLCanvasElement | undefined>(undefined)

  useEffect(
    function loadPage() {
      const loader = props.loaderRef.current
      if (loader === null) return

      setTimeout(() => {
        loader
          .loadPage(props.pageNumber, PAGE_SCALE)
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

  return (
    <Group
      {...props.position}
      {...props.dimensions}
      id={`page-${props.pageNumber}`}>
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
