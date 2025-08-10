import { createMDX } from 'fumadocs-mdx/next'
import type { NextConfig } from 'next'

const withMDX = createMDX({
  outDir: 'src/.source',
})

const nextConfig: NextConfig = {
  output: 'export',
  basePath: process.env.NODE_ENV === 'production' ? '/components' : undefined,
  assetPrefix:
    process.env.NODE_ENV === 'production' ? '/components' : undefined,

  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  webpack(config) {
    config.externals = [...config.externals, { canvas: 'canvas' }]
    return config
  },
}

export default withMDX(nextConfig)
