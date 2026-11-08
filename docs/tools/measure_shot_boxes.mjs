import { chromium } from '/home/cx/os/ohos-xts-auto-reporter/node_modules/playwright/index.mjs'
const scenarios = ['dark-derived', 'dark-mirror-running', 'dark-drafts', 'dark-mirror-failed', 'dark-ready']
const browser = await chromium.launch()
const out = {}
for (const name of scenarios) {
  const page = await browser.newPage({ viewport: { width: 832, height: 900 }, deviceScaleFactor: 2 })
  await page.goto(`file:///tmp/xts-preview/${name}.html`)
  await page.waitForTimeout(120)
  const data = await page.evaluate(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } }
    const byText = (tag, text) => [...document.querySelectorAll(tag)].find((el) => (el.textContent || '').trim() === text) || null
    const panels = [...document.querySelectorAll('.oh-xts__panel')].map((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), title: (el.querySelector('.oh-xts__panel-title') || {}).textContent || '' } })
    const hints = [...document.querySelectorAll('.oh-xts__hint')].map((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').slice(0, 20) } })
    return {
      height: document.documentElement.scrollHeight,
      workbook: box(document.querySelector('#oh-xts-workbook')),
      workbookHint: hints.find((h) => h.y < 400 && h.y > 150) || hints[0] || null,
      preflightBtn: box(byText('button', '评测资料预检')),
      uploadBtn: box(byText('button', '上传固件')) || box(byText('button', '上传中…')),
      scanBtn: box(byText('button', '识别目录')), 
      saveWaiverBtn: box(byText('button', '保存豁免草稿')),
      panels,
      rows: [...document.querySelectorAll('.oh-xts__row')].map((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } }),
      bar: box(document.querySelector('.oh-xts__bar')),
      draftsPanelTitle: (() => { const h = [...document.querySelectorAll('.oh-xts__panel-title')].find((el) => el.textContent.includes('草稿')); const r = h && h.getBoundingClientRect(); return r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null })(),
      scanPanelTitle: (() => { const h = [...document.querySelectorAll('.oh-xts__panel-title')].find((el) => el.textContent.includes('识别结果')); const r = h && h.getBoundingClientRect(); return r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null })(),
    }
  })
  out[name] = data
  await page.close()
}
console.log(JSON.stringify(out, null, 1))
await browser.close()
