import {CharactersCalc} from "./characters-calc.js";

/**
 * Aggregates the abilities/actions available to a character for the sheet's
 * "Abilities & Actions" panel: equipped-weapon attacks plus class/subclass, racial,
 * feat, and background features.
 *
 * The underlying game data does not store an entry's action-economy type or its
 * limited-use count in a structured field for class/race/feat/background features
 * (only `actions.json`-style entries carry a structured `time`). Those facts are
 * embedded in prose via tags like `{@variantrule Bonus Action|...}`, `{@action ...}`,
 * `{@variantrule Reaction|...}`, and phrases such as "once per long rest". This util
 * therefore derives both via heuristics, which the player can override on the sheet.
 */
export class CharactersActions {
	/* -------------------------------------------- Categories -------------------------------------------- */

	static CAT_ACTION = "action";
	static CAT_BONUS = "bonus";
	static CAT_REACTION = "reaction";
	static CAT_PASSIVE = "passive";

	static CATEGORIES = [
		{id: this.CAT_ACTION, name: "Action"},
		{id: this.CAT_BONUS, name: "Bonus Action"},
		{id: this.CAT_REACTION, name: "Reaction"},
		{id: this.CAT_PASSIVE, name: "Passive / Other"},
	];

	static isCategory (id) { return this.CATEGORIES.some(it => it.id === id); }

	/* -------------------------------------------- Reset timing -------------------------------------------- */

	static RESET_SHORT = "short"; // recovers on a short or long rest
	static RESET_LONG = "long"; // recovers on a long rest only
	static RESET_NONE = "none"; // manual reset only (e.g. per day, per turn)

	/* -------------------------------------------- Public: collect -------------------------------------------- */

	/**
	 * Build the full list of abilities for a character.
	 * @param opts
	 * @param opts.character The character object (for ability mods, proficiencies, overrides).
	 * @param opts.classInfos Resolved `[{ref, cls, subclass}]` (from the sheet).
	 * @param opts.race Resolved race entity, or null.
	 * @param opts.feats Resolved feat entities.
	 * @param opts.background Resolved background entity, or null.
	 * @param opts.inventory Resolved `[{entry, item}]` inventory entries.
	 * @return {Array<object>} Abilities, each: {id, name, sourceLabel, kind, category, entries,
	 *   uses: {max, resetOn}|null, weapon: {...}|null, ent}.
	 */
	static getAbilities ({character, classInfos = [], race = null, feats = [], background = null, inventory = []}) {
		const out = [];

		this._addWeaponAttacks({out, character, inventory});
		this._addClassFeatures({out, character, classInfos});
		this._addRacialTraits({out, race});
		this._addFeats({out, feats});
		this._addBackgroundFeatures({out, background});

		// Apply any player overrides (manual tab re-assignment), stored by ability id.
		const overrides = character.abilityOverrides || {};
		out.forEach(ab => {
			const ov = overrides[ab.id];
			if (ov && this.isCategory(ov)) ab.category = ov;
		});

		return out;
	}

	/** Group a flat ability list by category id, preserving each list's order. */
	static groupByCategory (abilities) {
		const byCat = {};
		this.CATEGORIES.forEach(cat => { byCat[cat.id] = []; });
		abilities.forEach(ab => { (byCat[ab.category] = byCat[ab.category] || []).push(ab); });
		return byCat;
	}

	/* -------------------------------------------- Collectors -------------------------------------------- */

	static _addWeaponAttacks ({out, character, inventory}) {
		(inventory || []).forEach(({entry, item}) => {
			if (!entry?.equipped || !item) return;
			if (!(item.weapon || item.weaponCategory)) return;

			const attack = this.getWeaponAttack({character, item});
			out.push({
				id: this._getAbilityId("weapon", item.source, item.name),
				name: item.name,
				sourceLabel: "Weapon",
				kind: "weapon",
				category: this.CAT_ACTION,
				entries: null,
				uses: null,
				weapon: attack,
				ent: item,
			});
		});
	}

	static _addClassFeatures ({out, character, classInfos}) {
		const addFrom = (grouped, level, fnLabel, sourceFallback) => {
			(grouped || []).forEach(group => {
				if (!Array.isArray(group)) return;
				group.forEach(feat => {
					if (!feat || typeof feat !== "object" || !feat.entries) return;
					const featLevel = feat.level || 1;
					if (featLevel > level) return;
					out.push(this._featureToAbility({
						feat,
						sourceLabel: fnLabel(featLevel),
						kind: "class",
						source: feat.source || sourceFallback,
						character,
					}));
				});
			});
		};

		(classInfos || []).forEach(({ref, cls, subclass}) => {
			const level = ref.level || 0;
			addFrom(cls.classFeatures, level, (l) => `${cls.name} ${l}`, cls.source);
			if (subclass) addFrom(subclass.subclassFeatures, level, (l) => `${cls.name}: ${subclass.name} ${l}`, subclass.source);
		});
	}

