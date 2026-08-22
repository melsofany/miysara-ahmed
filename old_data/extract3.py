#!/usr/bin/env python3
"""Extract syscolumns + systypes, then dump any table's rows."""
import mmap, struct, json, sys, datetime

f = open('old_db.bak', 'rb')
mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
BASE = 0x1a00
END = 0x14e81a00
PAGES = (END - BASE) // 0x2000

def page(n):
    o = BASE + n * 0x2000
    return mm[o:o + 0x2000]

def parse_record(pg, off):
    tagA = pg[off]; tagB = pg[off + 1]
    fsize = struct.unpack('<H', pg[off + 2:off + 4])[0]
    if fsize < 4 or off + fsize > 0x2000: return None
    fixed = bytes(pg[off + 4:off + fsize])
    pos = off + fsize
    if pos + 2 > 0x2000: return None
    ncols = struct.unpack('<H', pg[pos:pos + 2])[0]; pos += 2
    if ncols > 300: return None
    nb = (ncols + 7) // 8
    if pos + nb > 0x2000: return None
    nullmap = bytes(pg[pos:pos + nb]); pos += nb
    varcols = []
    if tagA & 0x20:
        if pos + 2 > 0x2000: return None
        nvar = struct.unpack('<H', pg[pos:pos + 2])[0]; pos += 2
        if nvar > 100 or pos + 2 * nvar > 0x2000: return None
        ends = [struct.unpack('<H', pg[pos + 2 * i:pos + 2 * i + 2])[0] for i in range(nvar)]
        pos += 2 * nvar
        start = pos - off
        for e in ends:
            if e < start or off + e > 0x2000: return None
            varcols.append(bytes(pg[off + start: off + e]))
            start = e
    return tagA, tagB, fixed, ncols, nullmap, varcols

def iter_object_rows(objid):
    for n in range(PAGES):
        pg = page(n)
        if pg[0] != 1 or pg[1] != 1 or pg[3] != 0: continue
        if int.from_bytes(pg[24:28], 'little') != objid: continue
        cnt = struct.unpack('<H', pg[22:24])[0]
        for i in range(cnt):
            so = 0x2000 - 2 * (i + 1)
            off = struct.unpack('<H', pg[so:so + 2])[0]
            if pg[off + 1] != 0: continue
            rec = parse_record(pg, off)
            if rec: yield rec

