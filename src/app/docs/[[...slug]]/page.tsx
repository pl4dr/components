import { source } from '@/lib/source'
import { getMDXComponents } from '@/mdx-components'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/page'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>
}) {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const MDX = page.data.body

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        {/* <p>{page.data.content}</p> */}
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  )
}

export const generateStaticParams = async () => {
  return source.generateParams()
}

export const generateMetadata = async (props: {
  params: Promise<{ slug?: string[] }>
}): Promise<Metadata> => {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  return {
    title: page.data.title,
    description: page.data.description,
  } satisfies Metadata
}
