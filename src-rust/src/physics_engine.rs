use std::f64::consts::PI;
use crate::config_parser::{PlanetNode, UniverseMetadata};

pub fn void_distance(a: &PlanetNode, b: &PlanetNode, scale_km: f64) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let center_dist_km = (dx * dx + dy * dy).sqrt() * scale_km;
    let a_radius = a.radius_km + a.atmosphere_thickness_km;
    let b_radius = b.radius_km + b.atmosphere_thickness_km;
    (center_dist_km - a_radius - b_radius).max(0.0)
}

pub fn void_travel_time_ms(a: &PlanetNode, b: &PlanetNode, l_km: f64, c_kms: f64) -> f64 {
    let h1n1 = a.atmosphere_thickness_km * a.refraction_index;
    let h2n2 = b.atmosphere_thickness_km * b.refraction_index;
    ((h1n1 + h2n2 + l_km) / c_kms) * 1000.0
}

pub fn crust_transit_ms(
    planet: &PlanetNode,
    entry_tower: usize,
    exit_tower: usize,
    meta: &UniverseMetadata,
) -> f64 {
    let n = planet.active_towers;
    let s = if entry_tower == exit_tower {
        0
    } else {
        let cw = (exit_tower + n - entry_tower) % n;
        let ccw = (entry_tower + n - exit_tower) % n;
        cw.min(ccw)
    };
    let m = if entry_tower == exit_tower { 1 } else { s + 1 };
    let travel_s = (2.0 * PI * planet.radius_km * s as f64)
        / (n as f64 * meta.fiber_speed_fraction * meta.speed_of_light_kms);
    travel_s * 1000.0 + m as f64 * meta.tower_processing_delay_ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config_parser::{parse_config, UniverseConfig};

    const REAL_CONFIG: &str = include_str!("../../universe-config.json");

    fn config() -> UniverseConfig {
        parse_config(REAL_CONFIG).unwrap()
    }

    fn node(id: &str) -> PlanetNode {
        config().nodes.into_iter().find(|n| n.id == id).unwrap()
    }

    fn meta() -> UniverseMetadata {
        config().universe_metadata
    }

    #[test]
    fn test_void_distance_aegis_boreas() {
        let a = node("Aegis");
        let b = node("Boreas");
        let s = config().universe_metadata.coordinate_scale_unit_km;
        let l = void_distance(&a, &b, s);
        let expected_km = 18_018_000.0;
        let diff = (l - expected_km).abs();
        assert!(diff < 1000.0, "L(Aegis,Boreas) = {} km, expected ~{} km", l, expected_km);
    }

    #[test]
    fn test_void_distance_same_planet_zero() {
        let a = node("Aegis");
        let s = config().universe_metadata.coordinate_scale_unit_km;
        let l = void_distance(&a, &a, s);
        assert_eq!(l, 0.0);
    }

    #[test]
    fn test_tv_aegis_boreas() {
        let a = node("Aegis");
        let b = node("Boreas");
        let m = meta();
        let l = void_distance(&a, &b, m.coordinate_scale_unit_km);
        let tv = void_travel_time_ms(&a, &b, l, m.speed_of_light_kms);
        let expected_ms = 60060.0;
        let diff = (tv - expected_ms).abs();
        assert!(diff < 100.0, "Tv(Aegis,Boreas) = {} ms, expected ~{} ms", tv, expected_ms);
    }

    #[test]
    fn test_tp_dawn_same_tower() {
        let p = node("Dawn");
        let m = meta();
        let tp = crust_transit_ms(&p, 0, 0, &m);
        assert!((tp - 7.0).abs() < 0.1, "Tp(Dawn,0→0) = {} ms, expected ~7.0 ms", tp);
    }

    #[test]
    fn test_tp_dawn_adjacent_towers() {
        let p = node("Dawn");
        let m = meta();
        let tp = crust_transit_ms(&p, 0, 1, &m);
        assert!(tp > 7.0, "Tp should include travel + at least one tower delay: {}", tp);
        assert!(tp < 500.0, "Tp too large: {}", tp);
    }

    #[test]
    fn test_void_distance_exceeds_lmax() {
        let a = node("Aegis");
        let c = node("Caelum");
        let s = config().universe_metadata.coordinate_scale_unit_km;
        let l = void_distance(&a, &c, s);
        assert!(l > 50_000_000.0, "L(Aegis,Caelum) = {} km should exceed Lmax", l);
    }

    #[test]
    fn stress_physics_100k_calls() {
        let cfg = config();
        let m = &cfg.universe_metadata;
        let s = m.coordinate_scale_unit_km;
        for _ in 0..10000 {
            for i in 0..cfg.nodes.len() {
                for j in i + 1..cfg.nodes.len() {
                    let l = void_distance(&cfg.nodes[i], &cfg.nodes[j], s);
                    let tv = void_travel_time_ms(&cfg.nodes[i], &cfg.nodes[j], l, m.speed_of_light_kms);
                    assert!(tv >= 0.0);
                }
            }
        }
        // Separate Tp stress with correct tower ranges per planet
        for _ in 0..1000 {
            for planet in &cfg.nodes {
                let t = planet.active_towers;
                for e in 0..t {
                    for x in 0..t {
                        let _ = crust_transit_ms(planet, e, x, m);
                    }
                }
            }
        }
    }

    #[test]
    fn test_tv_all_planet_pairs() {
        let cfg = config();
        let m = &cfg.universe_metadata;
        let s = m.coordinate_scale_unit_km;
        let c = m.speed_of_light_kms;
        for i in 0..cfg.nodes.len() {
            for j in i + 1..cfg.nodes.len() {
                let l = void_distance(&cfg.nodes[i], &cfg.nodes[j], s);
                let tv = void_travel_time_ms(&cfg.nodes[i], &cfg.nodes[j], l, c);
                assert!(tv >= 0.0, "Tv negative for {}->{}", cfg.nodes[i].id, cfg.nodes[j].id);
            }
        }
    }
}
