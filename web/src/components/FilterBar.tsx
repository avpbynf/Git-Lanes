import { type RefObject } from 'react'
import type { Filters, Order } from '../api'

interface Props {
  search: RefObject<HTMLInputElement | null>
  query: string
  onQuery: (query: string) => void
  regex: boolean
  matchCase: boolean
  broken: boolean
  onMode: (patch: { regex?: boolean; matchCase?: boolean }) => void
  authors: string[]
  filters: Filters
  onFilters: (patch: Partial<Filters>) => void
  order: Order
  onOrder: () => void
  freshness: string
  onReload: () => void
}

/** What git reads as a date, and what to call each one in the list. */
const WHEN: [string, string][] = [
  ['', 'any time'],
  ['24 hours ago', 'last 24 hours'],
  ['7 days ago', 'last 7 days'],
  ['31 days ago', 'last 31 days'],
]

const BY_DATE = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.6 3.6h10.8M2.6 8h7M2.6 12.4h3.4" />
  </svg>
)

const BY_BRANCH = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.2 4.6v7.6M5.2 8.4h3.2a2.4 2.4 0 0 0 2.4-2.4V4.6" />
    <circle cx="5.2" cy="13.6" r="1.4" />
    <circle cx="10.8" cy="3.2" r="1.4" />
  </svg>
)

const REFRESH = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13.6 8a5.6 5.6 0 1 1-1.7-4" />
    <path d="M13.9 1.6v3h-3" />
  </svg>
)

export function FilterBar({
  search, query, onQuery, regex, matchCase, broken, onMode,
  authors, filters, onFilters, order, onOrder, freshness, onReload,
}: Props) {
  return (
    <div className="filters">
      <span className="field">
        <input
          ref={search}
          type="search"
          className={broken ? 'bad' : ''}
          value={query}
          spellCheck={false}
          placeholder="text, author, hash or ref"
          onChange={(event) => onQuery(event.target.value)}
        />
        <button
          className={regex ? 'mode on' : 'mode'}
          title={broken ? 'that expression does not compile' : 'read as a regular expression'}
          onClick={() => onMode({ regex: !regex })}
        >
          .*
        </button>
        <button
          className={matchCase ? 'mode on' : 'mode'}
          title="tell upper case from lower"
          onClick={() => onMode({ matchCase: !matchCase })}
        >
          Aa
        </button>
      </span>

      <select
        value={filters.author}
        title="only the commits one person wrote"
        onChange={(event) => onFilters({ author: event.target.value })}
      >
        <option value="">anyone</option>
        {authors.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>

      <select
        value={filters.since}
        title="only the commits since"
        onChange={(event) => onFilters({ since: event.target.value })}
      >
        {WHEN.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      <input
        className="paths"
        value={filters.paths}
        spellCheck={false}
        placeholder="paths, comma separated"
        onChange={(event) => onFilters({ paths: event.target.value })}
      />

      <span className="spacer" />

      <button
        className="icon"
        title={order === 'date' ? 'read down the calendar' : 'each branch kept whole'}
        onClick={onOrder}
      >
        {order === 'date' ? BY_DATE : BY_BRANCH}
      </button>
      <button className="icon" title={freshness} onClick={onReload}>{REFRESH}</button>
    </div>
  )
}
