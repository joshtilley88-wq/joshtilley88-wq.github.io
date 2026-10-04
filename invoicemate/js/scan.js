/* InvoiceMate: receipt scanning. Photo (camera) -> Tesseract.js OCR in the browser (vendored, no CDN) -> parseReceipt -> expense form. */
'use strict';
const Scan = {
  worker: null, busy: false,
  async getWorker(onProgress) {
    if (this.worker) return this.worker;
    const base = new URL('vendor/tesseract/', location.href).href;
    this.worker = await Tesseract.createWorker('eng', 1, {               // 1 = LSTM engine only (smaller, what the vendored core supports)
      workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', gzip: true, workerBlobURL: false,
      logger: m => onProgress && onProgress(m),
    });
    return this.worker;
  },
  /* must be called straight from a tap (so the camera picker is allowed to open) */
  pick() {
    const inp = $('#im-cam'); inp.value = '';
    inp.onchange = () => { const f = inp.files[0]; if (f) this.handle(f); };
    inp.click();
  },
  guessCategory(merchant) {
    const m = (merchant || '').toLowerCase();
    if (/bunnings|reece|tradelink|mitre ?10|plumbtec|middys|rexel|samios|haymans|bowens|home timber|cnw|lawrence|tradezone/.test(m)) return 'Parts & materials';
    if (/total tools|sydney tools|tools/.test(m)) return 'Tools';
    if (/ampol|caltex|shell|\bbp\b|7-?eleven|united|metro|puma|liberty|coles express|fuel|petrol|servo/.test(m)) return 'Fuel';
    return '';
  },
  async handle(file) {
    if (this.busy) return; this.busy = true;
    if (!file.type.startsWith('image/')) { toast('Please choose a photo'); this.busy = false; return; }
    const m = openModal({ title: 'Reading receipt…', body: `<div class="stack" style="text-align:center"><div class="scan-prog"><div id="sc-bar"></div></div><div class="small muted" id="sc-msg">Getting ready (first time takes a little longer)…</div></div>` });
    const set = (p, msg) => { const b = $('#sc-bar', m), t = $('#sc-msg', m); if (b) b.style.width = Math.round(p * 100) + '%'; if (t && msg) t.textContent = msg; };
    try {
      const dataURL = await shrinkImage(file, 1800, 0.85);
      const blob = dataURLtoBlob(dataURL);
      const w = await this.getWorker(x => { if (x.status === 'recognizing text') set(0.2 + x.progress * 0.8, 'Reading the text… ' + Math.round(x.progress * 100) + '%'); else set(Math.min(0.2, (x.progress || 0) * 0.2), x.status ? x.status.replace(/^\w/, c => c.toUpperCase()) + '…' : ''); });
      const res = await w.recognize(blob);
      const text = (res.data && res.data.text || '').trim();
      const r = IMReceipt.parseReceipt(text);
      m._onClose = null; closeModal();
      if (!text) toast('Could not read any text. Fill it in by hand.');
      const pre = { fields: { supplier: r.merchant, amount: r.total || '', gst: r.total ? r.gst.toFixed(2) : '', date: r.date || today(), category: this.guessCategory(r.merchant), notes: 'Scanned receipt', gstIncl: true },
        file: { blob, type: 'image/jpeg', name: 'receipt-' + today() + '.jpg' }, ocrText: text, gstSource: r.gstSource };
      if (route().parts[0] !== 'expenses') { location.hash = '#/expenses'; await new Promise(ok => setTimeout(ok, 80)); await render(); }
      Pager.set(1);
      editExpenseModal(null, pre);
    } catch (e) {
      console.error(e); m._onClose = null; closeModal(); toast('Scan failed: ' + (e.message || e));
    } finally { this.busy = false; }
  },
};
ACT['scan-receipt'] = el => { Scan.pick(); if (!el.dataset.here) { closeModal(); } };
