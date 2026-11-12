import { api } from './client'

/**
 * 젯슨 모델 시험 점수 (재웅 11/12 "실제 모델 시험 정확도를 가져와야지").
 * 젯슨 tidy_eval.py가 채점을 마치면 core에 결과를 올리고(수연), core가 저장해 관리자에게 내려 준다(지영).
 * 요청 초안: GET /api/admin/model-scores?kind=TIDY → { items: ModelScore[] } (최신 순). 관리자만
 */
export interface ModelScore {
  kind: string
  /** 모델 파일 이름 (예: yolov8s) */
  model: string
  /** 깨끗함/남음 정확도 0–1 (tidy_eval leftAccuracy, 순위·합격 기준) */
  accuracy: number
  /** 시험 사진 쌍 수 */
  cases: number
  /** 사진 한 장 판단에 걸린 시간(중간값, 초) */
  medianSeconds: number
  measuredAt: string
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function isModelScore(v: unknown): v is ModelScore {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return typeof s.model === 'string' && s.model.length > 0
    && isNum(s.accuracy) && s.accuracy >= 0 && s.accuracy <= 1
    && isNum(s.cases) && s.cases > 0 && isNum(s.medianSeconds) && s.medianSeconds >= 0
    && typeof s.measuredAt === 'string' && Number.isFinite(Date.parse(s.measuredAt))
}

/**
 * 가장 최근 점수 하나. core에 API가 아직 없거나(404), 기록이 없거나, 모양이 다르면 null.
 * null이면 화면은 기록해 둔 값(CAMERA_MODEL_SCORE)을 "언제 잰 값"과 함께 보여 준다
 */
export async function getLatestModelScore(kind: 'TIDY', signal?: AbortSignal, member?: number | null): Promise<ModelScore | null> {
  const r = await api<{ items?: unknown }>(`/api/admin/model-scores?kind=${kind}`, { signal, member })
  const items = Array.isArray(r?.items) ? r.items.filter(isModelScore) : []
  if (!items.length) return null
  return items.reduce((a, b) => (Date.parse(b.measuredAt) > Date.parse(a.measuredAt) ? b : a))
}
