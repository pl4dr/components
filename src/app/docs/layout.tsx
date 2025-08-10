import icon from '@/app/icon.png'
import { source } from '@/lib/source'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { Code2Icon } from 'lucide-react'
import Image from 'next/image'
import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <div className="flex flex-row items-center gap-2 text-xl font-thin">
            <Image className="size-8 rounded-full" alt="PL4DR" src={icon} />
            PL4DR
            <Code2Icon className="size-6 stroke-[1] text-slate-500" />
          </div>
        ),
        url: 'https://pl4dr.github.io/components',
      }}
      githubUrl="https://github.com/pl4dr/components">
      {children}
    </DocsLayout>
  )
}
