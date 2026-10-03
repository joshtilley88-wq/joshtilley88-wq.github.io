# Impeller Quoter (PWA)

A phone-first, installable web app for quoting **fabricated centrifugal fan impellers** from engineering drawings.
All prices are in **AUD**. It's a static site with no backend and no build step, so it runs on GitHub Pages at any subpath (e.g. `/impeller/`) because every path is relative.

> **All rates and allowances are EXAMPLE PLACEHOLDERS.** Replace them with your own labour rates, supplier quotes and measured shop times before issuing a firm price. Every one is editable on the **Params** tab.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell, tabs, Content-Security-Policy (scripts only from self + cdnjs; network only to self, `api.openai.com`, cdnjs). |
| `app.css` | Mobile-first styles (navy `#1f3a5f` theme) and print CSS for the report. |
| `js/defaults.js` | **All parameters** (value, unit, status, note), grades, shapes, the `MVW-360-27` example and the standard exclusions. |
| `js/engine.js` | Pure costing engine (no DOM). Geometry, mass, development, cutting, welding, batch maths, markup/margin, the assumption register. Also loads under Node for testing. |
| `js/ai.js` | OpenAI calls: drawing extraction (vision + Structured Outputs) and the assistant (function/tool calling). |
| `js/app.js` | UI: views, editing, PDF rendering (pdf.js from cdnjs), AI change log + undo, usage cost, JSON export/import, voice input. |
| `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | PWA install (Android Chrome) and offline app shell. |
| `shots/` | 390 px wide screenshots from the headless Chrome check, plus `report-print.pdf`. |

## Workflow

1. **Drawing**: drop a PDF or image, or tap to pick one. PDFs are rendered to images in the browser (pdf.js 3.11.174, cdnjs, max 4 pages). Use **⟳ 90°** so the text reads upright.
2. **Extract with AI** (optional): sends the page images to OpenAI with your key and returns the title block, components and weld schedule as JSON.
   **No key? Use manual mode.** Add components and welds on the **Check** tab, or tap **Load example: MVW-360-27**.
3. **Check**: review the extracted data. Fields the model was unsure of are flagged *check* or *to confirm*. Fix them, then tap **Confirm data**. Until you do, the report carries a DRAFT banner.
4. **Cost**: totals by operation, itemised lines, markup or margin, extra cost lines and the mass check.
5. **Params**: every parameter grouped in collapsible sections (**Show all parameters**), each with a value, unit, status and note.
6. **AI**: chat instructions such as “add $400 for pickling”, “change welding rate to $100/hr” or “what’s driving the cost?”. Changes apply immediately, go into the **AI changes** log, and each entry has **Undo**. The 🎤 button uses the Web Speech API where the browser supports it.
7. **Report**: printable quote (Print / Save as PDF) covering the drawing ref, scope, BOM, cost build-up, overhead, contingency, markup or margin, ex/inc GST, the assumption register, exclusions, the AI change log and AI usage. **Export/Import JSON** saves a quote. The API key is never included in the export.

The quote autosaves to `localStorage` (`iq.quote.v1`).

## Status rules (from the method doc)

* `confirmed`: a confirmed input, `provisional`: a quoting assumption, `to_confirm`: an unresolved requirement.
* **A blank value is “To confirm” and is NOT priced. It is never treated as zero.** Such lines show “To confirm”, are left out of the total, and appear in the report banner, the assumption register and the exclusions.
* In the example, coating, NDT and material certificates are blank (unpriced). Balancing is a **provisional allowance** ($350) flagged *to confirm* because the drawing gives no balance grade.

## Formulas (engine.js)

**Plate mass**: net kg = area (m²) × t (m) × ρ (kg/m³). Gross (purchased) kg = net ÷ yield. Yield is set per component, or falls back to `plate_yield_pct`. Densities: 304 = 7900, 316 = 8000, 2205 = 7800, mild steel = 7850.
**Hub (bar)**: net = finished turned volume (OD, step, bore) × ρ. Gross = solid bar blank (OD + 2·allowance) × (L + 2·allowance).

**Eye (cylinder)**: Dn = ID + t (or OD − t), L = π·Dn, blank = L × W.

**Cone frustum (shroud)**: Ro, Ri (neutral radii), Δr = Ro − Ri. Give either the axial rise H or the slope α from the radial plane:
s = Δr / cos α = √(Δr² + H²), H = Δr·tan α, R_out = s·Ro/Δr, R_in = s·Ri/Δr, θ = 360·Δr/s (°), flat area = π(Ro + Ri)·s.
Check: θ(rad)·R_out = 2πRo. The cut length is θ(rad)·(R_out + R_in) + 2s. **If the angle on a drawing is measured from the axis, enter 90 − that angle.**

**Cutting**: cut length (m) × rate for the thickness band + pierces × pierce charge, plus deburr hours per part and a one-off cutting setup.

**Welding**:
* Fillet: area = a²/2. Volume = area × length (length = length each × count × sides). Deposit kg = volume × ρ_weld.
  Arc h = deposit × profile factor ÷ deposition rate (kg/h). **Weld h = arc h ÷ operator factor.**
* Full penetration / butt: weld h = length (m) × `fullpen_hr_per_m`, handled separately. Its deposit (≈ t² × length) is used only for mass and filler.

**Labour items** (hours × rate): rolling (setup + per cone/eye), hub machining (setup, turning, keyway, drill/tap, post-weld bore), fit-up (base + per welded part), distortion, dressing, inspection.
**Stainless**: pickling = max(minimum charge, surface area (both faces) × $/m²) per batch.
**Consumables**: filler kg × $/kg, gas × weld hours, plus shop consumables at a % of labour.

**Batch**: batch direct cost = one-off (basis “batch”) + Q × unit cost (basis “unit”). Unit price = price ÷ Q.
**Overhead** = % × direct. **Contingency** = % × (direct + overhead). **Cost** = direct + overhead + contingency.
**Markup**: price = cost × (1 + m). **Margin**: price = cost ÷ (1 − g). For example, $100 at 20% markup = $120, and at 20% margin = $125.
**GST** = 10% of price ex GST.

**Mass check**: Σ net mass × qty + weld deposit, compared with the drawing mass. A warning shows if they differ by more than 15%.

## OpenAI (optional)

* Settings ⚙: API key (stored **only** in this browser’s `localStorage` as `iq.openai_key`, sent **only** to `https://api.openai.com`), model (default `gpt-5.6-sol`, editable), image detail, max image size, token prices (US$/1M in and out) and the USD→AUD rate. Token prices are placeholders, so check current OpenAI pricing.
* Extraction: `POST /v1/chat/completions` with `image_url` data-URL parts and `response_format: {type: "json_schema", json_schema: {strict: true, ...}}`. Models without Structured Outputs automatically fall back to `json_object`.
* Assistant: `tools` = `set_parameter`, `add_cost_line`, `remove_cost_line`, `update_component`, `update_weld`, `explain`, with `tool_choice: "auto"`. The tool results go back as `role: "tool"` messages, for up to 4 rounds. Context includes all parameters, components, welds, extra lines and a cost summary.
* `max_completion_tokens` is used rather than `max_tokens`, and no `temperature` is sent, so reasoning models also accept the request.
* The AI usage cost per quote comes from `usage.prompt_tokens` and `usage.completion_tokens` × the Settings prices.
* Error messages are friendly for 401 (bad key), 403, 404 (model), 429 (rate limit / quota), 400, 5xx, offline and network failures, invalid JSON, refusals and truncation.

