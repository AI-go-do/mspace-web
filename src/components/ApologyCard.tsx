import { Link } from 'react-router-dom'
import { isDemoId } from '../api/apology'
import { agoLabel, type AppNotification } from '../api/notifications'
import Spacey from './Spacey'
import './ApologyCard.css'

/**
 * 홈 맨 위 "방의 사과" 카드 (Q-19, 11/8 최종안). 장치 오류로 붙은 노쇼 경고를 방이 스스로 물렀을 때 방이 먼저 사과한다.
 * 경고를 무르는 건 core 규칙이고, 이 카드는 그 결과를 알려 줄 뿐이다. [괜찮아요]는 읽음, [내 경고 보기]는 읽음 + 이용 규칙 화면(내 경고 N회)
 */
export default function ApologyCard({ n, now, onClose }: { n: AppNotification; now: Date; onClose: (id: number) => void }) {
  return (
    <section className="apology" aria-labelledby="apology-title">
      <div className="apology-top">
        <span className="apology-mascot" aria-hidden="true"><Spacey size={28} label="" /></span>
        <span className="apology-eyebrow">방이 먼저 사과해요 · <time dateTime={n.createdAt}>{agoLabel(n.createdAt, now)}</time></span>
        {isDemoId(n.id) && <span className="sample">예시</span>}
        <span className="apology-badge">경고 무름</span>
      </div>
      <h2 id="apology-title" className="apology-title">{n.title}</h2>
      <p className="apology-body">{n.body}</p>
      <div className="apology-actions">
        <button type="button" className="btn-line" onClick={() => onClose(n.id)}>괜찮아요</button>
        <Link to="/rules" className="btn-primary" onClick={() => onClose(n.id)}>내 경고 보기</Link>
      </div>
    </section>
  )
}
