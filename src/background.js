import { PDFDocument } from 'pdf-lib'

const capturedByExport = new Map()

function safeFilename(value, fallback = 'Canvas Course Review.pdf') {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`
}

function base64ToBytes(value) {
  const raw = atob(value)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function waitForLoaded(tabId, timeoutMs = 20_000) {
  const tab = await chrome.tabs.get(tabId)
  if (tab.status === 'complete') return

  await new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.tabs.onRemoved.removeListener(onRemoved)
    }
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        cleanup()
        resolve()
      }
    }
    const onRemoved = (id) => {
      if (id === tabId) {
        cleanup()
        reject(new Error('Resource tab closed before it finished loading.'))
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.onRemoved.addListener(onRemoved)
    timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for the resource preview.'))
    }, timeoutMs)
  })
}

async function printTabToPdf(tabId) {
  const debuggee = {tabId}
  await chrome.debugger.attach(debuggee, '1.3')
  try {
    await chrome.debugger.sendCommand(debuggee, 'Emulation.setEmulatedMedia', {media: 'screen'})
    await new Promise((resolve) => setTimeout(resolve, 900))
    const result = await chrome.debugger.sendCommand(debuggee, 'Page.printToPDF', {
      landscape: false,
      displayHeaderFooter: false,
      printBackground: true,
      scale: 0.86,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.25,
      marginBottom: 0.25,
      marginLeft: 0.25,
      marginRight: 0.25,
      preferCSSPageSize: false,
    })
    return result.data
  } finally {
    await chrome.debugger.detach(debuggee).catch(() => {})
  }
}

async function fetchPdfInTab(tabId, url) {
  const debuggee = {tabId}
  await chrome.debugger.attach(debuggee, '1.3')
  try {
    const result = await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
      expression: `
        (async () => {
          const response = await fetch(${JSON.stringify(url)}, {credentials:'include', cache:'no-store'})
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const type = (response.headers.get('content-type') || '').toLowerCase()
          if (!type.includes('pdf')) throw new Error('Expected PDF but received ' + (type || 'unknown content type'))
          const bytes = new Uint8Array(await response.arrayBuffer())
          let binary = ''
          const chunk = 0x8000
          for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
          return btoa(binary)
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error('Could not fetch the PDF with your signed-in session.')
    return result.result?.value
  } finally {
    await chrome.debugger.detach(debuggee).catch(() => {})
  }
}

async function captureResource(message) {
  let tab
  try {
    tab = await chrome.tabs.create({url: message.url, active: false})
    await waitForLoaded(tab.id)

    let data
    if (message.kind === 'pdf-url') {
      try {
        data = await fetchPdfInTab(tab.id, message.url)
      } catch {
        // Some document endpoints render a preview instead of exposing PDF bytes to fetch.
        data = await printTabToPdf(tab.id)
      }
    } else {
      data = await printTabToPdf(tab.id)
    }

    if (!data) throw new Error('No PDF data was produced.')
    const bucket = capturedByExport.get(message.exportId) || []
    bucket.push({title: message.title || 'Resource', data})
    capturedByExport.set(message.exportId, bucket)
    return {ok: true, pagesPending: bucket.length}
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

async function buildReviewPdf(message) {
  let debuggee = null
  try {
    const tabs = await chrome.tabs.query({})
    const target = tabs.find((tab) => tab.title?.includes(`[${message.exportId}]`))
    if (!target?.id) throw new Error('Could not find the generated review tab.')

    debuggee = {tabId: target.id}
    await chrome.debugger.attach(debuggee, '1.3')
    await chrome.debugger.sendCommand(debuggee, 'Emulation.setEmulatedMedia', {media: 'screen'})
    await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
      expression: `
        (() => {
          document.documentElement.classList.add('pdf-direct-export')
          document.body.classList.add('pdf-direct-export')
          const style = document.createElement('style')
          style.id = '__pdf_composer_export_style'
          style.textContent = 'html,body{background:white!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
            'body.pdf-direct-export .toolbar{display:none!important;}' +
            'body.pdf-direct-export .paper{margin:0 auto!important;box-shadow:none!important;background:white!important;}'
          document.head.appendChild(style)
        })()
      `,
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const result = await chrome.debugger.sendCommand(debuggee, 'Page.printToPDF', {
      landscape: false,
      displayHeaderFooter: false,
      printBackground: true,
      scale: 0.76,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.28,
      marginBottom: 0.28,
      marginLeft: 0.28,
      marginRight: 0.28,
      preferCSSPageSize: false,
    })
    await chrome.debugger.detach(debuggee)
    debuggee = null

    const output = await PDFDocument.create()
    const main = await PDFDocument.load(base64ToBytes(result.data))
    const mainPages = await output.copyPages(main, main.getPageIndices())
    mainPages.forEach((page) => output.addPage(page))

    const captured = capturedByExport.get(message.exportId) || []
    let extraPages = 0
    for (const item of captured) {
      try {
        const source = await PDFDocument.load(base64ToBytes(item.data))
        const pages = await output.copyPages(source, source.getPageIndices())
        pages.forEach((page) => output.addPage(page))
        extraPages += pages.length
      } catch (error) {
        console.warn('Skipping captured resource', item.title, error)
      }
    }

    output.setTitle(message.filename || 'Canvas Course Review')
    output.setProducer('Canvas PDF Composer')
    output.setCreator('Canvas PDF Composer')
    const merged = await output.save()
    const base64 = bytesToBase64(merged)

    await chrome.downloads.download({
      url: `data:application/pdf;base64,${base64}`,
      filename: safeFilename(message.filename),
      saveAs: true,
    })
    capturedByExport.delete(message.exportId)
    return {ok: true, extraPages}
  } finally {
    if (debuggee) await chrome.debugger.detach(debuggee).catch(() => {})
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.source !== 'pdf-composer') return

  if (message.action === 'capture-canvas-resource') {
    captureResource(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ok: false, error: error?.message || String(error)}))
    return true
  }

  if (message.action === 'download-review-pdf') {
    buildReviewPdf(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ok: false, error: error?.message || String(error)}))
    return true
  }
})
