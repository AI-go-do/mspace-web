import { useEffect, useState, type CSSProperties } from 'react'
import { currentMemberId } from '../api/client'
import {
  adminErrorMessage, alertEffectLabel, daysBefore, getPenalties, getSourceCounts, getTidyChecks, getUsageStats, tidyCounts, LEFT_ITEM_LABEL, pct,
  SUSPENSION_REASON, SUSPENSION_SCOPE, TIDY_LABEL, seenItemsLabel, tidyPhotoUrl, type TidyPhase, WARNING_REASON, type Penalties, type SourceCounts, type TidyCheckRow, type UsageStats,
} from '../api/admin'
import { minutesLabel } from '../lib/format'
import { seoulDate } from '../lib/time'
import { useCountUp } from '../lib/useCountUp'
import { IconButton } from '../components/IconAction'
import { AuthPhoto, Skeleton } from './AdminReports'

const REQUEST_TIMEOUT_MS = 15_000
const RANGES = [7, 30, 90]

/** "11/6 14:20" (서울) */
function stamp(iso: string): string {
  const p = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso)).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {})
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`
}

/** 기간 고르기 칩 (7·30·90일) */
function RangeChips({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="adm-chips" role="group" aria-label={label}>
      {RANGES.map((d) => (
        <button key={d} type="button" className="adm-chip" aria-pressed={value === d} onClick={() => onChange(d)}>최근 {d}일</button>
      ))}
    </div>
  )
}

/** 숫자 칸. 숫자는 세어 올라가고, 비율(0–1)이면 % 로 */
function Tile({ label, value, rate, sub, hero, i = 0 }: { label: string; value: number | null; rate?: boolean; sub?: string; hero?: boolean; i?: number }) {
  const n = value === null ? null : rate ? Math.round(value * 100) : value
  const shown = useCountUp(n, 800)
  return (
    <div className={`card stat-tile ${hero ? 'hero' : ''}`} style={{ '--k': i } as CSSProperties}>
      <span>{label}</span>
      <b aria-hidden="true">{n === null ? '—' : <>{shown}{rate && <small>%</small>}</>}</b>
      <span className="sr-only">{n === null ? '없음' : `${n}${rate ? '%' : ''}`}</span>
      {sub && <small>{sub}</small>}
    </div>
  )
}

/** 경고·정지 목록 (FR-WEB-101, core #75). 지금 정지 중인 사람이 위, 그다음 최근 경고 */
export function AdminPenalties() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Penalties | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    setData(null)
    setError(null)
    const ctrl = new AbortController()
    // 정리(cleanup)에서만 켠다. 시간 초과로 끊긴 건 오류로 보여 줘야 해서 signal.aborted로 가리지 않는다
    let stale = false
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    getPenalties(days, ctrl.signal, memberId)
      .then((d) => { if (!stale) setData(d) })
      .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
      .finally(() => clearTimeout(timer))
    return () => { stale = true; clearTimeout(timer); ctrl.abort() }
  }, [days])

  const active = data?.suspensions.filter((s) => s.active) ?? []
  const ended = data?.suspensions.filter((s) => !s.active) ?? []

  return (
    <section className="rec-body" aria-label="경고·정지">
      <RangeChips value={days} onChange={setDays} label="기간" />
      {error && <p role="alert" className="adm-msg err">{error}</p>}
      {!data && !error && <Skeleton />}
      {data && (
        <>
          <div className="stat-tiles three">
            <Tile hero label="지금 정지" value={active.length} />
            <Tile label="끝난 정지" value={ended.length} i={1} />
            <Tile label="경고" value={data.warnings.length} i={2} />
          </div>
          <div className="rec-two">
          <section className="card admin-sec">
            <h2>정지</h2>
            {data.suspensions.length === 0 && <p className="adm-small">이 기간에 정지가 없어요.</p>}
            <ul className="pen-list">
              {[...active, ...ended].map((s) => (
                <li key={`${s.scope}${s.id}`} className={`pen-row ${s.active ? 'on' : ''}`}>
                  <span className="pen-who"><b>{s.member.name}</b><span className="muted">{s.member.studentId}</span></span>
                  <span className="pen-what">
                    <span className={`pen-tag ${s.active ? 'on' : ''}`}>{s.active ? '정지 중' : '끝남'} · {SUSPENSION_SCOPE[s.scope] ?? s.scope}</span>
                    <span className="muted">{SUSPENSION_REASON[s.reason] ?? s.reason} · {stamp(s.startsAt)} → {stamp(s.endsAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card admin-sec">
            <h2>경고</h2>
            {data.warnings.length === 0 && <p className="adm-small">이 기간에 경고가 없어요.</p>}
            <ul className="pen-list">
              {data.warnings.map((w) => (
                <li key={w.id} className="pen-row">
                  <span className="pen-who"><b>{w.member.name}</b><span className="muted">{w.member.studentId}</span></span>
                  <span className="pen-what">
                    <span className="pen-tag">{WARNING_REASON[w.reason] ?? w.reason}</span>
                    <span className="muted">신고 #{w.reportId}{w.reservationId ? ` · 예약 #${w.reservationId}` : ''} · {stamp(w.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          </div>
        </>
      )}
    </section>
  )
}

