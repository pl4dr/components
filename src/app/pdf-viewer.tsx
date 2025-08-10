'use client'

import { PDFView } from '@/registry/pdfview/pdfview'
import {
  Object,
  PDFViewProvider,
  usePDFViewActions,
  usePDFViewState,
} from '@/registry/pdfview/pdfview-provider'
import { nanoid } from 'nanoid'
import { useEffect, useRef, useState } from 'react'
import { Image } from 'react-konva'

export default function PDFViewer() {
  const divRef = useRef<HTMLDivElement>(null)

  return (
    <PDFViewProvider>
      <ObjectButtons />
      <div
        ref={divRef}
        className="relative h-[800px] w-[90vw] border border-slate-100">
        <PDFView
          src="http://localhost:3000/sample.pdf"
          containerRef={divRef}
          RenderObject={RenderObject}
        />
        <PageIndicator />
      </div>
    </PDFViewProvider>
  )
}

function ObjectButtons() {
  const actions = usePDFViewActions()
  return (
    <div>
      {/* eslint-disable-next-line */}
      <img
        onClick={() => {
          actions.setObjectToPlace({
            id: nanoid(),
            dimensions: { width: 38, height: 38 },
            tag: 'image',
            data: {
              src: 'https://picsum.photos/100/100',
            },
          })
        }}
        src="https://picsum.photos/100/100"
        className="size-6"
      />
    </div>
  )
}

function RenderObject(props: { object: Object }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = new window.Image()
    img.src = props.object.data.src
    img.onload = () => {
      setImage(img)
    }
  }, [props.object])

  if (!image) return null

  return (
    <Image
      image={image}
      width={props.object.dimensions.width}
      height={props.object.dimensions.height}
      listening={props.object.placed}
      alt={''}
    />
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
