const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

fn encode_byte(b: u8, base: u8, buf: &mut [u8; 64]) -> &str {
    let mut val = b as u64;
    let mut pos = 64usize;
    if val == 0 {
        buf[63] = b'0';
        return std::str::from_utf8(&buf[63..]).unwrap();
    }
    while val > 0 {
        pos -= 1;
        buf[pos] = DIGITS[(val % base as u64) as usize];
        val /= base as u64;
    }
    std::str::from_utf8(&buf[pos..]).unwrap()
}

fn decode_digit(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'A'..=b'Z' => Some(c - b'A' + 10),
        b'a'..=b'z' => Some(c - b'a' + 10),
        _ => None,
    }
}

fn decode_token(token: &str, base: u8) -> Option<u8> {
    let mut val: u64 = 0;
    for &c in token.as_bytes() {
        let d = decode_digit(c)?;
        if d >= base {
            return None;
        }
        val = val.checked_mul(base as u64)?;
        val = val.checked_add(d as u64)?;
        if val > 255 {
            return None;
        }
    }
    Some(val as u8)
}

pub fn encode_for_transmission(payload: &str, dest_codex: u8) -> String {
    let base = dest_codex.clamp(2, 36);
    let mut buf = [0u8; 64];
    let mut result = String::with_capacity(payload.len() * 4);
    for (i, &byte) in payload.as_bytes().iter().enumerate() {
        if i > 0 {
            result.push(' ');
        }
        result.push_str(encode_byte(byte, base, &mut buf));
    }
    result
}

pub fn decode_from_transmission(encoded: &str, src_codex: u8) -> Option<String> {
    let base = src_codex.clamp(2, 36);
    let mut result = Vec::with_capacity(encoded.len());
    for token in encoded.split_whitespace() {
        if token.is_empty() {
            continue;
        }
        let byte = decode_token(token, base)?;
        result.push(byte);
    }
    String::from_utf8(result).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_h_base5() {
        let result = encode_for_transmission("H", 5);
        assert_eq!(result, "242");
    }

    #[test]
    fn test_encode_h_base14() {
        let result = encode_for_transmission("H", 14);
        assert_eq!(result, "52");
    }

    #[test]
    fn test_encode_h_base16() {
        let result = encode_for_transmission("H", 16);
        assert_eq!(result, "48");
    }

    #[test]
    fn test_encode_hello_base5() {
        let result = encode_for_transmission("Hello", 5);
        let expected = "242 401 413 413 421";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_roundtrip() {
        let original = "Hello";
        for base in 2..=36 {
            let encoded = encode_for_transmission(original, base);
            let decoded = decode_from_transmission(&encoded, base).unwrap();
            assert_eq!(decoded, original, "Roundtrip failed for base {}", base);
        }
    }

    #[test]
    fn test_decode_invalid_digit() {
        let result = decode_from_transmission("GG", 10);
        assert!(result.is_none());
    }

    #[test]
    fn test_encode_empty() {
        let result = encode_for_transmission("", 8);
        assert_eq!(result, "");
    }

    #[test]
    fn test_decode_empty() {
        let result = decode_from_transmission("", 8).unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn test_encode_byte_values() {
        let bytes: String = (0u8..=255u8).map(|b| b as char).collect();
        for base in [2u8, 8, 10, 16, 36] {
            let encoded = encode_for_transmission(&bytes, base);
            let decoded = decode_from_transmission(&encoded, base).unwrap();
            assert_eq!(decoded, bytes, "Full byte range roundtrip failed for base {}", base);
        }
    }

    #[test]
    fn test_decode_out_of_range() {
        let result = decode_from_transmission("256", 10);
        assert!(result.is_none());
    }

    #[test]
    fn stress_codec_roundtrip_50k() {
        let payloads = ["Hello World!", "Zeta-26", "", "\0\0\0", "The quick brown fox jumps over the lazy dog 0123456789"];
        for _ in 0..10000 {
            for &payload in &payloads {
                for base in 2..=36 {
                    let encoded = encode_for_transmission(payload, base);
                    let decoded = decode_from_transmission(&encoded, base);
                    assert_eq!(decoded, Some(payload.to_string()), "Roundtrip failed base={}", base);
                }
            }
        }
    }

    #[test]
    fn test_encode_zero_byte() {
        let result = encode_for_transmission("\0", 10);
        assert_eq!(result, "0");
    }
}
