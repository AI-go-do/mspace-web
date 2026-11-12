import { useEffect, useState, type CSSProperties } from 'react'
import { adminErrorMessage, getPenalties, getReports } from '../api/admin'
import { currentMemberId } from '../api/client'
import { CATEGORIES, VERDICT_LABEL } from '../api/reports'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { aiRecords, initialTrainees, rateOf, recordTotals, STREAK_TO_LEVEL_UP, traineeNote, type AiRecord, type Trainee } from '../lib/apprentice'
import { POLL_MS } from '../lib/poll'
import { onReportsChanged } from '../lib/reportsBus'
import { seoulClock, seoulDate } from '../lib/time'
import { useCountUp } from '../lib/useCountUp'
import { WarningRow } from './AdminInsights'
import { Skeleton } from './AdminReports'
import './AdminApprentice.css'

const roomName = (id: number) => ADMIN_ROOMS.find((r) => r.roomId === id)?.name ?? `방 ${id}`
const categoryName = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c
/** 오늘이면 시각만, 아니면 월/일 시각 */
function when(iso: string) {
  const d = new Date(iso)
  const day = seoulDate(d)
  return day === seoulDate() ? seoulClock(d) : `${day.slice(5).replace('-', '/')} ${seoulClock(d)}`
}
/** 경고를 철회할 수 있는 기간(경고 목록 API 범위) */
const DAYS = 30
/** 처리 기록을 한 번에 그리는 줄 수 */
const PAGE = 30

const LEVELS = [
  { level: 1, title: '제안만 해요', text: '사람이 [맞아요]를 눌러야 실행' },
  { level: 2, title: '먼저 하고 보고해요', text: '실행한 뒤 아침 보고에 남기고 언제든 되돌리기' },
  { level: 3, title: '혼자 해요', text: '기록은 남고 되돌릴 수 있어요' },
]
const TRAINEES = initialTrainees()

