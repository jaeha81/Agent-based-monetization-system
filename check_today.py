#!/usr/bin/env python3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import db

rows = db.query("SELECT id, platform, product_id, created_at FROM content ORDER BY id DESC LIMIT 15")
print(f"최신 {len(rows)}개:")
for r in rows:
    print(r)

rows2 = db.query("SELECT id, platform, product_id, hook FROM content WHERE product_id='13' ORDER BY id DESC LIMIT 6")
print(f"\nproduct_id=13: {len(rows2)}개")
for r in rows2:
    print(r)