/** 줄 하나를 가리키는 키. 예약 하나에 퇴실 직후·다시 확인 두 줄이 있을 수 있다 */
const rowKey = (r: Pick<TidyCheckRow, 'reservationId' | 'phase'>) => `${r.reservationId}-${r.phase}`

/** 비교 사진 한 칸: 어느 예약의 어느 단계 사진인지와 아래 글 */
interface Shot { reservationId: number; phase: TidyPhase; label: string; when: string }

/**
 * 펼친 줄의 비교 사진 두 장.
 * - 퇴실 직후 줄: 같은 방 바로 앞 예약의 퇴실 직후 사진 ↔ 이번 퇴실 직후 사진.
 *   AI가 비교에 쓰는 입실 직전 사진은 젯슨 안에만 두고 지운다(Q-22). 관리자는 서버에 남은 퇴실 사진(10차·core #115)만 보므로
 *   "입실 전"이라 부르지 않고 "앞 팀 퇴실 뒤"라고 적는다
 * - 다시 확인 줄: 퇴실 직후 ↔ 3시간 뒤
 */
export function tidyPair(rows: TidyCheckRow[], r: TidyCheckRow): [Shot | null, Shot] {
  if (r.phase === 'RECHECK') {
    const first = rows.find((x) => x.reservationId === r.reservationId && x.phase === 'FIRST')
    return [
      { reservationId: r.reservationId, phase: 'FIRST', label: '퇴실 직후', when: first ? stamp(first.observedAt) : '' },
      { reservationId: r.reservationId, phase: 'RECHECK', label: '3시간 뒤', when: stamp(r.observedAt) },
    ]
  }
  // 목록은 최근 순이라 같은 방의 더 오래된 퇴실 직후 줄 가운데 첫 번째가 바로 앞 예약
  const before = rows.find((x) => x.roomId === r.roomId && x.phase === 'FIRST' && x.reservationId !== r.reservationId
    && Date.parse(x.observedAt) < Date.parse(r.observedAt))
  return [
    before ? { reservationId: before.reservationId, phase: 'FIRST', label: '앞 팀 퇴실 뒤', when: `예약 #${before.reservationId} · ${stamp(before.observedAt)}` } : null,
    { reservationId: r.reservationId, phase: 'FIRST', label: '퇴실 뒤', when: stamp(r.observedAt) },
  ]
}

/**
 * 방 카메라 정리 확인 목록 (FR-DEV-105·FR-WEB-101, core #110·#112). 퇴실 뒤 젯슨이 본 결과를 최근 순으로.
 * 예약 하나에 퇴실 직후·3시간 뒤 다시 확인이 따로 한 줄씩. 다시 확인에도 남으면 core가 대표자 경고(신고 번호가 붙음).
 * 카메라 그림을 누르면 줄 아래에 비교 사진 두 장(core #115)을 펼친다. 사진은 누른 줄만 받는다(7일이면 수백 장)
 */
