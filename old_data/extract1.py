#!/usr/bin/env python3
"""Parse sysobjects (objId=1) records from SQL 2000 MDF stream."""
import mmap, struct

f = open('old_db.bak', 'rb')
mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
BASE = 0x1a00
END = 0x14e81a00
PAGES = (END - BASE) // 0x2000

def page(n):
    o = BASE + n * 0x2000
    return mm[o:o + 0x2000]

def parse_record(pg, off):
    """SQL2000 record: tagA,tagB,fsize(2),fixed...,ncols(2),nullbitmap,nvarcols(2),varoffsets(2*n),vardata"""
    tagA, tagB = pg[off], pg[off + 1]
    fsize = struct.unpack('<H', pg[off + 2:off + 4])[0]
    fixed = pg[off + 4:off + fsize]
    pos = off + fsize
    ncols = struct.unpack('<H', pg[pos:pos + 2])[0]; pos += 2
    nb = (ncols + 7) // 8
    nullmap = pg[pos:pos + nb]; pos += nb
    varcols = []
    if tagA & 0x20:
        nvar = struct.unpack('<H', pg[pos:pos + 2])[0]; pos += 2
        offs = [struct.unpack('<H', pg[pos + 2 * i:pos + 2 * i + 2])[0] for i in range(nvar)]
        pos += 2 * nvar
        # offsets are absolute from record start
        for i, vo in enumerate(offs):
            end = offs[i + 1] if i + 1 < len(offs) else None
            if end is None:
                # last varcol ends at... end of record; unknown -> use next slot? assume record end = next offset region
                end = None
            varcols.append((vo, end))
    return tagA, tagB, fixed, ncols, nullmap, pos, varcols

def is_null(nullmap, colidx):
    return (nullmap[colidx // 8] >> (colidx % 8)) & 1

# sysobjects fixed layout (SQL2000): id(4) xtype(2) uid(2) info(2) status(4) base_schema_ver(4) replinfo(4) parent_obj(4) crdate(8) ftcatid(2) schema_ver(4) stats_schema_ver(4) type(2) userstat(2) sysstat(2) indexdel(4) refdate(8) version(4) deltrig(4) instrig(4) updtrig(4) seltrig(4) category(4) cache(2) = 78 bytes
rows = []
for n in range(PAGES):
    pg = page(n)
    if pg[0] != 1 or pg[1] != 1 or pg[3] != 0:
        continue
    if int.from_bytes(pg[24:28], 'little') != 1:
        continue
    cnt = struct.unpack('<H', pg[22:24])[0]
    for i in range(cnt):
        so = 0x2000 - 2 * (i + 1)
        off = struct.unpack('<H', pg[so:so + 2])[0]
        tagA, tagB = pg[off], pg[off + 1]
        if tagB != 0:
            continue
        fsize = struct.unpack('<H', pg[off + 2:off + 4])[0]
        fixed = pg[off + 4:off + fsize]
        if len(fixed) < 10:
            continue
        rid = struct.unpack('<i', fixed[0:4])[0]
        xtype = fixed[4:6].decode('latin1')
        # find name: it's the variable col; locate via null bitmap + varcols
        pos = off + fsize
        ncols = struct.unpack('<H', pg[pos:pos + 2])[0]; pos += 2
        nb = (ncols + 7) // 8
        nullmap = pg[pos:pos + nb]; pos += nb
        name = None
        if tagA & 0x20:
            nvar = struct.unpack('<H', pg[pos:pos + 2])[0]; pos += 2
            if nvar >= 1:
                vstart = struct.unpack('<H', pg[pos:pos + 2])[0]
                vend = struct.unpack('<H', pg[pos + 2:pos + 4])[0] if nvar > 1 else None
                if vend is None:
                    # record end: next slot offset or free space; estimate: use page freeData? just read until double-null
                    raw = pg[off + vstart: off + vstart + 256]
                    name = raw.split(b'\x00\x00')[0]
                else:
                    name = pg[off + vstart: off + vend]
        try:
            name = name.decode('utf-16-le', errors='replace').rstrip('\x00') if name else None
        except Exception:
            name = None
        rows.append((rid, xtype, name))

rows.sort()
utypes = {}
for rid, xt, name in rows:
    utypes[xt] = utypes.get(xt, 0) + 1
print("total objects:", len(rows), "xtypes:", utypes)
print("\n--- user tables (U) ---")
for rid, xt, name in rows:
    if xt.strip() == 'U':
        print(rid, repr(name))
