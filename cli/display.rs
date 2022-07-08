// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

/// A function that converts a milisecond elapsed time to a string that
/// represents a human readable version of that time.
pub fn human_elapsed(elapsed: u128) -> String {
  if elapsed < 1_000 {
    return format!("{}ms", elapsed);
  }
  if elapsed < 1_000 * 60 {
    return format!("{}s", elapsed / 1000);
  }

  let seconds = elapsed / 1_000;
  let minutes = seconds / 60;
  let seconds_remainder = seconds % 60;
  format!("{}m{}s", minutes, seconds_remainder)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_human_elapsed() {
    assert_eq!(human_elapsed(1), "1ms");
    assert_eq!(human_elapsed(256), "256ms");
    assert_eq!(human_elapsed(1000), "1s");
    assert_eq!(human_elapsed(1001), "1s");
    assert_eq!(human_elapsed(1020), "1s");
    assert_eq!(human_elapsed(70 * 1000), "1m10s");
    assert_eq!(human_elapsed(86 * 1000 + 100), "1m26s");
  }
}
