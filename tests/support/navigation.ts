import type { Page, Response } from '@playwright/test'

const nuxtChunkPath = /\/_nuxt\/[^/?]+\.js(?:\?|$)/

export async function gotoPlanningRoom(page: Page, path: string) {
  let missingChunks: string[] = []
  const recordMissingChunk = (response: Response) => {
    if (response.status() === 404 && nuxtChunkPath.test(response.url())) {
      missingChunks.push(new URL(response.url()).pathname)
    }
  }

  page.on('response', recordMissingChunk)
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      missingChunks = []
      await page.goto(path)
      try {
        await page.getByText('Loading your planning room…', { exact: true })
          .waitFor({ state: 'hidden', timeout: 15_000 })
        return
      } catch (error) {
        if (missingChunks.length && attempt === 1) continue
        const detail = missingChunks.length
          ? ` Missing deployment chunks: ${[...new Set(missingChunks)].join(', ')}.`
          : ''
        throw new Error(
          `Planning room did not become ready at ${path}.${detail}`
          + ' Check that E2E_BASE_URL points to one completed staging deployment.',
          { cause: error },
        )
      }
    }
  } finally {
    page.off('response', recordMissingChunk)
  }
}
