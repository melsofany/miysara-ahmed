#!/usr/bin/env python3
"""Generic SQL Server 2000 record parser + system catalog extraction."""
import mmap, struct, json

f = open('old_db.bak', 'rb')
mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
BASE = 0x1a00
END = 0x14e81a00
PAGES = (END - BASE) // 0x2000

def page(n):
    o = BASE + n * 0x2000
    return mm[o:o + 0x2000]

def parse_record(pg, off):
    """Returns (tagA, fixed_bytes, ncols, nullmap_bytes, varcols[list of bytes]) or None if invalid"""
    tagA = pg[off]
    tagB = pg[off + 1]
    fsize = struct.unpack('<H', pg[off + 2:off + 4])[0]
    if fsize < 4 or off + fsize > 0x2000:
        return None
    fixed = bytes(pg[off + 4:off + fsize])
    pos = off + fsize
    if pos + 2 > 0x2000:
        return None
    ncols = struct.unpack('<H', pg[pos:pos + 2])[0]; pos += 2
    if ncols > 300:
        return None
    nb = (ncols + 7) // 8
    if pos + nb > 0x2000:
        return None
    nullmap = bytes(pg[pos:pos + nb]); pos += nb
    varcols = []
    if tagA & 0x20:
        if pos + 2 > 0x2000:
            return None
        nvar = struct.unpack('<H', pg[pos:pos + 2])[0]; pos += 2
        if nvar > 100 or pos + 2 * nvar > 0x2000:
            return None
        ends = [struct.unpack('<H', pg[pos + 2 * i:pos + 2 * i + 2])[0] for i in range(nvar)]
        pos += 2 * nvar
        start = pos - off
        for e in ends:
            if e < start or off + e > 0x2000:
                return None
            varcols.append(bytes(pg[off + start: off + e]))
            start = e
    return tagA, tagB, fixed, ncols, nullmap, varcols

def iter_object_pages(objid):
    for n in range(PAGES):
        pg = page(n)
        if pg[0] != 1 or pg[1] != 1 or pg[3] != 0:
            continue
        if int.from_bytes(pg[24:28], 'little') != objid:
            continue
        cnt = struct.unpack('<H', pg[22:24])[0]
        for i in range(cnt):
            so = 0x2000 - 2 * (i + 1)
            off = struct.unpack('<H', pg[so:so + 2])[0]
            if pg[off + 1] != 0:
                continue
            yield n, i, pg, off

def col_is_null(nullmap, idx):
    return (nullmap[idx // 8] >> (idx % 8)) & 1

# ---- sysobjects ----
objects = []
for n, i, pg, off in iter_object_pages(1):
    rec = parse_record(pg, off)
    if not rec:
        continue
    tagA, tagB, fixed, ncols, nullmap, varcols = rec
    if len(fixed) < 10 or not varcols:
        continue
    rid = struct.unpack('<i', fixed[0:4])[0]
    xtype = fixed[4:6].decode('latin1').strip()
    name = varcols[0].decode('utf-16-le', errors='replace').rstrip('\x00')
    crdate = struct.unpack('<q', fixed[24:32])[0]
    objects.append({'id': rid, 'xtype': xtype, 'name': name})

objects.sort(key=lambda x: x['id'])
tables = [o for o in objects if o['xtype'] == 'U']
print("objects:", len(objects), "user tables:", len(tables))
for t in tables:
    print(t['id'], t['name'])

json.dump(objects, open('sys_objects.json', 'w'), ensure_ascii=False, indent=1)
