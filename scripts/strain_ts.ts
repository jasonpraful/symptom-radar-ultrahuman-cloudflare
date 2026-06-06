/**
 * Reads a JSON array of histories from the file given as argv[2] and prints, for
 * each, the TypeScript `assessStrain` result. Used by `strain_parity.py` to fuzz
 * the strain algorithm against the Python reference across many synthetic cases.
 */
import { readFileSync } from "node:fs";
import { assessStrain } from "../src/strain.js";
import type { SnapshotRow } from "../src/types.js";

const file = process.argv[2];
const histories = JSON.parse(readFileSync(file, "utf8")) as SnapshotRow[][];
const out = histories.map((h) => assessStrain(h));
process.stdout.write(JSON.stringify(out));
