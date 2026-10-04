/* InvoiceMate: stand-in for Allyce's js/sync.js (Supabase cloud sync). Cloud sync is OFF in InvoiceMate:
 * these no-op versions keep the copied code working with data stored only on this device. */
'use strict';
const cloudEnabled = () => false;
const SY = { status: 'idle' };
const syncOn = () => false;
async function loadSync() { }
async function syncMark(col) { if (typeof Chase !== 'undefined') Chase.touched(col); }   // InvoiceMate: payment chasing watches saves
function startSync() { }
async function syncNow() { }
function syncStatusText() { return 'Local only'; }
const isAuthHash = () => false;
async function cloudAuthFromHash() { }
async function cloudFetchBlob() { throw new Error('Cloud sync is not set up in InvoiceMate'); }
async function cloudTab(el) { el.innerHTML = '<div class="card">Cloud sync is not set up in InvoiceMate yet.</div>'; }
