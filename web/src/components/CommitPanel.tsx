import { useEffect, useState } from 'react'
import { fetchCommit, type CommitDetail } from '../api'

interface Props {
  repo: string | null
  hash: string | null
  onClose: () => void
}

interface Answer {
  hash: string
  detail?: CommitDetail
  error?: string
}

export function CommitPanel({ repo, hash, onClose }: Props) {
  const [answer, setAnswer] = useState<Answer | null>(null)

  useEffect(() => {
    if (!hash) return
    let live = true
    fetchCommit(repo, hash)
      .then((detail) => live && setAnswer({ hash, detail }))
      .catch((err) => live && setAnswer({ hash, error: err instanceof Error ? err.message : String(err) }))
    return () => {
      live = false
    }
  }, [repo, hash])

  // the answer carries its own hash, so a stale one never shows under a new commit
  const shown = answer?.hash === hash ? answer : null
  const detail = shown?.detail
  const [title, ...rest] = (detail?.body ?? '').split('\n')
  const body = rest.join('\n').trim()

  return (
    <aside className={hash ? 'panel open' : 'panel'}>
      <header>
        <span className="strong">commit</span>
        <span className="spacer" />
        <button onClick={onClose}>close</button>
      </header>
      <div className="panel-body">
        {shown?.error && <p className="empty">{shown.error}</p>}
        {!shown && <p className="empty">reading...</p>}
        {detail && (
          <>
            <h2>{title}</h2>
            <p className="meta">
              <code>{detail.h.slice(0, 12)}</code> . {detail.an} &lt;{detail.ae}&gt;
              <br />
              {new Date(detail.at).toLocaleString()}
              {detail.merge ? ' . merge commit' : ''}
            </p>
            {body && <pre>{body}</pre>}
            {detail.files.length === 0 ? (
              <p className="empty">no file listed, which is what a merge shows</p>
            ) : (
              detail.files.map((file) => (
                <div key={file.path} className="file">
                  <span className="n">
                    {file.a === null ? 'bin' : <><i className="a">+{file.a}</i> <i className="d">-{file.d}</i></>}
                  </span>
                  <span className="p">{file.path}</span>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </aside>
  )
}
