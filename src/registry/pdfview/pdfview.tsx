'use client'

import { cn } from '@/lib/utils'
import {
  GAP_BETWEEN_PAGES_ON_CANVAS,
  PDF_PAGE_LOAD_SCALE,
  PDF_PAGE_STROKE_COLOR,
  ZOOM_BY_FACTOR,
  ZOOM_MAX,
  ZOOM_MIN,
} from '@/registry/pdfview/pdfview-constants'
import { PDFLoader } from '@/registry/pdfview/pdfview-loader'
import {
  Object,
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
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'

import { Group, Image, Layer, Rect, Stage, Transformer } from 'react-konva'

function PDFView<ContainerRef extends HTMLElement>(props: {
  src: string
  containerRef: React.RefObject<ContainerRef | null>

  RenderObject?: React.ComponentType<{
    object: Object
    remove: () => void
  }>
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

            objectToPlace: null,
            selectedObjectKey: null,
            objects: new Map(),
            pageObjects: new Map(),
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

      const controller = new AbortController()
      window.addEventListener(
        'keydown',
        (e) => {
          if (e.key === 'Escape') {
            setState((prev) => {
              return {
                ...prev,
                selectedObjectKey: null,
                objectToPlace: null,
              }
            })
          }

          if (e.key === 'Backspace' || e.key === 'Delete') {
            setState((prev) => {
              const selectedObjectKey = prev.selectedObjectKey
              if (!selectedObjectKey) return prev

              const objects = new Map(prev.objects)
              objects.delete(selectedObjectKey!)

              const pageObjects = new Map(prev.pageObjects)
              if (pageObjects.has(prev.currentPage)) {
                const pageObjectIds = pageObjects.get(prev.currentPage)!
                const objectIds = pageObjectIds.filter(
                  (id) => id !== selectedObjectKey,
                )

                pageObjects.set(prev.currentPage, objectIds)
              }

              return {
                ...prev,
                objects,
                pageObjects,
                selectedObjectKey: null,
              }
            })
          }
        },
        {
          signal: controller.signal,
        },
      )

      return () => {
        controller.abort()
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
      onMouseMove={(e) => {
        const stage = e.currentTarget as Konva.Stage
        const pointer = stage.getPointerPosition()!

        setState((prev) => ({
          ...prev,
          pointer,
        }))
      }}
      onClick={() => {
        setState((prev) => ({
          ...prev,
          selectedObjectKey: null,
          objectToPlace: null,
        }))
      }}
      className={cn('overflow-hidden', {
        // 'cursor-none': state.objectToPlace,
      })}>
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
              RenderObject={props.RenderObject}
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

        {state.objectToPlace && props.RenderObject && (
          <MouseCursor
            scale={state.scale}
            pointer={state.pointer}
            objectToPlace={state.objectToPlace}
            RenderObject={props.RenderObject}
          />
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

  RenderObject?: React.ComponentType<{
    object: Object
    remove: () => void
  }>
}) {
  const context = useContext(PDFViewContext)
  if (!context) throw new Error('PDFView must be child of PDFViewProvider.')
  const [state, setState] = context

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

  const RenderObject = props.RenderObject
  const objects = useMemo(() => {
    if (!RenderObject) return []
    const objectIds = state.pageObjects.get(props.pageNumber) ?? []

    const objects = [] as Object[]
    for (const objectId of objectIds) {
      const object = state.objects.get(objectId)
      if (object) objects.push(object)
    }

    return objects
  }, [props.pageNumber, RenderObject, state.pageObjects, state.objects])

  function placeObject(pageNumber: number, pointer: Vector2d) {
    if (!state.objectToPlace) return

    const newObject = {
      id: state.objectToPlace.id,
      position: pointer,
      dimensions: state.objectToPlace.dimensions,
      tag: state.objectToPlace.tag,
      data: state.objectToPlace.data,
      placed: true,
    }

    setState((prev) => {
      const objects = new Map(prev.objects)
      objects.set(newObject.id, newObject)

      const pageObjects = new Map(prev.pageObjects)
      if (!pageObjects.has(pageNumber)) {
        pageObjects.set(pageNumber, [])
      }

      const pageObjectIds = pageObjects.get(pageNumber)!
      if (!pageObjectIds.includes(newObject.id))
        pageObjects.get(pageNumber)!.push(newObject.id)

      return {
        ...prev,
        objects: objects,
        pageObjects: pageObjects,
        objectToPlace: null,
      }
    })

    setTimeout(() => {
      setState((prev) => ({
        ...prev,
        selectedObjectKey: newObject.id,
      }))
    }, 100)
  }

  return (
    <Group
      {...props.position}
      clipX={0}
      clipY={0}
      clipWidth={props.dimensions.width}
      clipHeight={props.dimensions.height}
      ref={groupRef}
      onClick={(e) => {
        const group = e.currentTarget as Konva.Group
        const localPos = group.getRelativePointerPosition()!

        placeObject(props.pageNumber, localPos)
      }}>
      {!image && (
        <Rect
          {...props.dimensions}
          fill={'white'}
          stroke={PDF_PAGE_STROKE_COLOR}
          strokeWidth={1}
        />
      )}
      {image && (
        <Image
          {...props.dimensions}
          x={0.5}
          y={0.5}
          width={props.dimensions.width - 1}
          height={props.dimensions.height - 1}
          image={image}
          stroke={PDF_PAGE_STROKE_COLOR}
          strokeWidth={1 / state.scale}
          strokeAfterFill={true}
          alt={`Page ${props.pageNumber}`}
        />
      )}

      {image &&
        objects.map((object) => {
          return (
            <ObjectContainer
              key={object.id}
              object={object}
              RenderObject={RenderObject!}
            />
          )
        })}
    </Group>
  )
}

function ObjectContainer(props: {
  object: Object
  RenderObject: React.ComponentType<{
    object: Object
    remove: () => void
  }>
}) {
  const context = useContext(PDFViewContext)
  if (!context) throw new Error('PDFView must be child of PDFViewProvider.')
  const [state, setState] = context

  const width = props.object.dimensions.width
  const height = props.object.dimensions.height
  const x = props.object.position.x - width / 2
  const y = props.object.position.y - height / 2

  const selected = props.object.id === state.selectedObjectKey
  const groupRef = useRef<Konva.Group>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  useEffect(() => {
    if (selected && transformerRef.current && groupRef.current) {
      transformerRef.current.nodes([groupRef.current])
      transformerRef.current.getLayer()?.batchDraw()
    }
  }, [selected])

  return (
    <>
      <Group
        draggable
        onTransformEnd={(e) => {
          const group = e.target
          const pos = group.position()
          const size = group.size()

          setState((prev) => {
            const objects = new Map(prev.objects)
            objects.set(props.object.id, {
              ...props.object,
              position: {
                x: pos.x + size.width / 2,
                y: pos.y + size.height / 2,
              },
            })

            return {
              ...prev,
              objects,
            }
          })
        }}
        onDragStart={() => {
          setState((prev) => {
            return {
              ...prev,
              selectedObjectKey: props.object.id,
            }
          })
        }}
        onDragEnd={(e) => {
          const group = e.target
          const pos = group.position()
          const size = group.size()

          setState((prev) => {
            const objects = new Map(prev.objects)
            objects.set(props.object.id, {
              ...props.object,
              position: {
                x: pos.x + size.width / 2,
                y: pos.y + size.height / 2,
              },
            })

            return {
              ...prev,
              objects,
            }
          })
        }}
        ref={groupRef}
        width={width}
        height={height}
        x={x}
        y={y}
        onClick={(e) => {
          e.cancelBubble = true

          setState((prev) => {
            return {
              ...prev,
              selectedObjectKey: props.object.id,
            }
          })
        }}>
        <props.RenderObject
          object={props.object}
          remove={() => {
            setState((prev) => {
              const objects = new Map(prev.objects)
              objects.delete(props.object.id)

              const pageObjects = new Map(prev.pageObjects)
              if (pageObjects.has(prev.currentPage)) {
                const pageObjectIds = pageObjects.get(prev.currentPage)!
                const objectIds = pageObjectIds.filter(
                  (id) => id !== props.object.id,
                )

                pageObjects.set(prev.currentPage, objectIds)
              }

              return {
                ...prev,
                objects,
                pageObjects,
                selectedObjectKey: null,
              }
            })
          }}
        />
      </Group>

      {selected && (
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          keepRatio={true}
          enabledAnchors={[
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right',
          ]}
          boundBoxFunc={(oldBox, newBox) => {
            const minSize = 20 * state.scale
            if (newBox.width < minSize || newBox.height < minSize) {
              return oldBox
            }
            return newBox
          }}
          // border
          borderStroke="black"
          borderStrokeWidth={state.scale}
          borderDash={[4 * state.scale, 4 * state.scale]}
          borderDashEnabled={true}
          // anchor
          anchorSize={3 * state.scale}
          anchorStroke="black"
          anchorStrokeWidth={state.scale}
          anchorFill="black"
          anchorCornerRadius={100}
        />
      )}
    </>
  )
}

function MouseCursor(props: {
  scale: number
  pointer: Vector2d
  objectToPlace: Object

  RenderObject: React.ComponentType<{
    object: Object
    remove: () => void
  }>
}) {
  const width = props.objectToPlace.dimensions.width * props.scale
  const height = props.objectToPlace.dimensions.height * props.scale
  const x = props.pointer.x - width / 2
  const y = props.pointer.y - height / 2

  return (
    <Group width={width} height={height} x={x} y={y}>
      <props.RenderObject
        object={{
          ...props.objectToPlace,
          dimensions: {
            width: width,
            height: height,
          },
        }}
        remove={() => {}}
      />
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

        const newY = -invertRemapRange(
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
        const newX = invertRemapRange(xPos, minX, maxX, newMaxX, 0)

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
