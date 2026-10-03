/* Impeller Quoter costing engine. Pure functions, no DOM.
 * Formulas follow the "Process steps and assumption register" method doc:
 *  - plate net mass = area x thickness x density (metres)
 *  - eye: L = π·Dn, Dn = ID + t (or OD − t)
 *  - cone frustum: Δr = Ro − Ri, s = Δr/cos α (= √(Δr² + H²)), H = Δr·tan α,
 *    Rout = s·Ro/Δr, Rin = s·Ri/Δr, θ = 360·Δr/s, flat area = π(Ro + Ri)s
 *  - fillet: area a²/2, volume = area x length, deposit = volume x density,
 *    arc hours = deposit / deposition rate, weld hours = arc hours / operator factor
 *  - batch cost = one-off + qty x unit cost; markup: P = C(1+m); margin: P = C/(1−g)
 * A null input is "To confirm" and makes the line UNPRICED (never zero). */
(function (root) {
  'use strict';
  const PI = Math.PI;
  const num = v => (v === null || v === undefined || v === '' || !isFinite(+v)) ? null : +v;

  function gradeKey(g) {
    const s = String(g || '').toLowerCase();
    if (/2205|duplex/.test(s)) return '2205';
    if (/316/.test(s)) return '316';
    if (/304/.test(s)) return '304';
    if (/mild|\bms\b|^ms$|250|350|a36|carbon/.test(s)) return 'ms';
    return null;
  }

  function paramMap(params) {
    const m = {};
    params.forEach(p => { m[p.id] = p; });
    return m;
  }

  /* Geometry for one piece of a component. Returns nulls where inputs are missing. */
  function geom(c, P) {
    const d = c.dims || {};
    const t = num(c.thk);
    const g = { area: null, cut: null, pierces: 1, surface: null, netKg: null, grossKg: null, dev: null, missing: [] };
    const need = (k) => { const v = num(d[k]); if (v === null) g.missing.push(k); return v; };
    const gk = gradeKey(c.grade);
    const dens = gk ? num(P['dens_' + gk] && P['dens_' + gk].value) : null;
    if (!gk) g.missing.push('grade');
    switch (c.shape) {
      case 'disc': {
        const OD = need('OD'); const ID = num(d.ID) || 0;
        if (OD !== null) {
          g.area = PI / 4 * (OD * OD - ID * ID);
          g.cut = PI * (OD + ID); g.pierces = ID > 0 ? 2 : 1;
        }
        break;
      }
      case 'cone': {
        const Do = need('Do'), Di = need('Di');
        let H = num(d.H), a = num(d.alpha);
        if (H === null && a === null) g.missing.push('H or alpha');
        if (Do !== null && Di !== null && (H !== null || a !== null)) {
          const Ro = Do / 2, Ri = Di / 2, dr = Ro - Ri;
          if (dr > 0) {
            if (H === null) H = dr * Math.tan(a * PI / 180);
            if (a === null) a = Math.atan2(H, dr) * 180 / PI;
            const s = dr / Math.cos(a * PI / 180);
            const Rout = s * Ro / dr, Rin = s * Ri / dr, theta = 360 * dr / s;
            g.area = PI * (Ro + Ri) * s;
            const th = theta * PI / 180;
            g.cut = th * (Rout + Rin) + 2 * s; g.pierces = 1;
            g.dev = { Ro, Ri, dr, H, alpha: a, s, Rout, Rin, theta, missingWedge: 360 - theta,
              checkOuter: th * Rout - 2 * PI * Ro, checkInner: th * Rin - 2 * PI * Ri };
          } else g.missing.push('Do > Di');
        }
        break;
      }
      case 'cylinder': {
        const W = need('W'); let Dn = null;
        const ID = num(d.ID), OD = num(d.OD);
        if (t === null) g.missing.push('thk');
        if (ID !== null && t !== null) Dn = ID + t; else if (OD !== null && t !== null) Dn = OD - t;
        if (ID === null && OD === null) g.missing.push('ID');
        if (Dn !== null && W !== null) {
          const L = PI * Dn;
          g.area = L * W; g.cut = 2 * (L + W); g.pierces = 1;
          g.dev = { Dn, L, W };
        }
        break;
      }
      case 'rect': {
        const L = need('L'), W = need('W');
        if (L !== null && W !== null) { g.area = L * W; g.cut = 2 * (L + W); }
        break;
      }
      case 'trapezoid': {
        const L = need('L'), W1 = need('W1'), W2 = need('W2');
        if (L !== null && W1 !== null && W2 !== null) {
          g.area = L * (W1 + W2) / 2;
          g.cut = W1 + W2 + L + Math.hypot(L, W1 - W2);
        }
        break;
      }
      case 'bar': {
        const OD = need('OD'), L = need('L'); const ID = num(d.ID) || 0;
        const SD = num(d.SD), SL = num(d.SL) || 0;
        if (OD !== null && L !== null && dens !== null) {
          const main = L - (SD ? SL : 0);
          const vol = PI / 4 * ((OD * OD - ID * ID) * main + (SD ? (SD * SD - ID * ID) * SL : 0)); // mm³
          g.netKg = vol * 1e-9 * dens;
          const al = num(P.bar_allow_mm && P.bar_allow_mm.value) || 0;
          const bOD = OD + 2 * al, bL = L + 2 * al;
          g.grossKg = PI / 4 * bOD * bOD * bL * 1e-9 * dens;
          g.blank = { OD: bOD, L: bL };
          g.cut = 0; g.pierces = 0;
          g.surface = (PI * OD * main + PI * (SD || 0) * SL) / 1e6;
        }
        return g;
      }
      case 'custom': {
        const A = num(d.A), M = num(d.M);
        if (A !== null) g.area = A;
        else if (M !== null) { g.netKg = M; }
        else g.missing.push('A or M');
        g.cut = num(d.C) || 0;
        break;
      }
      default: g.missing.push('shape');
    }
    if (c.shape !== 'bar' && c.shape !== 'cylinder' && t === null && !(c.shape === 'custom' && num(d.M) !== null)) g.missing.push('thk');
    if (g.area !== null && g.netKg === null && t !== null && dens !== null) g.netKg = g.area * t * 1e-9 * dens;
    if (g.area !== null) g.surface = 2 * g.area / 1e6;
    if (g.cut !== null) { g.cut += num(c.holeCut) || 0; g.pierces += num(c.holes) || 0; }
    const y = num(c.yieldPct) !== null ? num(c.yieldPct) : num(P.plate_yield_pct && P.plate_yield_pct.value);
    if (g.netKg !== null && g.grossKg === null && y) g.grossKg = g.netKg / (y / 100);
    g.yieldUsed = y;
    return g;
  }

  function coneDevelop(Do, Di, H, alpha) {
    return geom({ shape: 'cone', thk: 1, grade: '304', dims: { Do, Di, H, alpha } }, { dens_304: { value: 7900 }, plate_yield_pct: { value: 100 } }).dev;
  }

  function cutRate(t, P) {
    if (t === null) return null;
    const id = t <= 3 ? 'cut_rate_le3' : t <= 5 ? 'cut_rate_le5' : t <= 8 ? 'cut_rate_le8' : 'cut_rate_gt8';
    return { id, v: num(P[id].value) };
  }

  /* Main compute. state = {params, components, welds, extraLines, meta} */
  function compute(state) {
    const P = paramMap(state.params);
    const v = id => (P[id] ? num(P[id].value) : null);
    const st = id => (P[id] ? P[id].status : 'to_confirm');
    const lines = [];
    const add = (o) => {
      const l = Object.assign({ basis: 'unit', status: 'provisional', refs: [], labour: false, note: '' }, o);
      if (l.amount === null || l.amount === undefined || !isFinite(l.amount)) { l.amount = null; l.unpriced = true; l.status = 'to_confirm'; }
      lines.push(l); return l;
    };
    const worst = (...ids) => {
      const ss = ids.map(i => typeof i === 'string' && P[i] ? P[i].status : i);
      return ss.includes('to_confirm') ? 'to_confirm' : ss.includes('provisional') ? 'provisional' : 'confirmed';
    };
    const mul = (...xs) => xs.some(x => x === null || x === undefined) ? null : xs.reduce((a, b) => a * b, 1);
    const Q = Math.max(1, Math.round(v('batch_qty') || 1));
    const labour = v('labour_rate');

    // ---- components: material + cutting
    const comps = (state.components || []).map(c => ({ c, g: geom(c, P) }));
    let netMass = 0, massMissing = [], cutParts = 0, weldedParts = 0, stainlessArea = 0, anyStainless = false;
    comps.forEach(({ c, g }) => {
      const q = num(c.qty) || 0;
      const gk = gradeKey(c.grade);
      const isBar = c.shape === 'bar';
      const priceId = gk ? (isBar ? 'price_bar_' : 'price_plate_') + gk : null;
      const price = priceId ? v(priceId) : null;
      if (g.netKg !== null) netMass += g.netKg * q; else massMissing.push(c.name);
      if (c.welded) weldedParts += q;
      if (gk && gk !== 'ms') { anyStainless = true; if (g.surface !== null) stainlessArea += g.surface * q; }
      const cs = worst(c.status || 'provisional', priceId || 'to_confirm', gk ? 'dens_' + gk : 'to_confirm', Object.values(c.conf || {}).includes('to_confirm') ? 'to_confirm' : 'confirmed');
      add({ op: 'Material', comp: c.id,
        desc: `${c.name} ${q}× ${gk ? (gk === 'ms' ? 'MS' : gk) : '?'} ${isBar ? 'bar' : (num(c.thk) !== null ? c.thk + ' mm' : '? mm')}` +
          (g.netKg !== null ? `: net ${fmt(g.netKg * q, 2)} kg, gross ${g.grossKg !== null ? fmt(g.grossKg * q, 2) : '?'} kg` : '') +
          (isBar && g.blank ? ` (blank Ø${fmt(g.blank.OD, 0)} × ${fmt(g.blank.L, 0)})` : (g.yieldUsed ? ` @ ${g.yieldUsed}% yield` : '')),
        qty: g.grossKg !== null ? g.grossKg * q : null, unit: 'kg', rate: price,
        amount: g.grossKg !== null ? mul(g.grossKg * q, price) : null,
        status: cs, refs: [priceId].filter(Boolean), missing: g.missing });
      if (!isBar && c.shape !== 'custom' || (c.shape === 'custom' && g.cut)) {
        const cr = cutRate(num(c.thk), P);
        const cutM = g.cut !== null ? g.cut * q / 1000 : null;
        const pc = v('pierce_cost');
        add({ op: 'Cutting', comp: c.id, desc: `Cut ${c.name}: ${cutM !== null ? fmt(cutM, 2) : '?'} m + ${g.pierces * q} pierces`,
          qty: cutM, unit: 'm', rate: cr ? cr.v : null,
          amount: (cutM !== null && cr && cr.v !== null && pc !== null) ? cutM * cr.v + g.pierces * q * pc : null,
          status: worst(cr ? cr.id : 'to_confirm', 'pierce_cost'), refs: [cr && cr.id, 'pierce_cost'].filter(Boolean) });
        cutParts += q;
      }
    });
    add({ op: 'Cutting', desc: `Deburr, identify and edge prep (${cutParts} parts)`, qty: cutParts * (v('deburr_hr_per_part') ?? NaN), unit: 'hr', rate: labour,
      amount: mul(cutParts, v('deburr_hr_per_part'), labour), labour: true, status: worst('deburr_hr_per_part', 'labour_rate'), refs: ['deburr_hr_per_part', 'labour_rate'] });

    // ---- engineering & one-off setup (batch)
    const er = v('eng_rate');
    add({ op: 'Engineering & setup', basis: 'batch', desc: 'Drawing review, development, nesting, weld map', qty: v('eng_hours'), unit: 'hr', rate: er, amount: mul(v('eng_hours'), er), status: worst('eng_hours', 'eng_rate'), refs: ['eng_hours', 'eng_rate'] });
    add({ op: 'Engineering & setup', basis: 'batch', desc: 'CNC programming', qty: v('cnc_prog_hours'), unit: 'hr', rate: er, amount: mul(v('cnc_prog_hours'), er), status: worst('cnc_prog_hours', 'eng_rate'), refs: ['cnc_prog_hours', 'eng_rate'] });
    add({ op: 'Engineering & setup', basis: 'batch', desc: 'Assembly fixture / blade spacing template', qty: 1, unit: 'lot', rate: v('fixture_cost'), amount: v('fixture_cost'), status: st('fixture_cost'), refs: ['fixture_cost'] });
    add({ op: 'Engineering & setup', basis: 'batch', desc: 'Cutting setup / minimum charge', qty: 1, unit: 'lot', rate: v('cut_setup'), amount: v('cut_setup'), status: st('cut_setup'), refs: ['cut_setup'] });
    add({ op: 'Material', basis: 'batch', desc: 'Material certificates', qty: 1, unit: 'lot', rate: v('material_certs'), amount: v('material_certs'), status: st('material_certs'), refs: ['material_certs'] });

    // ---- forming
    const cones = comps.filter(x => x.c.shape === 'cone').reduce((a, x) => a + (num(x.c.qty) || 0), 0);
    const eyes = comps.filter(x => x.c.shape === 'cylinder').reduce((a, x) => a + (num(x.c.qty) || 0), 0);
    const blades = comps.filter(x => /blade/i.test(x.c.name)).reduce((a, x) => a + (num(x.c.qty) || 0), 0);
    if (cones + eyes > 0) add({ op: 'Rolling & forming', basis: 'batch', desc: 'Rolling setup and first-off trial', qty: v('roll_setup_hr'), unit: 'hr', rate: labour, amount: mul(v('roll_setup_hr'), labour), labour: true, status: worst('roll_setup_hr', 'labour_rate'), refs: ['roll_setup_hr', 'labour_rate'] });
    if (cones) add({ op: 'Rolling & forming', desc: `Roll and close cone shroud (${cones})`, qty: mul(cones, v('cone_roll_hr')), unit: 'hr', rate: labour, amount: mul(cones, v('cone_roll_hr'), labour), labour: true, status: worst('cone_roll_hr', 'labour_rate'), refs: ['cone_roll_hr', 'labour_rate'] });
    if (eyes) add({ op: 'Rolling & forming', desc: `Roll and close eye ring (${eyes})`, qty: mul(eyes, v('eye_roll_hr')), unit: 'hr', rate: labour, amount: mul(eyes, v('eye_roll_hr'), labour), labour: true, status: worst('eye_roll_hr', 'labour_rate'), refs: ['eye_roll_hr', 'labour_rate'] });
    if (blades && v('blade_form_hr')) add({ op: 'Rolling & forming', desc: `Form blades (${blades})`, qty: mul(blades, v('blade_form_hr')), unit: 'hr', rate: labour, amount: mul(blades, v('blade_form_hr'), labour), labour: true, status: worst('blade_form_hr', 'labour_rate'), refs: ['blade_form_hr', 'labour_rate'] });

    // ---- hub machining
    const hubs = comps.filter(x => x.c.shape === 'bar').reduce((a, x) => a + (num(x.c.qty) || 0), 0);
    const mr = v('mach_rate');
    if (hubs) {
      add({ op: 'Hub machining', basis: 'batch', desc: 'Machining setup', qty: v('hub_setup_hr'), unit: 'hr', rate: mr, amount: mul(v('hub_setup_hr'), mr), labour: true, status: worst('hub_setup_hr', 'mach_rate'), refs: ['hub_setup_hr', 'mach_rate'] });
      [['hub_turn_hr', 'Turn OD, step, faces, pilot bore'], ['keyway_hr', 'Cut keyway'], ['drill_tap_hr', 'Drill and tap M10, M8'], ['post_weld_bore_hr', 'Finish bore H6 after welding']].forEach(([id, d]) =>
        add({ op: 'Hub machining', desc: `${d} (${hubs})`, qty: mul(hubs, v(id)), unit: 'hr', rate: mr, amount: mul(hubs, v(id), mr), labour: true, status: worst(id, 'mach_rate'), refs: [id, 'mach_rate'] }));
    }

    // ---- fit-up
    add({ op: 'Fit-up & tack', desc: 'Assembly setup, locate hub and backplate', qty: v('fit_base_hr'), unit: 'hr', rate: labour, amount: mul(v('fit_base_hr'), labour), labour: true, status: worst('fit_base_hr', 'labour_rate'), refs: ['fit_base_hr', 'labour_rate'] });
    add({ op: 'Fit-up & tack', desc: `Fit and tack ${weldedParts} welded parts`, qty: mul(weldedParts, v('fit_hr_per_part')), unit: 'hr', rate: labour, amount: mul(weldedParts, v('fit_hr_per_part'), labour), labour: true, status: worst('fit_hr_per_part', 'labour_rate'), refs: ['fit_hr_per_part', 'labour_rate'] });

    // ---- welding
    const wr = v('weld_rate'), wd = v('weld_metal_density'), dep = v('weld_dep_rate'), pf = v('weld_profile_factor'), of = v('weld_op_factor'), fp = v('fullpen_hr_per_m');
    let depositKg = 0, weldHrs = 0, weldMissing = false;
    const weldRows = (state.welds || []).map(w => {
      const L = mul(num(w.lenEach), num(w.count), num(w.sides));
      const r = { w, L, kg: null, arc: null, hrs: null };
      if (w.type === 'fillet') {
        const a = num(w.leg);
        if (a !== null && L !== null && wd !== null) {
          r.vol = a * a / 2 * L; r.kg = r.vol * 1e-9 * wd;
          if (dep && pf !== null && of) { r.arc = r.kg * pf / dep; r.hrs = r.arc / of; }
        }
      } else {
        const t = num(w.thk);
        if (L !== null && fp !== null) r.hrs = L / 1000 * fp;
        if (L !== null && t !== null && wd !== null) r.kg = t * t * L * 1e-9 * wd; // approx. groove + reinforcement ~ t²
      }
      if (r.kg !== null) depositKg += r.kg; else weldMissing = true;
      if (r.hrs !== null) weldHrs += r.hrs;
      add({ op: 'Welding', desc: `${w.desc}: ${w.type === 'fillet' ? (num(w.leg) ?? '?') + ' mm fillet' : 'full pen. ' + (num(w.thk) ?? '?') + ' mm'}, ${L !== null ? fmt(L / 1000, 2) : '?'} m` +
          (r.kg !== null && w.type === 'fillet' ? `, ${fmt(r.kg, 3)} kg deposit, arc ${fmt(r.arc, 2)} h` : ''),
        qty: r.hrs, unit: 'hr', rate: wr, amount: mul(r.hrs, wr), labour: true,
        status: worst(w.status || 'provisional', 'weld_rate', w.type === 'fillet' ? 'weld_dep_rate' : 'fullpen_hr_per_m'),
        refs: ['weld_rate', w.type === 'fillet' ? 'weld_dep_rate' : 'fullpen_hr_per_m'] });
      return r;
    });

    // ---- finishing
    add({ op: 'Finishing', desc: 'Distortion correction and runout check', qty: v('distortion_hr'), unit: 'hr', rate: labour, amount: mul(v('distortion_hr'), labour), labour: true, status: worst('distortion_hr', 'labour_rate'), refs: ['distortion_hr', 'labour_rate'] });
    add({ op: 'Finishing', desc: 'Weld dressing, spatter removal, cleaning', qty: v('dressing_hr'), unit: 'hr', rate: labour, amount: mul(v('dressing_hr'), labour), labour: true, status: worst('dressing_hr', 'labour_rate'), refs: ['dressing_hr', 'labour_rate'] });
    if (anyStainless) {
      const byArea = mul(stainlessArea * Q, v('pickle_rate'));
      const amt = byArea === null || v('pickle_min') === null ? null : Math.max(byArea, v('pickle_min'));
      add({ op: 'Stainless treatment', basis: 'batch', desc: `Pickle and passivate ${fmt(stainlessArea * Q, 2)} m² (min. charge $${v('pickle_min') ?? '?'})`, qty: stainlessArea * Q, unit: 'm²', rate: v('pickle_rate'), amount: amt, status: worst('pickle_rate', 'pickle_min'), refs: ['pickle_rate', 'pickle_min'] });
    }
    // ---- quality
    add({ op: 'Inspection & balancing', desc: 'Dimensional + visual weld inspection', qty: v('insp_hr'), unit: 'hr', rate: labour, amount: mul(v('insp_hr'), labour), labour: true, status: worst('insp_hr', 'labour_rate'), refs: ['insp_hr', 'labour_rate'] });
    add({ op: 'Inspection & balancing', desc: 'NDT', qty: 1, unit: 'ea', rate: v('ndt_cost'), amount: v('ndt_cost'), status: st('ndt_cost'), refs: ['ndt_cost'] });
    add({ op: 'Inspection & balancing', desc: 'Balancing allowance (grade not specified)', qty: 1, unit: 'ea', rate: v('balance_cost'), amount: v('balance_cost'), status: st('balance_cost'), refs: ['balance_cost'] });
    add({ op: 'Inspection & balancing', basis: 'batch', desc: 'Freight to/from balancer', qty: 1, unit: 'lot', rate: v('balance_freight'), amount: v('balance_freight'), status: st('balance_freight'), refs: ['balance_freight'] });
    // ---- coating, packing, freight
    add({ op: 'Coating, packing & freight', desc: 'Coating', qty: 1, unit: 'ea', rate: v('coating_cost'), amount: v('coating_cost'), status: st('coating_cost'), refs: ['coating_cost'] });
    add({ op: 'Coating, packing & freight', desc: 'Packing / crate', qty: 1, unit: 'ea', rate: v('packing_cost'), amount: v('packing_cost'), status: st('packing_cost'), refs: ['packing_cost'] });
    add({ op: 'Coating, packing & freight', basis: 'batch', desc: 'Freight to customer', qty: 1, unit: 'lot', rate: v('freight_cost'), amount: v('freight_cost'), status: st('freight_cost'), refs: ['freight_cost'] });

    // ---- extra lines (manual or AI)
    (state.extraLines || []).forEach(x => {
      add({ op: x.category || 'Other', basis: x.basis === 'batch' ? 'batch' : 'unit', desc: x.name + (x.note ? ` (${x.note})` : ''), qty: num(x.qty), unit: x.unit || 'ea', rate: num(x.rate),
        amount: mul(num(x.qty), num(x.rate)), labour: !!x.labour, status: x.status || 'provisional', refs: [], extraId: x.id, source: x.source });
    });

    // ---- consumables (after labour is known)
    const labourUnit = lines.filter(l => l.labour && l.basis === 'unit' && l.amount !== null).reduce((a, l) => a + l.amount, 0);
    const labourBatch = lines.filter(l => l.labour && l.basis === 'batch' && l.amount !== null).reduce((a, l) => a + l.amount, 0);
    const fillerKg = pf !== null ? depositKg * pf : null;
    add({ op: 'Consumables', desc: `Filler wire ${fillerKg !== null ? fmt(fillerKg, 2) : '?'} kg`, qty: fillerKg, unit: 'kg', rate: v('filler_price'), amount: mul(fillerKg, v('filler_price')), status: st('filler_price'), refs: ['filler_price', 'weld_profile_factor'] });
    add({ op: 'Consumables', desc: `Shielding and purge gas (${fmt(weldHrs, 1)} weld hr)`, qty: weldHrs, unit: 'hr', rate: v('gas_per_weld_hr'), amount: mul(weldHrs, v('gas_per_weld_hr')), status: st('gas_per_weld_hr'), refs: ['gas_per_weld_hr'] });
    const scp = v('shop_consumables_pct');
    add({ op: 'Consumables', desc: `Shop consumables ${scp ?? '?'}% of labour (per unit)`, qty: labourUnit, unit: '$', rate: scp !== null ? scp / 100 : null, amount: scp !== null ? labourUnit * scp / 100 : null, status: st('shop_consumables_pct'), refs: ['shop_consumables_pct'] });
    if (labourBatch) add({ op: 'Consumables', basis: 'batch', desc: `Shop consumables ${scp ?? '?'}% of one-off labour`, qty: labourBatch, unit: '$', rate: scp !== null ? scp / 100 : null, amount: scp !== null ? labourBatch * scp / 100 : null, status: st('shop_consumables_pct'), refs: ['shop_consumables_pct'] });

    // ---- totals
    const priced = lines.filter(l => l.amount !== null);
    const unitSum = priced.filter(l => l.basis === 'unit').reduce((a, l) => a + l.amount, 0);
    const batchSum = priced.filter(l => l.basis === 'batch').reduce((a, l) => a + l.amount, 0);
    const direct = batchSum + Q * unitSum;
    const byOp = {};
    priced.forEach(l => { byOp[l.op] = (byOp[l.op] || 0) + (l.basis === 'unit' ? Q * l.amount : l.amount); });
    const oh = (v('overhead_pct') || 0) / 100 * direct;
    const cont = (v('contingency_pct') || 0) / 100 * (direct + oh);
    const cost = direct + oh + cont;
    const method = (P.pricing_method && P.pricing_method.value) === 'margin' ? 'margin' : 'markup';
    let price, profit, warn = [];
    if (method === 'margin') {
      const g = (v('margin_pct') || 0) / 100;
      if (g >= 1) { warn.push('Margin must be below 100%.'); price = null; }
      else price = cost / (1 - g);
    } else price = cost * (1 + (v('markup_pct') || 0) / 100);
    profit = price !== null ? price - cost : null;
    const gst = price !== null ? price * (v('gst_pct') || 0) / 100 : null;

    // ---- mass check
    const drawingMass = num(state.meta && state.meta.drawingMass);
    const calcMass = netMass + depositKg;
    const massDiffPct = drawingMass ? (calcMass - drawingMass) / drawingMass * 100 : null;
    if (massDiffPct !== null && Math.abs(massDiffPct) > 15) warn.push(`Calculated mass ${fmt(calcMass, 1)} kg differs from drawing mass ${drawingMass} kg by ${fmt(massDiffPct, 0)}%. Check thicknesses and dimensions.`);
    if (massMissing.length) warn.push('Mass incomplete, missing geometry for: ' + massMissing.join(', '));

    // ---- assumption register
    const register = [];
    state.params.forEach(p => {
      if (p.status !== 'confirmed' || num(p.value) === null && p.id !== 'pricing_method')
        register.push({ kind: 'Parameter', ref: p.id, item: p.label, value: p.value === null || p.value === '' ? 'To confirm' : `${p.value} ${p.unit}`, status: p.value === null ? 'to_confirm' : p.status, note: p.note });
    });
    comps.forEach(({ c, g }) => {
      const tc = Object.keys(c.conf || {}).filter(k => c.conf[k] === 'to_confirm');
      if (c.status !== 'confirmed' || tc.length || g.missing.length)
        register.push({ kind: 'Component', ref: c.id, item: c.name, value: (g.missing.length ? 'Missing: ' + g.missing.join(', ') + '. ' : '') + (tc.length ? 'Check: ' + tc.join(', ') : ''), status: (tc.length || g.missing.length) ? 'to_confirm' : c.status, note: c.note });
    });
    weldRows.forEach(r => {
      if (r.w.status !== 'confirmed' || r.hrs === null)
        register.push({ kind: 'Weld', ref: r.w.id, item: r.w.desc, value: r.L !== null ? fmt(r.L / 1000, 2) + ' m' : 'Length to confirm', status: r.hrs === null ? 'to_confirm' : r.w.status, note: r.w.note });
    });
    (state.extraLines || []).forEach(x => { if (x.status !== 'confirmed') register.push({ kind: 'Cost line', ref: x.id, item: x.name, value: `${x.qty} ${x.unit} @ $${x.rate}`, status: x.status || 'provisional', note: x.note || '' }); });

    return {
      Q, lines, unpriced: lines.filter(l => l.amount === null), unitSum, batchSum, direct, byOp,
      overhead: oh, contingency: cont, cost, method, price, profit, gst, priceInc: price !== null ? price + gst : null,
      unitPrice: price !== null ? price / Q : null, comps, weldRows, depositKg, weldHrs, netMass, calcMass, drawingMass, massDiffPct,
      stainlessArea, warnings: warn, register, weldMissing
    };
  }

  function fmt(n, d) { return n === null || n === undefined || !isFinite(n) ? '?' : Number(n).toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d }); }

  const api = { compute, geom, coneDevelop, gradeKey, paramMap, fmt, num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IQEngine = api;
})(this);
