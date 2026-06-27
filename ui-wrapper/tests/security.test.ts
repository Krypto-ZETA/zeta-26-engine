import { describe, test, expect } from "bun:test";
import { validateFile, validateConfig, sanitizePayload } from "../lib/validation";

function makeFile(name: string, content: string, size?: number): File {
  const blob = new Blob([content]);
  return new File([blob], name, { type: "application/json" });
}

describe("Security: File validation", () => {
  test("rejects non-json files", () => {
    const file = makeFile("test.txt", "{}");
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain(".json");
  });

  test("accepts valid json files", () => {
    const file = makeFile("config.json", "{}");
    const result = validateFile(file);
    expect(result.valid).toBe(true);
  });

  test("rejects empty files", () => {
    const file = makeFile("empty.json", "");
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("empty");
  });

  test("rejects files over 10MB", () => {
    const bigContent = "x".repeat(10 * 1024 * 1024 + 1);
    const file = makeFile("big.json", bigContent);
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("large");
  });
});

describe("Security: Config validation", () => {
  test("rejects non-object input", () => {
    expect(validateConfig(null).valid).toBe(false);
    expect(validateConfig("string").valid).toBe(false);
    expect(validateConfig(42).valid).toBe(false);
  });

  test("rejects prototype pollution via __proto__", () => {
    const data = JSON.parse('{"__proto__": {"polluted": true}, "nodes": []}');
    const result = validateConfig(data);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("prototype");
  });

  test("rejects prototype pollution via constructor", () => {
    const data = JSON.parse('{"constructor": {"prototype": {}}, "nodes": []}');
    const result = validateConfig(data);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("prototype");
  });

  test("rejects missing nodes array", () => {
    expect(validateConfig({}).valid).toBe(false);
    expect(validateConfig({ foo: "bar" }).valid).toBe(false);
  });

  test("rejects empty nodes array", () => {
    expect(validateConfig({ nodes: [] }).valid).toBe(false);
  });

  test("rejects missing metadata", () => {
    const result = validateConfig({
      nodes: [{ id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 }]
    });
    expect(result.valid).toBe(false);
  });

  test("rejects node with codex < 2", () => {
    const result = validateConfig({
      universe_metadata: { speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000, coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7, fiber_speed_fraction: 0.67 },
      nodes: [{ id: "A", codex: 1, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 }]
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("codex");
  });

  test("rejects node with negative radius", () => {
    const result = validateConfig({
      universe_metadata: { speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000, coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7, fiber_speed_fraction: 0.67 },
      nodes: [{ id: "A", codex: 8, x: 0, y: 0, radius_km: -100, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 }]
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("radius");
  });

  test("rejects node with < 4 towers", () => {
    const result = validateConfig({
      universe_metadata: { speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000, coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7, fiber_speed_fraction: 0.67 },
      nodes: [{ id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 2, atmosphere_thickness_km: 100, refraction_index: 1.0 }]
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("towers");
  });

  test("rejects refraction index < 1.0", () => {
    const result = validateConfig({
      universe_metadata: { speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000, coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7, fiber_speed_fraction: 0.67 },
      nodes: [{ id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 0.5 }]
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("refraction");
  });

  test("rejects duplicate node ids", () => {
    const result = validateConfig({
      universe_metadata: { speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000, coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7, fiber_speed_fraction: 0.67 },
      nodes: [
        { id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
        { id: "A", codex: 8, x: 100, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 }
      ]
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Duplicate");
  });

  test("rejects NaN in metadata", () => {
    const result = validateConfig({
      universe_metadata: { speed_of_light_kms: NaN, max_void_hop_distance_km: 50000000, coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7, fiber_speed_fraction: 0.67 },
      nodes: [{ id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 }]
    });
    expect(result.valid).toBe(false);
  });

  test("accepts valid config", () => {
    const result = validateConfig({
      universe_metadata: { speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000, coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7, fiber_speed_fraction: 0.67 },
      nodes: [
        { id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 },
        { id: "B", codex: 5, x: 100, y: 0, radius_km: 1000, active_towers: 4, atmosphere_thickness_km: 80, refraction_index: 1.01 }
      ]
    });
    expect(result.valid).toBe(true);
  });

  test("accepts planets key instead of nodes", () => {
    const result = validateConfig({
      universe_metadata: { speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000, coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7, fiber_speed_fraction: 0.67 },
      planets: [
        { id: "A", codex: 8, x: 0, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0 }
      ]
    });
    expect(result.valid).toBe(true);
  });

  test("rejects > 5000 nodes", () => {
    const nodes = Array.from({ length: 5001 }, (_, i) => ({
      id: `P${i}`, codex: 8, x: i, y: 0, radius_km: 1000, active_towers: 8, atmosphere_thickness_km: 100, refraction_index: 1.0
    }));
    const result = validateConfig({
      universe_metadata: { speed_of_light_kms: 300000, max_void_hop_distance_km: 50000000, coordinate_scale_unit_km: 100000, tower_processing_delay_ms: 7, fiber_speed_fraction: 0.67 },
      nodes
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Too many");
  });
});

describe("Security: Payload sanitization", () => {
  test("truncates payload over 10000 chars", () => {
    const long = "X".repeat(15000);
    const result = sanitizePayload(long);
    expect(result.length).toBe(10000);
  });

  test("passes short payload through unchanged", () => {
    expect(sanitizePayload("Hello")).toBe("Hello");
  });

  test("passes empty payload through", () => {
    expect(sanitizePayload("")).toBe("");
  });
});
