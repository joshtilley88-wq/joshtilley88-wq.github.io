/* Impeller Quoter: default parameters and the MVW-360-27 example.
 * EVERY RATE HERE IS AN EXAMPLE PLACEHOLDER (AUD). Replace with your own
 * supplier quotes and measured workshop times before issuing a firm price.
 * status: 'confirmed' | 'provisional' | 'to_confirm'
 * value null means "To confirm" and is NOT priced (never treated as zero). */
(function (root) {
  'use strict';
  const G = {
    commercial: 'Commercial and batch',
    material: 'Material (density and price)',
    engineering: 'Engineering and one-off setup',
    cutting: 'Cutting and preparation',
    forming: 'Rolling and forming',
    machining: 'Hub machining',
    fitup: 'Fit-up and tack',
    welding: 'Welding',
    finishing: 'Distortion, finishing and stainless treatment',
    quality: 'Inspection and balancing',
    coating: 'Coating, packing and freight',
    consumables: 'Consumables'
  };
  const P = (group, id, label, value, unit, status, note) => ({ group, id, label, value, unit, status, note });
  const EX = 'Example placeholder rate';
  const PARAMS = [
    // Commercial
    P('commercial', 'batch_qty', 'Batch quantity', 1, 'off', 'confirmed', 'From drawing: 1-OFF. One-off costs are spread over this quantity.'),
    P('commercial', 'labour_rate', 'Fabrication labour rate', 95, '$/hr', 'provisional', EX + '. State whether it includes overhead (if so set overhead to 0).'),
    P('commercial', 'overhead_pct', 'Overhead allocation', 15, '%', 'provisional', 'Applied to direct cost. Set to 0 if your hourly rates already include overhead.'),
    P('commercial', 'contingency_pct', 'Contingency', 5, '%', 'provisional', 'Covers identified uncertainty only; it must not hide missing scope.'),
    P('commercial', 'pricing_method', 'Pricing method', 'markup', 'markup|margin', 'provisional', 'markup: price = cost x (1 + m). margin: price = cost / (1 - g).'),
    P('commercial', 'markup_pct', 'Markup on cost', 20, '%', 'provisional', 'Used when pricing method = markup. Example: $100 cost + 20% = $120.'),
    P('commercial', 'margin_pct', 'Target gross margin', 20, '%', 'provisional', 'Used when pricing method = margin. Example: $100 cost at 20% margin = $125.'),
    P('commercial', 'gst_pct', 'GST', 10, '%', 'confirmed', 'Australian GST, shown separately on the quote.'),
    // Material
    P('material', 'dens_304', 'Density 304 stainless', 7900, 'kg/m³', 'provisional', 'Typical handbook value.'),
    P('material', 'dens_316', 'Density 316 stainless', 8000, 'kg/m³', 'provisional', 'Typical handbook value.'),
    P('material', 'dens_2205', 'Density SAF 2205 duplex', 7800, 'kg/m³', 'provisional', 'Typical handbook value.'),
    P('material', 'dens_ms', 'Density mild steel (250/350)', 7850, 'kg/m³', 'provisional', 'Method doc value for mass estimating.'),
    P('material', 'price_plate_304', '304 plate price', 7.0, '$/kg', 'provisional', EX + '. Get a supplier quote (grade, size, finish, freight).'),
    P('material', 'price_plate_316', '316 plate price', 9.0, '$/kg', 'provisional', EX + '.'),
    P('material', 'price_plate_2205', 'SAF 2205 plate price', 12.0, '$/kg', 'provisional', EX + '. Duplex is often a minimum-order item; check availability.'),
    P('material', 'price_plate_ms', 'Mild steel plate price', 2.5, '$/kg', 'provisional', EX + '.'),
    P('material', 'price_bar_304', '304 round bar price (hub)', 9.0, '$/kg', 'provisional', EX + '. Hub blank cut from solid bar.'),
    P('material', 'price_bar_316', '316 round bar price', 11.0, '$/kg', 'provisional', EX + '.'),
    P('material', 'price_bar_2205', '2205 round bar price', 15.0, '$/kg', 'provisional', EX + '.'),
    P('material', 'price_bar_ms', 'Mild steel bar price', 3.0, '$/kg', 'provisional', EX + '.'),
    P('material', 'plate_yield_pct', 'Default plate yield (net/gross)', 75, '%', 'provisional', 'Used when a component has no yield of its own. Not a universal waste rule; replace with a real nest.'),
    P('material', 'bar_allow_mm', 'Hub bar machining allowance', 5, 'mm/side', 'provisional', 'Added to bar OD (each side) and length (each end) for the hub blank.'),
    P('material', 'material_certs', 'Material certificates (3.1)', null, '$/batch', 'to_confirm', 'Not specified on drawing. To confirm whether mill certs are required.'),
    // Engineering
    P('engineering', 'eng_rate', 'Engineering/drafting rate', 110, '$/hr', 'provisional', EX + '.'),
    P('engineering', 'eng_hours', 'Drawing review, flat patterns, nesting', 4, 'hr/batch', 'provisional', 'One-off. Includes cone/eye development and weld map.'),
    P('engineering', 'cnc_prog_hours', 'CNC programming', 1, 'hr/batch', 'provisional', 'One-off.'),
    P('engineering', 'fixture_cost', 'Assembly fixture / blade spacing template', 300, '$/batch', 'provisional', 'One-off. Confirm tooling ownership for repeats.'),
    // Cutting
    P('cutting', 'cut_rate_le3', 'Cut rate t ≤ 3 mm', 2.8, '$/m', 'provisional', EX + ' (laser/plasma, stainless).'),
    P('cutting', 'cut_rate_le5', 'Cut rate 3 < t ≤ 5 mm', 4.0, '$/m', 'provisional', EX + '.'),
    P('cutting', 'cut_rate_le8', 'Cut rate 5 < t ≤ 8 mm', 4.8, '$/m', 'provisional', EX + '.'),
    P('cutting', 'cut_rate_gt8', 'Cut rate t > 8 mm', 7.0, '$/m', 'provisional', EX + '.'),
    P('cutting', 'pierce_cost', 'Pierce charge', 0.6, '$/pierce', 'provisional', EX + '.'),
    P('cutting', 'cut_setup', 'Cutting setup / minimum charge', 60, '$/batch', 'provisional', 'One-off per batch.'),
    P('cutting', 'deburr_hr_per_part', 'Deburr, identify, edge prep', 0.05, 'hr/part', 'provisional', 'Per cut part, at fabrication labour rate.'),
    // Forming
    P('forming', 'roll_setup_hr', 'Rolling setup', 1.0, 'hr/batch', 'provisional', 'One-off; includes first-off trial.'),
    P('forming', 'cone_roll_hr', 'Roll and close cone shroud', 1.5, 'hr/piece', 'provisional', 'Cone rolling is not priced by area alone (grade, thickness, rise).'),
    P('forming', 'eye_roll_hr', 'Roll and close eye ring', 0.75, 'hr/piece', 'provisional', ''),
    P('forming', 'blade_form_hr', 'Form blades', 0, 'hr/blade', 'provisional', 'Blades drawn straight (flat) in plan, so no forming assumed. Change if curved.'),
    // Machining
    P('machining', 'mach_rate', 'Machining rate', 120, '$/hr', 'provisional', EX + '.'),
    P('machining', 'hub_setup_hr', 'Hub machining setup', 1.0, 'hr/batch', 'provisional', 'One-off.'),
    P('machining', 'hub_turn_hr', 'Turn hub OD, step and faces, pilot bore', 1.5, 'hr/hub', 'provisional', ''),
    P('machining', 'keyway_hr', 'Keyway (17.98–18.02 wide)', 0.75, 'hr/hub', 'provisional', 'Slot or broach. Confirm in-house or subcontract.'),
    P('machining', 'drill_tap_hr', 'Drill and tap (M10, M8 x 20 deep)', 0.25, 'hr/hub', 'provisional', ''),
    P('machining', 'post_weld_bore_hr', 'Finish bore Ø65 H6 after welding', 1.0, 'hr/hub', 'to_confirm', 'Pre-weld machining alone may not meet runout. Confirm route and datums.'),
    // Fit-up
    P('fitup', 'fit_base_hr', 'Assembly setup', 1.5, 'hr/unit', 'provisional', 'Locate hub and backplate, set up fixture.'),
    P('fitup', 'fit_hr_per_part', 'Fit and tack per welded part', 0.25, 'hr/part', 'provisional', 'Applies to each part marked "welded". Do not price assembly as arc time alone.'),
    // Welding
    P('welding', 'weld_rate', 'Welding labour rate', 95, '$/hr', 'provisional', EX + '.'),
    P('welding', 'weld_metal_density', 'Weld metal density', 7900, 'kg/m³', 'provisional', 'Stainless filler.'),
    P('welding', 'weld_dep_rate', 'Deposition rate', 1.0, 'kg/hr', 'provisional', 'GMAW/pulse on thin stainless. TIG is lower (about 0.5). Calibrate to your shop.'),
    P('welding', 'weld_profile_factor', 'Weld profile / overweld factor', 1.3, 'x', 'provisional', 'Allowance for convexity and starts over theoretical a²/2.'),
    P('welding', 'weld_op_factor', 'Operator factor (arc-on fraction)', 0.3, 'fraction', 'provisional', 'Total weld hours = arc hours ÷ operator factor (covers repositioning, cleaning, interpass).'),
    P('welding', 'fullpen_hr_per_m', 'Full-penetration / butt weld time', 1.2, 'hr/m', 'provisional', 'Thin-wall TIG incl. back purge and prep. Handled separately from fillets.'),
    // Finishing
    P('finishing', 'distortion_hr', 'Distortion correction / runout check', 2.0, 'hr/unit', 'provisional', 'Requires shop history; provisional amount.'),
    P('finishing', 'dressing_hr', 'Weld dressing, spatter removal, cleaning', 1.5, 'hr/unit', 'provisional', 'Grinding every weld flush is NOT assumed.'),
    P('finishing', 'pickle_rate', 'Pickling and passivation', 45, '$/m²', 'provisional', 'Stainless only. Surface area = both faces of plate parts.'),
    P('finishing', 'pickle_min', 'Pickling minimum lot charge', 250, '$/batch', 'provisional', 'The higher of area x rate or the minimum is used.'),
    // Quality
    P('quality', 'insp_hr', 'Dimensional + visual inspection (AS1554.6 GP)', 1.5, 'hr/unit', 'provisional', 'Visual weld inspection to GP category.'),
    P('quality', 'ndt_cost', 'NDT (dye penetrant etc.)', null, '$/unit', 'to_confirm', 'Not specified on drawing. Not priced until confirmed.'),
    P('quality', 'balance_cost', 'Balancing allowance', 350, '$/unit', 'to_confirm', 'PROVISIONAL ALLOWANCE: no balance grade, speed or method on the drawing.'),
    P('quality', 'balance_freight', 'Freight to/from balancer', 80, '$/batch', 'to_confirm', 'Only if balancing is subcontracted.'),
    // Coating, packing
    P('coating', 'coating_cost', 'Coating / paint system', null, '$/unit', 'to_confirm', 'No coating specified (stainless). Not priced; listed as an exclusion until confirmed.'),
    P('coating', 'packing_cost', 'Packing / crate', 150, '$/unit', 'provisional', 'Protect bore and machined faces.'),
    P('coating', 'freight_cost', 'Freight to customer', 180, '$/batch', 'to_confirm', 'Destination not known. Placeholder.'),
    // Consumables
    P('consumables', 'filler_price', 'Filler wire (e.g. 309L/2209)', 30, '$/kg', 'provisional', 'Dissimilar 2205 to 304 joints need a suitable filler; confirm WPS.'),
    P('consumables', 'gas_per_weld_hr', 'Shielding/purge gas', 8, '$/weld hr', 'provisional', ''),
    P('consumables', 'shop_consumables_pct', 'Shop consumables (discs, paste, wire brushes)', 5, '% of labour', 'provisional', 'Percentage of direct labour cost.')
  ];

  const GRADES = {
    '304': { label: '304 stainless', stainless: true },
    '316': { label: '316 stainless', stainless: true },
    '2205': { label: 'SAF 2205 duplex', stainless: true },
    'ms': { label: 'Mild steel', stainless: false }
  };

  const SHAPES = {
    disc: { label: 'Disc / ring', dims: [['OD', 'OD mm'], ['ID', 'ID mm (centre hole)']] },
    cone: { label: 'Cone frustum (shroud)', dims: [['Do', 'Outer Ø neutral mm'], ['Di', 'Inner Ø neutral mm'], ['H', 'Axial rise mm'], ['alpha', 'or slope ° from radial plane']] },
    cylinder: { label: 'Cylinder / eye ring', dims: [['ID', 'ID mm'], ['W', 'Axial width mm']] },
    rect: { label: 'Rectangle', dims: [['L', 'Length mm'], ['W', 'Width mm']] },
    trapezoid: { label: 'Trapezoid (blade / gusset)', dims: [['L', 'Length mm'], ['W1', 'Width end 1 mm'], ['W2', 'Width end 2 mm']] },
    bar: { label: 'Turned bar (hub)', dims: [['OD', 'OD mm'], ['L', 'Overall length mm'], ['ID', 'Finished bore mm'], ['SD', 'Step Ø mm'], ['SL', 'Step length mm']] },
    custom: { label: 'Custom (area or mass)', dims: [['A', 'Area mm²'], ['M', 'or mass kg each'], ['C', 'Cut length mm']] }
  };

  // MVW-360-27 Rev 0, read from the drawing. Status per row reflects how sure the reading is.
  function example() {
    return {
      meta: {
        drawingNo: 'MVW-360-27', rev: '0', title: 'Impeller assembly, MVW 360 fan, ACW rotation',
        customer: 'Aerotech Fans', rotation: 'ACW', drawingQty: 1, drawingMass: 58,
        weldStd: 'AS1554 Part 6 1994 GP', balance: 'Not specified', coating: 'Not specified',
        scope: 'Supply 1-off fabricated impeller assembly to drawing MVW-360-27 Rev 0, ACW rotation: backplate, conical shroud with eye, 12 blades, 6 gussets, machined hub, lock washer and locking tab. Welded to AS1554.6 GP.',
        quoteRef: '', notes: 'Drawing is NTS. Section A dimensions used as stated; shroud/eye geometry partly REF.'
      },
      components: [
        C('backplate', 'Backplate', 1, '304', 6, 'disc', { OD: 922, ID: 115 }, 75, 0, 0, true, 'confirmed', 'Ø922 x 6 PL 304. Centre hole assumed Ø115 to suit hub step (to confirm).', { ID: 'to_confirm' }),
        C('shroud', 'Conical shroud', 1, '304', 3, 'cone', { Do: 922, Di: 510, H: 30, alpha: null }, 60, 0, 0, true, 'provisional', '3 PL 304. OD taken as Ø922 (matches backplate), inner Ø510 REF at eye joint, axial rise 30 from section A. Drawing is NTS.', { Do: 'to_confirm', H: 'to_confirm' }),
        C('eye', 'Eye ring (inlet)', 1, '304', 3, 'cylinder', { ID: 506, W: 20 }, 85, 0, 0, true, 'provisional', 'Ø506 ID x 3 thk; width 20 REF from section A. Full-penetration weld to shroud.', { W: 'to_confirm' }),
        C('blades', 'Blades', 12, '2205', 5, 'trapezoid', { L: 270, W1: 76, W2: 57 }, 80, 0, 0, true, 'provisional', '5 PL SAF 2205, 12-off equally spaced, straight, tip R457 / heel R260, 270 long, 30° shown. Height 76 at heel to 57 at tip from section A.', { W1: 'to_confirm', W2: 'to_confirm' }),
        C('gussets', 'Hub gussets', 6, '304', 6, 'trapezoid', { L: 95, W1: 61, W2: 10 }, 80, 0, 0, true, 'confirmed', '6 PL 304, 95 high x 61 base, 10 toe.', {}),
        C('hub', 'Hub', 1, '304', null, 'bar', { OD: 120, L: 81, ID: 65, SD: 115, SL: 12 }, null, 0, 0, true, 'confirmed', '304, Ø120 x 81 OAL, Ø115 step (81 − 69 = 12 long), pilot bore Ø55, finish bore Ø65 H6, keyway 17.98–18.02, 69.4–69.6 over key. Drill & tap M10; M8 x 20 deep.', {}),
        C('washer', 'Lock washer', 1, '304', 6, 'disc', { OD: 110, ID: 0 }, 70, 2, 81.7, false, 'confirmed', '6 PL 304 Ø110 with Ø17 and Ø9 holes at 45 centres. Loose part.', {}),
        C('tab', 'Locking tab', 1, '304', 1, 'rect', { L: 95, W: 50 }, 70, 2, 81.7, false, 'provisional', '1.0 PL 304, 65 + 30 long x 50 wide (20 wide ends), Ø17 and Ø9 holes. Area approximated as a rectangle.', {})
      ],
      welds: [
        W('w_blade', 'Blades to backplate and shroud', 'fillet', 3, null, 270, 24, 2, 'provisional', '3 mm fillet, all round symbol: 12 blades x 2 joints (backplate + shroud) x both sides x 270.'),
        W('w_hub', 'Hub to backplate', 'fillet', 4, null, 369.1, 2, 1, 'provisional', '4 mm fillet both sides: Ø120 front (377) + Ø115 back (361), averaged as 2 x 369.'),
        W('w_gusset', 'Gussets to hub and backplate', 'fillet', 4, null, 156, 6, 2, 'provisional', '4 mm fillet: (95 + 61) per gusset x both sides x 6-off.'),
        W('w_eye', 'Shroud to eye joint', 'fullpen', null, 3, 1602, 1, 1, 'confirmed', 'FULL PENETRATION WELD AT JOINT: π x 510 = 1602 mm.'),
        W('w_seams', 'Cone and eye closing seams', 'fullpen', null, 3, 228, 1, 1, 'provisional', 'Assumed one seam each (cone slant 208 + eye 20). Not shown on drawing; depends on nest.')
      ],
      extraLines: []
    };
  }
  function C(id, name, qty, grade, thk, shape, dims, yieldPct, holes, holeCut, welded, status, note, conf) {
    return { id, name, qty, grade, thk, shape, dims, yieldPct, holes, holeCut, welded, status, note, conf: conf || {} };
  }
  function W(id, desc, type, leg, thk, lenEach, count, sides, status, note) {
    return { id, desc, type, leg, thk, lenEach, count, sides, status, note };
  }

  const EXCLUSIONS = [
    'Casing, motor, shaft, bearings, fasteners not drawn, and fan performance or overspeed testing.',
    'Design verification, structural checks and engineering changes to the drawing.',
    'Any item marked "To confirm" with no value (see the assumption register); these are not included in the price.',
    'Delivery outside the freight allowance stated; site work and installation.',
    'Witness inspections and documentation beyond a basic dimensional report unless listed.'
  ];

  const api = { GROUPS: G, PARAMS, GRADES, SHAPES, example, EXCLUSIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IQDefaults = api;
})(this);
