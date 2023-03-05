import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { eligibleGroup, group } from "./group.ts";

Deno.test("group works", () => {
  assertEquals(group("nois1ffy2rz96sjxzm2ezwkmvyeupktp7elt6w3xckt"), "B");
  assertEquals(group("nois1uw8c69maprjq5ure7x80x9nauasrn7why5dfwd"), "B");
  assertEquals(group("nois1zh77twxfc47eu59q7mc7027jvvcnrpte3sr922"), "B");
  assertEquals(group("nois1wpy3gwlw4tt3uy0u5jrspfz0w9azztvlr0d04s"), "A");
  assertEquals(group("nois1rw47dxvhw3ahdlcznvwpcz43cdq8l0832eg6re"), "A");
  assertEquals(group("nois12a8yv4ndgnkygujj7cmmkfz2j9wjanezldwye0"), "B");
});

Deno.test("eligibleGroup works", () => {
  assertEquals(eligibleGroup(10), "A");
  assertEquals(eligibleGroup(11), null);
  assertEquals(eligibleGroup(12), null);
  assertEquals(eligibleGroup(13), null);
  assertEquals(eligibleGroup(14), null);
  assertEquals(eligibleGroup(15), "B");
  assertEquals(eligibleGroup(16), null);
  assertEquals(eligibleGroup(17), null);
  assertEquals(eligibleGroup(18), null);
  assertEquals(eligibleGroup(19), null);
  assertEquals(eligibleGroup(20), "A");
  assertEquals(eligibleGroup(21), null);
  assertEquals(eligibleGroup(22), null);
  assertEquals(eligibleGroup(23), null);
  assertEquals(eligibleGroup(24), null);
  assertEquals(eligibleGroup(25), "B");
  assertEquals(eligibleGroup(26), null);
});
