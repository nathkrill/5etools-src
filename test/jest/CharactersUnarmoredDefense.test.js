import "../../js/parser.js";
import "../../js/utils.js";
import {CharactersCalc} from "../../js/characters/characters-calc.js";
import {CharactersUnarmoredDefense} from "../../js/characters/characters-unarmored-defense.js";

const classInfoBardDance = ({level = 3} = {}) => ([
	{
		ref: {hash: "bard_xphb", level},
		cls: {name: "Bard", source: "XPHB"},
		subclass: {name: "College of Dance", shortName: "Dance", source: "XPHB"},
	},
]);

const classInfoBarbarian = ({level = 1} = {}) => ([
	{
		ref: {hash: "barbarian_xphb", level},
		cls: {name: "Barbarian", source: "XPHB"},
		subclass: null,
	},
]);

const classInfoMonk = ({level = 1} = {}) => ([
	{
		ref: {hash: "monk_xphb", level},
		cls: {name: "Monk", source: "XPHB"},
		subclass: null,
	},
]);

const classInfoFighter = () => ([
	{
		ref: {hash: "fighter_xphb", level: 5},
		cls: {name: "Fighter", source: "XPHB"},
		subclass: null,
	},
]);

// dex 16 (+3), cha 14 (+2), con 14 (+2), wis 14 (+2)
const abilities = {str: 10, dex: 16, con: 14, int: 10, wis: 14, cha: 14};

describe("CharactersUnarmoredDefense.getOptions", () => {
	it("returns the College of Dance option for a level-3 dance bard", () => {
		const opts = CharactersUnarmoredDefense.getOptions(classInfoBardDance({level: 3}));
		expect(opts).toHaveLength(1);
		expect(opts[0].ability).toBe("cha");
		expect(opts[0].allowShield).toBe(false);
	});

	it("does not return the College of Dance option below level 3", () => {
		expect(CharactersUnarmoredDefense.getOptions(classInfoBardDance({level: 2}))).toHaveLength(0);
	});

	it("returns the Barbarian option (con, shield allowed)", () => {
		const opts = CharactersUnarmoredDefense.getOptions(classInfoBarbarian());
		expect(opts).toHaveLength(1);
		expect(opts[0].ability).toBe("con");
		expect(opts[0].allowShield).toBe(true);
	});

	it("returns the Monk option (wis, no shield)", () => {
		const opts = CharactersUnarmoredDefense.getOptions(classInfoMonk());
		expect(opts).toHaveLength(1);
		expect(opts[0].ability).toBe("wis");
		expect(opts[0].allowShield).toBe(false);
	});

	it("returns nothing for a class without Unarmored Defense", () => {
		expect(CharactersUnarmoredDefense.getOptions(classInfoFighter())).toHaveLength(0);
	});
});

describe("CharactersCalc.getUnarmoredDefenseAc", () => {
	it("computes 10 + Dex + Cha for a dance bard", () => {
		const ac = CharactersCalc.getUnarmoredDefenseAc({abilities}, classInfoBardDance(), {});
		expect(ac).toBe(15); // 10 + 3 + 2
	});

	it("computes 10 + Dex + Con for a barbarian", () => {
		const ac = CharactersCalc.getUnarmoredDefenseAc({abilities}, classInfoBarbarian(), {});
		expect(ac).toBe(15); // 10 + 3 + 2
	});

	it("adds a shield bonus for the barbarian (shield allowed)", () => {
		const ac = CharactersCalc.getUnarmoredDefenseAc({abilities}, classInfoBarbarian(), {hasShield: true, shieldBonus: 2});
		expect(ac).toBe(17); // 10 + 3 + 2 + 2
	});

	it("disables the dance bard's UD while a shield is equipped", () => {
		const ac = CharactersCalc.getUnarmoredDefenseAc({abilities}, classInfoBardDance(), {hasShield: true, shieldBonus: 2});
		expect(ac).toBeNull();
	});

	it("returns null for a class without Unarmored Defense", () => {
		expect(CharactersCalc.getUnarmoredDefenseAc({abilities}, classInfoFighter(), {})).toBeNull();
	});
});

describe("CharactersCalc.getArmorClass with Unarmored Defense", () => {
	it("applies College of Dance UD while unarmored", () => {
		const ac = CharactersCalc.getArmorClass({abilities}, null, null, classInfoBardDance());
		expect(ac).toBe(15); // 10 + 3 + 2
	});

	it("falls back to 10 + Dex when no UD and unarmored", () => {
		const ac = CharactersCalc.getArmorClass({abilities}, null, null, classInfoFighter());
		expect(ac).toBe(13); // 10 + 3
	});

	it("prefers the higher of manual base and UD", () => {
		// Manual base 16 (+ dex = 19) beats UD (15)
		const ac = CharactersCalc.getArmorClass({abilities, ac: {base: 16}}, null, null, classInfoBardDance());
		expect(ac).toBe(19);
	});

	it("respects an explicit override, ignoring UD", () => {
		const ac = CharactersCalc.getArmorClass({abilities, ac: {override: 12}}, null, null, classInfoBardDance());
		expect(ac).toBe(12);
	});

	it("computes barbarian UD when unarmored", () => {
		const ac = CharactersCalc.getArmorClass({abilities}, null, null, classInfoBarbarian());
		expect(ac).toBe(15); // 10 + 3 + 2
	});
});
