'use client'

import {
  PDFView,
  PDFViewProvider,
  usePDFViewState,
} from '@/registry/pdf-view/pdf-view'
import { useRef } from 'react'

export default function PDFViewer() {
  const divRef = useRef<HTMLDivElement>(null)

  return (
    <PDFViewProvider>
      <div
        ref={divRef}
        className="relative h-[800px] w-[90vw] border border-slate-100">
        <PDFView src="http://localhost:3000/sample.pdf" containerRef={divRef} />
        <PageIndicator />
      </div>
    </PDFViewProvider>
  )
}

function PageIndicator() {
  const { currentPage, totalPages } = usePDFViewState()

  return (
    <div className="absolute bottom-2 left-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900 shadow-xs">
      {currentPage} / {totalPages}
    </div>
  )
}
