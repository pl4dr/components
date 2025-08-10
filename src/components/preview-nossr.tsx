'use client'

import dynamic from 'next/dynamic'

const Preview = dynamic(() => import('@/components/preview'), {
  ssr: false,
})

export { Preview }
