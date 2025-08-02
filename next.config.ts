import { createMDX } from 'fumadocs-mdx/next'
import type { NextConfig } from 'next'

const withMDX = createMDX({
  outDir: 'src/.source',
})

const nextConfig: NextConfig = {
  output: 'export',

  reactStrictMode: true,

  webpack(config) {
    config.externals = [...config.externals, { canvas: 'canvas' }]
    return config
  },
}

export default withMDX(nextConfig)
