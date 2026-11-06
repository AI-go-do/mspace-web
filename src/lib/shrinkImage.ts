/**
 * 시간표 캡처를 올리기 전에 브라우저에서 줄인다(라이브러리 없이 canvas로).
 * 학교 앞단 nginx가 1MB 넘는 본문을 413으로 막아서, 머리글 여유를 두고 900KB 아래 JPEG로 다시 만든다.
 * 다시 만들면 사진의 위치 정보(EXIF)도 같이 빠진다.
 */
export const MAX_UPLOAD_BYTES = 900 * 1024
export const MAX_SIDE = 1600
export const QUALITIES = [0.85, 0.75, 0.65, 0.5]
/** 화질을 다 낮춰도 크면 크기를 더 줄인다 */
export const SCALES = [1, 0.75, 0.5]
export const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']

/** 긴 변을 max에 맞춘다. 이미 작으면 그대로 */
export function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const ratio = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}

/** 크기·화질을 한 단계씩 낮추며 limit 아래가 되는 첫 결과를 준다. 끝까지 크면 null */
export async function encodeUnder(
  encode: (scale: number, quality: number) => Promise<Blob>,
  limit = MAX_UPLOAD_BYTES,
): Promise<Blob | null> {
  for (const scale of SCALES) {
    for (const quality of QUALITIES) {
      const blob = await encode(scale, quality)
      if (blob.size <= limit) return blob
    }
  }
  return null
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 열지 못했어요')) }
    img.src = url
  })
}

/** 브라우저 전용. 900KB 아래 JPEG를 주고, 끝까지 크면 null */
export async function shrinkImage(file: Blob): Promise<Blob | null> {
  const img = await loadImage(file)
  const base = fitSize(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('사진을 줄이지 못했어요')
  return encodeUnder((scale, quality) => {
    canvas.width = Math.max(1, Math.round(base.width * scale))
    canvas.height = Math.max(1, Math.round(base.height * scale))
    // 투명한 PNG가 JPEG에서 검게 나오지 않게 흰 바탕을 깐다
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진을 줄이지 못했어요'))), 'image/jpeg', quality))
  })
}