## Example: MVW-360-27 Rev 0 (Aerotech Fans)

The readings are taken from the drawing (NTS). Assumed or REF geometry is flagged:
backplate Ø922 × 6 (centre hole Ø115 assumed), cone shroud 3 mm Ø922 → Ø510 REF with a 30 mm rise, eye Ø506 ID × 20 REF wide, 12 × 2205 blades 5 mm (270 long, 76 → 57 high), 6 × gussets 95 × 61 / 10 toe, hub Ø120 × 81 (Ø115 × 12 step, bore Ø65 H6), lock washer Ø110 × 6, locking tab 95 × 50 × 1.
Welds: 3 mm fillets on the blades (all round), 4 mm fillets both sides at the hub and gussets, and a full-penetration weld at the shroud/eye joint (π × 510). The closing seams are an assumption.

## Deploy (when ready)

Copy this folder into the Pages repo as `impeller/` (or its own repo). No build step is needed. Bump the `C` cache name in `sw.js` when you change files, so installed copies update.

## Test locally

```
cd impeller-quoter/.. && python3 -m http.server 8765   # open http://localhost:8765/impeller-quoter/
node -e "const D=require('./impeller-quoter/js/defaults.js'),E=require('./impeller-quoter/js/engine.js');console.log(E.compute(Object.assign({params:D.PARAMS},D.example())).price)"
```

## Known limitations

* Geometry uses ideal shapes. Blades are modelled as flat trapezoids, the shroud as a straight cone (no flange or toroidal curvature), and the backplate bore as an assumption. Nesting is a yield %, not a real nest.
* AI extraction has been validated against the documented request format with a mocked API only. Real accuracy on scanned drawings needs checking; always review the Check tab.
* The API key is held in the browser (localStorage). Anyone with access to the device or browser profile can read it, so use a key with a spend limit.
* pdf.js loads from cdnjs on the first PDF (it's then cached by the service worker). Images work offline; AI features need a connection.