def is_null(nullmap, idx):
    return (nullmap[idx // 8] >> (idx % 8)) & 1

# ---------- syscolumns (objId=3) ----------
# SQL2000 syscolumns fixed: id(4) number(2) colid(2) status(1) type(1) length(2) xprec(1) xscale(1) isoutparam(1) isnullable(1)? xtype(1) xusertype(2) ... name varcol
columns = {}
for tagA, tagB, fixed, ncols, nullmap, varcols in iter_object_rows(3):
    if len(fixed) < 18 or not varcols: continue
    tid = struct.unpack('<i', fixed[0:4])[0]
    type_ = struct.unpack('<h', fixed[6:8])[0]
    length = struct.unpack('<h', fixed[8:10])[0]
    xprec, xscale = fixed[10], fixed[11]
    colid = struct.unpack('<h', fixed[12:14])[0]
    name = varcols[-1].decode('utf-16-le', errors='replace').rstrip('\x00')
    if colid <= 0 or colid > 500: continue
    columns.setdefault(tid, []).append({'colid': colid, 'type': type_, 'length': length, 'xprec': xprec, 'xscale': xscale, 'name': name})
for tid in columns:
    seen, uniq = set(), []
    for c in sorted(columns[tid], key=lambda c: c['colid']):
        if c['colid'] not in seen:
            seen.add(c['colid']); uniq.append(c)
    columns[tid] = uniq
json.dump(columns, open('sys_columns.json', 'w'), ensure_ascii=False, indent=1)

# ---------- sysindexes (objId=2): row counts ----------
rowcounts = {}
for tagA, tagB, fixed, ncols, nullmap, varcols in iter_object_rows(2):
    if len(fixed) < 4: continue
    tid = struct.unpack('<i', fixed[0:4])[0]
    # rowcnt offset varies; find later if needed
    rowcounts.setdefault(tid, 0)

# ---------- row decoder ----------
VARIABLE = {167, 175, 165, 173, 231, 239, 35, 99, 34}
TYPENAME = {34:'image',35:'text',36:'uniqueidentifier',48:'tinyint',52:'smallint',56:'int',58:'smalldatetime',
            59:'real',60:'money',61:'datetime',62:'float',98:'sql_variant',99:'ntext',104:'bit',106:'decimal',
            108:'numeric',122:'smallmoney',127:'bigint',165:'varbinary',167:'varchar',173:'binary',175:'char',
            189:'timestamp',231:'nvarchar',239:'nchar'}

def decode_fixed(t, data, xprec=0, xscale=0):
    if t == 56: return struct.unpack('<i', data[:4])[0]
    if t == 52: return struct.unpack('<h', data[:2])[0]
    if t == 48: return data[0]
    if t == 127: return struct.unpack('<q', data[:8])[0]
    if t == 104: return bool(data[0])
    if t == 59: return struct.unpack('<f', data[:4])[0]
    if t == 62: return struct.unpack('<d', data[:8])[0]
    if t in (60, 122):
        v = struct.unpack('<q', data[:8])[0] if t == 60 else struct.unpack('<i', data[:4])[0]
        return v / 10000.0
    if t == 61:
        days, ticks = struct.unpack('<ii', data[:8])
        try: return str(datetime.datetime(1900, 1, 1) + datetime.timedelta(days=days, seconds=ticks / 300))
        except Exception: return None
    if t == 58:
        days, mins = struct.unpack('<HH', data[:4])
        try: return str(datetime.datetime(1900, 1, 1) + datetime.timedelta(days=days, minutes=mins))
        except Exception: return None
    if t in (106, 108):
        storage = {5: 4, 9: 8, 13: 12, 17: 16}.get(len(data), len(data))
        sign = data[0]
        val = int.from_bytes(data[1:1 + storage], 'little')
        v = val / (10 ** xscale)
        return v if sign else -v
    if t in (175, 173, 165, 167):
        return data
    if t in (231, 239):
        return data
    if t == 36: return data.hex()
    if t == 189: return data.hex()
    return data

def decode_var(t, data):
    if t in (231,): return data.decode('utf-16-le', errors='replace').rstrip('\x00')
    if t in (239,): return data.decode('utf-16-le', errors='replace').rstrip('\x00 ')
    if t in (167, 175):
        try: return data.decode('cp1256').rstrip('\x00 ')
        except Exception: return data.decode('latin1', errors='replace').rstrip('\x00 ')
    if t == 99: return f"<ntext {len(data)}b>"
    if t == 35: return f"<text {len(data)}b>"
    return data.hex()

def fixed_len(col):
    t, ln = col['type'], col['length']
    if t in (175, 173, 239): return ln
    if t in (106, 108):
        p = col['xprec']
        return 5 if p <= 9 else 9 if p <= 19 else 13 if p <= 28 else 17
    return ln if t not in VARIABLE else ln

def parse_table(tid):
    cols = columns.get(tid, [])
    if not cols: return []
    maxcol = max(c['colid'] for c in cols)
    known = {c['colid'] for c in cols}
    gaps = [g for g in range(1, maxcol + 1) if g not in known]
    # استنتاج الأعمدة المحذوفة من حجم السجل
    fixed_cols_known = [c for c in cols if c['type'] not in VARIABLE]
    sample = next(iter_object_rows(tid), None)
    if sample is None: return []
    fsize_body = len(sample[2])
    known_fixed = sum(fixed_len(c) for c in fixed_cols_known)
    leftover = fsize_body - known_fixed
    for g in gaps:
        ln = leftover // len(gaps) if gaps else 0
        fixed_cols_known.append({'colid': g, 'type': 'gap', 'length': ln, 'name': f'_gap{g}'})
        leftover -= ln
    fixed_cols = sorted(fixed_cols_known, key=lambda c: c['colid'])
    var_cols = sorted([c for c in cols if c['type'] in VARIABLE], key=lambda c: c['colid'])
    rows = []
    for tagA, tagB, fixed, ncols, nullmap, varcols_raw in iter_object_rows(tid):
        row = {}
        fpos = 0
        ok = True
        for c in fixed_cols:
            ln = c['type'] == 'gap' and c['length'] or fixed_len(c)
            if fpos + ln > len(fixed): ok = False; break
            raw = fixed[fpos:fpos + ln]
            fpos += ln
            idx = c['colid'] - 1
            if c['type'] == 'gap':
                row[c['name']] = int.from_bytes(raw, 'little') if ln <= 8 else raw.hex()
                continue
            if idx < (ncols + 7) // 8 * 8 and is_null(nullmap, idx): row[c['name']] = None
            else:
                v = decode_fixed(c['type'], raw, c['xprec'], c['xscale'])
                if isinstance(v, (bytes, bytearray)):
                    v = decode_var(c['type'], v) if c['type'] in (175, 173) else v.hex()
                row[c['name']] = v
        if not ok: continue
        for vi, c in enumerate(var_cols):
            idx = c['colid'] - 1
            if idx < (ncols + 7) // 8 * 8 and is_null(nullmap, idx) or vi >= len(varcols_raw): row[c['name']] = None
            else: row[c['name']] = decode_var(c['type'], varcols_raw[vi])
        rows.append(row)
    return rows

if __name__ == '__main__':
    objects = {o['id']: o for o in json.load(open('sys_objects.json'))}
    if len(sys.argv) > 1:
        name = sys.argv[1]
        t = next((o for o in objects.values() if o['xtype'] == 'U' and o['name'].lower() == name.lower()), None)
        if not t: print("not found"); sys.exit(1)
        print("columns:", [(c['colid'], c['name'], TYPENAME.get(c['type'], c['type']), c['length']) for c in columns.get(t['id'], [])])
        rows = parse_table(t['id'])
        print("rows:", len(rows))
        for r in rows[: int(sys.argv[2]) if len(sys.argv) > 2 else 5]:
            print(json.dumps(r, ensure_ascii=False, default=str))
        json.dump(rows, open(f'table_{name}.json', 'w'), ensure_ascii=False, indent=1, default=str)
