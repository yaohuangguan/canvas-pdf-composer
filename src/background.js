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

function joinBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function looksLikePdf(bytes) {
  return bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
}

async function waitForLoaded(tabId, timeoutMs = 30_000) {
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
    await new Promise((resolve) => setTimeout(resolve, 1800))
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

async function readCdpStream(debuggee, handle) {
  const chunks = []
  let total = 0

  try {
    while (true) {
      const part = await chrome.debugger.sendCommand(debuggee, 'IO.read', {
        handle,
        size: 1024 * 1024,
      })

      if (part.data) {
        const bytes = part.base64Encoded
          ? base64ToBytes(part.data)
          : new TextEncoder().encode(part.data)
        chunks.push(bytes)
        total += bytes.length
        if (total > 200 * 1024 * 1024) {
          throw new Error('This PDF is larger than the current 200 MB capture limit.')
        }
      }

      if (part.eof) break
    }
  } finally {
    await chrome.debugger.sendCommand(debuggee, 'IO.close', {handle}).catch(() => {})
  }

  return joinBytes(chunks)
}

async function loadPdfWithCanvasSession(tabId, url) {
  if (!tabId) throw new Error('Could not find the Canvas source tab.')

  const debuggee = {tabId}
  await chrome.debugger.attach(debuggee, '1.3')

  try {
    await chrome.debugger.sendCommand(debuggee, 'Page.enable')
    const tree = await chrome.debugger.sendCommand(debuggee, 'Page.getFrameTree')
    const frameId = tree?.frameTree?.frame?.id
    if (!frameId) throw new Error('Could not resolve the Canvas page frame.')

    const loaded = await chrome.debugger.sendCommand(debuggee, 'Network.loadNetworkResource', {
      frameId,
      url,
      options: {
        disableCache: true,
        includeCredentials: true,
      },
    })

    const resource = loaded?.resource
    if (!resource?.success) {
      throw new Error(resource?.netErrorName || resource?.netError || 'Canvas did not return the file.')
    }
    if (resource.httpStatusCode && resource.httpStatusCode >= 400) {
      throw new Error(`Canvas file request returned HTTP ${resource.httpStatusCode}.`)
    }
    if (!resource.stream) {
      throw new Error('Canvas returned the file without a readable response stream.')
    }

    const bytes = await readCdpStream(debuggee, resource.stream)
    if (!looksLikePdf(bytes)) {
      const type = resource?.mimeType || resource?.headers?.['content-type'] || 'unknown content type'
      throw new Error(`Expected PDF bytes but Canvas returned ${type}.`)
    }

    return bytesToBase64(bytes)
  } finally {
    await chrome.debugger.detach(debuggee).catch(() => {})
  }
}

async function fetchPdfInCanvasTab(tabId, url) {
  if (!tabId) throw new Error('Could not find the Canvas source tab.')

  const debuggee = {tabId}
  await chrome.debugger.attach(debuggee, '1.3')
  try {
    const result = await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
      expression: `
        (async () => {
          const response = await fetch(${JSON.stringify(url)}, {
            credentials: 'include',
            cache: 'no-store',
            redirect: 'follow'
          })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
            throw new Error('Response is not a PDF')
          }
          let binary = ''
          const chunk = 0x8000
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
          }
          return btoa(binary)
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    })

    if (result.exceptionDetails || !result.result?.value) {
      throw new Error('Could not read PDF bytes from the signed-in Canvas page.')
    }
    return result.result.value
  } finally {
    await chrome.debugger.detach(debuggee).catch(() => {})
  }
}

async function capturePdfResource(message, sourceTabId) {
  const errors = []

  try {
    return await loadPdfWithCanvasSession(sourceTabId, message.url)
  } catch (error) {
    errors.push(error?.message || String(error))
  }

  try {
    return await fetchPdfInCanvasTab(sourceTabId, message.url)
  } catch (error) {
    errors.push(error?.message || String(error))
  }

  let tab
  try {
    tab = await chrome.tabs.create({url: message.url, active: false})
    await waitForLoaded(tab.id, 45_000)
    const data = await printTabToPdf(tab.id)
    if (!data) throw new Error('No PDF data was produced by the browser fallback.')
    return data
  } catch (error) {
    errors.push(error?.message || String(error))
    throw new Error(errors.join(' · '))
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

async function capturePageResource(message) {
  let tab
  try {
    tab = await chrome.tabs.create({url: message.url, active: false})
    await waitForLoaded(tab.id, 45_000)
    const data = await printTabToPdf(tab.id)
    if (!data) throw new Error('No PDF data was produced.')
    return data
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

async function captureResource(message, sourceTabId) {
  const data = message.kind === 'pdf-url'
    ? await capturePdfResource(message, sourceTabId)
    : await capturePageResource(message)

  if (!data) throw new Error('No PDF data was produced.')

  const bucket = capturedByExport.get(message.exportId) || []
  bucket.push({
    title: message.title || 'Resource',
    data,
    itemId: message.itemId || null,
    fileId: message.fileId || null,
  })
  capturedByExport.set(message.exportId, bucket)
  return {ok: true, pagesPending: bucket.length}
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source !== 'pdf-composer') return

  if (message.action === 'capture-canvas-resource') {
    captureResource(message, sender?.tab?.id)
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
