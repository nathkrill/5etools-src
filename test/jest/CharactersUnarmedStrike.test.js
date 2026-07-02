import "../../js/parser.js";
import "../../js/utils.js";
import {CharactersUnarmedStrike} from "../../js/characters/characters-unarmed-strike.js";

const monk = ({level = 1, source = "XPHB"} = {}) => ([
	{
		ref: {hash: `monk_${source.toLowerCase()}`, level},
		cls: {name: "Monk", source},
		subclass: null,
	},
]);

const fighter = ({level = 5} = {}) => ([
	{
		ref: {hash: "fighter_xphb", level},
		cls: {name: "Fighter", source: "XPHB"},
		subclass: null,
	},
]);

const featTavernBrawler = (source = "XPHB") => ({name: "Tavern Brawler", source});
const featUnarmedFighting = () => ({name: "Unarmed Fighting", source: "XPHB"});

describe("CharactersUnarmedStrike.getModifiers", () => {
	it("returns no die and str for a plain character", () => {
		const {die, ability, labels} = CharactersUnarmedStrike.getModifiers({classInfos: fighter(), feats: []});
		expect(die).toBeNull();
		expect(ability).toBe("str");
		expect(labels).toEqual([]);
	});

	it("returns no die and str for empty inputs", () => {
		const {die, ability} = CharactersUnarmedStrike.getModifiers({});
		expect(die).toBeNull();
		expect(ability).toBe("str");
	});

	describe("Monk Martial Arts (2024 / XPHB)", () => {
		it.each([
			[1, "1d6"],
			[4, "1d6"],
			[5, "1d8"],
			[10, "1d8"],
			[11, "1d10"],
			[16, "1d10"],
			[17, "1d12"],
			[20, "1d12"],
		])("level %i -> %s", (level, expected) => {
			const {die, ability} = CharactersUnarmedStrike.getModifiers({classInfos: monk({level, source: "XPHB"}), feats: []});
			expect(die).toBe(expected);
			expect(ability).toBe("best");
		});
	});

	describe("Monk Martial Arts (2014 / PHB)", () => {
		it.each([
			[1, "1d4"],
			[4, "1d4"],
			[5, "1d6"],
			[10, "1d6"],
			[11, "1d8"],
			[16, "1d8"],
			[17, "1d10"],
			[20, "1d10"],
		])("level %i -> %s", (level, expected) => {
			const {die, ability} = CharactersUnarmedStrike.getModifiers({classInfos: monk({level, source: "PHB"}), feats: []});
			expect(die).toBe(expected);
			expect(ability).toBe("best");
		});
	});

	it("Tavern Brawler (PHB) grants a d4 with str", () => {
		const {die, ability, labels} = CharactersUnarmedStrike.getModifiers({classInfos: fighter(), feats: [featTavernBrawler("PHB")]});
		expect(die).toBe("1d4");
		expect(ability).toBe("str");
		expect(labels).toContain("Tavern Brawler");
	});

	it("Tavern Brawler (XPHB) grants a d4 with str", () => {
		const {die} = CharactersUnarmedStrike.getModifiers({classInfos: fighter(), feats: [featTavernBrawler("XPHB")]});
		expect(die).toBe("1d4");
	});

	it("Unarmed Fighting (XPHB) grants a d6 with str", () => {
		const {die, ability, labels} = CharactersUnarmedStrike.getModifiers({classInfos: fighter(), feats: [featUnarmedFighting()]});
		expect(die).toBe("1d6");
		expect(ability).toBe("str");
		expect(labels).toContain("Unarmed Fighting");
	});

	it("picks the largest die when several modifiers apply", () => {
		// L5 XPHB Monk (d8) + Tavern Brawler (d4) -> d8, and ability stays 'best'.
		const {die, ability} = CharactersUnarmedStrike.getModifiers({
			classInfos: monk({level: 5, source: "XPHB"}),
			feats: [featTavernBrawler("XPHB")],
		});
		expect(die).toBe("1d8");
		expect(ability).toBe("best");
	});

	it("keeps Monk's 'best' ability even when a str-only feat is present", () => {
		const {ability} = CharactersUnarmedStrike.getModifiers({
			classInfos: monk({level: 1, source: "XPHB"}),
			feats: [featUnarmedFighting()],
		});
		expect(ability).toBe("best");
	});

	it("promotes ability to the feat's when no Monk levels are present", () => {
		// Unarmed Fighting is str-only, so ability remains str; combine with a low-level check.
		const {ability, die} = CharactersUnarmedStrike.getModifiers({
			classInfos: fighter(),
			feats: [featUnarmedFighting(), featTavernBrawler("XPHB")],
		});
		expect(ability).toBe("str");
		expect(die).toBe("1d6"); // d6 (Unarmed Fighting) beats d4 (Tavern Brawler)
	});
});