/** 일 종류 하나의 인사 기록 카드. 연속 맞힘 칸이 차례로 채워진다 */
function TraineeCard({ t, i }: { t: Trainee; i: number }) {
  const filled = t.level >= t.maxLevel ? STREAK_TO_LEVEL_UP : t.streak
  const rate = rateOf(t)
  return (
    <li className="card ap-rec" style={{ '--k': i } as CSSProperties}>
      <div className="ap-rec-top">
        <span className={`ap-lv-big l${t.level}`} aria-hidden="true">{t.level}</span>
        <div className="ap-rec-name">
          <b>{t.name}</b>
          <span className="adm-small">레벨 {t.level} · 최고 {t.maxLevel}</span>
        </div>
        <span className="ap-rate">{rate === null ? '—' : `${rate}%`}<small>맞힘 {t.right}/{t.total}</small></span>
      </div>
      <div className="ap-dots" role="img" aria-label={`연속 ${filled}/${STREAK_TO_LEVEL_UP}`}>
        {Array.from({ length: STREAK_TO_LEVEL_UP }, (_, k) => <i key={k} className={k < filled ? 'on' : ''} style={{ '--d': k } as CSSProperties} />)}
      </div>
      <small className="adm-small">{traineeNote(t)}</small>
      {t.note && <small className="ap-rec-note">{t.note}</small>}
    </li>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  const shown = useCountUp(value)
  return <div className="ap-stat"><dt>{label}</dt><dd><span aria-hidden="true">{shown}<small>건</small></span><span className="sr-only">{value}건</span></dd></div>
}

/** 처리 기록 한 줄. 경고가 간 신고는 아래에 경고 줄이 붙고, 관리자는 거기서 [철회]만 할 수 있다 */
function RecordRow({ r, i, onChanged }: { r: AiRecord; i: number; onChanged: () => void }) {
  const { report } = r
  return (
    <li style={{ '--k': i } as CSSProperties}>
      <span className="ap-time">{when(report.judgedAt ?? report.createdAt)}</span>
      <div className="ap-log-text">
        <b>{categoryName(report.category)} 신고 #{report.id} → {VERDICT_LABEL[report.verdict]}</b>
        <span className="ap-log-room">
          {roomName(report.roomId)}{report.reporterReservationId === null ? ' · 방 카메라 신고' : ''}
          {r.warnings.length === 0 ? ' · 경고 없음' : ''}
        </span>
        {r.warnings.length > 0 && (
          <ul className="pen-list ap-warns">
            {r.warnings.map((w) => <WarningRow key={w.id} w={w} onChanged={onChanged} />)}
          </ul>
        )}
      </div>
    </li>
  )
}

/**
 * "AI 수습사원" (11/12 지영: 무인 운영). AI가 처리하고 관리자는 결과만 본다.
 * 위: 레벨 단계와 인사 기록 카드(11/12 지영 "그대로 두기"). 옆: core에 쌓인 신고 판정 기록(최근 30일)과 그 판정으로 간 경고. 관리자가 할 수 있는 건 경고 철회뿐
 */
export function AdminApprentice() {
  const [records, setRecords] = useState<AiRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [shown, setShown] = useState(PAGE)

  useEffect(() => {
    const member = currentMemberId()
    if (member === null) return
    const ctrl = new AbortController()
    let stale = false
    // 목록을 비우지 않고 다시 받는다(철회한 줄의 "철회됨"이 그대로 남게)
    Promise.all([getReports(null, ctrl.signal, member), getPenalties(DAYS, ctrl.signal, member)])
      .then(([reports, p]) => {
        if (stale) return
        // 경고 목록이 최근 DAYS일만 오니 신고도 판정 시각 기준 같은 기간만. 숫자는 전부로 세고, 목록은 PAGE개씩 펼친다
        const since = Date.now() - DAYS * 86_400_000
        setRecords(aiRecords(reports.filter((r) => Date.parse(r.judgedAt ?? r.createdAt) >= since), p.warnings, Infinity))
        setError(null)
      })
      .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
    return () => { stale = true; ctrl.abort() }
  }, [reload])

  // 열어 둔 동안 1분마다, 신고 판정이 바뀌면 바로 다시 받는다
  useEffect(() => {
    const again = () => setReload((x) => x + 1)
    const t = setInterval(() => { if (document.visibilityState === 'visible') again() }, POLL_MS)
    const stop = onReportsChanged(again)
    return () => { clearInterval(t); stop() }
  }, [])

  const totals = records ? recordTotals(records) : null
  return (
    <section className="ap-wrap" aria-label="AI 수습사원">
      <ol className="ap-steps">
        {LEVELS.map((l, i) => (
          <li key={l.level} className={`ap-step l${l.level}`} style={{ '--k': i } as CSSProperties}>
            <span className="ap-step-no">{l.level}</span>
            <div><b>{l.title}</b><span>{l.text}</span></div>
          </li>
        ))}
      </ol>
      <div className="ap-two">
        <section className="ap-sec" aria-labelledby="ap-rec-h">
          <div className="adm-sec-h">
            <h2 id="ap-rec-h">인사 기록 카드</h2>
            <p>{STREAK_TO_LEVEL_UP}번 연속 맞으면 한 단계 올라가고, 틀리거나 되돌리면 바로 내려가요.</p>
          </div>
          <ul className="ap-recs">{TRAINEES.map((t, i) => <TraineeCard key={t.kind} t={t} i={i} />)}</ul>
        </section>
        <section className="ap-sec" aria-labelledby="ap-log-h">
          <div className="adm-sec-h">
            <h2 id="ap-log-h">AI가 처리한 일 <span className="ap-tag">최근 {DAYS}일</span></h2>
            <p>보기만 하는 기록이에요. 잘못 간 경고만 [철회]로 되돌릴 수 있어요.</p>
          </div>
          {totals && (
            <dl className="ap-stats">
              <Stat label="판정한 신고" value={totals.judged} />
              <Stat label="경고가 간 신고" value={totals.warned} />
              <Stat label="철회한 경고" value={totals.withdrawn} />
            </dl>
          )}
          {error && (
            <p role="alert" className="adm-msg err">
              {error} <button type="button" className="adm-chip" onClick={() => setReload((x) => x + 1)}>다시 받기</button>
            </p>
          )}
          {!records && !error && <Skeleton />}
          {records && (
            <div className="card ap-log-card">
              {records.length === 0 ? <p className="adm-small">아직 AI가 판정한 신고가 없어요.</p> : (
                <>
                  <ul className="ap-log">
                    {records.slice(0, shown).map((r, i) => <RecordRow key={r.report.id} r={r} i={i} onChanged={() => setReload((x) => x + 1)} />)}
                  </ul>
                  {records.length > shown && (
                    <button type="button" className="adm-chip ap-more" onClick={() => setShown((n) => n + PAGE)}>
                      {records.length - shown}건 더 보기
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
