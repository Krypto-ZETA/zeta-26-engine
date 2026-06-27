use std::collections::HashMap;
use crate::config_parser::{PlanetNode, UniverseConfig, UniverseMetadata};
use crate::physics_engine::{crust_transit_ms, void_distance, void_travel_time_ms};

#[derive(Clone)]
pub struct NetworkGraph {
    pub n: usize,
    pub node_ids: Vec<String>,
    pub name_to_idx: HashMap<String, usize>,
    pub node_positions_km: Vec<(f64, f64)>,
    pub tv_matrix: Vec<f64>,
    pub tower_lut: Vec<Vec<(usize, usize)>>,
    pub tp_cache: Vec<Vec<f64>>,
    pub alive_mask: Vec<u64>,
    pub nodes: Vec<PlanetNode>,
    pub adj: Vec<Vec<usize>>,
    #[allow(dead_code)]
    pub meta: UniverseMetadata,
}

impl NetworkGraph {
    pub fn get_tv(&self, i: usize, j: usize) -> f64 {
        assert!(i < self.n && j < self.n,
            "get_tv: index out of bounds (i={}, j={}, n={})", i, j, self.n);
        if !self.is_alive(i) || !self.is_alive(j) {
            return f64::INFINITY;
        }
        self.tv_matrix[i * self.n + j]
    }

    pub fn kill_node(&mut self, idx: usize) {
        if idx < self.n {
            self.alive_mask[idx / 64] &= !(1u64 << (idx % 64));
        }
    }

    pub fn resurrect_node(&mut self, idx: usize) {
        if idx < self.n {
            self.alive_mask[idx / 64] |= 1u64 << (idx % 64);
        }
    }

    pub fn is_alive(&self, idx: usize) -> bool {
        idx < self.n && (self.alive_mask[idx / 64] & (1u64 << (idx % 64))) != 0
    }

    pub fn find_node_idx(&self, id: &str) -> Option<usize> {
        self.name_to_idx.get(id).copied()
    }

    pub fn get_tp(&self, planet_idx: usize, entry: usize, exit: usize) -> f64 {
        let n_towers = self.nodes[planet_idx].active_towers;
        assert!(entry < n_towers && exit < n_towers,
            "get_tp: tower index out of bounds for planet {} (entry={}, exit={}, n_towers={})",
            self.node_ids[planet_idx], entry, exit, n_towers);
        self.tp_cache[planet_idx][entry * n_towers + exit]
    }

    pub fn get_closest_towers(&self, a: usize, b: usize) -> (usize, usize) {
        if a >= self.n || b >= self.n {
            return (0, 0);
        }
        self.tower_lut[a][b]
    }

    pub fn get_active_edge_pairs(&self) -> Vec<(usize, usize)> {
        let mut edges = Vec::new();
        for i in 0..self.n {
            if !self.is_alive(i) {
                continue;
            }
            for j in (i + 1)..self.n {
                if !self.is_alive(j) {
                    continue;
                }
                let tv = self.tv_matrix[i * self.n + j];
                if tv.is_finite() {
                    edges.push((i, j));
                }
            }
        }
        edges
    }
}

fn closest_tower_angle(a: &PlanetNode, b: &PlanetNode) -> (usize, usize) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let tau = 2.0 * std::f64::consts::PI;
    let angle = dy.atan2(dx);

    let angle_per_a = tau / a.active_towers as f64;
    let cw_from_top_a = (std::f64::consts::FRAC_PI_2 - angle + tau) % tau;
    let tower_a = (cw_from_top_a / angle_per_a).round() as usize % a.active_towers.max(1);

    let angle_per_b = tau / b.active_towers as f64;
    let rev_angle = (-dy).atan2(-dx);
    let cw_from_top_b = (std::f64::consts::FRAC_PI_2 - rev_angle + tau) % tau;
    let tower_b = (cw_from_top_b / angle_per_b).round() as usize % b.active_towers.max(1);

    (tower_a, tower_b)
}

