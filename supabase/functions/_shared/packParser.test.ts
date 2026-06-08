// Tests for the shared pack-string parser.
// Patterns here are real-world items observed in production:
//   - #N can prefix    → Blaze Red Sauce Can ("6/#10 CN")
//   - Leading-decimal  → Peroxide (".8 GA"), Sugar Packets (".1 OZ")
// Run with: deno test supabase/functions/_shared/packParser.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsePackString } from "./packParser.ts";

Deno.test("slash pack — '4 / 1 GA'", () => {
  assertEquals(parsePackString("4 / 1 GA"), { outer_qty: 4, inner_qty: 1, inner_type: 'ga', common_unit: 'ga' });
});

Deno.test("slash pack — '6/5LB'", () => {
  assertEquals(parsePackString("6/5LB"), { outer_qty: 6, inner_qty: 5, inner_type: 'lb', common_unit: 'lb' });
});

Deno.test("slash pack — '1/4 LB'", () => {
  assertEquals(parsePackString("1/4 LB"), { outer_qty: 1, inner_qty: 4, inner_type: 'lb', common_unit: 'lb' });
});

Deno.test("slash pack — '12/1 RL' (roll → ea)", () => {
  assertEquals(parsePackString("12/1 RL"), { outer_qty: 12, inner_qty: 1, inner_type: 'ea', common_unit: 'ea' });
});

Deno.test("no-slash pack — '3 CT'", () => {
  assertEquals(parsePackString("3 CT"), { outer_qty: 1, inner_qty: 3, inner_type: 'ea', common_unit: 'ea' });
});

Deno.test("no-slash pack — '2.5 KG'", () => {
  assertEquals(parsePackString("2.5 KG"), { outer_qty: 1, inner_qty: 2.5, inner_type: 'kg', common_unit: 'kg' });
});

// ── #N can prefix (Blaze Red Sauce pattern) ──
Deno.test("hash-can — '6/#10 CN' → 6 cans × 104 fl oz", () => {
  assertEquals(parsePackString("6/#10 CN"), { outer_qty: 6, inner_qty: 104, inner_type: 'oz', common_unit: 'oz' });
});

Deno.test("hash-can — '4/#5 CN'", () => {
  assertEquals(parsePackString("4/#5 CN"), { outer_qty: 4, inner_qty: 56, inner_type: 'oz', common_unit: 'oz' });
});

Deno.test("hash-can — '12/#2.5 CN' (fractional size)", () => {
  assertEquals(parsePackString("12/#2.5 CN"), { outer_qty: 12, inner_qty: 29, inner_type: 'oz', common_unit: 'oz' });
});

Deno.test("hash-can — '6/#10' (no unit suffix)", () => {
  assertEquals(parsePackString("6/#10"), { outer_qty: 6, inner_qty: 104, inner_type: 'oz', common_unit: 'oz' });
});

// ── Leading-decimal qty (Peroxide, Sugar Packets pattern) ──
Deno.test("leading-decimal — '.8 GA' (Peroxide)", () => {
  assertEquals(parsePackString(".8 GA"), { outer_qty: 1, inner_qty: 0.8, inner_type: 'ga', common_unit: 'ga' });
});

Deno.test("leading-decimal — '.1 OZ' (Sugar Packets)", () => {
  assertEquals(parsePackString(".1 OZ"), { outer_qty: 1, inner_qty: 0.1, inner_type: 'oz', common_unit: 'oz' });
});

Deno.test("leading-decimal in slash form — '1/.8 GA'", () => {
  assertEquals(parsePackString("1/.8 GA"), { outer_qty: 1, inner_qty: 0.8, inner_type: 'ga', common_unit: 'ga' });
});

Deno.test("unknown unit passes through", () => {
  assertEquals(parsePackString("1/5 WIDGET"), { outer_qty: 1, inner_qty: 5, inner_type: 'widget', common_unit: 'widget' });
});

Deno.test("null / empty / garbage", () => {
  assertEquals(parsePackString(null), null);
  assertEquals(parsePackString(""), null);
  assertEquals(parsePackString("just words"), null);
});
