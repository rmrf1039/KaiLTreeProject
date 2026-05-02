import { useEffect, useState } from 'react';
import type { TreeRecord } from '../../../shared/src/types';


type Props = {
  tree: TreeRecord;
  onClose: () => void;
};

function fmtNum(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return suffix ? `${s} ${suffix}` : s;
}

function fmtCoord(x: number | null | undefined, y: number | null | undefined): string {
  if (x === null || x === undefined || y === null || y === undefined) return '—';
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '—';
  return `${x.toFixed(2)}, ${y.toFixed(2)}`;
}

function fmtText(v: string | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.trim() === '' ? '—' : v;
}

function joinNonEmpty(parts: Array<string | null | undefined>, sep: string): string {
  return parts
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .join(sep);
}

export function TreeInfoModal({ tree, onClose }: Props) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const region = joinNonEmpty([tree.region, tree.regionRemark], ' · ');
  const locationLabel = joinNonEmpty([tree.dist, region], ' · ');

  return (
    <div className="tree-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="tree-modal-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="tree-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="tree-modal-image">
          {imgError ? (
            <div className="tree-modal-image-fallback">No image available</div>
          ) : (
            <img src={tree.proxyUrl} alt={`Tree ${tree.treeId}`} onError={() => setImgError(true)} />
          )}
        </div>
        <dl className="tree-modal-info">
          <div className="tree-modal-item">
            <dt>Tree Number</dt>
            <dd>{fmtText(tree.treeId)}</dd>
          </div>
          <div className="tree-modal-item">
            <dt>Location</dt>
            <dd>{fmtText(locationLabel)}</dd>
          </div>
          <div className="tree-modal-item">
            <dt>Coordinates (x, y)</dt>
            <dd className="mono">{fmtCoord(tree.twd97x, tree.twd97y)}</dd>
          </div>
          <div className="tree-modal-item">
            <dt>Diameter</dt>
            <dd>{fmtNum(tree.diameter, 'cm')}</dd>
          </div>
          <div className="tree-modal-item">
            <dt>Tree Height</dt>
            <dd>{fmtNum(tree.treeHeight, 'm')}</dd>
          </div>
          <div className="tree-modal-item">
            <dt>Survey Date</dt>
            <dd>{fmtText(tree.surveyDate)}</dd>
          </div>
          <div className="tree-modal-item">
            <dt>Tree Type</dt>
            <dd>{fmtText(tree.treeType)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