pub fn build_graph(config: UniverseConfig) -> NetworkGraph {
    let n = config.nodes.len();
    let meta = config.universe_metadata;
    let s = meta.coordinate_scale_unit_km;
    let l_max = meta.max_void_hop_distance_km;
    let c = meta.speed_of_light_kms;

    let node_ids: Vec<String> = config.nodes.iter().map(|n| n.id.clone()).collect();
    let name_to_idx: HashMap<String, usize> = node_ids.iter().enumerate().map(|(i, id)| (id.clone(), i)).collect();
    let node_positions_km: Vec<(f64, f64)> = config
        .nodes
        .iter()
        .map(|n| (n.x * s, n.y * s))
        .collect();

    let mut tv_matrix = vec![f64::INFINITY; n * n];
    let mut tower_lut = vec![vec![(0usize, 0usize); n]; n];

    for i in 0..n {
        tv_matrix[i * n + i] = 0.0;
        tower_lut[i][i] = (0, 0);
    }

    for i in 0..n {
        for j in (i + 1)..n {
            let l = void_distance(&config.nodes[i], &config.nodes[j], s);

            if l <= l_max {
                let tv = void_travel_time_ms(&config.nodes[i], &config.nodes[j], l, c);
                tv_matrix[i * n + j] = tv;
                tv_matrix[j * n + i] = tv;
            }

            let pair = closest_tower_angle(&config.nodes[i], &config.nodes[j]);
            tower_lut[i][j] = pair;
            let rev = closest_tower_angle(&config.nodes[j], &config.nodes[i]);
            tower_lut[j][i] = rev;
        }
    }

    let mut tp_cache: Vec<Vec<f64>> = Vec::with_capacity(n);
    for planet in &config.nodes {
        let t = planet.active_towers;
        let mut row = Vec::with_capacity(t * t);
        for entry in 0..t {
            for exit in 0..t {
                row.push(crust_transit_ms(planet, entry, exit, &meta));
            }
        }
        tp_cache.push(row);
    }

    let words = n.div_ceil(64);
    let mut alive_mask = vec![0u64; words];
    for i in 0..n {
        alive_mask[i / 64] |= 1u64 << (i % 64);
    }
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    for i in 0..n {
        for j in (i + 1)..n {
            if tv_matrix[i * n + j].is_finite() {
                adj[i].push(j);
                adj[j].push(i);
            }
        }
    }

    NetworkGraph {
        n,
        node_ids,
        name_to_idx,
        node_positions_km,
        tv_matrix,
        tower_lut,
        tp_cache,
        alive_mask,
        nodes: config.nodes,
        adj,
        meta,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config_parser::parse_config;

    const REAL_CONFIG: &str = include_str!("../../universe-config.json");

    fn real_config() -> UniverseConfig {
        parse_config(REAL_CONFIG).unwrap()
    }

    #[test]
    fn test_build_graph_6_nodes() {
        let graph = build_graph(real_config());
        assert_eq!(graph.n, 6);
        assert_eq!(
            graph.node_ids,
            vec!["Aegis", "Boreas", "Dawn", "Elysium", "Fenix", "Caelum"]
        );
    }

    #[test]
    fn test_edge_count() {
        let graph = build_graph(real_config());
        let edges = graph.get_active_edge_pairs();
        assert_eq!(edges.len(), 12, "Expected 12 valid edges from universe-config.json");
    }

    #[test]
    fn test_dropped_edges_exceed_lmax() {
        let graph = build_graph(real_config());
        let dropped_pairs = [("Aegis", "Fenix"), ("Aegis", "Caelum"), ("Boreas", "Caelum")];
        for (a_id, b_id) in &dropped_pairs {
            let a = graph.find_node_idx(a_id).unwrap();
            let b = graph.find_node_idx(b_id).unwrap();
            let tv = graph.get_tv(a, b);
            assert!(tv.is_infinite(), "{}-{} edge should be dropped (L > 50M km)", a_id, b_id);
        }
    }

    #[test]
    fn test_alive_bitmask_kill() {
        let mut graph = build_graph(real_config());
        let idx = graph.find_node_idx("Aegis").unwrap();
        assert!(graph.is_alive(idx));
        graph.kill_node(idx);
        assert!(!graph.is_alive(idx));
    }

    #[test]
    fn test_kill_masks_edges() {
        let mut graph = build_graph(real_config());
        let a = graph.find_node_idx("Aegis").unwrap();
        let b = graph.find_node_idx("Boreas").unwrap();
        assert!(graph.get_tv(a, b).is_finite());
        graph.kill_node(a);
        assert!(graph.get_tv(a, b).is_infinite());
    }

    #[test]
    fn test_resurrect_restores_edges() {
        let mut graph = build_graph(real_config());
        let a = graph.find_node_idx("Aegis").unwrap();
        let b = graph.find_node_idx("Boreas").unwrap();
        graph.kill_node(a);
        graph.resurrect_node(a);
        assert!(graph.get_tv(a, b).is_finite());
    }

    #[test]
    fn test_positions_scaled() {
        let graph = build_graph(real_config());
        let s = graph.meta.coordinate_scale_unit_km;
        let a = graph.find_node_idx("Aegis").unwrap();
        assert_eq!(graph.node_positions_km[a], (0.0, 0.0));
        let b = graph.find_node_idx("Boreas").unwrap();
        assert_eq!(graph.node_positions_km[b], (150.0 * s, 100.0 * s));
        let c = graph.find_node_idx("Caelum").unwrap();
        assert_eq!(graph.node_positions_km[c], (650.0 * s, 200.0 * s));
    }

    #[test]
    fn stress_kill_resurrect_100k_cycles() {
        let mut graph = build_graph(real_config());
        for i in 0..100000 {
            let idx = i % graph.n;
            graph.kill_node(idx);
            assert!(!graph.is_alive(idx));
            graph.resurrect_node(idx);
            assert!(graph.is_alive(idx));
        }
        assert_eq!(graph.get_active_edge_pairs().len(), 12);
    }

    #[test]
    fn stress_edge_checks_50k() {
        let graph = build_graph(real_config());
        let n = graph.n;
        for _ in 0..50000 {
            for i in 0..n {
                for j in 0..n {
                    if i != j {
                        let _ = graph.get_tv(i, j);
                    }
                }
            }
        }
    }

    #[test]
    fn test_tower_0_at_top_clockwise() {
        let a = PlanetNode {
            id: "Origin".into(), codex: 10, x: 0.0, y: 0.0,
            radius_km: 1000.0, active_towers: 8,
            atmosphere_thickness_km: 100.0, refraction_index: 1.0,
        };
        let above = PlanetNode {
            id: "Above".into(), codex: 10, x: 0.0, y: 100.0,
            radius_km: 1000.0, active_towers: 8,
            atmosphere_thickness_km: 100.0, refraction_index: 1.0,
        };
        let right = PlanetNode {
            id: "Right".into(), codex: 10, x: 100.0, y: 0.0,
            radius_km: 1000.0, active_towers: 8,
            atmosphere_thickness_km: 100.0, refraction_index: 1.0,
        };
        let (t_a, _) = closest_tower_angle(&a, &above);
        assert_eq!(t_a, 0, "Tower 0 should be at top (12 o'clock)");
        let (t_r, _) = closest_tower_angle(&a, &right);
        assert_eq!(t_r, 2, "Tower 2 should be at right (3 o'clock) with 8 towers");
    }

    #[test]
    fn test_valid_edges_all_present() {
        let graph = build_graph(real_config());
        let edges = graph.get_active_edge_pairs();
        let expected_count = 12;
        assert_eq!(edges.len(), expected_count);
        for &(i, j) in &edges {
            let tv = graph.get_tv(i, j);
            assert!(tv.is_finite() && tv > 0.0, "Edge {}<->{} has invalid Tv={}", graph.node_ids[i], graph.node_ids[j], tv);
        }
    }
}
