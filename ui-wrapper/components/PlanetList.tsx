'use client';

import { useEngine } from '@/lib/engine';

export default function PlanetList() {
  const { nodeIds, alive, toggleNode } = useEngine();

  if (!nodeIds.length) {
    return (
      <div className="nodes-list" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 80 }}>
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          Upload a config to load planets
        </span>
      </div>
    );
  }

  return (
    <div className="nodes-list">
      {nodeIds.map((id) => {
        const isDead = !alive[id];
        const uid = `t_${id.replace(/\W/g, '_')}`;
        return (
          <div key={id} className={`node-row${isDead ? ' dead' : ''}`}>
            <span className="node-name">{id}</span>
            <label className="tog">
              <input
                type="checkbox"
                id={uid}
                checked={!isDead}
                onChange={() => toggleNode(id)}
              />
              <span className="tog-track" />
              <span className="tog-thumb" />
            </label>
          </div>
        );
      })}
    </div>
  );
}
