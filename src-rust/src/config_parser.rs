use serde::Deserialize;
use std::fmt;

#[derive(Deserialize, Debug, Clone)]
pub struct UniverseConfig {
    pub universe_metadata: UniverseMetadata,
    pub nodes: Vec<PlanetNode>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct UniverseMetadata {
    pub speed_of_light_kms: f64,
    pub max_void_hop_distance_km: f64,
    pub coordinate_scale_unit_km: f64,
    pub tower_processing_delay_ms: f64,
    pub fiber_speed_fraction: f64,
}

#[derive(Deserialize, Debug, Clone)]
pub struct PlanetNode {
    pub id: String,
    pub codex: u8,
    pub x: f64,
    pub y: f64,
    pub radius_km: f64,
    pub active_towers: usize,
    pub atmosphere_thickness_km: f64,
    pub refraction_index: f64,
}

#[derive(Debug)]
pub enum ConfigError {
    Json(serde_json::Error),
    Validation(String),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::Json(e) => write!(f, "JSON parse error: {}", e),
            ConfigError::Validation(msg) => write!(f, "Validation error: {}", msg),
        }
    }
}

impl From<serde_json::Error> for ConfigError {
    fn from(e: serde_json::Error) -> Self {
        ConfigError::Json(e)
    }
}

pub fn parse_config(json: &str) -> Result<UniverseConfig, ConfigError> {
    let config: UniverseConfig = serde_json::from_str(json)?;
    validate_config(&config)?;
    Ok(config)
}

fn validate_config(config: &UniverseConfig) -> Result<(), ConfigError> {
    let meta = &config.universe_metadata;

    if !meta.speed_of_light_kms.is_finite() || meta.speed_of_light_kms <= 0.0 {
        return Err(ConfigError::Validation("speed_of_light_kms must be a positive finite number".into()));
    }
    if !meta.max_void_hop_distance_km.is_finite() || meta.max_void_hop_distance_km <= 0.0 {
        return Err(ConfigError::Validation("max_void_hop_distance_km must be a positive finite number".into()));
    }
    if !meta.coordinate_scale_unit_km.is_finite() || meta.coordinate_scale_unit_km <= 0.0 {
        return Err(ConfigError::Validation("coordinate_scale_unit_km must be a positive finite number".into()));
    }
    if !meta.tower_processing_delay_ms.is_finite() || meta.tower_processing_delay_ms < 0.0 {
        return Err(ConfigError::Validation("tower_processing_delay_ms must be a finite non-negative number".into()));
    }
    if !meta.fiber_speed_fraction.is_finite() || meta.fiber_speed_fraction <= 0.0 || meta.fiber_speed_fraction > 1.0 {
        return Err(ConfigError::Validation("fiber_speed_fraction must be a finite number in (0,1]".into()));
    }

    if config.nodes.is_empty() {
        return Err(ConfigError::Validation("at least one node required".into()));
    }

    let mut seen_ids = std::collections::HashSet::new();
    for (i, node) in config.nodes.iter().enumerate() {
        if node.id.is_empty() {
            return Err(ConfigError::Validation(format!("node[{}] has empty id", i)));
        }
        if !seen_ids.insert(&node.id) {
            return Err(ConfigError::Validation(format!("duplicate node id: {}", node.id)));
        }
        if node.codex < 2 {
            return Err(ConfigError::Validation(format!("{} codex {} must be >= 2", node.id, node.codex)));
        }
        if !node.radius_km.is_finite() || node.radius_km <= 0.0 {
            return Err(ConfigError::Validation(format!("{} radius_km must be a positive finite number", node.id)));
        }
        if node.active_towers < 4 {
            return Err(ConfigError::Validation(format!("{} active_towers {} must be >= 4", node.id, node.active_towers)));
        }
        if !node.atmosphere_thickness_km.is_finite() || node.atmosphere_thickness_km < 0.0 {
            return Err(ConfigError::Validation(format!("{} atmosphere_thickness_km must be a finite number >= 0", node.id)));
        }
        if !node.refraction_index.is_finite() || node.refraction_index < 1.0 {
            return Err(ConfigError::Validation(format!("{} refraction_index must be a finite number >= 1.0", node.id)));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL_CONFIG: &str = include_str!("../../universe-config.json");

    fn real_config() -> UniverseConfig {
        parse_config(REAL_CONFIG).unwrap()
    }

    #[test]
    fn stress_config_parse_10k() {
        for _ in 0..10000 {
            let config = real_config();
            assert_eq!(config.nodes.len(), 6);
        }
    }

    #[test]
    fn test_parse_real_config() {
        let config = real_config();
        assert_eq!(config.universe_metadata.speed_of_light_kms, 300000.0);
        assert_eq!(config.nodes.len(), 6);
        assert_eq!(config.nodes[0].id, "Aegis");
        assert_eq!(config.nodes[5].id, "Caelum");
    }

    #[test]
    fn test_rejects_bad_json() {
        let err = parse_config("not json").unwrap_err();
        assert!(matches!(err, ConfigError::Json(_)));
    }

    #[test]
    fn test_rejects_empty_nodes() {
        let nodes_start = REAL_CONFIG.find(r#""nodes": ["#).unwrap();
        let nodes_end = REAL_CONFIG.rfind(']').unwrap();
        let json = format!(
            "{}\"nodes\": []{}",
            &REAL_CONFIG[..nodes_start],
            &REAL_CONFIG[nodes_end + 1..]
        );
        let err = parse_config(&json).unwrap_err();
        assert!(err.to_string().contains("at least one node"));
    }

    #[test]
    fn test_rejects_codex_below_2() {
        let json = REAL_CONFIG.replace(r#""codex": 8"#, r#""codex": 1"#);
        let err = parse_config(&json).unwrap_err();
        assert!(err.to_string().contains("codex"));
    }

    #[test]
    fn test_rejects_radius_zero() {
        let json = REAL_CONFIG.replace(r#""radius_km": 6371.0"#, r#""radius_km": 0.0"#);
        let err = parse_config(&json).unwrap_err();
        assert!(err.to_string().contains("radius_km"));
    }

    #[test]
    fn test_rejects_fewer_than_4_towers() {
        let json = REAL_CONFIG.replace(r#""active_towers": 8"#, r#""active_towers": 2"#);
        let err = parse_config(&json).unwrap_err();
        assert!(err.to_string().contains("active_towers"));
    }

    #[test]
    fn test_rejects_refraction_below_1() {
        let json = REAL_CONFIG.replace(r#""refraction_index": 1.0003"#, r#""refraction_index": 0.9"#);
        let err = parse_config(&json).unwrap_err();
        assert!(err.to_string().contains("refraction_index"));
    }

    #[test]
    fn test_rejects_duplicate_id() {
        let json = REAL_CONFIG.replacen(r#""id": "Aegis""#, r#""id": "Dup""#, 1);
        let json = json.replacen(r#""id": "Boreas""#, r#""id": "Dup""#, 1);
        let err = parse_config(&json).unwrap_err();
        assert!(err.to_string().contains("duplicate"));
    }
}
