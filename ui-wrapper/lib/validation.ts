const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_JSON_DEPTH = 10;
const MAX_NODES = 5000;
const MAX_FIELD_LENGTH = 1000;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

function getDepth(obj: unknown, current: number = 0): number {
  if (current > MAX_JSON_DEPTH) return current;
  if (obj === null || typeof obj !== 'object') return current;
  if (Array.isArray(obj)) {
    let max = current + 1;
    for (const item of obj) {
      max = Math.max(max, getDepth(item, current + 1));
    }
    return max;
  }
  let max = current + 1;
  for (const val of Object.values(obj as Record<string, unknown>)) {
    max = Math.max(max, getDepth(val, current + 1));
  }
  return max;
}

function checkPrototypePollution(obj: unknown, path: string = ''): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) {
    return obj.some((item, i) => checkPrototypePollution(item, `${path}[${i}]`));
  }
  const record = obj as Record<string, unknown>;
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  for (const key of Object.keys(record)) {
    if (dangerous.includes(key)) return true;
    if (checkPrototypePollution(record[key], `${path}.${key}`)) return true;
  }
  return false;
}

function validateNode(node: unknown, index: number): string | null {
  if (typeof node !== 'object' || node === null) return `Node ${index}: not an object`;
  const n = node as Record<string, unknown>;

  if (typeof n.id !== 'string' || n.id.length === 0) return `Node ${index}: missing or empty 'id'`;
  if (n.id.length > MAX_FIELD_LENGTH) return `Node ${index}: 'id' too long`;
  if (typeof n.codex !== 'number' || n.codex < 2 || n.codex > 36) return `Node ${index}: 'codex' must be 2-36`;
  if (typeof n.x !== 'number' || !Number.isFinite(n.x)) return `Node ${index}: 'x' must be finite number`;
  if (typeof n.y !== 'number' || !Number.isFinite(n.y)) return `Node ${index}: 'y' must be finite number`;
  if (typeof n.radius_km !== 'number' || n.radius_km <= 0) return `Node ${index}: 'radius_km' must be positive`;
  if (typeof n.active_towers !== 'number' || n.active_towers < 4) return `Node ${index}: 'active_towers' must be >= 4`;
  if (typeof n.atmosphere_thickness_km !== 'number' || n.atmosphere_thickness_km < 0) return `Node ${index}: 'atmosphere_thickness_km' must be >= 0`;
  if (typeof n.refraction_index !== 'number' || n.refraction_index < 1.0) return `Node ${index}: 'refraction_index' must be >= 1.0`;

  return null;
}

function validateMetadata(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) return 'missing universe_metadata';
  const m = meta as Record<string, unknown>;

  if (typeof m.speed_of_light_kms !== 'number' || !Number.isFinite(m.speed_of_light_kms) || m.speed_of_light_kms <= 0) return 'speed_of_light_kms must be positive';
  if (typeof m.max_void_hop_distance_km !== 'number' || !Number.isFinite(m.max_void_hop_distance_km) || m.max_void_hop_distance_km <= 0) return 'max_void_hop_distance_km must be positive';
  if (typeof m.coordinate_scale_unit_km !== 'number' || !Number.isFinite(m.coordinate_scale_unit_km) || m.coordinate_scale_unit_km <= 0) return 'coordinate_scale_unit_km must be positive';
  if (typeof m.tower_processing_delay_ms !== 'number' || !Number.isFinite(m.tower_processing_delay_ms) || m.tower_processing_delay_ms < 0) return 'tower_processing_delay_ms must be >= 0';
  if (typeof m.fiber_speed_fraction !== 'number' || !Number.isFinite(m.fiber_speed_fraction) || m.fiber_speed_fraction <= 0 || m.fiber_speed_fraction > 1) return 'fiber_speed_fraction must be in (0,1]';

  return null;
}

export function validateFile(file: File): ValidationResult {
  if (!file.name.endsWith('.json')) {
    return { valid: false, error: 'Only .json files are accepted' };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 10MB` };
  }
  if (file.size === 0) {
    return { valid: false, error: 'File is empty' };
  }
  return { valid: true };
}

export function validateConfig(data: unknown): ValidationResult {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'Config must be a JSON object' };
  }

  if (checkPrototypePollution(data)) {
    return { valid: false, error: 'Config contains dangerous prototype pollution keys' };
  }

  const depth = getDepth(data);
  if (depth > MAX_JSON_DEPTH) {
    return { valid: false, error: `JSON too deeply nested (${depth} levels). Max: ${MAX_JSON_DEPTH}` };
  }

  const obj = data as Record<string, unknown>;
  let nodes: unknown[];

  if (Array.isArray(data)) {
    nodes = data;
  } else if (Array.isArray(obj.nodes)) {
    nodes = obj.nodes;
  } else if (Array.isArray(obj.planets)) {
    nodes = obj.planets;
  } else {
    return { valid: false, error: 'No nodes array found. Expected "nodes" or "planets" key, or a root array.' };
  }

  if (nodes.length === 0) {
    return { valid: false, error: 'Nodes array is empty' };
  }
  if (nodes.length > MAX_NODES) {
    return { valid: false, error: `Too many nodes (${nodes.length}). Max: ${MAX_NODES}` };
  }

  const metaError = validateMetadata(obj.universe_metadata);
  if (metaError) {
    return { valid: false, error: metaError };
  }

  const seenIds = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const nodeErr = validateNode(nodes[i], i);
    if (nodeErr) return { valid: false, error: nodeErr };

    const node = nodes[i] as Record<string, unknown>;
    if (seenIds.has(node.id as string)) {
      return { valid: false, error: `Duplicate node id: "${node.id}"` };
    }
    seenIds.add(node.id as string);
  }

  return { valid: true };
}

export function sanitizePayload(payload: string): string {
  if (payload.length > 10000) {
    return payload.slice(0, 10000);
  }
  return payload;
}
