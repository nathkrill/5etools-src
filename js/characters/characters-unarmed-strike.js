/**
 * Curated registry of class/subclass/feat features that upgrade a character's basic
 * Unarmed Strike attack — i.e. features that change the damage die or the ability used for
 * the attack and damage rolls.
 *
 * Feature descriptions are free-form prose, so their mechanical effect can't be reliably
 * parsed from text. The relevant features are described here as structured modifiers that the
 * actions engine (`CharactersActions`) can apply on top of the default unarmed strike
 * (`1 + Strength modifier` bludgeoning).
 *
 * A modifier may provide:
 *   - die      {string}   Damage die that replaces the default flat "1" (e.g. "1d4", "1d6").
 *   - ability  {"str"|"dex"|"best"}  Ability used for attack/damage. "best" picks the higher
 *              of Strength and Dexterity (Monk).
 *   - label    {string}   Human-readable source label (for tooltips / debugging).
 *
 * When several modifiers apply, the largest die wins, and any "best"/"dex" ability preference
 * is honoured (so a Monk who also has Tavern Brawler keeps the larger Monk die and Dex).
 */
export class CharactersUnarmedStrike {
	// Monk "Martial Arts" die progression, keyed by class source. Each row is
	// `[minLevel, die]`, highest applicable minLevel wins.
	static _MONK_DICE_BY_SOURCE = {
		// 2014 PHB: d4 / d6 / d8 / d10
		phb: [[1, "1d4"], [5, "1d6"], [11, "1d8"], [17, "1d10"]],
		// 2024 XPHB: d6 / d8 / d10 / d12
		xphb: [[1, "1d6"], [5, "1d8"], [11, "1d10"], [17, "1d12"]],
	};

	static _getMonkDie (classSource, level) {
		const table = this._MONK_DICE_BY_SOURCE[String(classSource || "").toLowerCase()]
			|| this._MONK_DICE_BY_SOURCE.xphb;
		let die = table[0][1];
		table.forEach(([min, d]) => { if (level >= min) die = d; });
		return die;
	}

	// Feats that upgrade the unarmed strike, keyed by `"name|source"` lowercased.
	// A `"name|*"` wildcard matches any source.
	static _FEAT_REGISTRY = {
		// Tavern Brawler (2014 & 2024): unarmed strike uses a d4.
		"tavern brawler|*": {die: "1d4", ability: "str", label: "Tavern Brawler"},
		// Unarmed Fighting (fighting style, 2024): unarmed strike uses a d6 (d8 while holding
		// nothing — not modelled; the baseline d6 is used).
		"unarmed fighting|xphb": {die: "1d6", ability: "str", label: "Unarmed Fighting"},
	};

	static _getFeatModifier (feat) {
		if (!feat?.name) return null;
		const name = String(feat.name).toLowerCase();
		const source = String(feat.source || "").toLowerCase();
		return this._FEAT_REGISTRY[`${name}|${source}`] || this._FEAT_REGISTRY[`${name}|*`] || null;
	}

	/** Higher die of two "NdX" strings (compares faces; falls back to lexical). Returns the larger. */
	static _maxDie (a, b) {
		if (!a) return b;
		if (!b) return a;
		const faces = (s) => Number(String(s).split("d")[1]) || 0;
		return faces(b) > faces(a) ? b : a;
	}

	/**
	 * Resolve the applicable unarmed-strike modifiers for a character.
	 *
	 * @param opts.classInfos Resolved `[{ref, cls, subclass}]` (from
	 *        `CharactersDataUtil.pGetCharacterClasses`).
	 * @param opts.feats Resolved feat entities (with `.name`/`.source`).
	 * @return {{die: string|null, ability: "str"|"dex"|"best", labels: string[]}}
	 *         `die` is the best replacement die (or null for the default flat 1); `ability`
	 *         is the preferred attack/damage ability; `labels` lists contributing sources.
	 */
	static getModifiers ({classInfos = [], feats = []} = {}) {
		let die = null;
		let ability = "str";
		const labels = [];

		// Monk "Martial Arts": Dex-or-Str, martial-arts die by level & edition.
		(classInfos || []).forEach(({ref, cls}) => {
			if (!cls) return;
			if (String(cls.name || "").toLowerCase() !== "monk") return;
			const level = ref?.level || 0;
			if (level < 1) return;
			const monkDie = this._getMonkDie(cls.source, level);
			die = this._maxDie(die, monkDie);
			ability = "best"; // Martial Arts lets a Monk use Dex or Str.
			labels.push("Monk: Martial Arts");
		});

		// Feats that upgrade the unarmed strike (Tavern Brawler, Unarmed Fighting).
		(feats || []).forEach(feat => {
			const mod = this._getFeatModifier(feat);
			if (!mod) return;
			die = this._maxDie(die, mod.die);
			// Only widen the ability preference; never override a Monk's "best" back to "str".
			if (ability === "str" && mod.ability && mod.ability !== "str") ability = mod.ability;
			labels.push(mod.label);
		});

		return {die, ability, labels};
	}
}

globalThis.CharactersUnarmedStrike = CharactersUnarmedStrike;
