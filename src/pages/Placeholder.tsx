import { Link } from 'react-router-dom'

/** 아직 만들지 않은 화면. 요구사항 번호로 무엇을 만들지 알려 준다. */
export default function Placeholder({ title, fr }: { title: string; fr?: string }) {
  return (
    <main style={{ padding: '56px 16px 16px' }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ margin: 0 }}>곧 만들 화면이에요.</p>
        {fr && <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>요구사항 {fr}</p>}
      </div>
      <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, marginTop: 8, color: 'var(--blue)', fontWeight: 700 }}>
        홈으로
      </Link>
    </main>
  )
}
