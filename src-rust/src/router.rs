#![allow(clippy::missing_const_for_thread_local)]
use std::cell::RefCell;
use std::cmp::Ordering;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::collections::HashMap;
use crate::codex_translator;
use crate::graph_builder::NetworkGraph;

#[derive(PartialEq, Clone, Copy)]
struct TotalF64(f64);

impl Eq for TotalF64 {}

impl PartialOrd for TotalF64 {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for TotalF64 {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0)
    }
}

thread_local! {
    #[allow(clippy::type_complexity)]
    static ROUTE_CACHE: RefCell<HashMap<(usize, usize), (u64, Vec<usize>, f64)>> = RefCell::new(HashMap::new());
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HopLogEntry {
    pub planet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tower_entry: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tower_exit: Option<usize>,
    pub payload_state: String,
    pub tp_ms: f64,
    pub fiber_transit_ms: f64,
    pub tower_delay_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tv_from_prev_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub atmospheric_refraction_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub void_transmission_ms: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RouteResult {
    pub origin_id: String,
    pub destination_id: String,
    pub current_id: String,
    pub payload: String,
    pub hop_log: Vec<HopLogEntry>,
    pub path: Vec<usize>,
    pub total_latency_ms: f64,
}

pub fn clear_route_cache() {
    ROUTE_CACHE.with(|c| c.borrow_mut().clear());
}

fn build_hop_log(
    graph: &NetworkGraph,
    path: &[usize],
    payload: &str,
    _origin_id: &str,
    _dest_id: &str,
) -> (Vec<HopLogEntry>, f64) {
    let mut hop_log = Vec::with_capacity(path.len());
    let mut total_latency = 0.0;
    let mut pstate_buf = String::with_capacity(128);

    for (seg_idx, &planet_idx) in path.iter().enumerate() {
        let (entry_tower, exit_tower) = if path.len() == 1 {
            (0, 0)
        } else if seg_idx == 0 {
            let (t_exit, _) = graph.get_closest_towers(planet_idx, path[1]);
            (t_exit, t_exit)
        } else if seg_idx == path.len() - 1 {
            let (_, t_entry) = graph.get_closest_towers(path[seg_idx - 1], planet_idx);
            (t_entry, t_entry)
        } else {
            let (_, entry_tower) = graph.get_closest_towers(path[seg_idx - 1], planet_idx);
            let (exit_tower, _) = graph.get_closest_towers(planet_idx, path[seg_idx + 1]);
            (entry_tower, exit_tower)
        };

        let (fiber_transit_ms, tower_delay_ms) = crate::physics_engine::crust_transit_components(
            &graph.nodes[planet_idx], entry_tower, exit_tower, &graph.meta,
        );
        let tp = fiber_transit_ms + tower_delay_ms;
        total_latency += tp;

        let (tv_from_prev, atmospheric_refraction_ms, void_transmission_ms) = if seg_idx > 0 {
            let prev_idx = path[seg_idx - 1];
            let tv = graph.get_tv(prev_idx, planet_idx);
            if tv.is_finite() {
                total_latency += tv;
                let l_km = crate::physics_engine::void_distance(
                    &graph.nodes[prev_idx], &graph.nodes[planet_idx],
                    graph.meta.coordinate_scale_unit_km,
                );
                let (atmo, void) = crate::physics_engine::void_travel_components(
                    &graph.nodes[prev_idx], &graph.nodes[planet_idx], l_km,
                    graph.meta.speed_of_light_kms,
                );
                (Some(tv), Some(atmo), Some(void))
            } else {
                (None, None, None)
            }
        } else {
            (None, None, None)
        };

        let (tower_entry, tower_exit) = if path.len() == 1 {
            (None, None)
        } else if seg_idx == 0 {
            (None, Some(exit_tower))
        } else if seg_idx == path.len() - 1 {
            (Some(entry_tower), None)
        } else {
            (Some(entry_tower), Some(exit_tower))
        };

        pstate_buf.clear();
        use std::fmt::Write;
        let is_dest = seg_idx == path.len() - 1;
        if path.len() == 1 || is_dest {
            let _ = write!(&mut pstate_buf, "{}", payload);
        } else {
            let next_idx = path[seg_idx + 1];
            let dest_codex = graph.nodes[next_idx].codex;
            let encoded = codex_translator::encode_for_transmission(payload, dest_codex);
            let _ = write!(&mut pstate_buf, "{} (Base{})", encoded, dest_codex);
        }

        hop_log.push(HopLogEntry {
            planet: graph.node_ids[planet_idx].clone(),
            tower_entry,
            tower_exit,
            payload_state: pstate_buf.clone(),
            tp_ms: tp,
            fiber_transit_ms,
            tower_delay_ms,
            tv_from_prev_ms: tv_from_prev,
            atmospheric_refraction_ms,
            void_transmission_ms,
        });
    }

    (hop_log, total_latency)
}

fn dijkstra(graph: &NetworkGraph, src: usize) -> (Vec<f64>, Vec<Option<usize>>) {
    let n = graph.n;
    let inf = f64::INFINITY;
    let mut dist = vec![inf; n * n];
    let mut prev_state = vec![None::<usize>; n * n];

    let src_state = src * n + src;
    dist[src_state] = 0.0;

    let mut heap = BinaryHeap::new();
    heap.push(Reverse((TotalF64(0.0), src_state)));

    while let Some(Reverse((cost, state))) = heap.pop() {
        let u = state / n;
        let prev_u = state % n;

        if cost.0 > dist[state] {
            continue;
        }

        for &v in &graph.adj[u] {
            if !graph.is_alive(v) {
                continue;
            }
            let tv = graph.get_tv(u, v);
            if !tv.is_finite() {
                continue;
            }

            let (entry, exit) = if u == src {
                let (t_exit, _) = graph.get_closest_towers(u, v);
                (t_exit, t_exit)
            } else {
                let (_, t_entry) = graph.get_closest_towers(prev_u, u);
                let (t_exit, _) = graph.get_closest_towers(u, v);
                (t_entry, t_exit)
            };
            let tp_u = graph.get_tp(u, entry, exit);

            let next_cost = cost.0 + tp_u + tv;
            let next_state = v * n + u;

            if next_cost < dist[next_state] {
                dist[next_state] = next_cost;
                prev_state[next_state] = Some(state);
                heap.push(Reverse((TotalF64(next_cost), next_state)));
            }
        }
    }

    (dist, prev_state)
}

fn reconstruct_path(
    dist: &[f64],
    prev_state: &[Option<usize>],
    graph: &NetworkGraph,
    _src: usize,
    dst: usize,
) -> Option<(Vec<usize>, f64)> {
    let n = graph.n;
    let mut best_state = None;
    let mut best_total = f64::INFINITY;

    for p in 0..n {
        if p == dst {
            continue;
        }
        let state = dst * n + p;
        if dist[state].is_infinite() {
            continue;
        }
        let (_, entry) = graph.get_closest_towers(p, dst);
        let tp_dst = graph.get_tp(dst, entry, entry);
        let total = dist[state] + tp_dst;
        if total < best_total {
            best_total = total;
            best_state = Some(state);
        }
    }

    let mut state = best_state?;
    let mut path = Vec::new();

    loop {
        let node = state / n;
        path.push(node);
        match prev_state[state] {
            Some(s) => state = s,
            None => break,
        }
    }

    path.reverse();
    Some((path, best_total))
}


pub fn calculate_route(
    graph: &NetworkGraph,
    src_idx: usize,
    dst_idx: usize,
    origin_id: &str,
    dest_id: &str,
    payload: &str,
) -> Option<RouteResult> {
    if !graph.is_alive(src_idx) || !graph.is_alive(dst_idx) {
        return None;
    }

    let gen = graph.cache_gen.get();
    let cache_key = (src_idx, dst_idx);

    if let Some((cached_gen, cached_path, cached_latency)) = ROUTE_CACHE.with(|cache| {
        cache.borrow().get(&cache_key).cloned()
    }) {
        if cached_gen == gen {
            let (hop_log, _) = build_hop_log(graph, &cached_path, payload, origin_id, dest_id);
            let current_id = graph.node_ids[cached_path[cached_path.len() - 1]].clone();
            return Some(RouteResult {
                origin_id: origin_id.to_string(),
                destination_id: dest_id.to_string(),
                current_id,
                payload: payload.to_string(),
                hop_log,
                path: cached_path,
                total_latency_ms: cached_latency,
            });
        }
    }

    if src_idx == dst_idx {
        let tp = graph.get_tp(src_idx, 0, 0);
        let path = vec![src_idx];
        let (hop_log, _) = build_hop_log(graph, &path, payload, origin_id, dest_id);
        let result = RouteResult {
            origin_id: origin_id.to_string(),
            destination_id: dest_id.to_string(),
            current_id: origin_id.to_string(),
            payload: payload.to_string(),
            hop_log,
            path: path.clone(),
            total_latency_ms: tp,
        };
        ROUTE_CACHE.with(|cache| cache.borrow_mut().insert((src_idx, src_idx), (gen, path, tp)));
        return Some(result);
    }

    let (dist, prev_state) = dijkstra(graph, src_idx);
    let (path, total_latency) = match reconstruct_path(&dist, &prev_state, graph, src_idx, dst_idx) {
        Some(r) => r,
        None => return None,
    };
    if path[0] != src_idx || path[path.len() - 1] != dst_idx {
        return None;
    }

    let (hop_log, _) = build_hop_log(graph, &path, payload, origin_id, dest_id);
    let current_id = graph.node_ids[path[path.len() - 1]].clone();
    let result = RouteResult {
        origin_id: origin_id.to_string(),
        destination_id: dest_id.to_string(),
        current_id,
        payload: payload.to_string(),
        hop_log,
        path: path.clone(),
        total_latency_ms: total_latency,
    };
    ROUTE_CACHE.with(|cache| cache.borrow_mut().insert(cache_key, (gen, path, total_latency)));
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config_parser::parse_config;
    use crate::graph_builder::build_graph;

    const REAL_CONFIG: &str = include_str!("../../universe-config.json");

    fn setup_graph() -> NetworkGraph {
        let config = parse_config(REAL_CONFIG).unwrap();
        build_graph(config)
    }

    #[test]
    fn test_route_aegis_boreas_direct() {
        let graph = setup_graph();
        let src = graph.find_node_idx("Aegis").unwrap();
        let dst = graph.find_node_idx("Boreas").unwrap();
        let result = calculate_route(&graph, src, dst, "Aegis", "Boreas", "Hello").unwrap();
        assert_eq!(result.path, vec![src, dst]);
        assert!(result.total_latency_ms > 0.0);
        assert_eq!(result.hop_log.len(), 2);
        assert_eq!(result.origin_id, "Aegis");
        assert_eq!(result.destination_id, "Boreas");
        assert_eq!(result.payload, "Hello");
    }

    #[test]
    fn test_route_same_node() {
        let graph = setup_graph();
        let idx = graph.find_node_idx("Aegis").unwrap();
        let result = calculate_route(&graph, idx, idx, "Aegis", "Aegis", "Hello").unwrap();
        assert_eq!(result.path, vec![idx]);
        assert_eq!(result.origin_id, "Aegis");
        assert_eq!(result.destination_id, "Aegis");
    }

    #[test]
    fn test_route_aegis_caelum_reachable() {
        let graph = setup_graph();
        let src = graph.find_node_idx("Aegis").unwrap();
        let dst = graph.find_node_idx("Caelum").unwrap();
        let result = calculate_route(&graph, src, dst, "Aegis", "Caelum", "Hello").unwrap();
        assert_eq!(*result.path.first().unwrap(), src);
        assert_eq!(*result.path.last().unwrap(), dst);
        assert!(result.path.len() >= 3);
    }

    #[test]
    fn test_route_fails_on_killed_node() {
        let mut graph = setup_graph();
        let src = graph.find_node_idx("Aegis").unwrap();
        let dst = graph.find_node_idx("Boreas").unwrap();
        graph.kill_node(src);
        let result = calculate_route(&graph, src, dst, "Aegis", "Boreas", "Hello");
        assert!(result.is_none());
    }

    #[test]
    fn test_route_reroutes_around_killed() {
        let mut graph = setup_graph();
        let src = graph.find_node_idx("Aegis").unwrap();
        let dst = graph.find_node_idx("Caelum").unwrap();
        let boreas = graph.find_node_idx("Boreas").unwrap();
        graph.kill_node(boreas);
        let result = calculate_route(&graph, src, dst, "Aegis", "Caelum", "Hello").unwrap();
        assert_eq!(*result.path.first().unwrap(), src);
        assert_eq!(*result.path.last().unwrap(), dst);
        assert!(!result.path.contains(&boreas));
    }

    #[test]
    fn test_hop_detail_all_planets_have_tp() {
        let graph = setup_graph();
        let src = graph.find_node_idx("Aegis").unwrap();
        let dst = graph.find_node_idx("Caelum").unwrap();
        let result = calculate_route(&graph, src, dst, "Aegis", "Caelum", "Hello").unwrap();
        for hop in &result.hop_log {
            assert!(!hop.planet.is_empty());
            assert!(hop.tp_ms >= 7.0, "Tp {} = {} should be >= one tower delay", hop.planet, hop.tp_ms);
        }
    }

    #[test]
    fn test_all_pairs_reachable() {
        let graph = setup_graph();
        let n = graph.n;
        for i in 0..n {
            for j in i + 1..n {
                let result = calculate_route(&graph, i, j, &graph.node_ids[i], &graph.node_ids[j], "test");
                assert!(result.is_some(), "No route from {} to {}", graph.node_ids[i], graph.node_ids[j]);
            }
        }
    }

    #[test]
    fn test_latency_increases_with_hops() {
        let graph = setup_graph();
        let aegis = graph.find_node_idx("Aegis").unwrap();
        let boreas = graph.find_node_idx("Boreas").unwrap();
        let caelum = graph.find_node_idx("Caelum").unwrap();
        let direct = calculate_route(&graph, aegis, boreas, "Aegis", "Boreas", "Hello").unwrap();
        let multi = calculate_route(&graph, aegis, caelum, "Aegis", "Caelum", "Hello").unwrap();
        assert!(multi.total_latency_ms > direct.total_latency_ms,
            "Multi-hop route should have higher latency");
    }

    #[test]
    fn test_packet_json_output() {
        let graph = setup_graph();
        let src = graph.find_node_idx("Aegis").unwrap();
        let dst = graph.find_node_idx("Boreas").unwrap();
        let result = calculate_route(&graph, src, dst, "Aegis", "Boreas", "Hello").unwrap();
        assert_eq!(result.origin_id, "Aegis");
        assert_eq!(result.destination_id, "Boreas");
        assert_eq!(result.current_id, "Boreas");
        assert_eq!(result.payload, "Hello");
        assert_eq!(result.hop_log.len(), 2);
        assert_eq!(result.hop_log[0].tower_entry, None);
        assert!(result.hop_log[0].tower_exit.is_some());
        assert!(result.hop_log[0].payload_state.contains("Base5"),
            "origin should encode for next planet: {}", result.hop_log[0].payload_state);
        assert!(result.hop_log[1].tower_entry.is_some());
        assert_eq!(result.hop_log[1].tower_exit, None);
        assert_eq!(result.hop_log[1].payload_state, "Hello",
            "destination should show decoded literal");
        assert!(result.hop_log[1].tv_from_prev_ms.is_some());
    }

    #[test]
    fn test_packet_schema_field_names() {
        let graph = setup_graph();
        let src = graph.find_node_idx("Aegis").unwrap();
        let dst = graph.find_node_idx("Caelum").unwrap();
        let result = calculate_route(&graph, src, dst, "Aegis", "Caelum", "Hello").unwrap();
        assert_eq!(result.origin_id, "Aegis");
        assert_eq!(result.destination_id, "Caelum");
        assert_eq!(result.current_id, "Caelum");
        assert_eq!(result.payload, "Hello");
        assert_eq!(result.hop_log.first().unwrap().planet, "Aegis");
        assert_eq!(result.hop_log.last().unwrap().planet, "Caelum");
        assert!(result.hop_log.first().unwrap().tower_entry.is_none());
        assert!(result.hop_log.last().unwrap().tower_exit.is_none());
        assert!(result.hop_log.first().unwrap().payload_state.contains("Base"),
            "origin should encode for next planet: {}", result.hop_log.first().unwrap().payload_state);
        assert_eq!(result.hop_log.last().unwrap().payload_state, "Hello",
            "destination should show decoded literal");
    }

    #[test]
    fn stress_route_50k_all_pairs() {
        let graph = setup_graph();
        let n = graph.n;
        for _ in 0..5000 {
            for i in 0..n {
                for j in i + 1..n {
                    let r = calculate_route(&graph, i, j, &graph.node_ids[i], &graph.node_ids[j], "stress");
                    assert!(r.is_some(), "No route {} -> {}", graph.node_ids[i], graph.node_ids[j]);
                }
            }
        }
    }

    #[test]
    fn stress_route_kill_cycle_10k() {
        let mut graph = setup_graph();
        let aegis = graph.find_node_idx("Aegis").unwrap();
        let caelum = graph.find_node_idx("Caelum").unwrap();
        let boreas = graph.find_node_idx("Boreas").unwrap();
        for _ in 0..10000 {
            graph.kill_node(boreas);
            let r = calculate_route(&graph, aegis, caelum, "Aegis", "Caelum", "stress");
            assert!(r.is_some());
            assert!(!r.unwrap().path.contains(&boreas));
            graph.resurrect_node(boreas);
            let r2 = calculate_route(&graph, aegis, caelum, "Aegis", "Caelum", "stress");
            assert!(r2.is_some());
        }
    }

    #[test]
    fn stress_cache_hit_100k() {
        let graph = setup_graph();
        let aegis = graph.find_node_idx("Aegis").unwrap();
        let caelum = graph.find_node_idx("Caelum").unwrap();
        // Warm cache
        calculate_route(&graph, aegis, caelum, "Aegis", "Caelum", "warm");
        for _ in 0..100000 {
            let r = calculate_route(&graph, aegis, caelum, "Aegis", "Caelum", "cache");
            assert!(r.is_some());
        }
    }

    #[test]
    fn stress_same_node_50k() {
        let graph = setup_graph();
        for _ in 0..50000 {
            for idx in 0..graph.n {
                let r = calculate_route(&graph, idx, idx, &graph.node_ids[idx], &graph.node_ids[idx], "self");
                assert!(r.is_some());
            }
        }
    }

    #[test]
    fn test_cache_different_payloads() {
        let graph = setup_graph();
        let src = graph.find_node_idx("Aegis").unwrap();
        let dst = graph.find_node_idx("Boreas").unwrap();
        let r1 = calculate_route(&graph, src, dst, "Aegis", "Boreas", "Hello").unwrap();
        let r2 = calculate_route(&graph, src, dst, "Aegis", "Boreas", "World").unwrap();
        assert_eq!(r1.payload, "Hello");
        assert_eq!(r2.payload, "World");
        assert!(r1.hop_log[0].payload_state.contains("Base"),
            "origin should encode for next planet: {}", r1.hop_log[0].payload_state);
        assert_ne!(r1.hop_log[0].payload_state, r2.hop_log[0].payload_state,
            "different payloads should produce different payload_state");
        assert_eq!(r1.hop_log[1].payload_state, "Hello",
            "destination should show decoded literal");
        assert_eq!(r2.hop_log[1].payload_state, "World",
            "destination should show decoded literal");
    }
}
