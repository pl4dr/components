'use client'

import { cn } from '@/lib/utils'
import Konva from 'konva'
import * as pdfjs from 'pdfjs-dist'
import type {
  DocumentInitParameters,
  TypedArray,
} from 'pdfjs-dist/types/src/display/api'
import React, { useEffect, useRef, useState } from 'react'
import { Group, Image, Layer, Rect, Stage } from 'react-konva'

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
        const scale =
          dominantPageWidth > allowedPageWidth
            ? allowedPageWidth / dominantPageWidth
            : 1

        const scaledPageWidth = pageDimensions.width * scale
        const scaledPageHeight = pageDimensions.height * scale

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

const PAGE_SCALE = 4
const PAGE_GAP = 24
const SCALE = 1

function PDFView<ContainerRef extends HTMLElement>(props: {
  src: string
  containerRef: React.RefObject<ContainerRef | null>
}) {
  const [status, setStatus] = useState(
    'loading' as 'loading' | 'success' | 'error',
  )
  const [viewportState, setViewportState] = useState({
    width: 0,
    height: 0,

    x: 0,
    y: 0,

    pagePositions: [] as ReturnType<PDFLoader['calculatePagePositions']>,
  })
  const loaderRef = useRef<PDFLoader>(null)

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

      const viewportWidth = rect.width
      const loader = new PDFLoader()

      loader
        .load(props.src, PAGE_SCALE)
        .then(({ dominantPageWidth, pageDimensions }) => {
          setStatus('success')

          const pagePositions = loader.calculatePagePositions({
            pageDimensions,
            dominantPageWidth,
            viewportWidth,
            pageGap: PAGE_GAP,
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

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()

    const stage = e.currentTarget as Konva.Stage
    const deltaY = e.evt.deltaY
    const deltaX = e.evt.deltaX

    const layer = stage.getLayers()[0]

    setViewportState((prev) => {
      const maxPageWidth = Math.max(
        ...prev.pagePositions.map((p) => p.dimensions.width * SCALE),
      )
      const extraX = Math.abs(prev.width - maxPageWidth) / 2

      const lastPageY =
        layer.findOne(`#page-${prev.pagePositions.length}`)!.y() * SCALE

      let newY = prev.y - deltaY
      let newX = prev.x - deltaX

      if (newY > 0) newY = 0
      if (newY < -(lastPageY + PAGE_GAP * 2)) newY = -(lastPageY + PAGE_GAP * 2)

      console.log(newX, extraX)
      if (newX > extraX + PAGE_GAP * 2) newX = extraX + PAGE_GAP * 2
      // if (newX < -(extraX + PAGE_GAP * 2)) newX = -(extraX + PAGE_GAP * 2)

      return { ...prev, y: newY }
    })
  }

  // NOTE: temporary loading state
  if (status === 'loading') {
    return <div>Loading...</div>
  }

  return (
    <Stage
      scaleX={SCALE}
      scaleY={SCALE}
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

      // immediately load 1-3 pages
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
    <Group {...props.position} id={`page-${props.pageNumber}`}>
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
    </Group>
  )
}

export { PDFView }
