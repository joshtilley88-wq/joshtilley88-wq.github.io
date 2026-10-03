/* OpenAI calls, made directly from the browser with the user's own key.
 * The key is read from localStorage by app.js and only ever sent to https://api.openai.com.
 * Endpoint: POST /v1/chat/completions (vision via image_url content parts,
 * Structured Outputs via response_format json_schema, function tools via tools[]). */
(function (root) {
  'use strict';
  const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

  class AIError extends Error { constructor(msg, detail) { super(msg); this.detail = detail; } }

  function friendly(status, body) {
    const e = (body && body.error) || {};
    const m = e.message || '';
    const code = e.code || e.type || '';
    if (status === 401) return 'OpenAI rejected the API key (401). Check the key in Settings; it should start with "sk-".';
    if (status === 403) return 'This key or project does not have access to that model or endpoint (403). Try another model in Settings. ' + m;
    if (status === 404) return 'Model not found (404). Check the model name in Settings (for example gpt-5.6-sol or gpt-4o). ' + m;
    if (status === 429 && /quota|billing/i.test(code + m)) return 'Your OpenAI account has run out of credit or hit its quota (429). Add billing credit at platform.openai.com.';
    if (status === 429) return 'OpenAI rate limit reached (429). Wait a minute and try again.';
    if (status === 413) return 'The drawing images are too large for one request. Lower "Max image size" in Settings.';
    if (status >= 500) return `OpenAI had a server problem (${status}). Try again shortly.`;
    if (status === 400) return 'OpenAI could not accept the request (400): ' + (m || 'unknown reason');
    return `OpenAI error ${status}: ${m}`;
  }

  async function call(body, s) {
    if (!s.key) throw new AIError('No OpenAI API key set. Open Settings (⚙) and paste your key, or use manual mode.');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AIError('You appear to be offline. AI features need a connection; manual costing still works.');
    let res;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key }, body: JSON.stringify(body), referrerPolicy: 'no-referrer' });
    } catch (err) {
      throw new AIError('Could not reach OpenAI (network error). Check your connection and try again.', String(err));
    }
    let json = null;
    try { json = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok) { const er = new AIError(friendly(res.status, json), json); er.status = res.status; throw er; }
    if (!json || !json.choices || !json.choices[0]) throw new AIError('OpenAI returned an empty response. Try again.');
    return json;
  }

  function usageOf(json) {
    const u = json.usage || {};
    return { prompt: u.prompt_tokens || 0, completion: u.completion_tokens || 0, model: json.model || '' };
  }

  // ---------- Drawing extraction ----------
  const S = (t) => ({ type: [t, 'null'] });
  const field = { type: 'object', additionalProperties: false, required: ['value', 'confidence'],
    properties: { value: { type: ['string', 'null'] }, confidence: { type: 'string', enum: ['high', 'medium', 'low', 'to_confirm'] } } };
  const compProps = {
    name: { type: 'string' }, qty: S('number'), material_grade: S('string'), thickness_mm: S('number'),
    shape: { type: 'string', enum: ['disc', 'cone', 'cylinder', 'rect', 'trapezoid', 'bar', 'custom'] },
    od_mm: S('number'), id_mm: S('number'), length_mm: S('number'), width_mm: S('number'), width2_mm: S('number'),
    height_mm: S('number'), angle_deg: S('number'), step_od_mm: S('number'), step_length_mm: S('number'),
    hole_count: S('number'), welded_into_assembly: { type: 'boolean' }, notes: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    uncertain_fields: { type: 'array', items: { type: 'string' } }
  };
  const weldProps = {
    location: { type: 'string' }, type: { type: 'string', enum: ['fillet', 'full_penetration', 'butt', 'other'] },
    leg_mm: S('number'), throat_or_thickness_mm: S('number'), length_each_mm: S('number'), count: S('number'), sides: S('number'),
    notes: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
  };
  const SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['title_block', 'components', 'welds', 'general_notes', 'questions'],
    properties: {
      title_block: { type: 'object', additionalProperties: false,
        required: ['drawing_number', 'revision', 'title', 'customer', 'quantity', 'rotation', 'mass_kg', 'weld_standard', 'balance_grade', 'coating'],
        properties: { drawing_number: field, revision: field, title: field, customer: field, quantity: field, rotation: field, mass_kg: field, weld_standard: field, balance_grade: field, coating: field } },
      components: { type: 'array', items: { type: 'object', additionalProperties: false, required: Object.keys(compProps), properties: compProps } },
      welds: { type: 'array', items: { type: 'object', additionalProperties: false, required: Object.keys(weldProps), properties: weldProps } },
      general_notes: { type: 'array', items: { type: 'string' } },
      questions: { type: 'array', items: { type: 'string' } }
    }
  };
  const EXTRACT_PROMPT = `You are an engineering estimator's assistant reading a fabrication drawing of a centrifugal fan impeller.
The drawing may be rotated or scanned. Read only what is written or dimensioned; NEVER guess.
Return JSON matching the schema:
- title_block: drawing number, revision, title, customer/company, quantity (e.g. "1"), rotation (CW/ACW), mass_kg, welding standard, balance grade, coating. Use value null + confidence "to_confirm" if not shown.
- components: every drawn part (backplate, shroud, eye/inlet ring, blades, gussets, hub, washers, tabs, rings, stiffeners).
  qty = number per impeller; material_grade e.g. "304", "SAF 2205", "mild steel 250"; thickness_mm from the "x PL" callout.
  shape: disc (od_mm, id_mm), cone (od_mm outer, id_mm inner, height_mm = axial rise, angle_deg = slope from the radial plane if given),
  cylinder (id_mm or od_mm, width_mm = axial width), rect (length_mm, width_mm), trapezoid (length_mm, width_mm = wide end, width2_mm = narrow end),
  bar for machined hubs (od_mm, length_mm overall, id_mm finished bore, step_od_mm, step_length_mm), custom otherwise.
  For blades give length along the blade and the blade height at each end if the section shows it. Put tip/heel radii, angles, bores, keyways, tapped holes in notes.
  Any dimension you are not sure of: set null or list its field name in uncertain_fields, and lower confidence.
- welds: each weld symbol or note. type fillet / full_penetration / butt; leg_mm for fillets; length_each_mm = length of one joint if derivable; count = number of such joints; sides = 1 or 2 (both sides / all-round). null when not stated.
- general_notes: tolerances, standards, notes. questions: things an estimator must confirm (missing balance grade, coating, NDT, ambiguous dimensions).`;

  async function extract(images, s) {
    const content = [{ type: 'text', text: 'Extract the impeller drawing data. ' + images.length + ' page image(s) follow.' }]
      .concat(images.map(url => ({ type: 'image_url', image_url: { url, detail: s.detail || 'high' } })));
    const base = { model: s.model, messages: [{ role: 'system', content: EXTRACT_PROMPT }, { role: 'user', content }], max_completion_tokens: 12000 };
    let json;
    try {
      json = await call(Object.assign({}, base, { response_format: { type: 'json_schema', json_schema: { name: 'impeller_drawing', strict: true, schema: SCHEMA } } }), s);
    } catch (e) {
      // Older models without Structured Outputs: fall back to JSON mode.
      if (e.status === 400 && /response_format|json_schema|structured/i.test(e.message)) {
        base.messages[0].content += '\nRespond with a single JSON object only. Schema: ' + JSON.stringify(SCHEMA);
        json = await call(Object.assign({}, base, { response_format: { type: 'json_object' } }), s);
      } else throw e;
    }
    const msg = json.choices[0].message || {};
    if (msg.refusal) throw new AIError('The model declined to read this drawing: ' + msg.refusal);
    if (json.choices[0].finish_reason === 'length') throw new AIError('The model ran out of output tokens before finishing. Try again, or use a page crop.');
    let data;
    try { data = JSON.parse(msg.content); } catch (_) { throw new AIError('The model reply was not valid JSON. Try again or switch model.', msg.content); }
    return { data, usage: usageOf(json) };
  }

  // ---------- Assistant with tool calling ----------
  const OPS = ['Material', 'Cutting', 'Engineering & setup', 'Rolling & forming', 'Hub machining', 'Fit-up & tack', 'Welding', 'Finishing', 'Stainless treatment', 'Inspection & balancing', 'Coating, packing & freight', 'Consumables', 'Other'];
  const STATUS = ['confirmed', 'provisional', 'to_confirm'];
  const TOOLS = [
    { type: 'function', function: { name: 'set_parameter', description: 'Change a costing parameter by its id (see context.params). value null marks it "To confirm" (unpriced).',
      parameters: { type: 'object', additionalProperties: false, required: ['id', 'value'], properties: {
        id: { type: 'string' }, value: { type: ['number', 'string', 'null'] }, status: { type: 'string', enum: STATUS }, note: { type: 'string' } } } } },
    { type: 'function', function: { name: 'add_cost_line', description: 'Add an extra cost line. amount = qty x rate. basis "unit" = per impeller, "batch" = once per batch.',
      parameters: { type: 'object', additionalProperties: false, required: ['name', 'category', 'qty', 'unit', 'rate'], properties: {
        name: { type: 'string' }, category: { type: 'string', enum: OPS }, qty: { type: 'number' }, unit: { type: 'string' }, rate: { type: 'number', description: 'AUD per unit' },
        basis: { type: 'string', enum: ['unit', 'batch'] }, labour: { type: 'boolean', description: 'true if it is shop labour (attracts shop consumables %)' }, note: { type: 'string' }, status: { type: 'string', enum: STATUS } } } } },
    { type: 'function', function: { name: 'remove_cost_line', description: 'Remove an extra cost line by its id (context.extraLines).',
      parameters: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } } } },
    { type: 'function', function: { name: 'update_component', description: 'Change a component field. field is one of qty, grade, thk, yieldPct, holes, holeCut, welded, status, note, or dims.<key> (e.g. dims.OD).',
      parameters: { type: 'object', additionalProperties: false, required: ['component_id', 'field', 'value'], properties: {
        component_id: { type: 'string' }, field: { type: 'string' }, value: { type: ['number', 'string', 'boolean', 'null'] } } } } },
    { type: 'function', function: { name: 'update_weld', description: 'Change a weld field: type (fillet|fullpen), leg, thk, lenEach, count, sides, status, note.',
      parameters: { type: 'object', additionalProperties: false, required: ['weld_id', 'field', 'value'], properties: {
        weld_id: { type: 'string' }, field: { type: 'string' }, value: { type: ['number', 'string', 'null'] } } } } },
    { type: 'function', function: { name: 'explain', description: 'Answer a question about the quote without changing anything. Use for "why", "what is driving the cost" etc.',
      parameters: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } } } }
  ];
  const CHAT_PROMPT = `You are the costing assistant inside Josh Tilley's impeller quoting app (Australia, AUD, prices ex GST unless stated).
You change the quote ONLY through the tools. Rules:
- Use exact parameter ids from context.params. "Welding rate" = weld_rate, "labour rate" = labour_rate, "machining rate" = mach_rate, etc.
- To add a new cost, use add_cost_line (basis "unit" unless it is clearly a one-off for the whole batch). If the item already exists as a parameter (e.g. pickling, NDT, balancing, coating), prefer set_parameter on that parameter so nothing is double counted, and say which you changed.
- Never price an unknown as zero. If something is unknown, set it to null (To confirm) or ask.
- For questions, use explain or just reply; base answers on context.cost (largest lines first). Be brief and concrete with dollar figures.
- After making changes, reply with one or two short sentences summarising what changed.`;

  async function chat(history, context, s, applyTool) {
    const messages = [{ role: 'system', content: CHAT_PROMPT + '\n\nCurrent quote context (JSON):\n' + JSON.stringify(context) }].concat(history);
    const usage = { prompt: 0, completion: 0, model: '' };
    let explained = [];
    for (let round = 0; round < 4; round++) {
      const req = { model: s.model, messages, tools: TOOLS, tool_choice: 'auto', max_completion_tokens: 3000 };
      // GPT-5.x models only allow function tools on chat/completions with reasoning off.
      if (/^gpt-5/i.test(s.model || '')) req.reasoning_effort = 'none';
      const json = await call(req, s);
      const u = usageOf(json); usage.prompt += u.prompt; usage.completion += u.completion; usage.model = u.model;
      const msg = json.choices[0].message || {};
      const calls = (msg.tool_calls || []).filter(c => c.type === 'function');
      if (!calls.length) return { reply: msg.content || msg.refusal || explained.join('\n') || '(no reply)', usage, explained };
      messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });
      for (const c of calls) {
        let args = {}, result;
        try { args = JSON.parse(c.function.arguments || '{}'); } catch (_) { result = { ok: false, error: 'Arguments were not valid JSON' }; }
        if (!result) {
          if (c.function.name === 'explain') { explained.push(String(args.text || '')); result = { ok: true }; }
          else { try { result = applyTool(c.function.name, args); } catch (err) { result = { ok: false, error: String(err.message || err) }; } }
        }
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
      }
    }
    return { reply: explained.join('\n') || 'Done.', usage, explained };
  }

  const api = { extract, chat, call, SCHEMA, TOOLS, OPS, AIError, ENDPOINT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IQAI = api;
})(this);
