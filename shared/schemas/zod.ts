import { z } from "zod";

/*
 * Every schema imports `z` from here, never from "zod" directly (an ESLint rule
 * enforces it). Zod speeds up object parsing by compiling code with
 * `new Function`, and before that it probes whether eval is allowed. Under our
 * CSP and Trusted Types the probe throws (zod catches it) but the browser still
 * reports a policy violation. Jitless mode skips both; the speed difference is
 * irrelevant at our sizes. Workers forbid eval as well.
 */
z.config({ jitless: true });

export { z };