	static _addRacialTraits ({out, race}) {
		if (!race?.entries) return;
		const label = race._displayName || race.name || "Race";
		race.entries
			.filter(ent => ent && typeof ent === "object" && ent.name && ent.entries)
			.forEach(ent => {
				out.push(this._featureToAbility({
					feat: ent,
					sourceLabel: label,
					kind: "racial",
					source: race.source,
				}));
			});
	}

	static _addFeats ({out, feats}) {
		(feats || [])
			.filter(feat => feat && feat.entries)
			.forEach(feat => {
				out.push(this._featureToAbility({
					feat: {name: feat.name, entries: feat.entries},
					sourceLabel: "Feat",
					kind: "feat",
					source: feat.source,
				}));
			});
	}

	static _addBackgroundFeatures ({out, background}) {
		if (!background?.entries) return;
		const label = background.name || "Background";
		// Background `entries` mix flavor strings with named feature blocks; surface only the
		// named features (e.g. a background's "Feature: ...").
		background.entries
			.filter(ent => ent && typeof ent === "object" && ent.name && ent.entries)
			.forEach(ent => {
				out.push(this._featureToAbility({
					feat: ent,
					sourceLabel: label,
					kind: "background",
					source: background.source,
				}));
			});
	}

	/** Convert a feature-like entry into an ability descriptor, deriving category + uses. */
	static _featureToAbility ({feat, sourceLabel, kind, source, character = null}) {
		const text = this._flattenText(feat.entries);
		return {
			id: this._getAbilityId(kind, source, feat.name),
			name: feat.name || sourceLabel,
			sourceLabel,
			kind,
			category: this._detectCategory({ent: feat, text}),
			entries: feat.entries,
			uses: this._detectUses({ent: feat, text}),
			weapon: null,
			ent: feat,
		};
	}

	/* -------------------------------------------- Ability ids -------------------------------------------- */

	/** Stable id for storing per-ability state (uses, tab override). */
	static _getAbilityId (kind, source, name) {
		return `${kind}|${(source || "").toLowerCase()}|${(name || "").toLowerCase()}`;
	}

	/* -------------------------------------------- Category detection -------------------------------------------- */

