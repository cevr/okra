import { describe, it, expect } from "bun:test";
import { Option } from "effect";
import { resolveJob } from "../../../../src/brain/commands/daemon/schedule.js";

describe("resolveJob", () => {
  describe("Sunday (0)", () => {
    it("9am -> meditate", () =>
      expect(resolveJob({ day: 0, hour: 9 })).toEqual(Option.some("meditate")));
    it("1pm -> reflect", () =>
      expect(resolveJob({ day: 0, hour: 13 })).toEqual(Option.some("reflect")));
    it("5pm -> reflect", () =>
      expect(resolveJob({ day: 0, hour: 17 })).toEqual(Option.some("reflect")));
    it("9pm -> reflect", () =>
      expect(resolveJob({ day: 0, hour: 21 })).toEqual(Option.some("reflect")));
  });

  describe("Mon-Thu (1-4)", () => {
    for (const day of [1, 2, 3, 4] as const) {
      it(`day ${day} 9am -> ruminate`, () =>
        expect(resolveJob({ day, hour: 9 })).toEqual(Option.some("ruminate")));
      it(`day ${day} 1pm -> reflect`, () =>
        expect(resolveJob({ day, hour: 13 })).toEqual(Option.some("reflect")));
      it(`day ${day} 5pm -> reflect`, () =>
        expect(resolveJob({ day, hour: 17 })).toEqual(Option.some("reflect")));
      it(`day ${day} 9pm -> reflect`, () =>
        expect(resolveJob({ day, hour: 21 })).toEqual(Option.some("reflect")));
    }
  });

  describe("Fri/Sat (5-6) skip all", () => {
    for (const day of [5, 6] as const) {
      for (const hour of [9, 13, 17, 21]) {
        it(`day ${day} hour ${hour} -> none`, () =>
          expect(resolveJob({ day, hour })).toEqual(Option.none()));
      }
    }
  });

  describe("unexpected hours -> none", () => {
    it("3am -> none", () => expect(resolveJob({ day: 1, hour: 3 })).toEqual(Option.none()));
    it("midnight -> none", () => expect(resolveJob({ day: 0, hour: 0 })).toEqual(Option.none()));
    it("10am -> none", () => expect(resolveJob({ day: 2, hour: 10 })).toEqual(Option.none()));
  });
});
