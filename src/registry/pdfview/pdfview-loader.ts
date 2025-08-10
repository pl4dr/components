import type {
  DocumentInitParameters,
  TypedArray,
} from 'pdfjs-dist/types/src/display/api'

import * as pdfjs from 'pdfjs-dist'

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
        const allowedScale =
          dominantPageWidth > allowedPageWidth
            ? allowedPageWidth / dominantPageWidth
            : 1

        const scaledPageWidth = pageDimensions.width * allowedScale
        const scaledPageHeight = pageDimensions.height * allowedScale

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

export { PDFLoader }
