const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = -1;
let lastRandom: number[] = [];

/** A ULID: 10 characters of time then 16 random ones, increasing within a millisecond. */
export function ulid(now: number = Date.now()): string {
  let random: number[];
  if (now <= lastTime) {
    now = lastTime;
    random = increment(lastRandom);
  } else {
    lastTime = now;
    random = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (b) => b % 32,
    );
  }
  lastRandom = random;
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) {
    time = ENCODING[t % 32] + time;
  }
  return time + random.map((d) => ENCODING[d]).join("");
}

function increment(digits: number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]! < 31) {
      next[i]! += 1;
      return next;
    }
    next[i] = 0;
  }
  throw new Error("ULID random part overflowed");
}
