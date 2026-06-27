use crate::graph_builder::NetworkGraph;

pub fn kill_node_by_id(graph: &mut NetworkGraph, id: &str) -> Option<usize> {
    let idx = graph.find_node_idx(id)?;
    graph.kill_node(idx);
    Some(idx)
}

pub fn resurrect_node_by_id(graph: &mut NetworkGraph, id: &str) -> Option<usize> {
    let idx = graph.find_node_idx(id)?;
    graph.resurrect_node(idx);
    Some(idx)
}

pub fn alive_mask_bytes(graph: &NetworkGraph) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(graph.alive_mask.len() * 8);
    for &word in &graph.alive_mask {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    bytes
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
    fn test_kill_by_id() {
        let mut graph = setup_graph();
        let idx = kill_node_by_id(&mut graph, "Aegis").unwrap();
        assert!(!graph.is_alive(idx));
    }

    #[test]
    fn test_kill_unknown_id_returns_none() {
        let mut graph = setup_graph();
        let result = kill_node_by_id(&mut graph, "Unknown");
        assert!(result.is_none());
    }

    #[test]
    fn test_resurrect_by_id() {
        let mut graph = setup_graph();
        let idx = graph.find_node_idx("Aegis").unwrap();
        graph.kill_node(idx);
        resurrect_node_by_id(&mut graph, "Aegis").unwrap();
        assert!(graph.is_alive(idx));
    }

    #[test]
    fn test_alive_mask_all_alive() {
        let graph = setup_graph();
        let mask = alive_mask_bytes(&graph);
        assert_eq!(mask.len(), 8);
        // Lower 6 bits of first word set = 0x3F
        assert_eq!(mask[0], 0x3F);
        assert!(mask[1..8].iter().all(|&b| b == 0));
    }

    #[test]
    fn test_alive_mask_after_kill() {
        let mut graph = setup_graph();
        kill_node_by_id(&mut graph, "Aegis").unwrap();
        let mask = alive_mask_bytes(&graph);
        assert_eq!(mask[0] & 1, 0); // Aegis (bit 0) is dead
        assert_eq!(mask[0] & 0x3E, 0x3E); // Other 5 bits still set
    }

    #[test]
    fn test_kill_all_nodes_sequential() {
        let mut graph = setup_graph();
        for i in 0..graph.n {
            assert!(graph.is_alive(i));
            graph.kill_node(i);
            assert!(!graph.is_alive(i));
        }
        let mask = alive_mask_bytes(&graph);
        assert!(mask.iter().all(|&b| b == 0));
    }
}