export function AdminTidyChecks() {
  const [days, setDays] = useState(7)
  const [open, setOpen] = useState<string | null>(null)
  const [rows, setRows] = useState<TidyCheckRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    setRows(null)
    setError(null)
    const ctrl = new AbortController()
    let stale = false
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    getTidyChecks(days, ctrl.signal, memberId)
      .then((r) => { if (!stale) setRows(r) })
      .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
      .finally(() => clearTimeout(timer))
    return () => { stale = true; clearTimeout(timer); ctrl.abort() }
  }, [days])

  const counts = rows ? tidyCounts(rows) : null
  return (
    <section className="rec-body" aria-label="카메라 정리 확인">
      <RangeChips value={days} onChange={setDays} label="기간" />
      {error && <p role="alert" className="adm-msg err">{error}</p>}
      {!rows && !error && <Skeleton />}
      {rows && counts && (
        <>
          <div className="stat-tiles three">
            <Tile hero label="물건 남음" value={counts.left} />
            <Tile label="깨끗함" value={counts.clean} i={1} />
            <Tile label="3시간 뒤 경고" value={counts.warned} i={2} />
          </div>
          <section className="card admin-sec">
            <h2>퇴실 뒤 카메라가 본 것</h2>
            {rows.length === 0 && <p className="adm-small">이 기간에 받은 결과가 없어요.</p>}
            <ul className="pen-list">
              {rows.map((r) => {
                const key = rowKey(r)
                const isOpen = open === key
                const on = r.result !== 'CLEAN'
                const pair = isOpen ? tidyPair(rows, r) : null
                return (
                  <li key={key} className={`pen-row tidy-row ${on ? 'on' : ''}`}>
                    <span className="pen-who"><b>{r.roomName}</b><span className="muted">예약 #{r.reservationId}</span></span>
                    <span className="pen-what">
                      <span className="tidy-tags">
                        <span className="pen-tag">{r.phase === 'RECHECK' ? '3시간 뒤' : '퇴실 직후'}</span>
                        <span className={`pen-tag ${on ? 'on' : ''}`}>
                          {TIDY_LABEL[r.result] ?? r.result}{r.reportId !== null ? ` · 경고 신고 #${r.reportId}` : ''}
                        </span>
                      </span>
                      {r.items.length > 0 && <span>{seenItemsLabel(r.items)}</span>}
                      {r.leftItems.length > 0 && <span>두고 간 것: {r.leftItems.map((x) => LEFT_ITEM_LABEL[x] ?? x).join('·')}</span>}
                      <span className="muted">{r.endedAt ? `${stamp(r.endedAt)} 퇴실 · ` : ''}{stamp(r.observedAt)} 확인</span>
                    </span>
                    <IconButton
                      icon={isOpen ? 'close' : 'camera'}
                      label={isOpen ? '사진 닫기' : '비교 사진 보기'}
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : key)}
                    />
                    {pair && (
                      <div className="tidy-photos"><div className="evidence-grid">
                        {pair.map((shot, i) => (
                          <figure key={i} className="evidence-cell">
                            <AuthPhoto
                              url={shot ? tidyPhotoUrl(shot.reservationId, shot.phase) : null}
                              empty={shot ? '사진 없음' : '앞 팀 사진 없음'}
                              alt={`${r.roomName} ${shot?.label ?? '앞 팀 퇴실 뒤'} 사진`}
                            />
                            <figcaption><b>{shot?.label ?? '앞 팀 퇴실 뒤'}</b><span className="muted">{shot?.when ?? '이 기간에 앞 팀 기록 없음'}</span></figcaption>
                          </figure>
                        ))}
                      </div></div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </section>
  )
}

/**
 * 이용 통계 (FR-WEB-101, core #74 + 예약 만든 곳 #45). 위에 핵심 숫자 넷, 방별 사용률 막대, 시간대별 예약 막대,
 * 결과 나눔, 센서. 막대는 한 가지 값이라 파랑 한 색(범례 없음), 값은 막대 끝에 글로, 표로도 볼 수 있다
 */
export function AdminStats() {
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [source, setSource] = useState<SourceCounts | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    const to = seoulDate()
    const from = daysBefore(to, days - 1)
    setStats(null)
    setSource(null)
    setError(null)
    const ctrl = new AbortController()
    let stale = false
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    getUsageStats(from, to, ctrl.signal, memberId)
      .then((s) => { if (!stale) setStats(s) })
      .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
      .finally(() => clearTimeout(timer))
    // 만든 곳 건수는 덧붙이는 숫자라, 실패해도 통계는 보여 준다
    getSourceCounts(from, to, ctrl.signal, memberId).then((c) => { if (!stale) setSource(c) }).catch(() => undefined)
    return () => { stale = true; clearTimeout(timer); ctrl.abort() }
  }, [days])

  const t = stats?.total
  const maxHour = Math.max(1, ...(stats?.byHour.map((h) => h.reservations) ?? [0]))

  return (
    <section className="rec-body" aria-label="이용 통계">
      <RangeChips value={days} onChange={setDays} label="기간" />
      {error && <p role="alert" className="adm-msg err">{error}</p>}
      {!stats && !error && <Skeleton />}
      {stats && t && (
        <>
          <span className="adm-small">{stats.from} ~ {stats.to} · {stats.days}일</span>
          <div className="stat-tiles four">
            <Tile hero label="예약" value={t.reservations.total} sub={`취소 ${t.reservations.canceled} 포함`} />
            <Tile label="실제 이용률" value={t.rates.actualUse} rate sub={`입실 ${t.reservations.used}건`} i={1} />
            <Tile label="노쇼율" value={t.rates.noShow} rate sub={`노쇼 ${t.reservations.noShow}건`} i={2} />
            <Tile label="방 사용률" value={t.rates.utilization} rate sub="하루 24시간 기준" i={3} />
          </div>
          <div className="card stat-strip">
            <span><b>{minutesLabel(t.minutes.used)}</b>이용 시간</span>
            <span><b>{t.minutes.avgUsed == null ? '—' : minutesLabel(t.minutes.avgUsed)}</b>평균 이용</span>
            <span><b>{t.uniqueUsers}명</b>이용자</span>
            {source && <span><b>{source.agent}건</b>비서 예약</span>}
          </div>

          <div className="rec-two">
          <section className="card admin-sec">
            <h2>방별 사용률</h2>
            <div className="hbar-list">
              {stats.rooms.map((r) => {
                const v = r.rates.utilization ?? 0
                return (
                  <div key={r.roomId} className="hbar-row" tabIndex={0}
                    title={`${r.roomName ?? `창작실 ${r.roomId}`}: 사용률 ${pct(r.rates.utilization)}, 예약 ${r.reservations.total}건, 노쇼 ${r.reservations.noShow}건`}>
                    <span className="hbar-label">{r.roomId}</span>
                    <span className="hbar-track"><i style={{ width: `${Math.max(v * 100, v > 0 ? 2 : 0)}%`, '--k': r.roomId } as CSSProperties} /></span>
                    <span className="hbar-value">{pct(r.rates.utilization)}</span>
                  </div>
                )
              })}
            </div>
            <details className="stat-table">
              <summary>표로 보기</summary>
              <table>
                <thead><tr><th>방</th><th>예약</th><th>입실</th><th>노쇼</th><th>사용률</th><th>이용 시간</th></tr></thead>
                <tbody>
                  {stats.rooms.map((r) => (
                    <tr key={r.roomId}>
                      <td>{r.roomName ?? r.roomId}</td><td>{r.reservations.total}</td><td>{r.reservations.used}</td>
                      <td>{r.reservations.noShow}</td><td>{pct(r.rates.utilization)}</td><td>{minutesLabel(r.minutes.used)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <section className="card admin-sec">
            <h2>시간대별 예약</h2>
            <div className="vbar" role="img" aria-label={`시간대별 예약. 가장 많은 때 ${stats.byHour.reduce((a, h) => (h.reservations > a.reservations ? h : a), stats.byHour[0] ?? { hour: 0, reservations: 0 }).hour}시`}>
              {stats.byHour.map((h) => (
                <span key={h.hour} className="vbar-col" title={`${h.hour}시: 예약 ${h.reservations}건, 입실 ${h.used}건`}>
                  <i style={{ height: `${(h.reservations / maxHour) * 100}%`, '--k': h.hour } as CSSProperties} />
                </span>
              ))}
            </div>
            <div className="vbar-axis" aria-hidden="true"><span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>24시</span></div>
          </section>
          </div>
          <div className="rec-two">

          <section className="card admin-sec">
            <h2>예약이 끝난 모양</h2>
            <dl className="stat-dl">
              <div><dt>입실해서 사용</dt><dd>{t.reservations.used}</dd></div>
              <div><dt>자동 퇴실(종료 시각)</dt><dd>{t.reservations.autoCheckedOut}</dd></div>
              <div><dt>자리 비움으로 해제</dt><dd>{t.reservations.awayReleased}</dd></div>
              <div><dt>관리자 강제 퇴실</dt><dd>{t.reservations.forced}</dd></div>
              <div><dt>노쇼</dt><dd>{t.reservations.noShow}</dd></div>
              <div><dt>취소</dt><dd>{t.reservations.canceled}</dd></div>
              <div><dt>30분 안 짧은 이용</dt><dd>{t.shortUses}</dd></div>
            </dl>
          </section>

          <section className="card admin-sec">
            <h2>센서 (CO2·재실)</h2>
            <dl className="stat-dl">
              <div><dt>CO2 평균 / 최고</dt><dd>{t.sensor.co2AvgPpm ?? '—'} / {t.sensor.co2MaxPpm ?? '—'} ppm</dd></div>
              <div><dt>기준({t.sensor.thresholdPpm}ppm) 넘은 측정</dt><dd>{pct(t.sensor.co2OverRate)}</dd></div>
              <div><dt>환기 알림</dt><dd>{t.sensor.ventilationAlerts}번</dd></div>
              <div><dt>사람 있음(센서)</dt><dd>{minutesLabel(t.sensor.occupiedMinutes)}</dd></div>
              <div><dt>예약 없이 사람 있음</dt><dd>{minutesLabel(t.sensor.occupiedWithoutReservationMinutes)}</dd></div>
            </dl>
            <span className="adm-small">재실은 센서가 상태가 바뀔 때만 기록해서 근삿값이에요.</span>
          </section>
          </div>

          {t.alerts && (
            <section className="card admin-sec">
              <h2>알림 효과</h2>
              <dl className="stat-dl">
                <div><dt>노쇼 직전 알림 뒤 입실</dt><dd>{alertEffectLabel(t.alerts.noShowCheckedIn, t.alerts.noShowWarned, t.alerts.noShowCheckedInRate)}</dd></div>
                <div><dt>환기 알림 뒤 {t.alerts.resolvedWithinMinutes}분 안 CO2 기준({t.sensor.thresholdPpm}ppm) 이하</dt><dd>{alertEffectLabel(t.alerts.ventilationResolved, t.alerts.ventilationChecked, t.alerts.ventilationResolvedRate)}</dd></div>
              </dl>
              <span className="adm-small">결과가 난 알림만 세요. 아직 입실 안 했는데 입실 마감 전인 예약, 확인 시간이 아직 안 지난 환기 알림은 빠져요.</span>
            </section>
          )}
        </>
      )}
    </section>
  )
}
