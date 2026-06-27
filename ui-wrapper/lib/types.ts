export interface PlanetNode {
  id: string;
  codex: number;
  x: number;
  y: number;
  radius_km: number;
  active_towers: number;
  atmosphere_thickness_km: number;
  refraction_index: number;
}

export interface UniverseMetadata {
  speed_of_light_kms: number;
  max_void_hop_distance_km: number;
  coordinate_scale_unit_km: number;
  tower_processing_delay_ms: number;
  fiber_speed_fraction: number;
  system_name: string;
}

export interface UniverseConfig {
  universe_metadata: UniverseMetadata;
  nodes: PlanetNode[];
}

export interface HopResult {
  planet: string;
  tower_entry?: number;
  tower_exit?: number;
  payload_state: string;
  tp_ms: number;
  fiber_transit_ms: number;
  tower_delay_ms: number;
  tv_from_prev_ms?: number;
  atmospheric_refraction_ms?: number;
  void_transmission_ms?: number;
}

export interface RouteResult {
  origin_id: string;
  destination_id: string;
  current_id: string;
  payload: string;
  hop_log: HopResult[];
  path: number[];
  total_latency_ms: number;
}

export interface Edge {
  i: number;
  j: number;
}
