import { Link } from 'react-router-dom'

/**
 * 아직 만들지 않은 화면, 없는 주소.
 * 요구사항 번호(fr)는 개발자용이라 화면에 보이지 않게 data 속성에만 둔다.
 */
export default function Placeholder({ title, message = '곧 만들 화면이에요.', fr }: { title: string; message?: string; fr?: string }) {
  return (
    <main data-fr={fr} style={{ padding: '56px 16px 16px' }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ margin: 0 }}>{message}</p>
      </div>
      <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, marginTop: 8, color: 'var(--blue)', fontWeight: 700 }}>
        홈으로
      </Link>
    </main>
  )
}
