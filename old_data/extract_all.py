#!/usr/bin/env python3
import json
TARGETS = ['Items', 'Item_Barcodes', 'Item_Stock', 'Categories', 'SubCategories', 'Colors', 'Stores', 'Item_Types', 'Price_Types', 'Sales_Reps', 'Item_Packages', 'Clients']
src = open('extract3.py').read().split("if __name__ == '__main__'")[0]
exec(src)
objects = json.load(open('sys_objects.json'))
byname = {o['name']: o['id'] for o in objects if o['xtype'] == 'U'}
for t in TARGETS:
    oid = byname.get(t)
    rows = parse_table(oid) if oid else []
    json.dump(rows, open(f'table_{t}.json', 'w'), ensure_ascii=False)
    print(t, len(rows), "rows", flush=True)
import sys; sys.exit(0)
# old code below disabled
import mmap, struct, json, datetime, sys

TARGETS = sys.argv[1:] or ['Items', 'Item_Barcodes', 'Item_Stock', 'Categories', 'SubCategories', 'Colors', 'Stores', 'Item_Types', 'Price_Types', 'Sales_Reps', 'Item_Packages']

objects = json.load(open('sys_objects.json'))
columns = json.load(open('sys_columns.json'))
byname = {o['name']: o['id'] for o in objects if o['xtype'] == 'U'}
ids = {}
for t in TARGETS:
    if t in byname:
        ids[byname[t]] = t
print("targets:", ids, flush=True)

src = open('extract3.py').read()
src = src.replace("TARGETS_PLACEHOLDER", "")
exec(src.split("if __name__ == '__main__'")[0])

colmaps = {}
for oid, name in ids.items():
    cols = columns.get(str(oid), []) if isinstance(columns, dict) else []
    colmaps[oid] = cols

def fixed_len_g(col):
    if col['type'] == 'gap': return col['length']
    return fixed_len(col)

out = {name: [] for oid, name in ids.items()}
# تحديد الأعمدة المحذوفة مسبقًا لكل جدول باستخدام أول سجل
prep = {}
for oid, name in ids.items():
    cols = colmaps[oid]
    if not cols:
        prep[oid] = None; continue
    maxcol = max(c['colid'] for c in cols)
    known = {c['colid'] for c in cols}
    gaps = [g for g in range(1, maxcol + 1) if g not in known]
    fk = [c for c in cols if str(c['type']) not in [str(x) for x in VARIABLE]]
    sample = next(iter_object_rows(oid), None)
    if sample is None:
        prep[oid] = None; continue
    known_fixed = sum(fixed_len(fk) for fk in [ [x for x in cols if x['type'] not in VARIABLE] ] or [[]])
    known_fixed = sum(fixed_len(x) for x in [c for c in cols if c['type'] not in VARIABLE])
    leftover = len(sample[2]) - known_fixed
    for g in gaps:
        ln = leftover // len(gaps)
        fk.append({'colid': g, 'type': 'gap', 'length': ln, 'name': f'_gap{g}'})
        leftover -= ln
    fixed_cols = sorted(fk, key=lambda c: c['colid'])
    var_cols = sorted([c for c in cols if c['type'] in VARIABLE], key=lambda c: c['colid'])
    prep[oid] = (fixed_cols, var_cols)

for tagA, tagB, fixed, ncols, nullmap, varcols_raw in iter_object_rows(list(ids.keys())):
    # iter_object_rows accepts single id; do manual dispatch instead
    pass

# dispatch loop
for oid, spec in prep.items():
    if spec is None: continue
    fixed_cols, var_cols = spec
    rows = out[ids[oid]]
    for tagA, tagB, fixed, ncols, nullmap, varcols_raw in iter_object_rows(oid):
        row = {}
        fpos = 0
        ok = True
        for c in fixed_cols:
            ln = c['type'] == 'gap' and c['length'] or fixed_len(c)
            if fpos + ln > len(fixed): ok = False; break
            raw = fixed[fpos:fpos + ln]
            fpos += ln
            if c['type'] == 'gap':
                row[c['name']] = int.from_bytes(raw, 'little') if ln <= 8 else raw.hex()
                continue
            idx = c['colid'] - 1
            if is_null(nullmap, idx): row[c['name']] = None
            else:
                v = decode_fixed(c['type'], raw, c['xprec'], c['xscale'])
                if isinstance(v, (bytes, bytearray)):
                    v = decode_var(c['type'], v) if c['type'] in (175, 173, 231) else v.hex()
                row[c['name']] = v
        if not ok: continue
        for vi, c in enumerate(var_cols):
            idx = c['colid'] - 1
            if is_null(nullmap, idx) or vi >= len(varcols_raw): row[c['name']] = None
            else: row[c['name']] = decode_var(c['type'], varcols_raw[vi])
        rows.append(row)

for oid, name in ids.items():
    rows = out[name]
    json.dump(rows, open(f'table_{name}.json', 'w'), ensure_ascii=False)
    print(name, len(rows), "rows", flush=True)
