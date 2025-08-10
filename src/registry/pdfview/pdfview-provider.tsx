import {
  GAP_BETWEEN_PAGES_ON_CANVAS,
  ZOOM_MAX,
  ZOOM_MIN,
} from '@/registry/pdfview/pdfview-constants'
import { PDFLoader } from '@/registry/pdfview/pdfview-loader'
import { calculateXForScale } from '@/registry/pdfview/pdfview-utils'
import { Vector2d } from 'konva/lib/types'
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

export type PDFViewState = {
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

  pointer: Vector2d

  objects: Map<string, Object>
  pageObjects: Map<number, string[]>
  selectedObjectKey: string | null
  objectToPlace: Object | null
}

export type Object = {
  id: string
  position: Vector2d
  dimensions: { width: number; height: number }
  tag: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  placed: boolean
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
  setObjectToPlace: (
    objectToPlace: Omit<Object, 'position' | 'placed'> | null,
  ) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}>(null as any)

type Actions =
  typeof PDFViewActionsContext extends React.Context<infer T> ? T : never

declare global {
  interface Window {
    pdfview: Actions
  }
}

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

    pointer: {
      x: -1000,
      y: -1000,
    },

    objects: new Map(),
    pageObjects: new Map(),
    selectedObjectKey: null,
    objectToPlace: null,
  })

  const setViewportScale = useCallback((scale: number) => {
    setState((state) => {
      const clampedScale = Math.max(Math.min(scale, ZOOM_MAX), ZOOM_MIN)
      const newX = calculateXForScale(state.width, clampedScale)

      return {
        ...state,
        x: newX,
        scale: clampedScale,
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

  const setObjectToPlace = useCallback(
    (object: Omit<Object, 'position' | 'placed'> | null) => {
      setState((prev) => ({
        ...prev,
        objectToPlace: object
          ? {
              ...object,
              position: {
                x: 0,
                y: 0,
              },
              placed: false,
            }
          : null,
      }))
    },
    [],
  )

  const actions = useMemo(() => {
    return {
      setViewportScale,
      goToPage,
      setObjectToPlace,
    }
  }, [setViewportScale, goToPage, setObjectToPlace])

  useEffect(() => {
    window.pdfview = actions
  }, [actions])

  return (
    <PDFViewActionsContext.Provider value={actions}>
      <PDFViewContext.Provider value={[state, setState]}>
        {props.children}
      </PDFViewContext.Provider>
    </PDFViewActionsContext.Provider>
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

export { PDFViewContext, PDFViewProvider, usePDFViewActions, usePDFViewState }
