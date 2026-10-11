import type { RefObject } from 'react';
import type { RetroSummary } from './types';

/**
 * Off-screen print layout for the retro summary.
 *
 * Rendered at a fixed 794px (A4 at 96dpi) on white and captured by
 * usePdfExport. Deliberately plain: html2canvas renders MUI elevation and
 * oklch() colours poorly, so this uses borders and hex only, and no theme
 * tokens. Atomic blocks are tagged data-pdf-block so page breaks never split a
 * card mid-sentence.
 */

const RANK_LABEL: Record<number, string> = { 1: '#1', 2: '#2', 3: '#3' };

interface Props {
  summary: RetroSummary;
  targetRef: RefObject<HTMLDivElement | null>;
}

const cell: React.CSSProperties = { border: '1px solid #ccc', padding: '6px 8px', fontSize: 11, textAlign: 'left' };

export default function RetroPdfDocument({ summary, targetRef }: Props) {
  const { board, items, participants, topPicks, conversions, comments } = summary;
  const lanes = [...board.lanes].sort((a, b) => a.order - b.order);

  return (
    <div style={{ position: 'absolute', left: -99999, top: 0 }} aria-hidden>
      <div
        ref={targetRef}
        style={{
          width: 794, padding: 32, background: '#ffffff', color: '#212121',
          fontFamily: 'Arial, Helvetica, sans-serif',
        }}
      >
        {/* Header */}
        <div data-pdf-block style={{ borderBottom: '2px solid #1565c0', paddingBottom: 12, marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, margin: 0, color: '#1565c0' }}>{board.title}</h1>
          <p style={{ fontSize: 12, margin: '6px 0 0', color: '#555' }}>
            {board.projectName ? `${board.projectName} · ` : ''}
            {board.meetingDate} at {board.meetingTime} ({board.timezone})
          </p>
          <p style={{ fontSize: 12, margin: '2px 0 0', color: '#555' }}>
            Facilitator: {board.facilitatorName ?? '—'} · {participants.length} participant
            {participants.length === 1 ? '' : 's'} · Status: {board.status}
          </p>
        </div>

        {/* Top 3 — the part people actually read */}
        <h2 style={{ fontSize: 16, color: '#1565c0', marginBottom: 8 }}>Top Agreed Points</h2>
        {topPicks.length === 0 ? (
          <p style={{ fontSize: 12, color: '#777', fontStyle: 'italic' }}>No points were ranked.</p>
        ) : (
          topPicks.map(p => (
            <div
              key={p.id}
              data-pdf-block
              style={{ border: '1px solid #f9a825', borderLeft: '5px solid #f9a825', padding: 10, marginBottom: 8 }}
            >
              <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>
                {RANK_LABEL[p.topPickRank as number]} — {p.content}
              </div>
              <div style={{ fontSize: 11, color: '#666' }}>
                {lanes.find(l => l.key === p.laneKey)?.name ?? p.laneKey} ·{' '}
                {p.voteCount} vote{p.voteCount === 1 ? '' : 's'} ·{' '}
                {p.isAnonymous ? 'Anonymous' : `${p.author?.firstName ?? ''} ${p.author?.lastName ?? ''}`.trim()}
              </div>
            </div>
          ))
        )}

        {/* Follow-up work, when the facilitator chose to create any */}
        {conversions.length > 0 && (
          <>
            <h2 style={{ fontSize: 16, color: '#1565c0', margin: '20px 0 8px' }}>Follow-up Created</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={cell}>Type</th>
                  <th style={cell}>Ref</th>
                  <th style={cell}>From retro point</th>
                </tr>
              </thead>
              <tbody>
                {conversions.map(c => (
                  <tr key={c.id}>
                    <td style={cell}>{c.converted?.type === 'ACTION_ITEM' ? 'Action Item' : 'Risk'}</td>
                    <td style={cell}>#{c.converted?.refId}</td>
                    <td style={cell}>{c.content}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Full board, one section per lane */}
        <div data-pdf-page-break-before="always">
          <h2 style={{ fontSize: 16, color: '#1565c0', margin: '0 0 8px' }}>Full Board</h2>
        </div>

        {lanes.map(lane => {
          const laneItems = items.filter(i => i.laneKey === lane.key);
          return (
            <div key={lane.key} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, color: lane.color, borderBottom: `2px solid ${lane.color}`, paddingBottom: 4 }}>
                {lane.name} ({laneItems.length})
              </h3>
              {laneItems.length === 0 && (
                <p style={{ fontSize: 11, color: '#999', fontStyle: 'italic' }}>No items.</p>
              )}
              {laneItems.map(i => (
                <div key={i.id} data-pdf-block style={{ border: '1px solid #ddd', padding: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 12, marginBottom: 3 }}>{i.content}</div>
                  <div style={{ fontSize: 10, color: '#777' }}>
                    {i.isAnonymous
                      ? 'Anonymous'
                      : `${i.author?.firstName ?? ''} ${i.author?.lastName ?? ''}`.trim() || 'Unknown'}
                    {' · '}{i.voteCount} vote{i.voteCount === 1 ? '' : 's'}
                    {i.topPickRank ? ` · Top ${i.topPickRank}` : ''}
                  </div>
                  {(comments[i.id] ?? []).map(c => (
                    <div key={c.id} style={{ marginTop: 5, paddingLeft: 12, borderLeft: '2px solid #e0e0e0' }}>
                      <div style={{ fontSize: 11 }}>{c.comment}</div>
                      <div style={{ fontSize: 10, color: '#999' }}>{c.author ?? 'Anonymous'}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}

        {/* Attendees */}
        <div data-pdf-block style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, color: '#1565c0', marginBottom: 6 }}>Attendees</h2>
          <p style={{ fontSize: 11, color: '#444' }}>
            {participants.length > 0 ? participants.map(p => p.name).join(', ') : 'No recorded attendees.'}
          </p>
        </div>

        <div
          data-pdf-block
          style={{ marginTop: 24, borderTop: '1px solid #ccc', paddingTop: 8, fontSize: 10, color: '#888' }}
        >
          Generated {new Date().toLocaleDateString()} · Anonymous contributions are not attributable by design.
        </div>
      </div>
    </div>
  );
}
