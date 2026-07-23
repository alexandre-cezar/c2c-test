import { useState, useEffect } from 'react'

export default function App() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)

  const fetchHello = async () => {
    setStatus('loading')
    setError(null)
    try {
      const res = await fetch('/api/hello')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setStatus('ok')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  useEffect(() => {
    fetchHello()
  }, [])

  return (
    <div className="app">
      <div className="card">
        <div className="badge">Code2Cloud</div>
        <h1>Container to Cloud</h1>
        <p className="subtitle">
          A fancy-but-simple app running on Kubernetes behind an NGINX Ingress.
        </p>

        {status === 'loading' && <p className="muted">Contacting backend...</p>}

        {status === 'error' && (
          <div className="error">
            <strong>Backend unreachable</strong>
            <span>{error}</span>
          </div>
        )}

        {status === 'ok' && data && (
          <div className="result">
            <p className="message">{data.message}</p>
            <dl>
              <dt>Served by pod</dt>
              <dd>{data.hostname}</dd>
              <dt>Python</dt>
              <dd>{data.python_version}</dd>
              <dt>Environment</dt>
              <dd>{data.environment}</dd>
              <dt>Timestamp</dt>
              <dd>{data.timestamp}</dd>
            </dl>
          </div>
        )}

        <button className="btn" onClick={fetchHello}>Refresh</button>
      </div>
      <footer>Built with FastAPI + React, shipped via Jenkins to Docker Hub.</footer>
    </div>
  )
}
