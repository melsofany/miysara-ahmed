#!/usr/bin/env python3
"""Probe SQL Server 2000 page/record layout from the MDF stream inside the .bak"""
import mmap, struct, sys

f = open('old_db.bak', 'rb')
mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
BASE = 0x1a00
END = 0x14e81a00
PAGES = (END - BASE) // 0x2000
print("pages:", PAGES)

def page(n):
    o = BASE + n * 0x2000
    return mm[o:o + 0x2000]

# candidate: find a data page (type 1) with several slots
VALID = {1, 2, 3, 8, 9, 10, 11, 13, 15, 16, 17, 19, 20}
def detect_slots(pg):
    """try header variants, return (slotcnt_off, slotcnt_size, n) if slot array valid"""
    for off, size in [(22, 4), (22, 2), (24, 4), (24, 2), (26, 2), (20, 2)]:
        n = int.from_bytes(pg[off:off + size], 'little')
        if n == 0 or n > 200:
            continue
        ok = True
        prev = 95
        for i in range(n):
            so = 0x2000 - 2 * (i + 1)
            slot = int.from_bytes(pg[so:so + 2], 'little')
            if slot < 96 or slot >= 0x2000 - 2 or slot <= prev - 1 and slot < prev:
                # slots offsets usually ascending
                pass
            if slot < 96 or slot > 0x1f00:
                ok = False; break
            tagA = pg[slot]
            if tagA & 0x0f != 0 or (tagA & 0xc0):
                ok = False; break
            prev = slot
        if ok:
            return off, size, n
    return None

found = 0
for n in range(0, PAGES):
    pg = page(n)
    if pg[0] != 1 or pg[1] != 1:  # headerVersion=1, type=data
        continue
    r = detect_slots(pg)
    if r:
        off, size, cnt = r
        print(f"page {n}: slotcnt@{off} size{size} = {cnt} slots; level={pg[3]} indexId={int.from_bytes(pg[6:8],'little')} objId@24={int.from_bytes(pg[24:28],'little')} objId@26={int.from_bytes(pg[26:30],'little')}")
        found += 1
        if found >= 8:
            break
