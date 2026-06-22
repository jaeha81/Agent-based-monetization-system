import sys, json
sys.path.insert(0, '.')
import db

rows = db.query(
    'SELECT output_data, content_id, created_at FROM workflow_jobs WHERE node_type=? AND status=? ORDER BY created_at DESC',
    ['youtube_upload', 'completed']
)
print('=== 실제 YouTube 업로드 영상 ===')
video_ids = []
for r in rows:
    try:
        out = json.loads(r['output_data'] or '{}')
        vid = out.get('videoId')
        if vid:
            video_ids.append(vid)
            print("content_id=" + str(r['content_id']) + " videoId=" + vid + " date=" + str(r['created_at']))
    except Exception:
        pass
print("총 " + str(len(video_ids)) + "개")
