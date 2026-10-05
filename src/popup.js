import { PDFDocument } from 'pdf-lib'
import { collectCanvasCourse, installDownloadBridge } from './canvas.js'

const state = {
  pdfTabs: [],
  localFiles: [],
}

const $ = (id) => document.getElementById(id)

function setStatus(element, message, isError = false) {
  element.textContent = message || ''
  element.classList.toggle('error', !!isError)
}

function safeFilename(value, fallback = 'Merged PDFs.pdf') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const name = cleaned || fallback
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`
}

function isPdfTab(tab) {
  const url = tab.url || ''
  const title = tab.title || ''
  if (!/^(https?|file):/i.test(url)) return false

  try {
    const parsed = new URL(url)
    if (/\.pdf$/i.test(parsed.pathname)) return true
    if (/\.pdf(?:$|[?#])/i.test(url)) return true
  } catch {}

  return /\.pdf\s*$/i.test(title)
}

function displayUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return decodeURIComponent(parsed.pathname)
    return parsed.hostname + decodeURIComponent(parsed.pathname)
  } catch {
    return url
  }
}

async function scanPdfTabs() {
  const tabs = await chrome.tabs.query({})
  const pdfTabs = tabs
    .filter(isPdfTab)
    .sort((a, b) => (a.windowId - b.windowId) || (a.index - b.index))
    .map((tab) => ({
      id: String(tab.id),
      tabId: tab.id,
      title: tab.title || 'Untitled PDF',
      url: tab.url,
      selected: true,
    }))

  state.pdfTabs = pdfTabs
  renderPdfTabs()
}

function movePdf(index, direction) {
  const target = index + direction
  if (target < 0 || target >= state.pdfTabs.length) return
  const [item] = state.pdfTabs.splice(index, 1)
  state.pdfTabs.splice(target, 0, item)
  renderPdfTabs()
}

function renderPdfTabs() {
  const container = $('pdfTabs')
  container.textContent = ''
  $('emptyPdfTabs').classList.toggle('hidden', state.pdfTabs.length > 0)

  state.pdfTabs.forEach((item, index) => {
    const row = document.createElement('div')
    row.className = 'pdfRow'

    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = item.selected
    check.addEventListener('change', () => {
      item.selected = check.checked
    })

    const copy = document.createElement('div')
    copy.style.minWidth = '0'
    const title = document.createElement('div')
    title.className = 'pdfTitle'
    title.textContent = item.title
    title.title = item.title
    const meta = document.createElement('div')
    meta.className = 'pdfMeta'
    meta.textContent = displayUrl(item.url)
    meta.title = item.url
    copy.append(title, meta)

    const order = document.createElement('div')
    order.className = 'orderBtns'

    const up = document.createElement('button')
    up.textContent = '↑'
    up.title = 'Move up'
    up.disabled = index === 0
    up.addEventListener('click', () => movePdf(index, -1))

    const down = document.createElement('button')
    down.textContent = '↓'
    down.title = 'Move down'
    down.disabled = index === state.pdfTabs.length - 1
    down.addEventListener('click', () => movePdf(index, 1))

    order.append(up, down)
    row.append(check, copy, order)
    container.appendChild(row)
  })
}

function renderLocalFiles() {
  const container = $('localFileList')
  container.textContent = ''

  state.localFiles.forEach((file, index) => {
    const row = document.createElement('div')
    row.className = 'localChip'

    const name = document.createElement('span')
    name.textContent = file.name
    name.title = file.name

    const remove = document.createElement('button')
    remove.className = 'ghost small'
    remove.textContent = 'Remove'
    remove.addEventListener('click', () => {
      state.localFiles.splice(index, 1)
      renderLocalFiles()
    })

    row.append(name, remove)
    container.appendChild(row)
  })
}

function permissionOrigins(urls) {
  const origins = new Set()
  for (const url of urls) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        origins.add(`${parsed.origin}/*`)
      }
    } catch {}
  }
  return [...origins]
}

async function ensurePdfAccess(urls) {
  const origins = permissionOrigins(urls)
  if (origins.length) {
    const already = await chrome.permissions.contains({ origins })
    if (!already) {
      const granted = await chrome.permissions.request({ origins })
      if (!granted) throw new Error('Site access is required to read the selected PDF tabs.')
    }
  }

  if (urls.some((url) => url.startsWith('file:'))) {
    const allowed = await chrome.extension.isAllowedFileSchemeAccess()
    if (!allowed) {
      throw new Error('Enable “Allow access to file URLs” for Canvas PDF Composer, or add those PDFs with “Add local PDFs”.')
    }
  }
}

async function fetchPdfSource(item) {
  const response = await fetch(item.url, {
    credentials: 'include',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`${item.title}: HTTP ${response.status}`)
  return response.arrayBuffer()
}

async function mergeSelectedPdfs() {
  const status = $('mergeStatus')
  const button = $('mergeButton')
  const remote = state.pdfTabs.filter((item) => item.selected)

  if (!remote.length && !state.localFiles.length) {
    setStatus(status, 'Select at least one PDF tab or local file.', true)
    return
  }

  button.disabled = true

  try {
    setStatus(status, 'Checking access…')
    await ensurePdfAccess(remote.map((item) => item.url))

    const output = await PDFDocument.create()
    let totalPages = 0

    for (let index = 0; index < remote.length; index++) {
      const item = remote[index]
      setStatus(status, `Reading ${index + 1}/${remote.length + state.localFiles.length}: ${item.title}`)
      const bytes = await fetchPdfSource(item)
      const source = await PDFDocument.load(bytes)
      const pages = await output.copyPages(source, source.getPageIndices())
      pages.forEach((page) => output.addPage(page))
      totalPages += pages.length
    }

    for (let index = 0; index < state.localFiles.length; index++) {
      const file = state.localFiles[index]
      setStatus(status, `Reading ${remote.length + index + 1}/${remote.length + state.localFiles.length}: ${file.name}`)
      const source = await PDFDocument.load(await file.arrayBuffer())
      const pages = await output.copyPages(source, source.getPageIndices())
      pages.forEach((page) => output.addPage(page))
      totalPages += pages.length
    }

    if (!totalPages) throw new Error('The selected files did not contain any pages.')

    output.setTitle('Merged with Canvas PDF Composer')
    output.setProducer('Canvas PDF Composer')
    output.setCreator('Canvas PDF Composer')

    setStatus(status, `Creating ${totalPages}-page PDF…`)
    const bytes = await output.save()
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)

    try {
      await chrome.downloads.download({
        url,
        filename: safeFilename($('mergeFilename').value),
        saveAs: true,
      })
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }

    setStatus(status, `Done — merged ${remote.length + state.localFiles.length} PDFs into ${totalPages} pages.`)
  } catch (error) {
    setStatus(status, error?.message || String(error), true)
  } finally {
    button.disabled = false
  }
}

async function buildCanvasReview() {
  const button = $('canvasButton')
  const status = $('canvasStatus')
  button.disabled = true

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) throw new Error('No active tab.')

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: installDownloadBridge,
    })

    const options = {
      pages: $('pages').checked,
      discussions: $('discussions').checked,
      assignments: $('assignments').checked,
      quizzes: $('quizzes').checked,
      files: $('files').checked,
    }

    setStatus(status, 'Collecting Canvas modules…')

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: collectCanvasCourse,
      args: [options],
    })

    const value = result?.[0]?.result
    if (value?.ok === false) throw new Error(value.message || 'Canvas export failed.')
    setStatus(status, value?.message || 'Course review created.')
  } catch (error) {
    setStatus(status, error?.message || String(error), true)
  } finally {
    button.disabled = false
  }
}

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === button))
    $('mergeView').classList.toggle('active', view === 'merge')
    $('canvasView').classList.toggle('active', view === 'canvas')
  })
})

$('refreshTabs').addEventListener('click', () => scanPdfTabs().catch((error) => {
  setStatus($('mergeStatus'), error?.message || String(error), true)
}))

$('localFiles').addEventListener('change', (event) => {
  state.localFiles.push(...event.target.files)
  event.target.value = ''
  renderLocalFiles()
})

$('mergeButton').addEventListener('click', mergeSelectedPdfs)
$('canvasButton').addEventListener('click', buildCanvasReview)

scanPdfTabs().catch((error) => {
  setStatus($('mergeStatus'), error?.message || String(error), true)
})