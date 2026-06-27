# Zeta-26 Speed — Visual Comparison

## Operations Per Second

```
get_active_edges_ptr  ████████████████████████████████████████████  1,250,000 ops/s
get_node_positions_ptr ████████████████████████████████████████     1,000,000 ops/s
calculate_route (direct) ████████████████████████                     117,647 ops/s
calculate_route (3-hop)  ██████████████████████                       86,956 ops/s
get_active_edges         ████████████████                            625,000 ops/s
get_node_positions       ████████                                    312,500 ops/s
kill+resurrect           ████████████████                            333,333 ops/s
encode+decode            ██████████████                              232,558 ops/s
load_config              ████                                         15,700 ops/s
all-pairs (30 routes)    █                                             2,821 ops/s
```

## Time Per Operation (lower = faster)

```
get_active_edges_ptr  ▏                                            0.8 µs
get_node_positions_ptr ▏                                           1.0 µs
get_active_edges      ▏                                            1.6 µs
kill+resurrect        ▏                                            3.0 µs
get_node_positions    ▏                                            3.2 µs
encode+decode         ▏                                            4.3 µs
calculate_route (dir) ▏                                            8.5 µs
calculate_route (3h)  ▌                                           11.5 µs
load_config           ██████                                       63.7 µs
all-pairs (30)        ██████████████████████████████████████████  354.5 µs
```

## Speed Context

| Event | Time |
|-------|------|
| Zeta-26 direct route | 8.5 µs |
| Zeta-26 3-hop route | 11.5 µs |
| Zeta-26 kill/resurrect | 3.0 µs |
| Light travels 1 km | 3.3 µs |
| Human blink | 300,000 µs |
| 1 frame at 60 FPS | 16,667 µs |
| **Routes per frame** | **1,450** |
| **Kills per second** | **333,333** |

## Binary Size

```
Zeta-26 WASM   ████████████████████████  116.6 KB
JS Glue        ████                       17.8 KB
Total          ██████████████████████████ 134.4 KB
```

> 134 KB total — smaller than most web fonts. Loads in <1ms.