	/**
	 * Guess an ability's action-economy category. Honours a structured `time` array first
	 * (as on `actions.json` entries), then scans the rendered-tag text for the first
	 * action-economy reference.
	 */
	static _detectCategory ({ent, text}) {
		// Structured time (action-style entries).
		const time = ent.time?.[0] || ent.time;
		const unit = time?.unit;
		if (unit === Parser.SP_TM_ACTION) return this.CAT_ACTION;
		if (unit === Parser.SP_TM_B_ACTION) return this.CAT_BONUS;
		if (unit === Parser.SP_TM_REACTION) return this.CAT_REACTION;

		const lc = (text || "").toLowerCase();

		// Reaction is the most specific signal; check it first.
		if (/\{@(?:variantrule|action)\s+reaction\b/.test(lc) || /\btake a reaction\b/.test(lc) || /\bas a reaction\b/.test(lc)) return this.CAT_REACTION;
		if (/\{@(?:variantrule|action)\s+bonus action\b/.test(lc) || /\bas a bonus action\b/.test(lc) || /\bbonus action\b/.test(lc)) return this.CAT_BONUS;
		if (/\{@(?:variantrule|action)\s+(?:magic|attack|dash|dodge|disengage|hide|search|influence|study|utilize|ready)\b/.test(lc) || /\bas an action\b/.test(lc) || /\btake the [^.]*action\b/.test(lc) || /\bas a magic action\b/.test(lc)) return this.CAT_ACTION;

		return this.CAT_PASSIVE;
	}

	/* -------------------------------------------- Uses detection -------------------------------------------- */

	/**
	 * Attempt to derive a limited-use budget from prose. Returns `{max, resetOn}` or null.
	 * Recognises "N times", "a number of times equal to ...", "once", and the rest cadence
	 * ("per long rest" / "per short or long rest" / "per day"). Conservative: if no count
	 * can be read, returns null (the player can still add tracking manually).
	 */
	static _detectUses ({ent, text}) {
		const lc = (text || "").toLowerCase();
		if (!lc) return null;

		// Determine reset cadence.
		let resetOn = null;
		if (/short or long rest|short rest or long rest/.test(lc)) resetOn = this.RESET_SHORT;
		else if (/long rest/.test(lc)) resetOn = this.RESET_LONG;
		else if (/short rest/.test(lc)) resetOn = this.RESET_SHORT;
		else if (/per day|each day|long rest|dawn/.test(lc)) resetOn = this.RESET_LONG;

		// Only treat as limited-use if there's an explicit usage-limit phrasing.
		const hasLimitPhrasing = /you can use (?:this|it)|uses? of (?:this|it)|times equal to|once you use|expend|can't do so again|you have \d+ use/.test(lc);

		// Find an explicit numeric count near "times".
		let max = null;
		const numTimes = lc.match(/\b(\d+)\s+times\b/);
		if (numTimes) max = Number(numTimes[1]);
		else if (/\bonce\b/.test(lc) || /can't do so again until/.test(lc) || /can't use it again until/.test(lc)) max = 1;
		else if (/twice\b/.test(lc)) max = 2;
		else if (/times equal to your proficiency bonus/.test(lc)) max = null; // variable; let user set

		if (!resetOn && !hasLimitPhrasing) return null;
		if (max == null) {
			// Variable/proficiency-based or otherwise unreadable count: only surface a tracker
			// when there's clear rest-recovery + limit phrasing, defaulting to 1 for the player to edit.
			if (resetOn && hasLimitPhrasing) max = 1;
			else return null;
		}

		return {max, resetOn: resetOn || this.RESET_NONE};
	}

	/* -------------------------------------------- Text helpers -------------------------------------------- */

	/** Flatten an entries tree into a single searchable string (keeps tags intact). */
	static _flattenText (entries) {
		const parts = [];
		const walk = (node) => {
			if (node == null) return;
			if (typeof node === "string") { parts.push(node); return; }
			if (Array.isArray(node)) { node.forEach(walk); return; }
			if (typeof node === "object") {
				if (node.name) parts.push(node.name);
				if (node.entries) walk(node.entries);
				if (node.entry) walk(node.entry);
				if (node.items) walk(node.items);
			}
		};
		walk(entries);
		return parts.join(" ");
	}

	/* -------------------------------------------- Weapon attacks -------------------------------------------- */

	/**
	 * Compute a weapon's attack and damage for the given character.
	 * @return {object} {abil, toHit, isProficient, magicBonus, damage: [{formula, type}], range, properties[]}
	 */
	static getWeaponAttack ({character, item}) {
		const isFinesse = this._weaponHasProperty(item, Parser.ITM_PROP_ABV__FINESSE);
		const isRanged = this._isRangedWeapon(item);
		const isThrown = this._weaponHasProperty(item, Parser.ITM_PROP_ABV__THROWN);

		// Ability used: ranged -> DEX; finesse -> better of STR/DEX; else STR.
		const strMod = CharactersCalc.getAbilityModifier(character, "str");
		const dexMod = CharactersCalc.getAbilityModifier(character, "dex");
		let abil;
		let abilMod;
		if (isRanged && !isThrown) { abil = "dex"; abilMod = dexMod; } else if (isFinesse || isThrown) { abil = dexMod > strMod ? "dex" : "str"; abilMod = Math.max(strMod, dexMod); } else { abil = "str"; abilMod = strMod; }

		const pb = CharactersCalc.getProficiencyBonus(character);
		const isProficient = this._isProficientWithWeapon({character, item});
		const magicBonus = Number(item.bonusWeaponAttack ? item.bonusWeaponAttack.replace(/[^-\d]/g, "") : 0) || Number(item.bonusWeapon ? item.bonusWeapon.replace(/[^-\d]/g, "") : 0) || 0;

		const toHit = abilMod + (isProficient ? pb : 0) + magicBonus;

		const dmgMagic = magicBonus || (Number(item.bonusWeaponDamage ? item.bonusWeaponDamage.replace(/[^-\d]/g, "") : 0) || 0);
		const damage = [];
		if (item.dmg1) damage.push({formula: this._buildDamageFormula(item.dmg1, abilMod, dmgMagic), type: item.dmgType, label: "Damage"});
		if (item.dmg2) damage.push({formula: this._buildDamageFormula(item.dmg2, abilMod, dmgMagic), type: item.dmgType, label: "Versatile"});

		return {
			abil,
			abilMod,
			toHit,
			isProficient,
			magicBonus,
			damage,
			range: item.range || null,
			isRanged,
			properties: item.property || [],
		};
	}

	/** Build a damage formula string like "1d8 + 3" (+ optional magic bonus), trimming a zero modifier. */
	static _buildDamageFormula (dice, abilMod, magicBonus = 0) {
		const total = (abilMod || 0) + (magicBonus || 0);
		if (!total) return `${dice}`;
		return `${dice} ${total > 0 ? "+" : "-"} ${Math.abs(total)}`;
	}

	/** A weapon is ranged when its base type is "R" (handle source-suffixed types like "R|XPHB"). */
	static _isRangedWeapon (item) {
		const abv = (item.type || "").split("|")[0];
		return abv === "R";
	}

	/** Test whether a weapon carries a given property abbreviation (properties may be source-suffixed). */
	static _weaponHasProperty (item, propAbv) {
		return (item.property || []).some(p => (typeof p === "string" ? p : p?.uid || "").split("|")[0] === propAbv);
	}

	/**
	 * Determine weapon proficiency. Matches the character's `proficiencies.weapons` against the
	 * weapon's category ("simple"/"martial"), the literal weapon name, and the common
	 * "simple weapons"/"martial weapons" phrasings.
	 */
	static _isProficientWithWeapon ({character, item}) {
		const profs = (character.proficiencies?.weapons || []).map(p => (p || "").toLowerCase().trim());
		if (!profs.length) return false;
		const cat = (item.weaponCategory || "").toLowerCase();
		const name = (item.name || "").toLowerCase();
		return profs.some(p =>
			p === cat
			|| p === `${cat} weapons`
			|| p === `${cat} weapon`
			|| p === name
			|| (p.endsWith("s") && p.slice(0, -1) === name)
			|| name.includes(p),
		);
	}
}

globalThis.CharactersActions = CharactersActions;
