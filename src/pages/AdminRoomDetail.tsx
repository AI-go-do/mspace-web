import { useEffect, useRef, useState } from 'react'
import { ENV_RULES } from '../config/adminRooms'
import { roomAdvice } from '../lib/roomAdvice'
import type { RoomView } from '../lib/roomHealth'
import { timeRange } from '../lib/format'
import { seoulClock } from '../lib/time'
import { RoomChart, type MetricKey } from './AdminRoomChart'
import './AdminRoomDetail.css'
import { ClimatePanel } from '../components/Climate'
import { currentMemberId } from '../api/client'
import { useAppliances } from '../api/appliances'

const PRESENCE: Record<RoomView['presence'], string> = { OCCUPIED: '사람 있음', EMPTY: '비어 있음', UNKNOWN: '모름' }

function ago(iso: string | null, now: Date): string {
  if (!iso) return '받은 적 없음'
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}초 전`
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  return seoulClock(new Date(iso))
}

/**
 * 방 상세 창: "지금" 화면에서 방 줄(그래프)을 누르면 열린다.
 * 위 숫자 셋을 누르면 큰 그래프가 CO2·온도·습도로 바뀌고, 아래에 "지금 확인할 것"(왜 노랑·남색인지 + 할 일)과
 * 바로 할 수 있는 버튼(강제 퇴실·이 방 막기)을 둔다. 버튼은 방 관리 칸으로 값을 채워 넘기고, 실제 처리는 거기서 한 번 더 확인한다
 */
export function RoomDetail({ view, now, blocked, reports = 0, sample = false, onClose, onForceCheckout, onBlockRoom, onOpenReports }: {
  view: RoomView
  now: Date
  blocked: string | null
  reports?: number
  /** 가짜 값이면 예약 번호도 가짜라 강제 퇴실로 넘기지 않는다(실제 서버의 같은 번호 예약이 걸리지 않게) */
  sample?: boolean
  onClose: () => void
  onOpenReports: () => void
  onForceCheckout: (reservationId: number) => void
  onBlockRoom: (roomId: number, inspection: boolean) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [metric, setMetric] = useState<MetricKey>('co2')
  const advice = roomAdvice(view, now, { blocked, openReports: reports })
  const { log, auto } = useAppliances()
  const autoLog = log.filter((e) => e.roomId === view.roomId).slice(0, 4)
  const { flags } = view

  // 닫히면 연 버튼으로 포커스를 돌려준다(부모가 창을 지우므로 close()를 거치지 않는다)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (!d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (typeof d.showModal === 'function') d.showModal()
    }
    const onCancel = (e: Event) => { e.preventDefault(); onClose() }
    d.addEventListener('cancel', onCancel)
    return () => d.removeEventListener('cancel', onCancel)
  }, [onClose])
  useEffect(() => () => { if (opener.current?.isConnected) opener.current.focus() }, [])

  const tiles: { key: MetricKey; label: string; value: string | null; unit: string; hot: boolean; has: boolean }[] = [
    { key: 'co2', label: 'CO2', value: view.co2 === null ? null : String(view.co2), unit: 'ppm', hot: flags.co2Over || flags.co2Soon, has: view.sensors.has('co2') },
    { key: 'temp', label: '온도', value: view.temperatureC === null ? null : view.temperatureC.toFixed(1), unit: '°C', hot: flags.hot, has: view.sensors.has('temperature') },
    { key: 'hum', label: '습도', value: view.humidityPct === null ? null : String(view.humidityPct), unit: '%', hot: flags.dry, has: view.sensors.has('humidity') },
    { key: 'light', label: '조도', value: view.light === null ? null : String(view.light), unit: '%', hot: flags.lightLeftOn, has: view.sensors.has('light') },
  ]
  const hasDoorNote = view.sensors.has('door') ? ' 아래 하늘색 띠는 문이 열려 있던 때예요.' : ''
  const canCheckout = !!view.current && view.presence === 'OCCUPIED'
  const inspection = flags.offline || flags.stuck
  const notes: Record<MetricKey, string> = {
    co2: `점선은 ${ENV_RULES.forecastMinutes}분 예측(${view.forecastFrom === 'model' ? 'Jetson' : '최근 추세'}), 옅은 범위는 그만큼 틀릴 수 있다는 뜻이에요.`,
    temp: `${ENV_RULES.hotC}°C 넘으면 더움으로 표시해요.`,
    hum: `${ENV_RULES.dryPct}% 밑이면 건조로 표시해요.`,
    light: `조도는 밝기 %(센서 값 0~1023을 0~100%로)예요. ${ENV_RULES.lightOnPct}% 넘으면 불 켜짐으로 보고, 빈 방에서 ${ENV_RULES.lightLeftOnMinutes}분 넘게 켜져 있으면 알려요(기준은 임시값).`,
  }

  return (
    <dialog ref={ref} className={`rd t-${view.tone}`} aria-labelledby="rd-title" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rd-body">
        <header className="rd-head">
          <span className="nr-no">{view.roomId}</span>
          <div className="rd-title">
            <h2 id="rd-title">{view.name}</h2>
            <span className="muted">{view.slot}</span>
          </div>
          {blocked && <span className="nr-st s-warn">{blocked}</span>}
          <span className={`nr-st s-${view.status.tone}`}>{view.status.text}</span>
          <button type="button" className="rd-close" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <div className="rd-tiles" role="group" aria-label="그래프 고르기">
          {tiles.map((t) => (
            <button key={t.key} type="button" aria-pressed={metric === t.key} disabled={!t.has}
              className={`rd-tile ${metric === t.key ? 'on' : ''} ${t.hot ? 'hot' : ''}`} onClick={() => setMetric(t.key)}>
              <small>{t.label}</small>
              {t.value === null ? <b className="none">–</b> : <b>{t.value}<i>{t.unit}</i></b>}
            </button>
          ))}
        </div>

        <div className="rd-chart">
          <RoomChart key={metric} view={view} metric={metric} now={now} detail />
          <p className="rd-note">{notes[metric]} 그래프를 누르거나 마우스를 올리면 그 분의 값이 보여요.{hasDoorNote}</p>
        </div>

        <div className="rd-grid">
          <section className="rd-sec" aria-labelledby="rd-todo">
            <h3 id="rd-todo">지금 확인할 것</h3>
            {advice.length === 0
              ? <p className="rd-ok"><span aria-hidden="true">✓</span> 이상 없어요. 할 일이 없어요.</p>
              : (
                <ul className="rd-advice">
                  {advice.map((a) => (
                    <li key={a.title} className={`a-${a.tone}`}>
                      <b>{a.title}</b>
                      <span>{a.todo}</span>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <section className="rd-sec rd-climate" aria-labelledby="rd-climate">
            <h3 id="rd-climate">에어컨·공기청정기 <small className="muted">{auto ? '자동 켜짐' : '자동 꺼짐'}</small></h3>
            <ClimatePanel view={view} now={now} by="ADMIN" member={currentMemberId()} />
            {autoLog.length > 0 && (
              <ul className="cl-log" aria-label="자동으로 한 일">
                {autoLog.map((e) => <li key={`${e.at}${e.applianceId}`}><time>{seoulClock(new Date(e.at))}</time><span>{e.text}</span></li>)}
              </ul>
            )}
          </section>

          <section className="rd-sec" aria-labelledby="rd-facts">
            <h3 id="rd-facts">예약·장치</h3>
            <dl className="rd-facts">
              <dt>지금 예약</dt>
              <dd>{view.current ? `${timeRange(view.current.startAt, view.current.endAt)} · ${view.current.people}명 · #${view.current.reservationId}` : '없음'}</dd>
              <dt>다음 예약</dt>
              <dd>{view.nextAt ? seoulClock(new Date(view.nextAt)) : '없음'}</dd>
              <dt>재실</dt>
              <dd>{PRESENCE[view.presence]}</dd>
              {view.sensors.has('door') && (
                <>
                  <dt>문</dt>
                  <dd>{view.door ? `${view.door.open ? '열림' : '닫힘'} (${seoulClock(new Date(view.door.since))}부터 ${view.door.minutes}분)` : '모름'}</dd>
                </>
              )}
              <dt>마지막 신호</dt>
              <dd>{ago(view.lastSignalAt, now)}</dd>
            </dl>
            <div className="rd-actions">
              {reports > 0 && (
                <button type="button" className="adm-btn" onClick={onOpenReports}>신고 {reports}건 판정하러</button>
              )}
              {canCheckout && sample && (
                <button type="button" className="adm-btn line" disabled title="가짜 값의 예약 번호라 실제 예약이 걸릴 수 있어요">강제 퇴실로 (가짜 값이라 꺼 둠)</button>
              )}
              {canCheckout && !sample && (
                <button type="button" className={`adm-btn ${flags.overtime ? '' : 'line'}`} onClick={() => onForceCheckout(view.current!.reservationId)}>
                  강제 퇴실로
                </button>
              )}
              <button type="button" className={`adm-btn ${inspection ? '' : 'line'}`} onClick={() => onBlockRoom(view.roomId, inspection)}>
                {inspection ? '점검으로 이 방 막기' : '이 방 막기'}
              </button>
            </div>
            <p className="rd-hint">버튼을 누르면 방 관리 칸에 값이 채워져요. 처리는 거기서 한 번 더 확인한 뒤에 해요.</p>
          </section>
        </div>
      </div>
    </dialog>
  )
}
