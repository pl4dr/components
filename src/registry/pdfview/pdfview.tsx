'use client'

import { cn } from '@/lib/utils'
import {
  GAP_BETWEEN_PAGES_ON_CANVAS,
  PDF_PAGE_LOAD_SCALE,
  ZOOM_BY_FACTOR,
  ZOOM_MAX,
  ZOOM_MIN,
} from '@/registry/pdfview/pdfview-constants'
import { PDFLoader } from '@/registry/pdfview/pdfview-loader'
import {
  PDFViewContext,
  PDFViewState,
} from '@/registry/pdfview/pdfview-provider'
import {
  calculateMinMaxX,
  calculateXClamping,
  calculateXForScale,
  calculateYClamping,
  findClosestPage,
  invertRemapRange,
  remapRange,
} from '@/registry/pdfview/pdfview-utils'
import type Konva from 'konva'
import { Vector2d } from 'konva/lib/types'
import React, { useContext, useEffect, useRef, useState } from 'react'

import { Group, Image, Layer, Rect, Stage } from 'react-konva'

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

  function handleWheelLayer(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()

    const layer = e.currentTarget as Konva.Layer
    const stage = layer.getStage()

    const deltaY = e.evt.deltaY
    const deltaX = e.evt.deltaX
    const pointer = stage.getPointerPosition()!

    const modPressed = e.evt.ctrlKey || e.evt.metaKey

    updateStateOnWheel({ deltaX, deltaY, modPressed, pointer })
  }

  function handleWheelStage(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()

    const stage = e.currentTarget as Konva.Stage

    const deltaY = e.evt.deltaY
    const deltaX = e.evt.deltaX
    const pointer = stage.getPointerPosition()!

    const modPressed = e.evt.ctrlKey || e.evt.metaKey

    updateStateOnWheel({ deltaX, deltaY, modPressed, pointer })
  }

  function updateStateOnWheel(params: {
    deltaX: number
    deltaY: number
    modPressed: boolean
    pointer: Konva.Vector2d
  }) {
    const deltaY = params.deltaY
    const deltaX = params.deltaX
    const direction = params.deltaY > 0 ? -1 : 1
    const zoomBy = params.modPressed ? ZOOM_BY_FACTOR : 1
    const pointer = params.pointer

    setState((state) => {
      if (zoomBy !== 1) {
        const newScale =
          direction > 0
            ? Math.min(state.scale * zoomBy, ZOOM_MAX)
            : Math.max(state.scale / zoomBy, ZOOM_MIN)
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
      width={state.width}
      height={state.height}
      onWheel={handleWheelStage}
      className={cn('overflow-hidden')}>
      <Layer
        scaleX={state.scale}
        scaleY={state.scale}
        x={state.x}
        y={state.y}
        onWheel={handleWheelLayer}>
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
      </Layer>

      <Layer>
        <ScrollbarY
          state={state}
          onYUpdate={(y) => setState((prev) => ({ ...prev, y }))}
        />
        <ScrollbarX
          state={state}
          onXUpdate={(x) => setState((prev) => ({ ...prev, x }))}
        />
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

function ScrollbarY(props: {
  state: PDFViewState
  onYUpdate: (y: number) => void
}) {
  const { state } = props

  const lastPagePos = state.pagePositions[state.pagePositions.length - 1]
  const contentH =
    lastPagePos.position.y +
    lastPagePos.dimensions.height +
    GAP_BETWEEN_PAGES_ON_CANVAS
  const scaledContentH = contentH * state.scale

  const viewH = state.height
  const verticalRatio = viewH / scaledContentH
  const vLen = Math.max(20, viewH * verticalRatio)

  const minY = 2 * state.scale
  const maxY = state.height - (minY + 10)

  const dY = remapRange(
    -state.y,
    -GAP_BETWEEN_PAGES_ON_CANVAS,
    scaledContentH,
    minY,
    maxY,
  )

  const [dragging, setDragging] = useState(false)

  function dragBoundFunc(pos: Vector2d) {
    let newY = pos.y

    if (newY < minY) newY = minY
    if (newY > maxY - vLen) newY = maxY - vLen

    return {
      y: newY,
      x: state.width - 9,
    }
  }

  return (
    <Rect
      draggable
      dragBoundFunc={dragBoundFunc}
      onDragStart={() => setDragging(true)}
      onDragMove={(e) => {
        const { y: yPos } = e.currentTarget.position()

        let newY = -invertRemapRange(
          yPos,
          -GAP_BETWEEN_PAGES_ON_CANVAS,
          scaledContentH,
          minY,
          maxY,
        )
        props.onYUpdate(newY)
      }}
      onDragEnd={() => setDragging(false)}
      y={dragging ? undefined : dY}
      x={state.width - 9}
      width={6}
      height={vLen}
      fill="#c9c9c9"
      cornerRadius={3}
    />
  )
}

function ScrollbarX(props: {
  state: PDFViewState
  onXUpdate: (x: number) => void
}) {
  const { state } = props
  const stageW = state.width
  const horizontalRatio = stageW / (stageW * state.scale)
  const hLen = stageW * horizontalRatio

  const { minX, maxX } = calculateMinMaxX(state)
  const newMaxX = stageW - hLen
  const dX = remapRange(state.x, minX, maxX, newMaxX, 0)
  const showHScrollbar = state.scale > 1.05

  const [dragging, setDragging] = useState(false)

  function dragBoundFunc(pos: Vector2d) {
    let newX = pos.x

    if (newX >= newMaxX) newX = newMaxX
    if (newX < 0) newX = 0

    return {
      y: state.height - 8,
      x: newX,
    }
  }

  if (!showHScrollbar) return null

  return (
    <Rect
      draggable
      dragBoundFunc={dragBoundFunc}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      onDragMove={(e) => {
        const { x: xPos } = e.currentTarget.position()

        let newX = invertRemapRange(xPos, minX, maxX, newMaxX, 0)

        props.onXUpdate(newX)
      }}
      x={dragging ? undefined : dX}
      y={state.height - 8}
      width={hLen}
      height={6}
      fill="#c9c9c9"
      cornerRadius={3}
    />
  )
}

export { PDFView }
