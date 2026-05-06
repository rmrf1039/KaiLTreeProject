import { useEffect, useState } from 'react';
import type { TreeRecord } from '../../../shared/src/types';


type Props = {
  tree: TreeRecord;
  onClose: () => void;
};

function fmtNum(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return suffix ? `${s}${suffix}` : s;
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
        <dl className="tree-modal-info tree-modal-info-top">
          <div className="tree-modal-item">
            <dt>diameter</dt>
            <dd>{fmtNum(tree.diameter, 'cm')}</dd>
          </div>
          <div className="tree-modal-item">
            <dt>tree height</dt>
            <dd>{fmtNum(tree.treeHeight, 'm')}</dd>
          </div>
          <div className="tree-modal-item">
            <dt>tree type</dt>
            <dd>{fmtText(tree.treeType)}</dd>
          </div>
        </dl>
        <div className="tree-modal-image">
          {imgError ? (
            <div className="tree-modal-image-fallback">No image available</div>
          ) : (
            <img src={tree.proxyUrl} alt={`Tree ${tree.treeId}`} onError={() => setImgError(true)} />
          )}
        </div>
        <dl className="tree-modal-info tree-modal-info-bottom">
          <div className="tree-modal-item">
            <dt>location</dt>
            <dd>{fmtText(locationLabel)}</dd>
          </div>
          <div className="tree-modal-item">
            <dt>survey date</dt>
            <dd>{fmtText(tree.surveyDate)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
