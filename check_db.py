#!/usr/bin/env python3
import sys
sys.path.insert(0, '.')
import db

rows = db.query("""
    SELECT c.platform, c.hook, c.script, c.hashtags
    FROM content c
    JOIN products p ON c.product_id = p.id
    WHERE p.name LIKE '%테니스%'
    ORDER BY c.created_at DESC
    LIMIT 12
""")
print('테니스 콘텐츠:', len(rows))
for r in rows:
    print(f"\n[{r['platform']}]")
    print('훅:', r['hook'])
    print('스크립트:', r['script'])
    print('태그:', r['hashtags'])

if not rows:
    # 전체 최근 콘텐츠
    all_rows = db.query("SELECT platform, hook, product_id FROM content ORDER BY created_at DESC LIMIT 20")
    print('전체 최근 20개:', len(all_rows))
    for r in all_rows:
        print(' ', r['product_id'], r['platform'], '|', str(r['hook'])[:50])
