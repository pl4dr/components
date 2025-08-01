'use client'

import dynamic from 'next/dynamic'

const PDFViewer = dynamic(() => import('@/app/pdf-viewer'), {
  ssr: false,
})

export default function Home() {
  return (
    <main className="grid h-screen place-content-center">
      <PDFViewer />
    </main>
  )
}
