'use client'

import { PDFView } from '@/registry/pdfview/pdfview'
import {
  PDFViewProvider,
  usePDFViewActions,
  usePDFViewState,
} from '@/registry/pdfview/pdfview-provider'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  MinusIcon,
  PlusIcon,
} from 'lucide-react'
import { useRef } from 'react'

export default function Preview(props: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  return (
    <PDFViewProvider>
      <div
        ref={containerRef}
        className="relative h-[450px] w-full overflow-hidden rounded-md bg-white dark:bg-slate-800">
        <PDFView containerRef={containerRef} src={props.src} />
        <PageIndicator />
        <ZoomControls />
      </div>
    </PDFViewProvider>
  )
}

function PageIndicator() {
  const state = usePDFViewState()
  const actions = usePDFViewActions()

  return (
    <div className="absolute right-2 bottom-2 flex flex-row items-center gap-2 *:dark:border-[0.5px]">
      <button
        onClick={() => {
          actions.goToPage(state.currentPage - 1)
        }}
        type="button"
        className="grid size-[30px] cursor-pointer place-content-center rounded-full border border-slate-100 bg-white dark:bg-slate-800">
        <ChevronUpIcon className="size-4" />
      </button>
      <p className="w-[80px] rounded-full border border-slate-100 bg-white px-2 py-1 text-center text-sm text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white">
        {state.currentPage}&nbsp;
        <span className="text-xs text-slate-500 dark:text-slate-300">
          / {state.totalPages}
        </span>
      </p>
      <button
        onClick={() => {
          actions.goToPage(state.currentPage + 1)
        }}
        type="button"
        className="grid size-[30px] cursor-pointer place-content-center rounded-full border border-slate-100 bg-white dark:bg-slate-800">
        <ChevronDownIcon className="size-4" />
      </button>
    </div>
  )
}

function ZoomControls() {
  const state = usePDFViewState()
  const actions = usePDFViewActions()

  return (
    <div className="absolute bottom-2 left-2 flex flex-row items-center gap-2 *:dark:border-[0.5px]">
      <button
        onClick={() => {
          actions.setViewportScale(state.scale - 0.25)
        }}
        type="button"
        className="grid size-[30px] cursor-pointer place-content-center rounded-full border border-slate-100 bg-white dark:bg-slate-800">
        <MinusIcon className="size-4" />
      </button>
      <p className="w-[60px] rounded-full border border-slate-100 bg-white px-2 py-1 text-center text-sm text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white">
        {(state.scale * 100).toFixed(0)}
        <span className="text-xs">%</span>
      </p>
      <button
        onClick={() => {
          actions.setViewportScale(state.scale + 0.25)
        }}
        type="button"
        className="grid size-[30px] cursor-pointer place-content-center rounded-full border border-slate-100 bg-white dark:bg-slate-800">
        <PlusIcon className="size-4" />
      </button>
    </div>
  )
}
