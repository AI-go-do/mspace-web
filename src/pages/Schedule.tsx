import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { currentMemberId } from '../api/client'
import {
  checkSchedule, DAY_LABEL, DAYS, deleteSchedule, getSchedule, MAX_CLASSES, MAX_NAME, parseScheduleImage,
  saveSchedule, scheduleErrorMessage, sortClasses, type Day, type Schedule as Saved, type ScheduleClass, type ScheduleProblem,
} from '../api/schedule'
import { ACCEPT, shrinkImage } from '../lib/shrinkImage'
import './Schedule.css'

type Row = ScheduleClass & { key: number }
let nextKey = 1
const toRows = (classes: ScheduleClass[]): Row[] => sortClasses(classes).map((c) => ({ ...c, key: nextKey++ }))
const blank = (): Row => ({ dayOfWeek: 'MON', startTime: '09:00', endTime: '10:30', name: '', key: nextKey++ })

/**
 * FR-AGT-102 내 시간표. 비서의 my_schedule이 "수업 끝나고"를 알아듣는 근거(설계 5장).
 * 직접 입력하거나 캡처를 읽혀 초안을 받고, 학생이 확인해 [저장]을 눌러야 들어간다.
 */
export default function Schedule() {
  const navigate = useNavigate()
  // 이 화면을 연 학생 토큰으로만 보낸다(다른 탭에서 다른 학생이 로그인했으면 SESSION_CHANGED).
  // 열 때 토큰이 없었으면(시작 refresh가 네트워크 오류로 실패) 아직 묶지 않고, 처음 성공한 요청의 회원으로 묶는다
  const memberRef = useRef<number | null>(currentMemberId())
  const bound = () => memberRef.current ?? undefined
  const bind = () => { if (memberRef.current === null) memberRef.current = currentMemberId() }
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [draft, setDraft] = useState<{ note: string | null; dropped: number } | null>(null)
  const [problem, setProblem] = useState<ScheduleProblem | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'delete' | 'parse' | null>(null)
  const [askDelete, setAskDelete] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => {
    setLoadError(null)
    getSchedule(bound()).then((s) => { bind(); setSaved(s) }).catch((e) => setLoadError(scheduleErrorMessage(e)))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 한 번만 (다시 부르기는 버튼)
  useEffect(load, [])

  const reset = () => { setMsg(null); setDone(null); setProblem(null); setAskDelete(false) }
  const edit = () => { reset(); setDraft(null); setRows(saved ? toRows(saved.classes) : [blank()]) }
  const change = (key: number, patch: Partial<ScheduleClass>) => {
    setProblem(null)
    setRows((rs) => rs && rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const save = async () => {
    if (!rows) return
    reset()
    const classes = rows.map(({ key: _, ...c }) => ({ ...c, name: c.name.trim() }))
    const p = checkSchedule(classes)
    if (p) return setProblem(p)
    setBusy('save')
    try {
      setSaved(await saveSchedule(classes, bound()))
      bind()
      setRows(null)
      setDraft(null)
      setDone('저장했어요. 이제 비서에게 "내일 수업 끝나고 빈방 잡아 줘"라고 해 보세요.')
    } catch (e) {
      setMsg(scheduleErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    reset()
    setBusy('delete')
    try {
      await deleteSchedule(bound())
      bind()
      setSaved(null)
      setDone('시간표를 지웠어요.')
    } catch (e) {
      setMsg(scheduleErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 사진을 다시 골라도 다시 읽게
    if (!file) return
    reset()
    if (!ACCEPT.includes(file.type)) return setMsg('PNG·JPG·WebP 사진만 올릴 수 있어요.')
    setBusy('parse')
    try {
      const small = await shrinkImage(file).catch(() => undefined)
      if (small === undefined) return setMsg('사진을 열지 못했어요. 다른 사진으로 다시 올려 주세요.')
      if (!small) return setMsg('사진이 너무 커요. 시간표 부분만 잘라서 다시 올려 주세요.')
      const d = await parseScheduleImage(small, bound())
      bind()
      setDraft({ note: d.note, dropped: d.dropped })
      setRows(d.classes.length ? toRows(d.classes) : [blank()])
    } catch (err) {
      setMsg(scheduleErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  // 월~금은 늘 보이고, 토·일은 수업이 있을 때만
  const days = DAYS.filter((d) => (d !== 'SAT' && d !== 'SUN') || saved?.classes.some((c) => c.dayOfWeek === d))
  const capture = (
    <>
      <button type="button" className="btn-line" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
        {busy === 'parse' ? '사진 읽는 중…' : '캡처로 불러오기'}
      </button>
      <p className="muted sc-small">이름·학번이 보이면 그 부분을 잘라서 올려 주세요(사진은 외부 AI가 읽어요). 읽은 결과는 저장 전에 확인해요.</p>
    </>
  )

  return (
    <main className="sc">
      <header className="sub-head">
        <button type="button" className="back" aria-label="뒤로"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/me'))}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <h1>내 시간표</h1>
      </header>
      <input ref={fileRef} type="file" accept={ACCEPT.join(',')} hidden onChange={pick} />

      {done && <p role="status" className="card sc-msg sc-done">{done}</p>}
      {msg && <p role="alert" className="card sc-msg">{msg}</p>}
      {loadError && (
        <div role="alert" className="card sc-msg sc-col">
          시간표를 못 불러왔어요. {loadError}
          <button type="button" className="btn-line" onClick={load}>다시 불러오기</button>
        </div>
      )}
      {saved === undefined && !loadError && <p role="status" className="card sc-msg muted">불러오는 중…</p>}

      {saved === null && !rows && (
        <section className="card sc-col sc-sec">
          <b>아직 넣은 시간표가 없어요</b>
          <span className="muted sc-text">
            비서가 '수업 끝나고'를 알아들으려면 요일별 수업 시각이 필요해요. 넣어 두면 "내일 수업 끝나고 빈방 잡아 줘"에
            마지막 수업이 끝난 뒤 빈방을 찾아 줘요. 과목명과 시각만 저장해요.
          </span>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={edit}>직접 입력</button>
          {capture}
        </section>
      )}

      {saved && !rows && (
        <>
          {days.map((d) => {
            const list = saved.classes.filter((c) => c.dayOfWeek === d)
            return (
              <section key={d} className="card sc-day" aria-label={`${DAY_LABEL[d]}요일`}>
                <b className="sc-day-name">{DAY_LABEL[d]}</b>
                <ul>
                  {list.length === 0 && <li className="muted">수업 없음</li>}
                  {list.map((c) => <li key={c.startTime}><span className="sc-time">{c.startTime}–{c.endTime}</span>{c.name}</li>)}
                </ul>
              </section>
            )
          })}
          <div className="sc-col sc-sec">
            <button type="button" className="btn-primary" disabled={busy !== null} onClick={edit}>고치기</button>
            {capture}
            {!askDelete && <button type="button" className="sc-link" onClick={() => { reset(); setAskDelete(true) }}>전체 지우기</button>}
            {askDelete && (
              <div className="card sc-col sc-confirm" role="group" aria-label="전체 지우기 확인">
                <b>시간표를 모두 지울까요?</b>
                <span className="muted sc-text">지우면 비서가 '수업 끝나고'를 다시 알아듣지 못해요.</span>
                <div className="sc-row">
                  <button type="button" className="btn-line" onClick={() => setAskDelete(false)}>그대로 두기</button>
                  <button type="button" className="btn-primary" disabled={busy !== null} onClick={remove}>
                    {busy === 'delete' ? '지우는 중…' : '지우기'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {rows && (
        <>
          {draft && (
            <section className="card sc-col sc-sec sc-draft" aria-label="사진에서 읽은 초안">
              <b>사진에서 읽은 초안이에요. 아직 저장하지 않았어요</b>
              <span className="sc-text">맞는지 보고 고친 뒤 [저장]을 눌러 주세요.</span>
              {draft.dropped > 0 && <span className="sc-text">읽지 못하고 뺀 칸이 {draft.dropped}개 있어요. 빠진 수업은 직접 더해 주세요.</span>}
              {draft.note && <span className="sc-text">{draft.note}</span>}
            </section>
          )}
          {rows.map((r, i) => (
            <fieldset key={r.key} className="card sc-edit" aria-invalid={problem?.index === i} disabled={busy !== null}>
              <legend className="sr-only">{i + 1}번째 수업</legend>
              <div className="sc-row">
                <select aria-label="요일" value={r.dayOfWeek} onChange={(e) => change(r.key, { dayOfWeek: e.target.value as Day })}>
                  {DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}
                </select>
                <input className="sc-name" aria-label="과목명" placeholder="과목명 (예: 자료구조)" maxLength={MAX_NAME}
                  value={r.name} onChange={(e) => change(r.key, { name: e.target.value })} />
                <button type="button" className="btn-line sc-del" aria-label={`${i + 1}번째 수업 빼기`}
                  onClick={() => { setProblem(null); setRows(rows.filter((x) => x.key !== r.key)) }}>빼기</button>
              </div>
              <div className="sc-row">
                <input type="time" aria-label="시작" value={r.startTime} onChange={(e) => change(r.key, { startTime: e.target.value })} />
                <span aria-hidden="true">–</span>
                <input type="time" aria-label="끝" value={r.endTime} onChange={(e) => change(r.key, { endTime: e.target.value })} />
              </div>
              {problem?.index === i && <p role="alert" className="sc-err">{problem.message}</p>}
            </fieldset>
          ))}
          {problem && problem.index === null && <p role="alert" className="card sc-msg">{problem.message}</p>}
          <div className="sc-col sc-sec">
            <button type="button" className="btn-line" disabled={busy !== null || rows.length >= MAX_CLASSES}
              onClick={() => { setProblem(null); setRows([...rows, blank()]) }}>
              {rows.length >= MAX_CLASSES ? `수업은 ${MAX_CLASSES}개까지예요` : '+ 수업 더하기'}
            </button>
            <div className="sc-row">
              <button type="button" className="btn-line" disabled={busy !== null} onClick={() => { reset(); setRows(null); setDraft(null) }}>취소</button>
              <button type="button" className="btn-primary" disabled={busy !== null} onClick={save}>
                {busy === 'save' ? '저장하는 중…' : '저장'}
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
