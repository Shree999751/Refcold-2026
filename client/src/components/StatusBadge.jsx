import { STATUS } from '../lib/format.js';

export default function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.healthy;
  return (
    <span className={`badge tone-${s.tone}`}>
      <i aria-hidden="true" />
      {s.label}
    </span>
  );
}
