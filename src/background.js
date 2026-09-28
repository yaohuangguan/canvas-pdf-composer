chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.source !== 'pdf-composer' || message?.action !== 'download-review-pdf') return

  ;(async () => {
    let debuggee = null

    try {
      const tabs = await chrome.tabs.query({})
      const target = tabs.find((tab) => tab.title?.includes(`[${message.exportId}]`))
      if (!target?.id) throw new Error('Could not find the generated review tab.')

      debuggee = { tabId: target.id }
      await chrome.debugger.attach(debuggee, '1.3')

      await chrome.debugger.sendCommand(debuggee, 'Emulation.setEmulatedMedia', {
        media: 'screen',
      })

      await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: `
          (() => {
            document.documentElement.classList.add('pdf-direct-export')
            document.body.classList.add('pdf-direct-export')
            const style = document.createElement('style')
            style.id = '__pdf_composer_export_style'
            style.textContent =
              'html,body{background:white!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
              'body.pdf-direct-export .toolbar{display:none!important;}' +
              'body.pdf-direct-export .paper{margin:0 auto!important;box-shadow:none!important;background:white!important;}' +
              'body.pdf-direct-export .course-item,body.pdf-direct-export .module{break-inside:auto!important;}'
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

      await chrome.debugger
        .sendCommand(debuggee, 'Runtime.evaluate', {
          expression: `
            (() => {
              document.documentElement.classList.remove('pdf-direct-export')
              document.body.classList.remove('pdf-direct-export')
              document.getElementById('__pdf_composer_export_style')?.remove()
            })()
          `,
        })
        .catch(() => {})

      await chrome.debugger.detach(debuggee)
      debuggee = null

      const safeName = String(message.filename || 'Canvas Course Review.pdf')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()

      await chrome.downloads.download({
        url: `data:application/pdf;base64,${result.data}`,
        filename: safeName,
        saveAs: true,
      })

      sendResponse({ ok: true })
    } catch (error) {
      if (debuggee) await chrome.debugger.detach(debuggee).catch(() => {})
      sendResponse({ ok: false, error: error?.message || String(error) })
    }
  })()

  return true
})
