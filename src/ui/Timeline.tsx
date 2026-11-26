import type { Block } from '../core/model';
import { endLabel, toHHMM } from '../core/time';

// Шкала дня: блоки со временем по вертикали, пересекающиеся — в соседних дорожках и красным.
// Это визуализация; источник порядка — timeline-validation. Клик по блоку ведёт к его полям.

const PX_PER_MIN = 1;

interface Laid {
  block: Block;
  lane: number;
}

/** Жадная раскладка по дорожкам: блок идёт в первую дорожку, где предыдущий уже закончился. */
export function layLanes(sorted: Block[]): { items: Laid[]; lanes: number } {
  const ends: number[] = [];
  const items = sorted.map((block) => {
    let lane = ends.findIndex((end) => end <= block.start!);
    if (lane === -1) lane = ends.push(0) - 1;
    ends[lane] = block.start! + block.duration;
    return { block, lane };
  });
  return { items, lanes: Math.max(1, ends.length) };
}

export function Timeline({ timed, conflictIds, onPick }: { timed: Block[]; conflictIds: Set<string>; onPick: (id: string) => void }) {
  const valid = timed.filter((b) => b.duration > 0 && b.start! + b.duration <= 1440);
  if (!valid.length) return <p className="empty">На шкале пока ничего нет: добавьте встречу или задачу со временем.</p>;
  const from = Math.min(8 * 60, Math.floor(Math.min(...valid.map((b) => b.start!)) / 60) * 60);
  const to = Math.max(18 * 60, Math.ceil(Math.max(...valid.map((b) => b.start! + b.duration)) / 60) * 60);
  const { items, lanes } = layLanes(valid);
  const hours: number[] = [];
  for (let h = from; h <= to; h += 60) hours.push(h);
  return (
    <div className="timeline" style={{ height: (to - from) * PX_PER_MIN }} data-testid="timeline">
      {hours.map((h) => (
        <div key={h} className="timeline__hour" style={{ top: (h - from) * PX_PER_MIN }} aria-hidden="true">
          <span>{toHHMM(h)}</span>
        </div>
      ))}
      {items.map(({ block: b, lane }) => (
        <button
          type="button"
          key={b.id}
          className={`timeline__item timeline__item--${b.kind} ${conflictIds.has(b.id) ? 'timeline__item--conflict' : ''}`}
          style={{
            top: (b.start! - from) * PX_PER_MIN,
            height: Math.max(18, b.duration * PX_PER_MIN - 2),
            left: `calc(3.2rem + (100% - 3.2rem) * ${lane / lanes})`,
            width: `calc((100% - 3.2rem) / ${lanes} - 4px)`,
          }}
          data-testid="timeline-item"
          data-conflict={conflictIds.has(b.id) ? 'true' : 'false'}
          onClick={() => onPick(b.id)}
          aria-label={`${toHHMM(b.start!)}–${endLabel(b.start! + b.duration)} ${b.title || 'Без названия'}${conflictIds.has(b.id) ? ', пересечение' : ''}`}
        >
          <span className="timeline__time">{toHHMM(b.start!)}</span> {b.title || 'Без названия'}
        </button>
      ))}
    </div>
  );
}
