'use client'

import { PDFView } from '@/registry/pdf-view/pdf-view'
import { useRef } from 'react'

export default function PDFViewer() {
  const divRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={divRef}
      className="h-[800px] w-[90vw] overflow-hidden rounded-sm border border-slate-300 bg-white">
      <PDFView src="http://localhost:3000/sample.pdf" containerRef={divRef} />
    </div>
  )
}
