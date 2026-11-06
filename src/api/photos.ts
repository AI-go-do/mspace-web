import { api, ApiError } from './client'

/**
 * 입실·퇴실 사진 (FR-RPT-102). 선택 기능이라 안 올려도 입실·퇴실은 그대로 된다.
 * 형식: docs api/README.md "사진". 그 예약의 대표자·참여자 누구나, 종류별 1장.
 */
export type PhotoKind = 'CHECK_IN' | 'CHECK_OUT'

export interface UploadedPhoto {
  reservationId: number
  kind: PhotoKind
  uploadedAt: string
  sizeBytes: number
}

/** 사진은 화면에서 900KB 아래 JPEG로 줄인 뒤 보낸다(core 2MB, 학교 nginx 1MB 한도) */
export function uploadPhoto(reservationId: number, kind: PhotoKind, image: Blob, member?: number | null): Promise<UploadedPhoto> {
  const form = new FormData()
  form.append('kind', kind)
  form.append('file', image, kind === 'CHECK_IN' ? 'checkin.jpg' : 'checkout.jpg')
  return api(`/api/reservations/${reservationId}/photos`, { method: 'POST', body: form, member })
}

/** 서버 오류를 학생이 읽을 문장으로 */
export function photoErrorMessage(e: unknown, kind: PhotoKind): string {
  if (!(e instanceof ApiError)) return '연결이 끊겼어요. 잠시 후 다시 시도해 주세요.'
  // 학교 앞단 nginx는 1MB 넘는 본문을 HTML 413으로 막는다(코드 없음)
  if (e.status === 413) return '사진이 너무 커요. 다른 사진으로 다시 올려 주세요.'
  switch (e.code) {
    case 'PHOTO_INVALID': return 'JPG·PNG 사진만 올릴 수 있어요.'
    case 'PHOTO_TOO_LARGE': return '사진이 너무 커요. 다른 사진으로 다시 올려 주세요.'
    case 'PHOTO_NOT_ALLOWED_NOW':
      return kind === 'CHECK_IN'
        ? '입실 사진은 사용 중일 때만 올릴 수 있어요.'
        : '퇴실 사진은 사용 중이거나 퇴실 뒤 30분 안에만 올릴 수 있어요.'
    case 'RESERVATION_NOT_FOUND': return '찾을 수 없는 예약이에요.'
    default: return e.message
  }
}
