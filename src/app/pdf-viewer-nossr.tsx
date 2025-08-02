'use client'

import dynamic from 'next/dynamic'

const PDFViewer = dynamic(() => import('@/app/pdf-viewer'), {
  ssr: false,
})

export { PDFViewer }
