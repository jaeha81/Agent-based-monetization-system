export interface Mp4Metadata {
  width: number
  height: number
  durationSeconds: number
  hasVideoTrack: boolean
}

interface Box { type: string; start: number; dataStart: number; end: number }

function boxes(buffer: Buffer, start = 0, end = buffer.length): Box[] {
  const result: Box[] = []
  let offset = start
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    let header = 8
    if (size === 1) {
      if (offset + 16 > end) break
      const large = buffer.readBigUInt64BE(offset + 8)
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break
      size = Number(large)
      header = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < header || offset + size > end) break
    result.push({ type, start: offset, dataStart: offset + header, end: offset + size })
    offset += size
  }
  return result
}

function child(buffer: Buffer, parent: Box, type: string): Box | undefined {
  return boxes(buffer, parent.dataStart, parent.end).find(box => box.type === type)
}

function movieDuration(buffer: Buffer, mvhd: Box): number {
  const version = buffer[mvhd.dataStart]
  const timescaleOffset = mvhd.dataStart + (version === 1 ? 20 : 12)
  const durationOffset = mvhd.dataStart + (version === 1 ? 24 : 16)
  if (durationOffset + (version === 1 ? 8 : 4) > mvhd.end) return 0
  const timescale = buffer.readUInt32BE(timescaleOffset)
  if (!timescale) return 0
  const duration = version === 1
    ? Number(buffer.readBigUInt64BE(durationOffset))
    : buffer.readUInt32BE(durationOffset)
  return duration / timescale
}

function isVideoTrack(buffer: Buffer, trak: Box): boolean {
  const mdia = child(buffer, trak, 'mdia')
  const hdlr = mdia && child(buffer, mdia, 'hdlr')
  return !!hdlr && hdlr.dataStart + 12 <= hdlr.end && buffer.toString('ascii', hdlr.dataStart + 8, hdlr.dataStart + 12) === 'vide'
}

function trackDimensions(buffer: Buffer, trak: Box): { width: number; height: number } {
  const tkhd = child(buffer, trak, 'tkhd')
  if (!tkhd || tkhd.end - tkhd.dataStart < 8) return { width: 0, height: 0 }
  return {
    width: buffer.readUInt32BE(tkhd.end - 8) / 65536,
    height: buffer.readUInt32BE(tkhd.end - 4) / 65536,
  }
}

export function inspectMp4(buffer: Buffer): Mp4Metadata {
  if (buffer.length < 16) throw new Error('MP4 payload is too small')
  const top = boxes(buffer)
  if (!top.some(box => box.type === 'ftyp')) throw new Error('MP4 ftyp box is missing')
  const moov = top.find(box => box.type === 'moov')
  if (!moov) throw new Error('MP4 moov box is missing')
  const mvhd = child(buffer, moov, 'mvhd')
  const tracks = boxes(buffer, moov.dataStart, moov.end).filter(box => box.type === 'trak')
  const videoTrack = tracks.find(track => isVideoTrack(buffer, track))
  const dimensions = videoTrack ? trackDimensions(buffer, videoTrack) : { width: 0, height: 0 }
  const metadata = {
    ...dimensions,
    durationSeconds: mvhd ? movieDuration(buffer, mvhd) : 0,
    hasVideoTrack: !!videoTrack,
  }
  if (!metadata.hasVideoTrack || !metadata.width || !metadata.height || !metadata.durationSeconds) {
    throw new Error('MP4 video metadata is incomplete')
  }
  return metadata
}
