import { describe, expect, it, vi } from "vitest";
import { fakeElement } from "./__helpers__/dom.js";

describe("fakeElement", () => {
	it("finds what it was given and nothing for any other selector", () => {
		const child = fakeElement({ dataset: { id: "c1" } });
		const el = fakeElement({
			one: { ".child": child },
			all: { ".child": [child, child] },
			closest: { ".row": child },
		});

		expect(el.querySelector(".child")).toBe(child);
		expect(el.querySelector(".other")).toBeNull();
		expect(el.querySelectorAll(".child")).toEqual([child, child]);
		expect(el.querySelectorAll(".other")).toEqual([]);
		expect(el.closest(".row")).toBe(child);
		expect(el.closest(".other")).toBeNull();
	});

	it("keeps an explicit null or falsy answer rather than falling back", () => {
		const el = fakeElement({ closest: { "prose-mirror": false } });

		expect(el.closest("prose-mirror")).toBe(false);
	});

	it("takes a function where one answer does not depend on the selector", () => {
		const el = fakeElement({
			one: () => ({ textContent: "1" }),
			all: (selector) => [selector],
		});

		expect(el.querySelector(".a")).toEqual({ textContent: "1" });
		expect(el.querySelectorAll(".a")).toEqual([".a"]);
	});

	it("carries a dataset, empty by default, and passes other props through", () => {
		expect(fakeElement().dataset).toEqual({});

		const el = fakeElement({
			dataset: { role: "quarry" },
			checked: true,
			value: "3",
			classList: { add: vi.fn() },
		});

		expect(el.dataset.role).toBe("quarry");
		expect(el.checked).toBe(true);
		expect(el.value).toBe("3");
		el.classList.add("is-hidden");
		expect(el.classList.add).toHaveBeenCalledWith("is-hidden");
	});

	it("records listeners and runs only those registered for the emitted type", () => {
		const el = fakeElement();
		const onChange = vi.fn();
		const onClick = vi.fn();
		el.addEventListener("change", onChange, { capture: true });
		el.addEventListener("click", onClick);

		el.emit("change", { target: "a" });

		expect(onChange).toHaveBeenCalledExactlyOnceWith({ target: "a" });
		expect(onClick).not.toHaveBeenCalled();
		expect(el.listeners).toEqual([
			{ type: "change", listener: onChange, options: { capture: true } },
			{ type: "click", listener: onClick, options: undefined },
		]);
	});

	it("emits to every listener of a type, in registration order", () => {
		const el = fakeElement();
		const calls = [];
		el.addEventListener("click", () => calls.push("first"));
		el.addEventListener("click", () => calls.push("second"));

		el.emit("click", {});

		expect(calls).toEqual(["first", "second"]);
	});

	it("does nothing when nothing listens for the emitted type", () => {
		expect(() => fakeElement().emit("click", {})).not.toThrow();
	});

	it("gives each element its own listener list", () => {
		const a = fakeElement();
		const b = fakeElement();
		a.addEventListener("click", () => {});

		expect(a.listeners).toHaveLength(1);
		expect(b.listeners).toHaveLength(0);
	});
});
