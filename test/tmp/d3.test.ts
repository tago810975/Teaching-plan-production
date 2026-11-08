import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import { readDocx } from '@core/import/docx-reader'
import { importDocx } from '@core/import/import-docx'
it('d3', async () => {
  const bytes = new Uint8Array(readFileSync('/tmp/d3/d.docx'))
  const r = await readDocx(bytes)
  const counts: Record<string, number> = {}
  for (const p of r.paragraphs) counts[p.styleName ?? '-'] = (counts[p.styleName ?? '-'] ?? 0) + 1
  console.log(JSON.stringify(counts))
  const t = (p: (typeof r.paragraphs)[0]) => p.inlines.map((i) => (i.type === 'text' ? i.text : i.type === 'math' ? '∮' : '◇')).join('')
  let on = false, n = 0
  for (const p of r.paragraphs) {
    if (/综合/.test(p.styleName ?? '')) on = true
    if (on && n < 45 && t(p).trim() !== '') { n++; console.log((p.styleName ?? '-').replace('物理排版 ', '').slice(0, 10).padEnd(10), JSON.stringify(t(p).slice(0, 50))) }
  }
  const imp = await importDocx(bytes)
  console.log('questions', imp.questionCount, imp.warnings)
})
